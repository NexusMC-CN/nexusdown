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
