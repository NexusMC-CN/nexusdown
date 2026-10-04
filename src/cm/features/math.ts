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
 * ## 块级围栏走**块级通道**（`block: true`），和表格同一条路
 *
 * ⚠️ 这里曾经写着「**不能** `Decoration.replace({ block: true })`（方向键永远进不去）」✗，
 * 于是围栏用「开围栏行换行内 widget + 其余行 `HIDE` 藏内容 + `.nd-math-hidden`
 * 把行压成 `height: 0`」硬凑出「一整块」的观感 ✗。**那套会把 CM6 的高度表搞坏** ✗：
 * 高度表是按行测量的，`height: 0` 的行让 tile 数学对不上 → 真浏览器里直接抛
 * `No tile at position N` / `Decorations that replace line breaks may not be specified
 * via plugins`（实测，jsdom 测不出来 —— 高度表只在真实布局下存在）。
 *
 * 现在改成和 `table.ts` **同一条路**（那套已经跑通）：
 *
 * - 功能标 `block: true` → 骨架（`plugin.ts` 的 `splitFeatures`）把它分流到 StateField
 *   （**块级装饰只能由 StateField 提供**，ViewPlugin 提供会抛 `Block decorations may not
 *   be specified via plugins`）；
 * - **一个** `Decoration.replace({ block: true, widget })` 覆盖**整段**围栏
 *   （开围栏行首 → 闭围栏行尾）；
 * - **揭示态**：选区碰到围栏任意一行、**或**光标紧邻（`from - 1` / `to + 1`）→ 什么都不推。
 *   「紧邻即揭示」是关键 —— 块级区间光标进不去，门口是**唯一**能触达的位置，
 *   一到门口就换回源码，键盘用户照样能编辑；
 * - 点 widget → 光标落到 `from - 1`（见 `MathBlockWidget`）。
 *
 * ## 三条硬约束
 *
 * - widget 必须实现 `eq`（否则每次 rebuild 重建 DOM）；
 * - **行内**公式的隐藏态 `replace` 必须登记进 `atomicRanges`（`pushAtomicRange`）；
 *   块级 replace 不用 —— 光标本来就进不去（同 `table.ts`）。
 * - 块级 `replace` **必须**落在整行边界（行首/行尾），见 `decorateMathFences`。
 */
import { EditorSelection, type Line, type Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Decoration, WidgetType } from '@codemirror/view'

import { KATEX_OPTIONS, type KatexLike } from '../../render/features/math.js'
import { decorateFencedCode, isMathInfo, readFenceInfo } from '../decorate/fence.js'
import { MUTED_MARK, pushAtomicRange } from '../decorate/shared.js'
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
 * <div class="nd-math nd-math-block">…KaTeX 的输出…</div>
 * ```
 *
 * ⚠️ **是 `<div>`（块级）**，因为它是 `block: true` 的整块替换 —— widget 直接挂在
 * `.cm-content` 下、不在 `.cm-line` 里（同 `TableWidget` 的 `.nd-table`）。
 * 这也和渲染侧产出的 `<div class="nd-math nd-math-block">` 一致。
 * （以前它是行内替换、必须是 `<span>` 才能待在行内流里 —— 那套连同 `height: 0` 一起删了。）
 */
export class MathBlockWidget extends WidgetType {
  constructor(
    private readonly tex: string,
    private readonly render: MathRenderer,
    /** 围栏块首行行首的位置。点 widget 时把光标放到 `from - 1`（见文件头「紧邻即揭示」）。 */
    private readonly from: number,
  ) {
    super()
  }

  /**
   * ⚠️ 必须实现，否则每次 rebuild 都重建 DOM（公式会闪）。
   *
   * 比 `tex` **和** `from`：`tex` 变了公式要重画；`from` 变了 `mousedown` 要落到新位置，
   * 也必须重建。
   *
   * **不比 `render`**：同一个编辑器里 `render` 是同一个对象（`nexusdown()` 一次性注入），
   * 比引用没有意义；而消费方若习惯性地每次现造一个包装函数，比引用反而会让 widget
   * 永远不等、每帧重建。
   */
  override eq(other: MathBlockWidget): boolean {
    return other.tex === this.tex && other.from === this.from
  }

  override toDOM(view: EditorView): HTMLElement {
    const div = document.createElement('div')
    div.className = 'nd-math nd-math-block'
    try {
      /*
       * KaTeX 在 `trust:false` 下的输出是**自包含且安全**的，直接内联
       * （和渲染侧 `renderMath` 同一决定）。这是本项目**极少数**允许 `innerHTML`
       * 的地方：内容是消费方注入的渲染器产出的，不是用户输入；再转义会把公式里的
       * `<` 显示成 `&lt;`。
       */
      div.innerHTML = this.render.renderToString(this.tex, {
        ...KATEX_OPTIONS,
        displayMode: true,
      })
    } catch (e) {
      /*
       * 契约：渲染失败**降级成源码**，绝不抛（`throwOnError:false` 挡不住的那类）。
       * ⚠️ 这里必须 `textContent` —— 源码是**用户输入**，走 innerHTML 就是注入面。
       * ⚠️ 但**必须留一条日志**：静默降级会让「公式不渲染」变得毫无线索
       * （实测排查时卡了很久）。
       */
      console.warn('[nexusdown] 数学渲染失败，已降级成源码：', e)
      div.classList.add('nd-math-source')
      div.textContent = this.tex
    }

    /*
     * 点击揭示（同 `TableWidget`）。
     *
     * ⚠️ `preventDefault()` 是**必须的**，不是防御性代码：CM6 的 `eventBelongsToEditor`
     * 会先看 `event.defaultPrevented`，prevent 过就直接放行、不再自己处理鼠标。
     * 少了它，CM6 会抢走这次点击、把光标放到别处，揭示逻辑等于没写。
     *
     * ⚠️ `Math.max(0, …)`：围栏**就在文档开头**时 `from === 0`，`from - 1` 是 `-1`
     * —— 直接 dispatch 会抛 `Selection points outside of document`。夹到 0 落在
     * 围栏首行行首，属于「在围栏里」，一样揭示。
     */
    div.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: EditorSelection.cursor(Math.max(0, this.from - 1)) })
    })

    return div
  }

  /**
   * 返回 `false` = 事件交给 CM 的默认处理。
   *
   * 真正的「别让 CM 抢点击」靠 `mousedown` 里的 `preventDefault()`（见上）。
   * 这里返回 `false` 而不是 `true`，是为了**不拦掉别的交互**，只精确接管那一次 `mousedown`。
   */
  override ignoreEvent(_event: Event): boolean {
    return false
  }
}

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
    /*
     * ★ 块级功能：围栏产出一个 `block: true` 的跨行 replace，只能由 StateField 提供
     * （ViewPlugin 提供会抛 `Block decorations may not be specified via plugins`）。
     * 见文件头「块级围栏走块级通道」。
     *
     * ⚠️ 本功能**同时**推行内公式的装饰（认领 `Document` 是全文扫描的代价）。
     * 那些行内 replace 的原子区间由块级通道一并提供（见 `plugin.ts` 的 `blockDecorations`）。
     */
    block: true,
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
 * - **注入了渲染函数** → **一个** `block: true` 的跨行 replace 覆盖**整段围栏**
 *   （开围栏行首 → 闭围栏行尾），揭示态不推任何装饰。
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

    const open = firstChildNamed(fence, 'CodeMark')
    if (!open) continue
    const openLine = doc.lineAt(open.from)

    /*
     * 块级 replace **必须**落在整行边界（CM6 要求）——
     * `openLine.from` 是**结构性**的行首保证（围栏前最多 3 个前导空格也算在行内）。
     * `fence.to` 是**排他**的：正好落在下一行行首时，不减 1 会多算一行（同 `fence.ts`）。
     */
    const from = openLine.from
    const lastPos = fence.to > fence.from ? fence.to - 1 : fence.to
    const to = doc.lineAt(lastPos).to
    if (to <= from) continue

    // 揭示态 → **什么都不推**，源码原样（用户要能改）。⚠️ 必须在推 replace 之前返回，
    // 否则会把光标要编辑的源码藏掉。
    if (isMathFenceRevealed(doc, selection, from, to)) continue

    // 整段围栏 → 一个块级公式 widget。
    // 块级 replace 不登记 atomicRanges —— 光标本来就被 CM6 挡在区间外（同 `table.ts`）。
    ranges.push(
      Decoration.replace({
        block: true,
        widget: new MathBlockWidget(mathSource(doc, fence, openLine), render, from),
      }).range(from, to),
    )
  }
}

/**
 * 揭示判据 —— **和 `table.ts` 的 `isTableRevealed` 同一套**（见那边文件头「紧邻即揭示」）。
 *
 * 两个条件任一成立就揭示：
 *
 * 1. **选区碰到围栏任意一行** —— 复用 `selectionTouchesLineRange`，多光标安全。
 * 2. **光标紧邻** `from - 1` / `to + 1` —— ⚠️ 这一条**不能省**。块级区间光标进不去，
 *    门口是**唯一**能触达的位置；少了它键盘用户永远进不了围栏
 *    （`selectionTouchesLineRange` 不会把 `from - 1` 算进来 —— 那是**上一行**）。
 *
 * 用 `range.head` 而不是 `range.from` / `range.to`：紧邻描述的是**光标**（移动端），
 * 而选区只要碰到围栏行就已被条件 1 覆盖。
 */
function isMathFenceRevealed(
  doc: Text,
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  if (selectionTouchesLineRange(doc, selection, from, to)) return true
  for (const range of selection.ranges) {
    if (range.head === from - 1 || range.head === to + 1) return true
  }
  return false
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
