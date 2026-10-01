/**
 * `math` —— 行内 `$E = mc^2$`（契约：`docs/dialect-extensions.md` 第 2 节）。
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
 * ## 块级公式：编辑器侧**不特殊处理**（如实记录）
 *
 * 契约说「块级走 `fence.ts` 已有的 `info === 'math'` 分支」。但读了 `decorate/fence.ts`
 * 之后发现 —— **那个分支不存在**：`fence.ts` 对所有围栏一视同仁，只按 `info` 当语言名
 * 画标题栏。而 `decorate/*` 在本次任务里是**禁止修改**的接线文件（改了会和其它 agent 冲突）。
 *
 * 所以编辑器侧的现实是：` ```math ` 围栏会显示成一个语言名为 `math` 的**普通代码块**，
 * 里面是 TeX 源码。**块级公式的渲染只发生在显示侧**（`src/render/features/math.ts`
 * 把它变成 KaTeX）。这不是遗漏，是文件边界下的唯一正确选择 —— 若将来要补编辑器侧
 * 的块级公式，正确做法是在 `fence.ts` 里加 `info === 'math'` 分支，而不是在这里
 * 认领 `FencedCode`（认领会抢走**所有**代码块，且会和 embed 功能撞车）。
 *
 * ## 两条硬约束
 *
 * - widget 必须实现 `eq`（否则每次 rebuild 重建 DOM）；
 * - 非揭示态的 `replace` 必须**同时**登记进 `atomicRanges`（`pushAtomicRange`）。
 */
import type { EditorSelection, Text } from '@codemirror/state'
import { Decoration, WidgetType } from '@codemirror/view'

import { MUTED_MARK, pushAtomicRange } from '../decorate/shared.js'
import type { EditorFeature } from '../feature.js'
import type { DecorationRanges, MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'

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
 * ⚠️ **这里不渲染 KaTeX。** 原因和渲染侧是同一个：KaTeX 是可选依赖，
 * 不能进主包；而 CM6 widget 的 `toDOM()` 是**同步**的，`import()` 拿不到。
 * 编辑器里退化成「显示 TeX 源码」——用 `.nd-math` 的数学字体衬出「这是公式」，
 * 比露出 `$…$` 更接近所见即所得。真要在编辑器里画 KaTeX，得由消费方在
 * 装配时注入一个渲染函数（同渲染侧的注入思路），本次不做。
 */
export class MathWidget extends WidgetType {
  constructor(private readonly tex: string) {
    super()
  }

  /** 必须实现，否则每次 rebuild 都重建 DOM（公式会闪）。 */
  override eq(other: MathWidget): boolean {
    return other.tex === this.tex
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nd-math'
    // textContent：TeX 可能含 `<`（比如 `a < b`），绝不能用 innerHTML。
    span.textContent = this.tex
    return span
  }

  /** 事件交给 CM：点公式 → 光标定位 → 这一行转揭示态显示源码。 */
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

export const mathFeature: EditorFeature = {
  name: 'math',
  /*
   * ⚠️ `Document` 是**全局唯一**的挂载点，别再加第二个功能来认领它
   * （`indexFeatures` 会抛错）。见文件头。
   */
  nodes: ['Document'],
  decorate(ranges, atomicRanges, node, doc, selection) {
    decorateMath(ranges, atomicRanges, node, doc, selection)
  },
}

function decorateMath(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  _node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
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
      Decoration.replace({ widget: new MathWidget(span.tex) }),
      span.from,
      span.to,
    )
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
