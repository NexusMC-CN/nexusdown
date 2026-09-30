/**
 * 其它块级元素：水平线，以及 `plugin.ts` 归到「块级」桶里的图片。
 *
 * `plugin.ts` 的 `BLOCK_NODES` 是 `{ Image, HorizontalRule }`，两者都走这里：
 * - `Image` 的装饰逻辑（URL 白名单、揭示规则、`ImageWidget`）和链接完全共用，
 *   所以**直接转交 `decorateLink`**，不在两个文件里各写一遍。
 * - `HorizontalRule` 用 `Decoration.line` + CSS 边框画线。
 *
 * ⚠️ **不做 block widget** —— `block: true` 的 replace 会让方向键**永远进不去**
 * （参考文档「其他必须知道的约束」）。所以水平线是「藏掉整行字符 + 行上加 class」，
 * 线由 CSS 的 `border-top` 画出来，而不是塞一个 `<hr>` widget。
 */
import type { EditorSelection, Text } from '@codemirror/state'
import { Decoration } from '@codemirror/view'

import type { DecorationRanges, MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'
import { decorateLink } from './link.js'
import { HIDE, MUTED_MARK, pushAtomicRange } from './shared.js'

/** 模块级单例（RangeSet 的等值比较依赖对象标识）。 */
const HR_LINE = Decoration.line({ class: 'nd-hr' })

export function decorateBlock(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
): void {
  if (node.name === 'Image') {
    // `references` / `urlPolicy` 传 undefined → 走 link.ts 的内置默认策略。
    decorateLink(ranges, atomicRanges, node, doc, selection, undefined, undefined)
    return
  }

  if (node.name === 'HorizontalRule') {
    decorateHorizontalRule(ranges, atomicRanges, node, doc, selection)
  }
}

function decorateHorizontalRule(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
): void {
  // `  ---` 允许最多 3 个前导空格，所以整行从 line.from 起算。
  const line = doc.lineAt(node.from)
  ranges.push(HR_LINE.range(line.from))
  if (line.to <= line.from) return

  if (selectionTouchesLineRange(doc, selection, node.from, node.to)) {
    // 揭示态：`---` 变淡留在原地（光标可以进去改）。
    ranges.push(MUTED_MARK.range(line.from, line.to))
    return
  }

  // 非揭示态：藏掉整行字符（不含换行符 → 不跨行），线由 `.nd-hr` 的边框画。
  pushAtomicRange(ranges, atomicRanges, HIDE, line.from, line.to)
}
