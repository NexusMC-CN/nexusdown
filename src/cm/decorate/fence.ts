/**
 * 围栏代码块 —— 渲染成 **IDE 代码窗口**的样子。
 *
 *     ┌──────────────────────┐
 *     │ ● ● ●         yaml   │  ← 围栏行 → 标题栏 widget
 *     ├──────────────────────┤
 *     │ 我是内容              │  ← 内容行，lezer overlay 负责着色
 *     └──────────────────────┘
 *
 * 这个装饰器只做三件事：**给每一行加背景**、**把开围栏行换成标题栏 widget**、
 * **把闭围栏行藏掉**。语法着色完全交给 lezer overlay，这里不碰。
 *
 * ⚠️ 三条硬约束：
 *
 * 1. **`Decoration.replace` 不能跨行** —— 所以绝不 replace 整个 `FencedCode` 节点，
 *    而是 `doc.lineAt(mark.from)` 拿到 open / close 各自所在的**那一整行**再处理。
 * 2. **背景必须用 `Decoration.line`** —— `mark` 只包文字，改不了行盒
 *    （圆角、内边距、行高都画不出来）。
 * 3. **标题栏 widget 是行内替换，绝不能加 `block: true`** —— CM6 里 block widget
 *    的区间**方向键永远进不去**，加了这个围栏行就彻底无法编辑了。
 *
 * ⚠️ `FencedCode` 在 `plugin.ts` 里**不会 `return false`**，好让 lezer 的高亮 tag
 * 落进代码块里。所以这里**不要**自己做语法高亮，也不要在 `enter` 里阻断下降。
 */
import type { EditorSelection, Text } from '@codemirror/state'
import { Decoration } from '@codemirror/view'

import type { DecorateContext, DecorationRanges, MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'
import { firstChildNamed, lastChildNamed } from '../util/tree.js'
import { CodeFenceHeaderWidget } from '../widgets/code-header.js'
import { HIDE, pushAtomicRange } from './shared.js'

/** 模块级单例（RangeSet 的等值比较依赖对象标识）。 */
const BLOCK = 'nd-code-block'
const LINE_PLAIN = Decoration.line({ class: BLOCK })
const LINE_FIRST = Decoration.line({ class: `${BLOCK} nd-code-block-first` })
const LINE_LAST = Decoration.line({ class: `${BLOCK} nd-code-block-last` })
const LINE_ONLY = Decoration.line({ class: `${BLOCK} nd-code-block-first nd-code-block-last` })

/**
 * 折叠时代码块的**非首行** —— 压成 0 高。
 *
 * ⚠️ 为什么不能只靠 `HIDE`：`Decoration.replace` 藏的是**行内内容**（`[line.from, line.to)`，
 * 不含换行符）。**空行没有内容可藏**，于是它仍然占一整行高度 ——
 * 折叠一个中间有空行的代码块会露出一条白缝。
 *
 * ⚠️ 为什么要**同时带 `.nd-code-block`**：折叠动画靠 `max-height` 过渡，
 * 而 CSS transition 需要**前后两个状态都有确定值**。如果折叠态的行只有
 * `.nd-code-folded`、展开态只有 `.nd-code-block`，两个状态之间没有共同属性，
 * 过渡就不会触发（`max-height: none → 0` 是**不可动画**的）。
 * 让两种状态都带 `.nd-code-block`（它定义了 `max-height: 50em`），
 * 折叠时只加 `.nd-code-folded` 把 `max-height` 压到 0，过渡才有起点。
 */
const LINE_FOLDED = Decoration.line({ class: `${BLOCK} nd-code-folded` })

/** 首行只圆上外角、末行只圆下外角；单行块上下都圆。 */
function lineDecoration(index: number, count: number): Decoration {
  if (count === 1) return LINE_ONLY
  if (index === 0) return LINE_FIRST
  if (index === count - 1) return LINE_LAST
  return LINE_PLAIN
}

/**
 * 开围栏的 `info` string（反引号之后到行尾，已 `trim`）。
 *
 * ★ 这段逻辑本来内联在 `decorateFencedCode` 里（折叠态、展开态各写了一遍）。
 * 抽成导出函数是**给 embed 功能一个可复用的入口**：`features/embed.ts` 认领了
 * `FencedCode` 之后要自己判断「这个围栏是不是 embed」，就必须用**和标题栏
 * 完全相同**的方式取 `info` —— 两边各写一遍迟早会漂移（一边 `trim` 一边没 `trim`，
 * 于是 ` ```embed ... ` 在一侧认得、另一侧认不得）。
 *
 * ⚠️ 返回的是**整行** `info`（` ```ts a.ts ` → `ts a.ts`），调用方自己决定怎么切。
 * 理论上 `FencedCode` 一定以 `CodeMark` 开头，取不到时返回 `null`（防御）。
 */
export function readFenceInfo(doc: Text, node: MarkdownNode): string | null {
  const open = firstChildNamed(node, 'CodeMark')
  if (!open) return null
  const line = doc.lineAt(open.from)
  return doc.sliceString(open.to, line.to).trim()
}

/**
 * `info` 的第一段是不是 `embed` —— embed 功能用它做**分流判断**。
 *
 * ⚠️ 这里**只认第一段**，不校验 provider/kind/id。校验是
 * `render/features/embed.ts` 里 `parseEmbedFence` 的事（那张 provider 表是两侧
 * 共用的单一来源）。分成两步是因为「是不是 embed」和「embed 写得对不对」是两件事：
 * 前者决定「走哪条装饰路径」，后者决定「要不要降级成普通代码块」。
 */
export function isEmbedInfo(info: string | null | undefined): boolean {
  if (!info) return false
  return info.split(/\s+/)[0] === 'embed'
}

/**
 * `info` 的第一段是不是 `math` —— **块级公式**的围栏（契约第 2 节）。
 *
 * 和 `isEmbedInfo` 是同一套判定，理由也一样：
 *
 * - **只认第一段**（` ```math title=x ` 也算 math），和渲染侧
 *   `render/features/math.ts` 的 `language === 'math'` 逐字一致 ——
 *   两边各写一遍迟早会漂（一边 `trim` 一边没 `trim`，于是同一条围栏
 *   在一侧认得、另一侧认不得）。
 * - **不在这里校验内容** —— 「是不是 math 围栏」和「公式写没写对」是两件事，
 *   后者是 KaTeX 的事。
 *
 * ⚠️ **谁在用**：`features/embed.ts` 用它把 math 围栏**让出去**（不画成代码块），
 * 真正的装饰在 `features/math.ts` 的 Document 扫描里。为什么是这个分工见那边文件头。
 */
export function isMathInfo(info: string | null | undefined): boolean {
  if (!info) return false
  return info.split(/\s+/)[0] === 'math'
}

export function decorateFencedCode(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
  context?: DecorateContext,
): void {
  const folded = context?.folded ?? false
  const startLine = doc.lineAt(node.from)
  // `node.to` 是**排他**的：正好落在下一行行首时，不减 1 会多算一行
  // （和 util/selection.ts 里那个 off-by-one 是同一件事）。
  const lastPos = node.to > node.from ? node.to - 1 : node.to
  const endLine = doc.lineAt(lastPos)
  const count = endLine.number - startLine.number + 1

  const open = firstChildNamed(node, 'CodeMark')
  const close = lastChildNamed(node, 'CodeMark')

  // ---------------------------------------------------------------------
  // 折叠态：**只剩标题栏**，其余行全部压掉。
  // ---------------------------------------------------------------------
  if (folded) {
    // 标题栏那一行：上下都要圆角（它现在是整张卡片的唯一可见部分）。
    ranges.push(LINE_ONLY.range(startLine.from))

    for (let n = startLine.number + 1; n <= endLine.number; n++) {
      const line = doc.line(n)
      ranges.push(LINE_FOLDED.range(line.from))
      if (line.to > line.from) {
        pushAtomicRange(ranges, atomicRanges, HIDE, line.from, line.to)
      }
    }

    if (open) {
      const openLine = doc.lineAt(open.from)
      if (openLine.to > openLine.from) {
        const info = readFenceInfo(doc, node) ?? ''
        pushAtomicRange(
          ranges,
          atomicRanges,
          Decoration.replace({ widget: new CodeFenceHeaderWidget(info, true, node.from) }),
          openLine.from,
          openLine.to,
        )
      }
    }
    return
  }

  // ---------------------------------------------------------------------
  // 展开态
  // ---------------------------------------------------------------------

  /**
   * ⚠️ **背景加在每一行上，包括两行围栏** —— 这样整个块是**一张连续的卡片**，
   * 首尾行各自圆外角、上下各留一段灰边（视觉上就是窗口的内边距）。
   *
   * 试过只给内容行加背景、把围栏行折叠掉（`height: 0`），结果是**看起来少了两行**
   * —— 窗口上下凭空缺一块，比多两条灰边更奇怪（用户原话："那一行凭空消失了相当于？
   * 就很奇怪，我建议是保留上和下行，显示为一个真正的卡片的样子"）。
   */
  for (let n = startLine.number; n <= endLine.number; n++) {
    ranges.push(lineDecoration(n - startLine.number, count).range(doc.line(n).from))
  }

  // 揭示态（光标/选区碰到这个块的任意一行）：围栏原样可见 —— 用户要能改语言标记。
  if (selectionTouchesLineRange(doc, selection, node.from, node.to)) return

  // 开围栏行 → **窗口标题栏**（圆点 + 图标 + 文件名 + 语言名 + 折叠按钮）。
  if (open) {
    const openLine = doc.lineAt(open.from)
    if (openLine.to > openLine.from) {
      // 语言名 = 反引号之后到行尾的内容（` ```yaml ` → `yaml`；` ``` yaml ` 也 → `yaml`）。
      const info = readFenceInfo(doc, node) ?? ''
      pushAtomicRange(
        ranges,
        atomicRanges,
        Decoration.replace({ widget: new CodeFenceHeaderWidget(info, false, node.from) }),
        openLine.from,
        openLine.to,
      )
    }
  }

  // 闭围栏行 → 藏掉（窗口的下边框由 `.nd-code-block-last` 的灰底 + 圆角提供）。
  // 未闭合的围栏只有一个 `CodeMark`，open 与 close 是**同一个节点** → 只处理一次。
  if (close && (!open || close.from !== open.from)) {
    const closeLine = doc.lineAt(close.from)
    if (closeLine.to > closeLine.from) {
      pushAtomicRange(ranges, atomicRanges, HIDE, closeLine.from, closeLine.to)
    }
  }
}
