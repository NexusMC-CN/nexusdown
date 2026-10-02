/**
 * `math` —— 行内 `$E = mc^2$` + 块级 ` ```math ` 围栏（契约：`docs/dialect-extensions.md` 第 2 节）。
 *
 * ## 为什么行内用「正则扫描」而不是 lezer 行内扩展
 *
 * 任务书明确要求**优先退化方案**，理由是「不引入 lezer 行内扩展（成本高、风险大）」。
 * 实测确认了这个前提：lezer 对 `$x^2$` **什么都不产出**（只有一个 `Paragraph`），
 * 所以要么自己写一个 `MarkdownConfig` 内联解析器，要么扫文本。选了后者。
 *
 * ## 扫在哪：认领 `Document` 节点
 *
 * `EditorFeature.decorate` 是按**节点名**分发的（`plugin.ts` 只做 `features.get(name)`），
 * 没有一个「文档级」钩子。要做全文扫描，只能认领一个**覆盖全文**的节点 ——
 * 那就是根节点 `Document`（实测 `tree.iterate` 即使只遍历可见子区间也会 enter 到它）。
 *
 * ⚠️ 由此引出一条**跨 agent 的注册约束**：`indexFeatures` 会拒绝「两个功能认领同一
 * 节点名」，所以 `Document` **只能被这一个功能认领**。emoji 功能因此改去认领
 * lezer 的 `Emoji` 节点（见 `emoji.ts`），不跟这里抢 `Document`。
 *
 * ## 块级公式：KaTeX 由消费方注入，没注入就退回普通代码块
 *
 * 块级语法是 ` ```math ` 围栏。**它也是一个 `FencedCode` 节点，而那个节点归 embed
 * 认领**（embed 的语法就是一个围栏，见 `features/embed.ts` 文件头）——
 * 一个节点名只能被一个功能认领，所以这里**不能**也去认领 `FencedCode`。
 *
 * 于是分工是：
 *
 * - 本功能继续认领 `Document`，从**文档根节点走一遍树**找 `FencedCode` 子节点，
 *   用 `isMathInfo` 挑出 math 围栏；
 * - `embed.ts` 那边遇到 math 围栏**主动让出去**（不画成代码块），免得两条 replace
 *   叠在同一区间上。两边的判据都来自 `decorate/fence.ts` 的 `isMathInfo`，不会漂。
 *
 * 渲染函数**由消费方注入**（`nexusdown({ mathRenderer })`），和渲染侧是同一套思路：
 * KaTeX 是 **peerDependency**（~4 MB，绝大多数是字体），库**自己不 import**，
 * 消费方装、消费方把对象塞进来。没塞的时候**不报错**，退回**普通代码块**
 * （也就是本次改动之前的样子）——见 `decorateMathFences`。
 *
 * ⚠️ 为什么不直接在 widget 里 `import('katex')`：CM6 widget 的 `toDOM()` 是**同步**的，
 * `import()` 拿不到；而且那会让 KaTeX 变成硬依赖、进主包。同渲染侧的取舍。
 *
 * ## 三条硬约束
 *
 * - widget 必须实现 `eq`（否则每次 rebuild 重建 DOM）；
 * - 非揭示态的 `replace` 必须**同时**登记进 `atomicRanges`（`pushAtomicRange`）；
 * - **不能** `Decoration.replace({ block: true })`（方向键永远进不去）。
 */
import type { EditorSelection, Line, Text } from '@codemirror/state'
import { Decoration, WidgetType } from '@codemirror/view'

import { KATEX_OPTIONS, type KatexLike } from '../../render/features/math.js'
import { decorateFencedCode, isMathInfo, readFenceInfo } from '../decorate/fence.js'
import { HIDE, MUTED_MARK, pushAtomicRange } from '../decorate/shared.js'
import type { EditorFeature } from '../feature.js'
import type { DecorationRanges, MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'
import { firstChildNamed, lastChildNamed } from '../util/tree.js'

/** 一段行内公式在文档里的位置。 */
interface MathSpan {
  from: number
  /** 排他。含两侧的 `$`。 */
  to: number
  /** `$` 之间的 TeX 源码。 */
  tex: string
}

/**
 * 行内公式 widget（非揭示态）。
 *
 * ⚠️ **这里不渲染 KaTeX，显示的是 TeX 源码。** 原因和渲染侧是同一个：KaTeX 是
 * 可选依赖，不能进主包；而 CM6 widget 的 `toDOM()` 是**同步**的，`import()` 拿不到。
 * 所以行内退化成「显示 TeX 源码」——用 `.nd-math` 的数学字体衬出「这是公式」，
 * 比露出 `$…$` 更接近所见即所得。
 *
 * （**块级**公式不一样：它走 `MathBlockWidget`，由消费方注入的渲染函数画出真公式。
 * 差别在于块级本来就独占一块地方、值得为它开注入通道；行内公式在正文里满天飞，
 * 每个都跑一遍 KaTeX 会把输入拖卡，所以行内维持源码显示。）
 */
export class MathWidget extends WidgetType {
  constructor(
    private readonly tex: string,
    private readonly render?: MathRenderer,
  ) {
    super()
  }

  /**
   * 必须实现，否则每次 rebuild 都重建 DOM（公式会闪）。
   *
   * ⚠️ **只比 `tex`，不比 `render`** —— 同一个编辑器里 `render` 恒是同一个对象
   * （挂载时注入一次），比它没有意义，反而会在某些情况下让 `eq` 恒假 ✓。
   */
  override eq(other: MathWidget): boolean {
    return other.tex === this.tex
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nd-math'

    /*
     * ★ **真的渲染** —— 以前这里只有 `textContent = tex` ✗，于是行内公式
     * **永远显示成源码** ✓（`$x^2$` 里那个 `x^2` 就是它 ✓）。
     * 这是"编辑器里的公式不生效"的真正原因 ✓ —— 不是渲染函数没传进来 ✓，
     * 是**行内这条路根本没接渲染器** ✗。
     */
    if (this.render) {
      try {
        span.innerHTML = this.render.renderToString(this.tex, {
          ...KATEX_OPTIONS,
          displayMode: false,
        })
        return span
      } catch (e) {
        // 降级是契约（见 MathBlockWidget 的注释），但**留一条日志**，别静默 ✓
        console.warn('[nexusdown] 行内公式渲染失败，已降级成源码：', e)
      }
    }

    // 没注入渲染函数 / 渲染失败：降级成源码。
    // textContent：TeX 可能含 `<`（比如 `a < b`），绝不能用 innerHTML。
    span.classList.add('nd-math-source')
    span.textContent = this.tex
    return span
  }

  /** 事件交给 CM：点公式 → 光标定位 → 这一行转揭示态显示源码。 */
  override ignoreEvent(_event: Event): boolean {
    return false
  }
}

/**
 * 编辑器侧的数学渲染函数 —— 形状与渲染侧 `KatexLike` **完全一致**。
 *
 * ★ 刻意不另定义一套接口：消费方要能把**同一个 `katex` 对象**同时喂给两侧
 *
 * ```ts
 * import katex from 'katex'
 * import 'katex/dist/katex.min.css'          // ⚠️ 字体 CSS 也要引
 * import { mountEditor } from 'nexusdown/cm'
 * import { renderMarkdown, katexRenderer } from 'nexusdown/render'
 *
 * mountEditor({ parent, doc, mathRenderer: katex })
 * renderMarkdown(src, { plugins: [katexRenderer(katex)] })
 * ```
 *
 * 两边各写一套结构类型的话，真实 katex 会在其中一侧被 `strictFunctionTypes`
 * 拒掉（或者逼消费方写 `as`），那就违背了「同一个对象喂两侧」的初衷。
 */
export type MathRenderer = KatexLike

/**
 * 块级公式 widget（非揭示态）。
 *
 * DOM 结构（`.nd-math nd-math-block` 是**和渲染侧同一套类名**，方便消费方统一换肤）：
 *
 * ```html
 * <span class="nd-math nd-math-block">…KaTeX 的输出…</span>
 * ```
 *
 * ⚠️ 为什么是 `<span>` 而不是渲染侧那种 `<div>`：这个 widget 是**行内替换**
 * （`Decoration.replace`，见 `decorateMathFences`），必须待在行内流里。
 * 用块级元素会让 CM6 插在 widget 前后的 `cm-widgetBuffer` 和它垂直堆叠成三行
 * （同 `theme.css` 里 `.nd-code-header` / `.nd-embed-card` 踩过的坑）。
 * 「看起来像一整块」由 CSS 的 `width: calc(100% + pad)` + 负 margin 负责。
 */
export class MathBlockWidget extends WidgetType {
  constructor(
    private readonly tex: string,
    private readonly render: MathRenderer,
  ) {
    super()
  }

  /**
   * ⚠️ 必须实现，否则每次 rebuild 都重建 DOM（公式会闪）。
   *
   * **只比 `tex`，不比 `render`**：同一个编辑器里 `render` 是同一个对象
   * （`nexusdown()` 一次性注入），比引用没有意义；而消费方若习惯性地每次
   * 现造一个包装函数，比引用反而会让 widget 永远不等、每帧重建。
   */
  override eq(other: MathBlockWidget): boolean {
    return other.tex === this.tex
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nd-math nd-math-block'
    try {
      /*
       * KaTeX 在 `trust:false` 下的输出是**自包含且安全**的，直接内联
       * （和渲染侧 `renderMath` 同一决定）。这是本项目**极少数**允许 `innerHTML`
       * 的地方：内容是消费方注入的渲染器产出的，不是用户输入；再转义会把公式里的
       * `<` 显示成 `&lt;`。
       */
      span.innerHTML = this.render.renderToString(this.tex, {
        ...KATEX_OPTIONS,
        displayMode: true,
      })
    } catch (e) {
      /*
       * 契约：渲染失败**降级成源码**，绝不抛（`throwOnError:false` 挡不住的那类）。
       * ⚠️ 这里必须 `textContent` —— 源码是**用户输入**，走 innerHTML 就是注入面。
       */
      /*
       * ⚠️ **但必须留一条日志** ✗ —— 之前这里是裸 `catch {}`，
       * 结果"公式不渲染"变成了**完全没有线索**：页面不报错、控制台干净、
       * 只是悄悄降级成源码 ✓（实测排查时卡了很久 ✓）。
       *
       * 降级是**正常路径**（契约要求 ✓），但"为什么降级"是**诊断信息** ✗，
       * 不该和契约一起被吞掉 ✓。
       */
      console.warn('[nexusdown] 数学渲染失败，已降级成源码：', e)
      span.classList.add('nd-math-source')
      span.textContent = this.tex
    }
    return span
  }

  /** 返回 `false` = 事件交给 CM：点公式 → 光标落进围栏 → 转揭示态显示源码。 */
  override ignoreEvent(_event: Event): boolean {
    return false
  }
}

/**
 * 开围栏那一行的行级装饰 —— 只补 `padding-left`，好让公式 widget 用负 margin
 * 通到行左右边缘（和 `.nd-embed-open` / `.nd-code-header` 是同一套账）。
 */
const MATH_LINE_OPEN = Decoration.line({ class: 'nd-math-open' })

/**
 * 非开围栏的行（内容行 + 闭围栏）—— 内容藏掉后把**行盒也压成 0 高**。
 *
 * ⚠️ 只 `HIDE` 不够：`Decoration.replace` 藏的是行内内容、不含换行符，空行仍占
 * 一整行高度（同 `embed.ts` 的 `LINE_HIDDEN`、`fence.ts` 的 `LINE_FOLDED`）。
 */
const MATH_LINE_HIDDEN = Decoration.line({ class: 'nd-math-hidden' })

/**
 * 全文扫描的缓存。
 *
 * `Text` 是**不可变**的：只移动光标时 `state.doc` 是同一个对象，WeakMap 直接命中；
 * 真正改了文档才产生新对象、缓存自然失效。和 `decorate/link.ts` 的
 * `REFERENCE_CACHE` 是同一招（不做它的话，每次光标移动都要重扫全文）。
 */
const SPAN_CACHE = new WeakMap<Text, MathSpan[]>()

/**
 * 造一个 math 功能。`render` 由消费方注入（`nexusdown({ mathRenderer })`）；
 * **不传**就是「只认行内公式、块级退回普通代码块」的降级形态。
 *
 * 为什么做成工厂而不是模块级常量：渲染函数是**每个编辑器一份的装配期配置**
 * （同渲染侧 `katexRenderer` 的定位），不能烤进模块级单例 —— 那样两个消费方
 * 装不同的 KaTeX 就会互相串。
 */
export function createMathFeature(render?: MathRenderer): EditorFeature {
  return {
    name: 'math',
    /*
     * ⚠️ `Document` 是**全局唯一**的挂载点，别再加第二个功能来认领它
     * （`indexFeatures` 会抛错）。见文件头。
     */
    nodes: ['Document'],
    decorate(ranges, atomicRanges, node, doc, selection) {
      decorateMath(ranges, atomicRanges, node, doc, selection, render)
    },
  }
}

/** 默认实例（**没有**注入渲染函数）—— 块级公式退回普通代码块。 */
export const mathFeature: EditorFeature = createMathFeature()

function decorateMath(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
  render: MathRenderer | undefined,
): void {
  decorateInlineMath(ranges, atomicRanges, doc, selection, render)
  decorateMathFences(ranges, atomicRanges, node, doc, selection, render)
}

/** 行内 `$…$`：全文扫描 + 揭示态处理。 */
function decorateInlineMath(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  doc: Text,
  selection: EditorSelection,
  render: MathRenderer | undefined,
): void {
  const spans = spansFor(doc)
  if (spans.length === 0) return

  for (const span of spans) {
    if (selectionTouchesLineRange(doc, selection, span.from, span.to)) {
      // 揭示态：保留源码，只把两个 `$` 变淡（和 link.ts 的揭示态同一套 `.nd-mark`）。
      ranges.push(MUTED_MARK.range(span.from, span.from + 1))
      ranges.push(MUTED_MARK.range(span.to - 1, span.to))
      continue
    }
    // 非揭示态：整段 `$…$` 换成 widget，并登记原子区间。
    pushAtomicRange(
      ranges,
      atomicRanges,
      Decoration.replace({ widget: new MathWidget(span.tex, render) }),
      span.from,
      span.to,
    )
  }
}

/**
 * 块级 ` ```math ` 围栏。
 *
 * 从 `Document` 节点走一遍树找 `FencedCode`（为什么不能自己认领 `FencedCode`
 * 见文件头「块级公式」）。对每个 math 围栏：
 *
 * - **注入了渲染函数** → 开围栏行换成 `MathBlockWidget`，其余行藏掉压高；
 *   光标/选区碰到围栏时**保留源码**（不然用户改不了）。
 * - **没注入** → 交给 `decorateFencedCode` 画成**普通代码块**。直接复用，
 *   绝不在这里另抄一份代码块的画法（抄一份迟早和 `fence.ts` 漂开）。
 */
function decorateMathFences(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
  render: MathRenderer | undefined,
): void {
  for (const fence of mathFencesFor(doc, node)) {
    // 没有渲染函数 → 退回普通代码块（本次改动前的样子）。`decorateFencedCode`
    // 自己会处理揭示态，所以这一支**不能**提前做揭示判断。
    if (!render) {
      decorateFencedCode(ranges, atomicRanges, fence, doc, selection)
      continue
    }

    // 揭示态（光标/选区碰到围栏任意一行）：保留源码，让作者能改 TeX。
    // ⚠️ 必须在推任何 replace 之前返回，否则会把光标要编辑的源码藏掉。
    if (selectionTouchesLineRange(doc, selection, fence.from, fence.to)) continue

    const open = firstChildNamed(fence, 'CodeMark')
    if (!open) continue
    const openLine = doc.lineAt(open.from)

    // 开围栏行 → 公式 widget（整行行内替换；**不是** block widget —— 那会让方向键进不去）。
    ranges.push(MATH_LINE_OPEN.range(openLine.from))
    if (openLine.to > openLine.from) {
      pushAtomicRange(
        ranges,
        atomicRanges,
        Decoration.replace({ widget: new MathBlockWidget(mathSource(doc, fence, openLine), render) }),
        openLine.from,
        openLine.to,
      )
    }

    // 内容行 + 闭围栏行 → 藏内容 + 压行高。
    // `fence.to` 是**排他**的：正好落在下一行行首时，不减 1 会多算一行（同 fence.ts）。
    const lastPos = fence.to > fence.from ? fence.to - 1 : fence.to
    const endLine = doc.lineAt(lastPos)
    for (let n = openLine.number + 1; n <= endLine.number; n++) {
      const line = doc.line(n)
      ranges.push(MATH_LINE_HIDDEN.range(line.from))
      if (line.to > line.from) {
        pushAtomicRange(ranges, atomicRanges, HIDE, line.from, line.to)
      }
    }
  }
}

/**
 * 文档里的 math 围栏节点，按 `Text` 缓存。
 *
 * ⚠️ **必须缓存**，不能每次 rebuild 都重走一遍树：`plugin.ts` 在**纯光标移动**
 * （`selectionSet`）时也会重建装饰，而走树是**全文**开销 —— 不缓存的话每动一下
 * 光标就把整棵树遍历一遍（正文里没有公式的文档也要付这个钱）。
 *
 * 和 `SPAN_CACHE` 是同一招：`Text` 不可变，同一个 `Text` 对应的语法树是同一棵，
 * 所以缓存的节点位置与内容都仍然有效；改了文档就是新 `Text`、缓存自然失效。
 */
const FENCE_CACHE = new WeakMap<Text, MarkdownNode[]>()

function mathFencesFor(doc: Text, node: MarkdownNode): MarkdownNode[] {
  const cached = FENCE_CACHE.get(doc)
  if (cached) return cached

  const built: MarkdownNode[] = []
  forEachFencedCode(node, (fence) => {
    if (isMathInfo(readFenceInfo(doc, fence))) built.push(fence)
  })
  FENCE_CACHE.set(doc, built)
  return built
}

/**
 * 围栏里的 TeX 源码（开围栏行的**下一行**到闭围栏行的**前一行**）。
 *
 * 未闭合的围栏（只有一个 `CodeMark`）会吃掉后面所有内容，此时内容一直取到
 * 围栏末行 —— 和 lezer 给的范围一致，不另做判断。
 */
function mathSource(doc: Text, fence: MarkdownNode, openLine: Line): string {
  const close = lastChildNamed(fence, 'CodeMark')
  const lastPos = fence.to > fence.from ? fence.to - 1 : fence.to
  const endLine = doc.lineAt(lastPos)
  const lastContent = (close && close.from !== openLine.from ? doc.lineAt(close.from).number : endLine.number + 1) - 1

  const parts: string[] = []
  for (let n = openLine.number + 1; n <= lastContent; n++) {
    parts.push(doc.line(n).text)
  }
  return parts.join('\n')
}

/**
 * 递归找出 `node` 下的所有 `FencedCode`。
 *
 * ⚠️ 找到 `FencedCode` 后**不再往里走**（围栏内部不可能再嵌围栏），
 * 其余节点继续下降（围栏可能藏在引用块 / 列表项里）。
 *
 * 为什么不用 `syntaxTree` 全量遍历：`EditorFeature.decorate` 的签名里**没有 state**
 * （见 `types.ts`，为了保持装饰器是纯函数可单测），拿不到树；而 `node` 就是
 * `Document`，它自带 `firstChild` / `nextSibling`，从这里走足够了。
 */
function forEachFencedCode(node: MarkdownNode, visit: (fence: MarkdownNode) => void): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'FencedCode') {
      visit(child)
      continue
    }
    forEachFencedCode(child, visit)
  }
}

function spansFor(doc: Text): MathSpan[] {
  const cached = SPAN_CACHE.get(doc)
  if (cached) return cached
  const built = collectMathSpans(doc)
  SPAN_CACHE.set(doc, built)
  return built
}

/** 开/闭围栏：CommonMark 允许最多 3 个前导空格，所以**不能** `trimStart` 后再判。 */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

/**
 * 逐行扫出所有行内公式。
 *
 * 为什么要逐行：行内公式**不跨行**（跨行的是块级，走围栏）。逐行扫描天然满足这一点。
 *
 * 跳过两类代码（否则 `$x$` 写在代码里会被误当公式）：
 *
 * - **围栏代码块**：用 `FENCE_RE` 跟踪开关（和 `link.ts` 的引用定义扫描同一招）。
 *   ⚠️ 局限：不识别 4 空格缩进的**缩进代码块**（`link.ts` 也不认）。接受这个局限 ——
 *   要认它就得有语法树，而 `decorate` 只拿得到 `doc`。
 * - **行内代码**：`scanLine` 里遇到反引号就整段跳过（见 `skipCode`）。
 */
function collectMathSpans(doc: Text): MathSpan[] {
  const spans: MathSpan[] = []
  let fence: string | null = null

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const match = FENCE_RE.exec(line.text)
    if (match) {
      // 只记围栏种类（``` 还是 ~~~），同种才能闭合。
      const marker = match[1]!
      const kind = marker[0]!
      if (fence === null) fence = kind
      else if (fence === kind) fence = null
      continue
    }
    if (fence !== null) continue
    scanLine(line.text, line.from, spans)
  }

  return spans
}

/**
 * 扫一行，产出 `$…$` 区间。
 *
 * 判定规则（每条都有理由）：
 *
 * - 开 `$` 后不能紧跟 `$` → `$$…$$` **不是**行内公式（契约：块级用围栏，不用 `$$`）；
 * - 内容**首尾不能是空白** → 挡掉 `$5 and $6` 这种货币写法（`$5 and $` 的内容
 *   以空格结尾，直接拒绝）；
 * - 闭 `$` 后不能紧跟数字 → 挡掉 `$x$5`（更像「公式后面接了个数字」，不是 `$x$` + `5`）；
 * - 内容非空。
 *
 * ⚠️ 没有「开 `$` 前必须是空白/行首」这类前置约束：`a$x$b` 里 `$x$` 也算公式。
 * 这是有意的取舍 —— 多加一条前置约束会让 `f(x)=$x^2$` 这类**合法**写法被拒。
 */
function scanLine(text: string, base: number, out: MathSpan[]): void {
  let i = 0
  while (i < text.length) {
    const ch = text[i]

    if (ch === '\\') {
      // 转义：`\$` 是字面美元，跳过下一个字符。
      i += 2
      continue
    }
    if (ch === '`') {
      i = skipCode(text, i)
      continue
    }
    if (ch !== '$') {
      i++
      continue
    }
    if (text[i + 1] === '$') {
      // `$$` → 不是行内公式，跳过两个字符（避免把 `$$x$$` 误读成 `$x$`）。
      i += 2
      continue
    }

    // 找闭合 `$`（允许内容里出现转义 `\$`）。
    let j = i + 1
    let close = -1
    while (j < text.length) {
      const c = text[j]
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === '$') {
        close = j
        break
      }
      j++
    }
    if (close < 0) {
      // 没有闭合 → 这个 `$` 是字面量，从下一个字符继续。
      i++
      continue
    }

    const tex = text.slice(i + 1, close)
    const next = text[close + 1] ?? ''
    if (tex.length > 0 && !/^\s/.test(tex) && !/\s$/.test(tex) && !/\d/.test(next)) {
      out.push({ from: base + i, to: base + close + 1, tex })
      i = close + 1
      continue
    }
    i++
  }
}

/**
 * 从 `start`（指向一段反引号）跳到行内代码结束之后。
 *
 * 规则对齐 CommonMark 的简化版：数出开反引号个数 `n`，往后找**长度恰好为 `n`**
 * 的反引号段；找不到（未闭合）就只跳过这段反引号本身、继续当普通文本扫 ——
 * CommonMark 也把未闭合反引号当字面量，这样处理两边一致。
 */
function skipCode(text: string, start: number): number {
  let n = 0
  while (text[start + n] === '`') n++

  let i = start + n
  while (i < text.length) {
    if (text[i] !== '`') {
      i++
      continue
    }
    let m = 0
    while (text[i + m] === '`') m++
    if (m === n) return i + n
    i += m
  }
  return start + n
}
