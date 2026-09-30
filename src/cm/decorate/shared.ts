import { Decoration } from '@codemirror/view';

import type { DecorationRanges } from '../types';

/** 揭示态标记的 class 名。`theme.ts` 的机制性规则也用它。 */
export const MARK_CLASS = 'nd-mark';

/**
 * 共享的空 `Decoration.replace`。**必须是模块级单例** ——
 * RangeSet 里的等值比较依赖对象标识，每次 `new` 一个空 replace
 * 会让 CM 的 diff 无法复用 DOM（整块重排）。
 */
export const HIDE = Decoration.replace({});

/**
 * 揭示态的标记（`**`、`*`、`` ` ``、`# `、`> `）：变淡，并中和继承来的粗体/斜体。
 *
 * ⚠️ 它不是「隐藏的反面」，而是一个**独立 mark**：样式 mark 覆盖整个节点（含标记），
 * 再用 `.nd-mark` 把标记继承来的样式压回去。这样就不用为「标记」和「内容」
 * 切两段 mark，省掉一大堆边界计算。
 */
export const MUTED_MARK = Decoration.mark({ class: MARK_CLASS });

/**
 * 推一个**隐藏**装饰：既进 `ranges`（要渲染），也进 `atomicRanges`（要当原子块）。
 *
 * 两个集合是分开的：只有隐藏态才配当原子区间，否则光标走不进揭示态的 `**` 里。
 */
export function pushAtomicRange(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  decoration: Decoration,
  from: number,
  to: number,
): void {
  ranges.push(decoration.range(from, to));
  atomicRanges.push(decoration.range(from, to));
}

/**
 * 推一个**可揭示的标记**：
 *   - 揭示态 → `MUTED_MARK`（变淡，留在文本流里，光标可以一个字符一个字符走进去）
 *   - 非揭示态 → `HIDE`，并且**同时**登记成原子区间（光标不能停在隐藏区间中间）
 */
export function pushRevealableMark(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  revealed: boolean,
  from: number,
  to: number,
): void {
  if (revealed) {
    ranges.push(MUTED_MARK.range(from, to));
  } else {
    pushAtomicRange(ranges, atomicRanges, HIDE, from, to);
  }
}
