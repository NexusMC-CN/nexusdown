<script setup lang="ts">
/**
 * nexusdown playground —— 开发迭代用的单页 + **方言画廊**。
 *
 * 它直接 import `src/`（vite alias 见 playground/vite.config.ts），
 * 所以改 `src/**` 任意文件都会 HMR，**不需要**先 `npm run build`。
 *
 * 页面布局：
 *
 * | 区域 | 内容 |
 * | --- | --- |
 * | 左 | `<NexusdownEditor>`（v-model，和消费方用法完全一致） |
 * | 右 | `renderMarkdown()` 的产出：预览 / HTML 源码 / Markdown 原文 |
 * | 底 | 状态栏：行数、字符数、HTML 体积、渲染耗时、**当前样例覆盖了哪些语法** |
 *
 * ## 画廊怎么用
 *
 * 每个样例在 `fixtures.ts` 里声明自己覆盖了哪几条语法（`covers`）。状态栏把
 * **整个目录**都画出来，覆盖到的亮、没覆盖的灰 —— 于是「哪条语法还没有样例」
 * 一眼就能看见，不用去翻文件数。
 *
 * ⚠️ 别用正则去猜「这段文本里有没有某条语法」：那和渲染器的判定必然漂
 * （`==高亮==` 在代码块里就不算高亮）。覆盖情况以 `covers` 为准，它是**声明**，
 * 而且 `tests/dialect/gallery.test.ts` 会检查每条语法都真的有样例。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import NexusdownEditor from '../../src/editor/Editor.vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { katexRenderer, renderMarkdown, type MentionResolution } from '../../src/render/index.ts'
import '../../src/shared/blocks.css'
import '../../src/shared/dialect.css'
import { DIALECT_SYNTAXES, fixtures } from './fixtures.ts'

type ViewMode = 'split' | 'edit' | 'preview'
type PaneTab = 'preview' | 'html' | 'markdown'

const viewModes: Array<{ id: ViewMode; label: string }> = [
  { id: 'split', label: '分栏' },
  { id: 'edit', label: '只看编辑' },
  { id: 'preview', label: '只看输出' },
]

const tabs: Array<{ id: PaneTab; label: string }> = [
  { id: 'preview', label: '预览' },
  { id: 'html', label: 'HTML' },
  { id: 'markdown', label: 'Markdown' },
]

const view = ref<ViewMode>('split')
const tab = ref<PaneTab>('preview')

/*
 * ⚠️ 默认取 `full`（全功能样例），**不要取 `fixtures[0]`**。
 *
 * 画廊的数组是「19 条单语法在前、full/minimal/stress/empty 在后」——取 `[0]`
 * 打开页面就只有一行标题，状态栏 19 个徽章只亮 1 个，看起来像"页面缺了一大半"。
 * `full` 是唯一覆盖全部 19 条语法的样例（`gallery.test.ts` 有断言）。
 */
const initialFixture = fixtures.find((f) => f.id === 'full') ?? fixtures[0]!
const fixtureId = ref(initialFixture.id)
/**
 * 给样例末尾补一个空行（**只在 playground 里**，不改 fixture 数据）。
 *
 * 光标放到文末后，如果文末正好在某个块里（callout / tabs / fence…），
 * 那个块会因为「光标所在行揭示」显示成源码 —— 打开样例第一眼看到的是源码，
 * 不是渲染结果。补一个空行，文末就落在块外，所有块都保持渲染态。
 */
const withTail = (text: string): string => text.trimEnd() + '\n\n'

const markdown = ref(withTail(initialFixture.markdown))
const copied = ref(false)
const editorRef = ref<{ view: { state: { doc: { length: number } }; dispatch: (spec: unknown) => void } | null } | null>(null)

/**
 * 光标放到文末。
 *
 * ⚠️ 不这么做的话，光标默认在 0 —— 第一行处于**揭示态**，
 * 于是打开任何样例都看到「源码」而不是渲染结果（实测：callout/tabs/fence 全中）。
 */
async function jumpToEnd() {
  await nextTick()
  const view = editorRef.value?.view
  if (view) {
    view.dispatch({ selection: { anchor: view.state.doc.length } })
  }
}

onMounted(() => {
  window.setTimeout(() => void jumpToEnd(), 400)
  /*
   * 调试钩子：把 EditorView 挂到 window，方便 puppeteer / 控制台量
   * 光标位置、滚动跳变、装饰重建耗时。只影响 playground，不进库。
   */
  const attach = () => {
    const view = editorRef.value?.view
    if (view) (window as unknown as { __ndView?: unknown }).__ndView = view
    else window.setTimeout(attach, 120)
  }
  window.setTimeout(attach, 200)
})

watch(fixtureId, (id) => {
  const fixture = fixtures.find((f) => f.id === id)
  if (fixture) markdown.value = withTail(fixture.markdown)
  // 等子组件的 modelValue watch 先跑完，再挪光标（否则会被它覆盖回 0）
  window.setTimeout(() => void jumpToEnd(), 80)
})

/*
 * 演示用的 `RenderData` —— 和消费方真实做法一致：**库不查库 / 不联网**，
 * 解析结果由外面喂。这里给 `@nexusdown` 一条，用来同时验证
 * 「编辑器卡片」和「渲染侧卡片」是否同构。
 */
const renderData = {
  mentions: new Map<string, MentionResolution>([
    [
      'nexusdown',
      {
        title: 'nexusdown',
        href: '/nexusdown',
        kind: 'resource',
        summary: 'Markdown 编辑器 + 渲染器，同一套方言',
        byline: 'NexusMC',
        badges: ['v0.0.2'],
      },
    ],
  ]),
}

/*
 * ⚠️ 稳定引用：`renderMarkdown` 按 `plugins` 数组的**标识**缓存 parser
 * （见 `RenderMarkdownOptions.plugins` 的注释）。每次 computed 里新建数组
 * 会每次重建一个 markdown-it 实例。
 */
const MATH_PLUGINS = [katexRenderer(katex)]

const renderResult = computed(() => {
  const started = performance.now()
  const html = renderMarkdown(markdown.value, { plugins: MATH_PLUGINS, data: renderData })
  return { html, ms: performance.now() - started }
})

const stats = computed(() => {
  const text = markdown.value
  return {
    lines: text ? text.split('\n').length : 0,
    chars: [...text].length,
    htmlBytes: new TextEncoder().encode(renderResult.value.html).length,
  }
})

/**
 * 方言覆盖情况 —— **以 fixture 的声明为准**（`covers`），不靠正则猜。
 *
 * 状态栏把 `DIALECT_SYNTAXES` 全画出来：亮 = 当前样例有这条语法，灰 = 没有。
 * 再给一个「覆盖 N/M」的汇总，鼠标悬停能看见还差哪些 —— 这就是「一眼看出
 * 哪条语法还没被样例覆盖」。
 */
const covered = computed(() => new Set(fixtures.find((f) => f.id === fixtureId.value)?.covers ?? []))

const syntaxes = computed(() =>
  DIALECT_SYNTAXES.map((syntax) => ({ ...syntax, on: covered.value.has(syntax.id) })),
)

const uncovered = computed(() => syntaxes.value.filter((syntax) => !syntax.on).map((syntax) => syntax.label))

async function copyHtml() {
  try {
    await navigator.clipboard.writeText(renderResult.value.html)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1200)
  } catch {
    // 剪贴板权限被拒时静默忽略
  }
}
</script>

<template>
  <div class="app">
    <header class="bar">
      <div class="brand">
        <strong>nexusdown</strong>
        <span class="tag">playground · 直接跑 src/</span>
      </div>

      <label class="fixture">
        <span>样例</span>
        <select v-model="fixtureId">
          <option v-for="f in fixtures" :key="f.id" :value="f.id">{{ f.label }}</option>
        </select>
      </label>

      <div class="seg" role="group" aria-label="视图">
        <button
          v-for="m in viewModes"
          :key="m.id"
          type="button"
          :class="{ active: view === m.id }"
          @click="view = m.id"
        >
          {{ m.label }}
        </button>
      </div>
    </header>

    <main class="body" :class="`view-${view}`">
      <section v-show="view !== 'preview'" class="pane pane-editor">
        <div class="pane-head">
          编辑器 · <code>NexusdownEditor</code>（v-model）
        </div>
        <div class="pane-body">
          <NexusdownEditor
            ref="editorRef"
            v-model="markdown"
            class="editor"
            :math-renderer="katex"
            :mentions="renderData.mentions"
          />
        </div>
      </section>

      <section v-show="view !== 'edit'" class="pane pane-output">
        <div class="pane-head">
          <span>输出</span>
          <div class="tabs">
            <button
              v-for="t in tabs"
              :key="t.id"
              type="button"
              :class="{ active: tab === t.id }"
              @click="tab = t.id"
            >
              {{ t.label }}
            </button>
          </div>
          <button class="copy" type="button" @click="copyHtml">
            {{ copied ? '已复制' : '复制 HTML' }}
          </button>
        </div>
        <div class="pane-body scroll">
          <div v-if="tab === 'preview'" class="nd-preview" v-html="renderResult.html" />
          <pre v-else-if="tab === 'html'" class="code">{{ renderResult.html || '（空）' }}</pre>
          <pre v-else class="code">{{ markdown || '（空）' }}</pre>
        </div>
      </section>
    </main>

    <footer class="status">
      <span class="stat">
        {{ stats.lines }} 行 · {{ stats.chars }} 字符 · HTML {{ stats.htmlBytes }} B
      </span>
      <span class="stat">渲染 {{ renderResult.ms.toFixed(2) }} ms</span>
      <span
        class="stat coverage"
        :class="{ partial: uncovered.length > 0 }"
        :title="uncovered.length ? '当前样例未覆盖：' + uncovered.join('、') : '当前样例覆盖全部语法'"
      >
        {{ covered.size === 0 ? '变体样例 · 不计入 19 条语法' : `语法覆盖 ${syntaxes.filter((s) => s.on).length}/${syntaxes.length}` }}
      </span>
      <span v-if="covered.size > 0" class="dialect">
        <i
          v-for="syntax in syntaxes"
          :key="syntax.id"
          :class="{ on: syntax.on }"
          :title="syntax.on ? '当前样例覆盖了这条语法' : '当前样例没有这条语法（换个样例看）'"
        >
          {{ syntax.label }}
        </i>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  color: #1f2328;
  background: #f6f7f9;
}

/* ---------------------------------------------------------------- 顶栏 */

.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  row-gap: 8px;
  gap: 18px;
  padding: 10px 18px;
  background: #fff;
  border-bottom: 1px solid #e3e6ea;
  flex: none;
}

.brand {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
}

.brand strong {
  font-size: 15px;
}

.tag {
  font-size: 12px;
  color: #8a9099;
}

.fixture {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  max-width: 100%;
  font-size: 13px;
  color: #57606a;
  white-space: nowrap;
}

.fixture select {
  max-width: 100%;
  font: inherit;
  padding: 4px 8px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #fff;
}

.seg {
  display: flex;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  overflow: hidden;
}

.seg button,
.tabs button {
  font: inherit;
  font-size: 13px;
  padding: 5px 12px;
  border: 0;
  background: #fff;
  color: #57606a;
  cursor: pointer;
}

.seg button + button,
.tabs button + button {
  border-left: 1px solid #d0d7de;
}

.seg button.active,
.tabs button.active {
  background: #eef1f4;
  color: #1f2328;
  font-weight: 600;
}

/* ---------------------------------------------------------------- 主体 */

.body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.pane + .pane {
  border-left: 1px solid #e3e6ea;
}

.view-split .pane {
  flex: 1 1 0;
}

.view-edit .pane-editor,
.view-preview .pane-output {
  flex: 1;
}

.pane-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 12px;
  color: #6e7781;
  border-bottom: 1px solid #eef0f3;
  background: #fbfcfd;
  flex: none;
}

.pane-head code {
  font-size: 11px;
  background: #eef1f4;
  padding: 1px 5px;
  border-radius: 4px;
}

.pane-body {
  flex: 1;
  min-height: 0;
  padding: 16px;
  display: flex;
}

.pane-body.scroll {
  display: block;
  overflow: auto;
  padding: 0;
}

.pane-editor .pane-body {
  padding: 16px 18px;
}

.editor {
  flex: 1;
  min-height: 0;
  --nd-editor-height: max(300px, calc(100vh - 170px));
}

/* 编辑器在 flex 容器里撑满 */
.editor :deep(.nd-editor) {
  height: 100%;
}

/* ---------------------------------------------------------------- 输出区 */

.tabs {
  display: flex;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  overflow: hidden;
}

.copy {
  margin-left: auto;
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #fff;
  color: #57606a;
  cursor: pointer;
}

.copy:hover {
  background: #f3f4f6;
}

.code {
  margin: 0;
  padding: 16px 18px;
  font: 12.5px/1.7 ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  color: #24292f;
  background: #fbfcfd;
}

/* ---------------------------------------------------------------- 状态栏 */

.status {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 7px 18px;
  font-size: 12px;
  color: #57606a;
  background: #fff;
  border-top: 1px solid #e3e6ea;
}

/* 「语法覆盖 N/M」—— 有未覆盖项时用琥珀色，提醒这里还有缺口。 */
.coverage {
  padding: 1px 8px;
  border: 1px solid #b7e2c8;
  border-radius: 999px;
  color: #0f6d3f;
  background: #e9f7ef;
  cursor: default;
}

.coverage.partial {
  border-color: #ecd8a8;
  color: #8a5a00;
  background: #fdf6e3;
}

.dialect {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.dialect i {
  font-style: normal;
  white-space: nowrap;
  padding: 1px 7px;
  border: 1px solid #e3e6ea;
  border-radius: 999px;
  color: #a0a6ad;
  background: #f6f7f9;
}

.dialect i.on {
  color: #0f6d3f;
  border-color: #b7e2c8;
  background: #e9f7ef;
}

/* 窄屏：上下分栏（否则两个 50% 宽的面板都没法读） */
@media (max-width: 900px) {
  .body {
    flex-direction: column;
  }

  .pane + .pane {
    border-left: 0;
    border-top: 1px solid #e3e6ea;
  }

  .pane-editor,
  .pane-output {
    min-height: 46vh;
  }

  .editor {
    --nd-editor-height: max(260px, 38vh);
  }

  .bar {
    gap: 10px;
    padding: 8px 12px;
  }

  .tag {
    display: none;
  }

  .fixture {
    margin-left: 0;
  }

  .seg {
    margin-left: auto;
  }

  .status {
    padding: 6px 12px;
  }

  .dialect {
    margin-left: 0;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
  }
}
</style>

<!-- 预览区是 v-html 注入的，scoped 样式够不到，所以这段不 scoped。
     块级排版一律交给 src/shared/blocks.css（编辑器与渲染侧共用）——
     这里只留预览容器的留白。否则 playground 自己的样式会和 blocks.css 打架，
     看到的差异是 playground 的，不是库的。 -->
<style>
.nd-preview {
  padding: 20px 24px 40px;
  /*
   * 只设**容器**的字体/行高/颜色 —— 块级排版（标题字号、段距、表格、代码块…）
   * 全部交给 src/shared/blocks.css（编辑器与渲染侧共用）。
   * 容器这四条必须和编辑器 `.cm-content` 一致（14.5px / 1.8），否则一切 em 都错位。
   */
  font-family: var(--nd-font-body, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  font-size: var(--nd-font-size, 14.5px);
  line-height: var(--nd-line-height, 1.8);
  color: var(--nd-text, #1f2328);
  overflow-wrap: break-word;
}

.nd-preview > :first-child {
  margin-top: 0;
}
</style>
