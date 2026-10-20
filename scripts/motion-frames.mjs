/**
 * Motion Lab 抽帧截图 + 属性审计 + 减少动效校验。
 *
 * ## 用法
 *
 * ```bash
 * npm run motion            # 另开一个终端：起 Motion Lab（127.0.0.1:5200）
 * node scripts/motion-frames.mjs
 * ```
 *
 * 参数：
 *   --demos=bold,h1      只跑这几段
 *   --frames=0,50,100    只抽这几个百分比（默认 0,25,50,75,100）
 *   --url=http://...     换个地址（默认 127.0.0.1:5200）
 *   --no-rm              跳过"减少动效"那一轮
 *
 * 产物（都在 `.local/motion-shots/`，不进版本库）：
 *   `<demo>-<pct>.png`   五帧
 *   `rm/<demo>.png`      减少动效下的第 0 帧（应该**就是终态**）
 *
 * ## 为什么用 puppeteer-core 而不是 `chrome --screenshot`
 *
 * 命令行版没法保证"页面已经把动画冻在这一帧"再拍 —— 它拍的是"加载后某一刻"，
 * 而我们要的是**确定的 t**。这里用深链 `?demo=<id>&t=<ms>` 让页面自己冻结，
 * 等 `<html data-ready>` 出现再拍，于是同一帧拍一百次都是同一张图。
 * （浏览器还是本机那个 Chrome，只是用 CDP 驱动它。）
 *
 * ## 脚本自己也是验收的一部分
 *
 * 它不只是截图，还会：
 * 1. 从**页面**读演示清单（`demos.ts` 是唯一事实源，这里不抄一份 id 列表）；
 * 2. 读 `effect.getKeyframes()` 做属性审计，**动了 layout 属性就退出码 1**；
 * 3. 用 `Emulation.setEmulatedMedia` 模拟 `prefers-reduced-motion: reduce`，
 *    把"减少动效下的第 0 帧"和"正常模式的第 100% 帧"的**计算样式逐元素对比** ——
 *    这条断言才是"减少动效直接呈现终态"的证据，肉眼看不出来。
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = path.resolve('.local/motion-shots')

const argv = process.argv.slice(2)
const arg = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const BASE = (arg('url') ?? process.env.MOTION_URL ?? 'http://127.0.0.1:5200/').replace(/\/?$/, '/')
const onlyDemos = (arg('demos') ?? '').split(',').filter(Boolean)
const fractions = (arg('frames') ?? '0,25,50,75,100').split(',').map((n) => Number(n) / 100)
const withReducedMotion = !argv.includes('--no-rm')

/**
 * 布局属性名单 —— 和 `src/editor/demos/demos.ts` 的 `LAYOUT_PROPS` **同一份语义**。
 *
 * ⚠️ 这里是**手抄的第二份**，但用途不同：它跑在**浏览器里**（页面内 evaluate），
 * 拿不到打包后的 TS 模块。真正的单一事实源仍然是 `demos.ts`，那边有静态测试守着
 * （`registry.test.ts` 扫 `demos.css`）；这份只负责"截图这一轮也说一遍"。
 * 两边不一致的表现是：测试绿、这里红（或者反过来）—— 一眼能看出来。
 */
const LAYOUT_PROPS = [
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'top', 'right', 'bottom', 'left', 'inset', 'margin', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'font-size', 'font-weight', 'line-height',
  'letter-spacing', 'word-spacing', 'grid-template-rows', 'grid-template-columns',
  'flex-basis', 'border-width', 'gap',
]

fs.mkdirSync(path.join(OUT, 'rm'), { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
})

const problems = []
const page = await browser.newPage()
/* 3x：演示画布只有 144×46，1x 拍出来"1px 的跳"根本看不见 */
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 3 })
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`)
})

/** 等页面把动画冻结好（`<html data-ready="1">`）。 */
async function waitReady() {
  await page.waitForFunction('document.documentElement.dataset.ready === "1"', { timeout: 20_000 })
  /* 再等一帧，保证冻结后的样式已经落到绘制层上 */
  await sleep(60)
}

/** 打开某个演示的某一帧。 */
async function openFrame(id, ms) {
  const url = `${BASE}?demo=${encodeURIComponent(id)}&t=${Math.round(ms)}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('.demo-stage', { timeout: 15_000 })
  await waitReady()
}

/** 从页面读演示清单（`demos.ts` 是唯一事实源，这里不抄 id）。 */
async function readDemoIds() {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('.lab-item', { timeout: 20_000 })
  return page.$$eval('.lab-item__id', (els) => els.map((el) => el.textContent.trim()))
}

/**
 * 页内属性审计：读 `effect.getKeyframes()`，把动的属性分类。
 *
 * ⚠️ 用 `document.getAnimations()` + "目标在画布里"过滤，**不用逐个元素的
 * `el.getAnimations()`** —— 后者不返回伪元素动画（Chrome 实测），
 * 而这里恰好有 4 条画在 `::before` / `::after` 上。漏掉它们不会报错，
 * 只会让审计表静悄悄地少几行。
 */
function auditInPage(layoutProps) {
  const stage = document.querySelector('.demo-stage')
  if (!stage) return { animations: [], layout: [] }
  const animations = []
  const layout = []
  for (const anim of document.getAnimations()) {
    const effect = anim.effect
    const target = effect?.target
    if (!(target instanceof Element) || (target !== stage && !stage.contains(target))) continue
    const frames = effect?.getKeyframes?.() ?? []
    const props = new Set()
    for (const frame of frames) {
      for (const key of Object.keys(frame)) {
        if (key === 'offset' || key === 'computedOffset' || key === 'easing' || key === 'composite') continue
        props.add(key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
      }
    }
    const name = `${anim.animationName ?? 'animation'}${effect?.pseudoElement ?? ''}`
    animations.push({ name, props: [...props] })
    for (const prop of props) if (layoutProps.includes(prop)) layout.push(`${name} → ${prop}`)
  }
  return { animations, layout }
}

/**
 * 页内探针：把画布上**每个元素**（含伪元素）的"视觉相关计算样式"拼成一个字符串。
 *
 * 用途：`prefers-reduced-motion: reduce` 下的第 0 帧应该和正常模式的第 100% 帧
 * **逐元素相同**（= 直接呈现终态）。不可见元素（`opacity: 0`）跳过 ——
 * 它们对画面没有任何贡献，而且"退场到不可见"的终态本来就不该再区分位移。
 */
function probeInPage() {
  const stage = document.querySelector('.demo-stage')
  if (!stage) return []
  const read = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo)
    if (cs.opacity === '0') return 'hidden'
    return [
      cs.opacity, cs.transform, cs.clipPath, cs.backgroundColor, cs.color,
      cs.borderTopColor, cs.strokeDashoffset, cs.backgroundSize, cs.boxShadow,
      cs.fontWeight, cs.fontFamily, cs.textDecorationLine,
    ].join('|')
  }
  const out = []
  const els = [stage, ...stage.querySelectorAll('*')]
  for (const el of els) {
    out.push(read(el, null), read(el, '::before'), read(el, '::after'))
  }
  return out
}

/* ---------------------------------------------------------------- 主流程 */

const demoIds = (onlyDemos.length ? onlyDemos : await readDemoIds()).filter(Boolean)
if (!demoIds.length) {
  console.error('✗ 没读到任何演示 —— Motion Lab 起来了吗？（npm run motion）')
  process.exit(1)
}

const report = []

for (const id of demoIds) {
  await openFrame(id, 0)
  const duration = await page.$eval('.lab-timeline input[type=range]', (el) => Number(el.max))
  const audit = await page.evaluate(auditInPage, LAYOUT_PROPS)

  const finalProbe = { id, duration, audit, frames: [] }

  for (const fraction of fractions) {
    const ms = Math.round(duration * fraction)
    await openFrame(id, ms)
    const stage = await page.$('.demo-stage')
    const pct = String(Math.round(fraction * 100)).padStart(3, '0')
    await stage.screenshot({ path: path.join(OUT, `${id}-${pct}.png`) })
    finalProbe.frames.push(`${id}-${pct}.png`)
    if (fraction === 1) finalProbe.finalProbe = await page.evaluate(probeInPage)
  }

  if (withReducedMotion) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await openFrame(id, 0)
    const reducedProbe = await page.evaluate(probeInPage)
    const stage = await page.$('.demo-stage')
    await stage.screenshot({ path: path.join(OUT, 'rm', `${id}.png`) })

    const a = finalProbe.finalProbe ?? []
    const b = reducedProbe
    const diffs = []
    if (a.length !== b.length) diffs.push(`元素数不同 ${a.length} vs ${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) diffs.push(`#${i}: ${a[i]} ≠ ${b[i]}`)
    }
    finalProbe.reducedMotion = diffs.length ? { ok: false, diffs: diffs.slice(0, 4) } : { ok: true }
    await page.emulateMediaFeatures([])
  }

  report.push(finalProbe)
  const verdict = finalProbe.reducedMotion
    ? (finalProbe.reducedMotion.ok ? '减少动效=终态 ✓' : '减少动效≠终态 ✗')
    : ''
  console.log(
    `${id.padEnd(12)} ${String(duration).padStart(4)}ms  ` +
      `动画 ${String(audit.animations.length).padStart(2)} 条  ` +
      `layout ${audit.layout.length ? '✗ ' + audit.layout.join('；') : '0 ✓'}  ${verdict}`,
  )
  /* 不一致时把前几处差异打出来 —— 不然只看到 ✗，还得再跑一遍才知道差在哪 */
  for (const diff of finalProbe.reducedMotion?.diffs ?? []) console.log(`    ${diff}`)
}

await browser.close()

/* ---------------------------------------------------------------- 汇总 */

const layoutViolations = report.flatMap((r) => r.audit.layout.map((hit) => `${r.id}: ${hit}`))
const rmFailures = report.filter((r) => r.reducedMotion && !r.reducedMotion.ok)
const uniqueProps = [...new Set(report.flatMap((r) => r.audit.animations.flatMap((a) => a.props)))].sort()

console.log('\n———— 汇总 ————')
console.log(`演示 ${report.length} 段，抽帧 ${report.reduce((n, r) => n + r.frames.length, 0)} 张 → ${OUT}`)
console.log(`动到的属性全集：${uniqueProps.join(', ')}`)
console.log(`layout 属性违规：${layoutViolations.length ? '\n  ' + layoutViolations.join('\n  ') : '无 ✓'}`)
if (withReducedMotion) {
  console.log(
    `减少动效≠终态：${rmFailures.length ? '\n  ' + rmFailures.map((r) => r.id).join('\n  ') : '无 ✓'}`,
  )
}
if (problems.length) {
  console.log(`页面错误：\n  ${[...new Set(problems)].slice(0, 10).join('\n  ')}`)
}

const failed = layoutViolations.length > 0 || rmFailures.length > 0 || problems.length > 0
process.exit(failed ? 1 : 0)
