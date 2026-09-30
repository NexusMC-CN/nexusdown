/**
 * ATX 标题 1-6。
 *
 * ⚠️ 放大（行高 / 外边距）**必须用 `Decoration.line`** —— `Decoration.mark`
 * 只包文字，改不了行盒。
 *
 * 本函数只负责「标题这一行」和「`# ` 定界符」，**不阻断下降**：
 * 标题里的嵌套行内标记（`# 这是 **粗体** 标题`）由 decorateInline 处理，
 * 那是 plugin.ts 的事（silkdown 的坑 ② 是它在 heading 处提前 return false）。
 */
import type { EditorSelection, Range, Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { Decoration } from '@codemirror/view'

import { selectionTouchesLineRange } from '../util/selection.js'
import { firstChildNamed } from '../util/tree.js'
import { pushRevealableMark } from './shared.js'

/** 模块级单例（RangeSet 的等值比较依赖对象标识）。 */
const HEADING_LINES: Record<number, Decoration> = {
  1: Decoration.line({ class: 'nd-h1' }),
  2: Decoration.line({ class: 'nd-h2' }),
  3: Decoration.line({ class: 'nd-h3' }),
  4: Decoration.line({ class: 'nd-h4' }),
  5: Decoration.line({ class: 'nd-h5' }),
  6: Decoration.line({ class: 'nd-h6' }),
}

export function decorateHeading(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  const level = Number.parseInt(node.name.slice(-1), 10)
  const lineDecoration = HEADING_LINES[level]
  if (!lineDecoration) return

  ranges.push(lineDecoration.range(doc.lineAt(node.from).from))

  const headerMark = firstChildNamed(node, 'HeaderMark')
  if (!headerMark) return

  // `# ` 的尾随空格一起藏，但**向后扫到第一个非空格字符**而不是无条件吃掉
  // 一个字符 —— 否则 `#  两空格  标题` 藏掉 `# ` 之后还会残留一个空格。
  let markTo = headerMark.to
  while (markTo < node.to && doc.sliceString(markTo, markTo + 1) === ' ') markTo++

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to)
  pushRevealableMark(ranges, atomicRanges, revealed, headerMark.from, markTo)
}
