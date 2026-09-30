/**
 * 行内标记：粗体 / 斜体 / 行内代码 / 删除线。
 *
 * 两个设计要点（见 docs/cm-live-preview-reference.md 第 2 节与 4.2 节）：
 *
 * 1. 样式 mark **覆盖整个节点（含定界符）**。揭示态下 `**` 虽然落在
 *    `.nd-strong` 区间里，却被 `.nd-mark` 的 `font-weight: normal` /
 *    `font-style: normal` 中和掉 —— 不必为「定界符」和「内容」切两段 mark。
 * 2. 非揭示态只把**定界符本身**注册成 atomic。绝不把整个节点注册成 atomic，
 *    否则非活动行上光标跨不过词中间（silkdown 的坑 ③）。
 */
import type { EditorSelection, Range, Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { Decoration } from '@codemirror/view'

import { selectionTouchesLineRange } from '../util/selection.js'
import { children } from '../util/tree.js'
import { pushRevealableMark } from './shared.js'

/**
 * 模块级单例。RangeSet 的等值比较依赖对象标识，
 * 在函数里 `Decoration.mark({...})` 会让 CM 的 diff 无法复用 DOM。
 */
const STRONG_MARK = Decoration.mark({ class: 'nd-strong' })
const EM_MARK = Decoration.mark({ class: 'nd-em' })
const INLINE_CODE_MARK = Decoration.mark({ class: 'nd-code' })
const STRIKE_MARK = Decoration.mark({ class: 'nd-strike' })

const INLINE_MARKS: Record<string, Decoration> = {
  StrongEmphasis: STRONG_MARK,
  Emphasis: EM_MARK,
  InlineCode: INLINE_CODE_MARK,
  Strikethrough: STRIKE_MARK,
}

/** 行内定界符节点：`*` / `**`、`` ` ``、`~~`。 */
const MARKER_NODES = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark'])

export function decorateInline(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  const styling = INLINE_MARKS[node.name]
  if (!styling) return

  ranges.push(styling.range(node.from, node.to))

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to)

  // 每个定界符单独决定「藏」还是「变淡」。
  // ⚠️ 不要在这里把整个 node 注册成 atomicRanges —— pushRevealableMark
  //    已经为每个定界符注册了 atomic，那是冗余且过度的。
  for (const child of children(node)) {
    if (!MARKER_NODES.has(child.name)) continue
    pushRevealableMark(ranges, atomicRanges, revealed, child.from, child.to)
  }
}
