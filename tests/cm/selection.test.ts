import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { selectionTouchesLineRange } from '../../src/cm/util/selection';

/**
 * 文档：`aaa\nbbb\nccc`
 *   L1 = [0, 3)  （`lineAt(3)` 仍算 L1 —— 位置 3 是那个换行符）
 *   L2 = [4, 7)
 *   L3 = [8, 11)
 */
const doc = Text.of(['aaa', 'bbb', 'ccc']);

// ⚠️ `EditorSelection.cursor()` 返回的是 `SelectionRange`（不是 EditorSelection），
//    要包一层 `EditorSelection.single` 才是能喂给谓词的选区。
const cursor = (pos: number) => EditorSelection.single(pos);

describe('selectionTouchesLineRange', () => {
  it('★ off-by-one：节点的 to 落在下一行行首时，不该把 end-line 算多一行', () => {
    // 节点 [0, 8) 覆盖 L1 + L2（8 是 L3 的行首，属于**排他**边界）。
    // 光标停在 L3 行首 → 不该揭示。
    expect(selectionTouchesLineRange(doc, cursor(8), 0, 8)).toBe(false);

    // 对照组：光标在 L2 的最后一个字符上 → 必须揭示。
    expect(selectionTouchesLineRange(doc, cursor(6), 0, 8)).toBe(true);

    // 把「为什么」钉死：位置 8 属于 L3、位置 7 属于 L2。
    // 少了 `safeTo = to - 1`，nodeEndLine 会变成 3，第一条断言就会假阳性通过。
    expect(doc.lineAt(8).number).toBe(3);
    expect(doc.lineAt(7).number).toBe(2);
  });

  it('★ off-by-one：真实解析出的节点（to 落在最后一行行首）', () => {
    // `# 标题\n\n正文\n` —— 语法树长度正好落在第 4 行（空行）的行首。
    const text = Text.of(['# 标题', '', '正文', '']);
    const state = EditorState.create({
      doc: text,
      extensions: [markdown({ base: markdownLanguage, addKeymap: false })],
    });
    const treeLength = syntaxTree(state).length;

    // 前提：这个位置确实是「行首」
    expect(text.lineAt(treeLength).from).toBe(treeLength);

    // 光标在最后那个空行上 → 不该揭示上面几行的节点
    expect(selectionTouchesLineRange(text, cursor(treeLength), 0, treeLength)).toBe(false);
    // 光标在「正文」行上 → 揭示
    expect(selectionTouchesLineRange(text, cursor(treeLength - 1), 0, treeLength)).toBe(true);
  });

  it('光标落在节点区间内 → 揭示', () => {
    expect(selectionTouchesLineRange(doc, cursor(0), 0, 3)).toBe(true);
    expect(selectionTouchesLineRange(doc, cursor(2), 0, 3)).toBe(true);
  });

  it('光标与节点没有共同行 → 不揭示', () => {
    expect(selectionTouchesLineRange(doc, cursor(0), 4, 7)).toBe(false);
    expect(selectionTouchesLineRange(doc, cursor(9), 4, 7)).toBe(false);
  });

  it('跨行选择：选区跨越节点所在行 → 揭示', () => {
    // L1 行首 → L3 行首（跨了 L2）
    const sel = EditorSelection.single(0, 10);
    expect(selectionTouchesLineRange(doc, sel, 4, 7)).toBe(true);
  });

  it('多光标：任一光标落在节点行区间即揭示', () => {
    // L1 与 L3 各一个光标，节点在 L2 → 都不碰，不揭示
    const away = EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(8)]);
    expect(selectionTouchesLineRange(doc, away, 4, 7)).toBe(false);

    // 第二个光标落在 L2 → 揭示（只看 selection.main 会漏掉这种）
    const touching = EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)]);
    expect(selectionTouchesLineRange(doc, touching, 4, 7)).toBe(true);

    // 反过来：主光标在 L1、次光标在 L2，也要揭示
    const touchingReverse = EditorSelection.create([
      EditorSelection.cursor(1),
      EditorSelection.cursor(9),
      EditorSelection.cursor(5),
    ]);
    expect(selectionTouchesLineRange(doc, touchingReverse, 4, 7)).toBe(true);
  });

  it('多行节点：任意一行上的光标都揭示', () => {
    // 节点 [0, 11) 覆盖 L1..L3（to === doc.length，safeTo 退回 10）
    expect(selectionTouchesLineRange(doc, cursor(0), 0, 11)).toBe(true);
    expect(selectionTouchesLineRange(doc, cursor(5), 0, 11)).toBe(true);
    expect(selectionTouchesLineRange(doc, cursor(10), 0, 11)).toBe(true);
  });

  it('节点到文档末尾（to === doc.length）不会越界', () => {
    expect(selectionTouchesLineRange(doc, cursor(10), 8, 11)).toBe(true);
    expect(selectionTouchesLineRange(doc, cursor(0), 8, 11)).toBe(false);
  });

  it('零长度节点（from === to）不崩', () => {
    expect(selectionTouchesLineRange(doc, cursor(4), 4, 4)).toBe(true);
    expect(selectionTouchesLineRange(doc, cursor(0), 4, 4)).toBe(false);
  });
});
