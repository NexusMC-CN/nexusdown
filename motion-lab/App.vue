<script setup lang="ts">
/**
 * Motion Lab —— **帧级审片工作台**。
 *
 * ## 它解决什么问题
 *
 * 演示是 120×44 的小画布、1.8 秒跑完。肉眼看只能得到"好像动了"，
 * 得不到"第 47 帧文字右移了 1px"。这个页面的全部意义就是**把时间轴摊开**：
 *
 * | 能力 | 怎么实现 |
 * | --- | --- |
 * | 重播 / 暂停 / 0.1x | `getAnimations()` → `play()` / `pause()` / `playbackRate` |
 * | 逐帧 ±16.7ms | `currentTime ± 16.7`（60fps 一帧） |
 * | 时间轴 scrub | 滑轨 → `pause()` + `currentTime = t` |
 * | 属性审计 | `effect.getKeyframes()` → 逐条分类 layout / paint / 合成 |
 * | 三条贝塞尔曲线 | 从 `--nd-motion-*` **令牌读值**再画，不是抄一份数字 |
 * | 深链冻结 | `?demo=<id>&t=<ms>`，截图脚本靠它拿稳定帧 |
 *
 * ## ⚠️ 为什么用 `document.getAnimations()` 而不是 CSS 类名
 *
 * 演示的动画**常驻声明、默认 `paused`**（见 `demos.css` 的「播放机制」）。
 * 也就是说动画对象**一直存在**，可以随时 `pause()` 到任意 `currentTime`。
 * 如果动画是"hover 时才赋名字"的，那就只能看，不能停在任意帧。
 *
 * ## ⚠️ 为什么动画对象用 `shallowRef`
 *
 * `Animation` 是浏览器对象。放进 `ref([])` 会被 Vue 深度代理 ——
 * `anim.currentTime = t` 打到的是 Proxy，某些实现下不生效且**不报错**。
 * 数组本身需要响应式（要重渲染审计表），所以 `shallowRef`：数组换了会更新，
 * 元素不被代理。
 */
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import DemoStage from '../src/editor/demos/DemoStage.vue'
import {
  classifyProp,
  DEMO_BEATS,
  DEMOS,
  getDemo,
  type DemoSpec,
  type PropKind,
} from '../src/editor/demos/demos'
import { DIALECT_SYNTAXES } from '../playground/src/fixtures'

defineOptions({ name: 'MotionLabApp' })

/* ---------------------------------------------------------------- 常量 */

/** 60fps 一帧。逐帧步进就按这个数走（工单里写的 ±16.7ms 就是它）。 */
const FRAME_MS = 16.7

/** 三条曲线的展示配置（颜色只在这里定，曲线本身从令牌读）。 */
const CURVE_SPECS = [
  { token: '--nd-motion-snap', label: 'snap', fallback: [0.16, 1, 0.3, 1], color: '#2f6feb', note: '出现 / 行 / 补位' },
  { token: '--nd-motion-mech', label: 'mech', fallback: [0.7, 0, 0.2, 1], color: '#b42318', note: '快门 / 擦入 / 所有退出' },
  { token: '--nd-motion-ease', label: 'ease', fallback: [0.2, 0.7, 0.1, 1], color: '#1a7f37', note: '普通过渡 / 颜色' },
] as const

/* ---------------------------------------------------------------- 状态 */

const params = new URLSearchParams(window.location.search)

/** 深链里的 `t`（没有就是 `null` —— 注意 `t=0` 是合法的冻结帧）。 */
const deepTime = params.has('t') ? Number(params.get('t')) : null

const demoId = ref<string>(
  (() => {
    const wanted = params.get('demo')
    return wanted && getDemo(wanted) ? wanted : DEMOS[0]!.id
  })(),
)

const spec = computed<DemoSpec>(() => getDemo(demoId.value) ?? DEMOS[0]!)

const duration = computed(() => spec.value.duration)
const totalFrames = computed(() => Math.ceil(duration.value / FRAME_MS))

const time = ref(0)
const playing = ref(false)
const rate = ref(1)

/** 画布台的包裹元素 —— 从它身上 `querySelector('.demo-stage')` 拿动画。 */
const stageWrap = ref<HTMLElement | null>(null)

/** ⚠️ `shallowRef`：元素不能被代理（见文件头）。 */
const animations = shallowRef<Animation[]>([])

const audit = ref<Array<{ name: string; props: Array<{ prop: string; kind: PropKind }> }>>([])

const layoutHits = computed(() =>
  audit.value.flatMap((row) =>
    row.props.filter((p) => p.kind === 'layout').map((p) => `${row.name} → ${p.prop}`),
  ),
)

const frame = computed(() => Math.min(Math.floor(time.value / FRAME_MS), totalFrames.value - 1))

/* ---------------------------------------------------------------- 画廊 */

const coveredCount = computed(
  () => DIALECT_SYNTAXES.filter((syntax) => DEMOS.some((demo) => demo.syntax === syntax.id)).length,
)

/** 按 `DIALECT_SYNTAXES` 的顺序分组 —— 和方言文档 / playground 画廊对得上。 */
const groups = computed(() => {
  const rows = DIALECT_SYNTAXES.map((syntax) => ({
    syntax: syntax.id,
    label: syntax.label,
    demos: DEMOS.filter((demo) => demo.syntax === syntax.id),
  }))
  const action = DEMOS.filter((demo) => demo.syntax === 'action')
  if (action.length) rows.push({ syntax: 'action', label: '工具栏动作（无语法）', demos: action })
  return rows
})

/* ---------------------------------------------------------------- 动画驱动 */

/** 等一帧：`requestAnimationFrame` 在无头/后台可能被节流，所以带超时兜底。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(finish)
    setTimeout(finish, 120)
  })
}

/**
 * 收集画布里的**全部**动画。
 *
 * ⚠️⚠️ **必须用 `document.getAnimations()` 再按"目标是否在画布里"过滤，
 * 不能逐个元素 `el.getAnimations()`。**
 *
 * 实测（Chrome）：`Element.getAnimations()` **不返回伪元素的动画** ——
 * 而这里恰好有 4 条挂在伪元素上：行内代码的灰底（`::before`）、
 * 链接和自动链接的下划线（`::after`）、高亮的记号笔（`::before`）。
 * 漏掉它们不会报错，只会表现为"这 4 条永远停在 0%" ——
 * 而审计表少几行是看不出来的（`demo-link-underline` 根本不会出现）。
 *
 * `KeyframeEffect.target` 对伪元素动画返回的是**宿主元素**，所以
 * `stage.contains(target)` 一条就够，顺便把 Lab 自己的界面动画挡在外面。
 */
function collectAnimations(): Animation[] {
  const stage = stageWrap.value?.querySelector('.demo-stage')
  if (!stage) return []
  return document.getAnimations().filter((anim) => {
    const target = (anim.effect as KeyframeEffect | null)?.target
    return target instanceof Element && (target === stage || stage.contains(target))
  })
}

/** 读关键帧，把动的属性逐条分类（layout 标红）。 */
function readAudit(list: Animation[]) {
  return list.map((anim) => {
    const effect = anim.effect as KeyframeEffect | null
    const frames = (effect?.getKeyframes?.() ?? []) as Array<Record<string, unknown>>
    const props = new Set<string>()
    for (const frame of frames) {
      for (const key of Object.keys(frame)) {
        /* `getKeyframes()` 的元字段不是"动的属性"。 */
        if (key === 'offset' || key === 'computedOffset' || key === 'easing' || key === 'composite') continue
        props.add(key)
      }
    }
    /* 伪元素的动画名后面挂上 `::before` / `::after` —— 否则审计表里看不出
       哪条动画其实画在伪元素上，而那正是最容易漏审的一类。 */
    const base = (anim as CSSAnimation).animationName ?? 'animation'
    const name = `${base}${effect?.pseudoElement ?? ''}`
    return {
      name,
      props: [...props].map((prop) => ({ prop, kind: classifyProp(prop) })),
    }
  })
}

let rafId = 0

function stopLoop() {
  playing.value = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

function loop() {
  const first = animations.value[0]
  if (!playing.value || !first) return
  if (typeof first.currentTime === 'number') time.value = first.currentTime
  if (time.value >= duration.value) {
    pauseAll()
    scrub(duration.value)
    return
  }
  rafId = requestAnimationFrame(loop)
}

function applyRate() {
  for (const anim of animations.value) anim.playbackRate = rate.value
}

function pauseAll() {
  stopLoop()
  for (const anim of animations.value) anim.pause()
}

/** 跳到某一毫秒并停住（scrub / 逐帧 / 深链都用这一条）。 */
function scrub(ms: number) {
  const clamped = Math.max(0, Math.min(duration.value, ms))
  stopLoop()
  for (const anim of animations.value) {
    anim.pause()
    anim.currentTime = clamped
  }
  time.value = clamped
}

function play() {
  if (!animations.value.length) return
  if (time.value >= duration.value) scrub(0)
  applyRate()
  for (const anim of animations.value) anim.play()
  playing.value = true
  rafId = requestAnimationFrame(loop)
}

function replay() {
  scrub(0)
  play()
}

function setRate(value: number) {
  rate.value = value
  applyRate()
}

function stepFrames(delta: number) {
  scrub(time.value + delta * FRAME_MS)
}

function onScrub(event: Event) {
  scrub(Number((event.target as HTMLInputElement).value))
  syncUrl()
}

/* ---------------------------------------------------------------- 切换演示 */

/** 把当前状态写回地址栏 —— 复制链接就能把"这个演示的这一帧"发给别人。 */
function syncUrl() {
  const url = new URL(window.location.href)
  url.searchParams.set('demo', demoId.value)
  url.searchParams.set('t', String(Math.round(time.value)))
  window.history.replaceState(null, '', url)
}

/**
 * 挂上新演示的动画并**重新审计**。
 *
 * ⚠️ 必须等两件事：DOM 更新完（`nextTick`）+ 样式应用完（一帧）。
 * 样式没应用时 `getAnimations()` 是**空数组** —— 而空数组不报错，
 * 只表现为"审计表是空的、时间轴拖不动"，很容易被当成"这个演示没有动画"。
 */
async function mountAnimations(freezeAt: number | null) {
  await nextTick()
  await nextFrame()

  animations.value = collectAnimations()
  audit.value = readAudit(animations.value)

  if (freezeAt !== null && Number.isFinite(freezeAt)) scrub(freezeAt)
  else scrub(0)

  /*
   * 截图脚本等这个标记。`data-ready` 落在 `<html>` 上而不是某个元素上：
   * 它描述的是"这一页可以拍了"，不是"某个组件渲染完了"。
   */
  document.documentElement.dataset.ready = '1'
}

watch(demoId, () => {
  syncUrl()
  void mountAnimations(deepTime)
})

onMounted(() => {
  void mountAnimations(deepTime)
})

/* ---------------------------------------------------------------- 三条曲线 */

/**
 * 从 `--nd-motion-*` 读真实值再画 —— **不抄数字**。
 *
 * 抄一份的话，令牌改了图还是旧的，而"图看着对"恰恰是最容易骗过审片的证据。
 */
function readCurve(token: string, fallback: readonly number[]): { raw: string; points: number[] } {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const numbers = raw.match(/-?\d*\.?\d+/g)?.map(Number) ?? []
  if (numbers.length >= 4) return { raw, points: numbers.slice(0, 4) }
  return { raw: `cubic-bezier(${fallback.join(', ')})`, points: [...fallback] }
}

/** 三次贝塞尔采样成 SVG 路径（y 轴翻转：CSS 的 1 在顶上）。 */
function curvePath(points: number[]): string {
  const [x1, y1, x2, y2] = points as [number, number, number, number]
  const steps = 48
  const dots: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const x = 3 * t * u * u * x1 + 3 * t * t * u * x2 + t * t * t
    const y = 3 * t * u * u * y1 + 3 * t * t * u * y2 + t * t * t
    dots.push(`${(x * 100).toFixed(2)},${((1 - y) * 100).toFixed(2)}`)
  }
  return `M${dots.join(' L')}`
}

const curves = computed(() =>
  CURVE_SPECS.map((item) => {
    const { raw, points } = readCurve(item.token, item.fallback)
    return { ...item, raw, path: curvePath(points) }
  }),
)

/* ---------------------------------------------------------------- 展示用 */

const beatPercent = computed(() => DEMO_BEATS)
</script>

<template>
  <div class="lab" :class="{ 'lab-playing': playing }">
    <!-- ------------------------------------------------------------ 画廊 -->
    <aside class="lab-gallery">
      <div class="lab-gallery__head">
        <h1 class="lab-gallery__title">Motion Lab</h1>
        <span
          class="lab-badge"
          :class="{ 'lab-badge--bad': coveredCount !== DIALECT_SYNTAXES.length }"
          :title="`${coveredCount} 条语法有演示`"
        >
          {{ coveredCount }} / {{ DIALECT_SYNTAXES.length }}
        </span>
      </div>

      <div class="lab-gallery__list">
        <div v-for="group in groups" :key="group.syntax" class="lab-group">
          <div class="lab-group__head">
            <span>{{ group.label }}</span>
            <span class="lab-group__id">{{ group.syntax }}</span>
          </div>
          <p v-if="!group.demos.length" class="lab-group__empty">没有演示 ⚠️</p>
          <button
            v-for="demo in group.demos"
            :key="demo.id"
            type="button"
            class="lab-item"
            :class="{ on: demo.id === demoId }"
            @click="demoId = demo.id"
          >
            <span>{{ demo.label }}</span>
            <span class="lab-item__id">{{ demo.id }}</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- ------------------------------------------------------------ 控制台 -->
    <main class="lab-console">
      <div class="lab-console__head">
        <h2 class="lab-console__title">{{ spec.label }}</h2>
        <span class="lab-meta">{{ spec.id }} · {{ spec.syntax }}</span>
        <span class="lab-meta">{{ duration }}ms · {{ totalFrames }} 帧 · 拍点 {{ beatPercent.join(' / ') }}%</span>
      </div>

      <!-- 画布：和工具栏卡片里**同一个** DemoStage -->
      <div ref="stageWrap" class="lab-stage">
        <div class="lab-canvas">
          <DemoStage :spec="spec" />
        </div>
      </div>

      <div class="lab-controls">
        <button type="button" class="lab-btn" @click="replay">重播</button>
        <button type="button" class="lab-btn" :class="{ on: !playing }" @click="pauseAll">暂停</button>
        <button type="button" class="lab-btn" :class="{ on: rate === 0.1 }" @click="setRate(rate === 0.1 ? 1 : 0.1)">
          0.1x
        </button>
        <button type="button" class="lab-btn lab-btn--icon" title="上一帧（-16.7ms）" @click="stepFrames(-1)">◀ 帧</button>
        <button type="button" class="lab-btn lab-btn--icon" title="下一帧（+16.7ms）" @click="stepFrames(1)">帧 ▶</button>
        <button type="button" class="lab-btn" @click="scrub(0)">回到 0%</button>
        <button type="button" class="lab-btn" @click="scrub(duration)">到 100%</button>
        <span class="lab-readout">
          t <b>{{ Math.round(time) }}</b> / {{ duration }}ms · 帧 <b>{{ frame }}</b> / {{ totalFrames }} ·
          <b>{{ ((time / duration) * 100).toFixed(1) }}%</b> · {{ playing ? `播放中 ${rate}x` : '已暂停' }}
        </span>
      </div>

      <div class="lab-timeline">
        <input
          type="range"
          min="0"
          :max="duration"
          step="1"
          :value="Math.round(time)"
          aria-label="时间轴"
          @input="onScrub"
        >
        <span v-for="beat in beatPercent" :key="beat" class="lab-beat" :style="{ left: `${beat}%` }">
          <span class="lab-beat__label">{{ beat }}%</span>
        </span>
      </div>

      <!-- 属性审计 -->
      <section class="lab-section">
        <h3 class="lab-section__title">属性审计（读 effect.getKeyframes()）</h3>
        <p class="lab-verdict" :class="layoutHits.length ? 'lab-verdict--bad' : 'lab-verdict--ok'">
          <template v-if="layoutHits.length">
            ⚠️ 动了 layout 属性 {{ layoutHits.length }} 条：{{ layoutHits.join('；') }}
          </template>
          <template v-else>
            ✓ 无 layout 属性（{{ audit.length }} 条动画；绿 = 合成，黄 = 重绘，红 = 排版）
          </template>
        </p>
        <p v-if="!audit.length" class="lab-empty">没有读到动画 —— 可能样式还没应用，试试切走再切回来。</p>
        <table v-else class="lab-audit">
          <thead>
            <tr>
              <th>@keyframes</th>
              <th>动的属性</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in audit" :key="row.name">
              <td class="lab-audit__name">{{ row.name }}</td>
              <td>
                <span v-for="p in row.props" :key="p.prop" class="lab-prop" :class="`lab-prop--${p.kind}`">
                  {{ p.prop }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 三条曲线 -->
      <section class="lab-section">
        <h3 class="lab-section__title">三条曲线（值从 --nd-motion-* 令牌读）</h3>
        <div class="lab-curves">
          <div v-for="curve in curves" :key="curve.label" class="lab-curve">
            <svg viewBox="-2 -2 104 104" aria-hidden="true">
              <path d="M0 100 L100 0" stroke="#e6e8eb" stroke-width="1" fill="none" />
              <path :d="curve.path" :stroke="curve.color" stroke-width="2" fill="none" />
            </svg>
            <span class="lab-curve__legend">
              <span class="lab-curve__dot" :style="{ background: curve.color }" />
              <span class="lab-curve__name">{{ curve.label }}</span><br>
              {{ curve.note }}<br>
              {{ curve.raw }}
            </span>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
