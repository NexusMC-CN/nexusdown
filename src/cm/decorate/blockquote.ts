/**
 * 引用块。
 *
 * 左边线靠 `Decoration.line` + CSS `border-left`。因为 line 装饰只作用于
 * 「以该位置开头的那一行」，**整块每一行都要推一个**，否则多行引用的
 * 左边线只覆盖第一行。
 *
 * 嵌套引用（`> > 文字`）目前给同一行推两次同一个 class，CSS 只算一次 ——
 * 嵌套没有视觉层级。要修得按嵌套深度生成 `nd-bq-1` / `nd-bq-2`。
 */
import type { EditorSelection, Range, Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { Decoration } from '@codemirror/view'

import { selectionTouchesLineRange } from '../util/selection.js'
import { children } from '../util/tree.js'
import { pushRevealableMark } from './shared.js'

/** 模块级单例（RangeSet 的等值比较依赖对象标识）。 */
const BLOCKQUOTE_LINE = Decoration.line({ class: 'nd-blockquote' })

export function decorateBlockquote(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  // 整块每一行一个 line 装饰。
  let pos = node.from
  while (pos <= node.to) {
    const line = doc.lineAt(pos)
    ranges.push(BLOCKQUOTE_LINE.range(line.from))
    if (line.to >= node.to) break
    pos = line.to + 1
  }

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to)

  for (const quoteMark of collectQuoteMarks(node, [])) {
    // `> ` 的尾随空格一起藏；`>tight` 没有空格时只藏 `>`。
    const next = doc.sliceString(quoteMark.to, quoteMark.to + 1)
    const markTo = next === ' ' ? quoteMark.to + 1 : quoteMark.to
    pushRevealableMark(ranges, atomicRanges, revealed, quoteMark.from, markTo)
  }
}

/**
 * 收集**本层**引用块自己的 `QuoteMark`。
 *
 * ⚠️ 不能只看直接子节点：lezer 会把续行的 `>` 塞进 `Paragraph` 里 ——
 * `> a\n> b` 的树是 `Blockquote > [QuoteMark, Paragraph > QuoteMark]`，
 * 第二个 `>` 不是 Blockquote 的直接子节点。只扫直接子节点的话，
 * 多行引用只有第一行的 `>` 被藏掉。
 *
 * 遇到嵌套 `Blockquote` 要**剪枝**：`> > 文字` 里内层的 `>` 由内层自己的
 * 那次调用处理，否则同一个区间会被推两次。
 */
function collectQuoteMarks(node: SyntaxNode, out: SyntaxNode[]): SyntaxNode[] {
  for (const child of children(node)) {
    if (child.name === 'QuoteMark') {
      out.push(child)
    } else if (child.name !== 'Blockquote') {
      collectQuoteMarks(child, out)
    }
  }
  return out
}
