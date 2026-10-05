import type { EditorSelection, Text } from '@codemirror/state';

/**
 * Obsidian 式的行级揭示判定：**任一**选区与 `[from, to]` 有共同行 → 揭示。
 *
 * 为什么用「行区间」而不是 `doc.lineAt(head)`：
 *   - 多行选区必须揭示被跨越的行里的节点
 *   - 多行节点（围栏代码块）在任意一行上都该揭示
 *
 * 为什么遍历 `selection.ranges` 而不是 `selection.main`：
 *   - CM6 支持多光标，每个光标都该独立触发揭示
 */
export function selectionTouchesLineRange(
  doc: Text,
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  // ★ CM6 的节点 `to` 是**排他**的。如果 `to` 正好落在下一行行首，
  //   不减 1 就会把 end-line 算多一行 —— 表现为「光标在下一行时，上一行的标记也被揭示」。
  const safeTo = to > from ? Math.max(from, to - 1) : to;
  const nodeStartLine = doc.lineAt(from).number;
  const nodeEndLine = doc.lineAt(safeTo).number;

  for (const range of selection.ranges) {
    const selStartLine = doc.lineAt(range.from).number;
    const selEndLine = doc.lineAt(range.to).number;
    if (selStartLine <= nodeEndLine && nodeStartLine <= selEndLine) return true;
  }
  return false;
}

/**
 * 光标是不是停在**块级装饰的门口**（`from - 1` / `to + 1`）。
 *
 * ## 为什么需要它
 *
 * 块级 `Decoration.replace` 的区间**光标进不去** ✗ —— 实测连程序
 * `dispatch({ selection: cursor(from) })` 都会被 CM6 夹到 `from - 1` ✓。
 * 所以「门口」是用户**唯一**能触达的位置 ✓，揭示判据必须有它 ✓，
 * 不然键盘用户永远进不了围栏/表格 ✓。
 *
 * ## ⚠️ 为什么还要判「那一行非空」
 *
 * 光看位置是**不够**的 ✗ —— **空行只有一个位置** ✓，整行都等于 `from - 1` ✓，
 * 于是光标**路过**那里也会命中 ✓ → **公式/表格莫名其妙不渲染** ✗。
 *
 * 用户实测（2026-10-04）：文档是 `空 / ```math / 公式 / ``` / 空` 五行的时侯，
 * 光标停在第 1 或第 5 行（都是空行）→ **公式不渲染** ✗；
 * **写一个字之后又渲染了** ✓（那一行变长 ✓ → `from` 移动 ✓ → 不再是紧邻 ✓）。
 *
 * 加上「非空」这个条件之后：
 * - **空行**上路过 → **不揭示** ✓（本次修的就是它 ✓）
 * - **有内容的行**，光标停在**行尾**（`from - 1` 就是上一行的行尾 ✓）→ 揭示 ✓
 *   —— 这时候用户基本就是"想在这儿打字" ✓，揭示是合理的 ✓
 *
 * ⚠️ **残留情况**：相邻行**有内容**时，光标停在它的**行尾**仍会揭示 ✓ ——
 * 想让"路过"和"要编辑"完全分开，需要记住用户的**意图**（点击设标记 ✓），
 * 那是更大的一步 ✓；这条判据先把"空行必然命中"这个最刺眼的去掉 ✓。
 */
export function selectionHoversBlock(
  doc: Text,
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  for (const range of selection.ranges) {
    const head = range.head
    if (head === from - 1 && from > 0 && doc.lineAt(head).length > 0) return true
    if (head === to + 1 && head <= doc.length && doc.lineAt(head).length > 0) return true
  }
  return false
}
