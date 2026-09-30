import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { describe, expect, it } from 'vitest';

import { children, firstChildNamed, lastChildNamed } from '../../src/cm/util/tree';

function tree(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, addKeymap: false })],
  });
  return syntaxTree(state);
}

/** 在真实语法树里按名字找一个节点（返回稳定的 SyntaxNode）。 */
function find(doc: string, name: string): SyntaxNode {
  let found: SyntaxNode | null = null;
  tree(doc).iterate({
    enter: (node) => {
      if (!found && node.name === name) found = node.node;
    },
  });
  if (!found) throw new Error(`没找到节点 ${name}`);
  return found;
}

describe('util/tree', () => {
  it('children() 直接子节点按文档顺序返回', () => {
    const heading = find('# 标题\n', 'ATXHeading1');
    expect(children(heading).map((c) => c.name)).toEqual(['HeaderMark']);
  });

  it('★ children() 也能吃 tree.iterate 给的 SyntaxNodeRef', () => {
    let refFirstChildIsMethod = false;
    let stableFirstChild = '';
    let childNames: string[] = [];
    let childRanges: Array<[number, number]> = [];

    tree('# 标题\n').iterate({
      enter: (node) => {
        if (node.name !== 'ATXHeading1' || childNames.length > 0) return;

        // ⚠️ 这就是坑：`enter` 给的是 TreeCursor，它的 `firstChild` 是个**移动游标的方法**
        //    （返回 boolean），不是子节点属性。直接 `node.firstChild` 不但拿不到节点，
        //    还会把游标挪走、把整棵树遍历搞乱。
        refFirstChildIsMethod =
          typeof (node as unknown as { firstChild: unknown }).firstChild === 'function';
        // 稳定的 SyntaxNode 上 `firstChild` 才是真正的子节点
        stableFirstChild = node.node.firstChild?.name ?? '';

        // 必须在回调**内部**就用掉（见下一个用例）
        childNames = children(node).map((c) => c.name);
        childRanges = children(node).map((c) => [c.from, c.to]);
      },
    });

    expect(refFirstChildIsMethod).toBe(true);
    expect(stableFirstChild).toBe('HeaderMark');
    expect(childNames).toEqual(['HeaderMark']);
    expect(childRanges).toEqual([[0, 1]]);
  });

  it('⚠️ enter 给的 ref 是活游标：出了回调就不能再拿来取子节点', () => {
    let held: SyntaxNodeRef | null = null;
    let nameAtEnter = '';

    tree('# 标题\n').iterate({
      enter: (node) => {
        if (nameAtEnter || node.name !== 'ATXHeading1') return;
        nameAtEnter = node.name;
        held = node; // ❌ 把 ref 存下来
      },
    });

    expect(nameAtEnter).toBe('ATXHeading1');
    // 遍历结束后游标已经回到根节点 —— 所以 plugin.ts 必须在回调内立刻 `ref.node`，
    // 而不是把 ref 传出去。
    expect(held!.node.name).not.toBe(nameAtEnter);
  });

  it('children() 对没有子节点的节点返回空数组', () => {
    const hr = find('---\n', 'HorizontalRule');
    expect(children(hr)).toEqual([]);
  });

  it('firstChildNamed() 只认直接子节点', () => {
    const heading = find('# 标题\n', 'ATXHeading1');
    expect(firstChildNamed(heading, 'HeaderMark')?.name).toBe('HeaderMark');
    expect(firstChildNamed(heading, 'Paragraph')).toBeNull();
    expect(firstChildNamed(heading, '不存在的节点')).toBeNull();
  });

  it('lastChildNamed() 拿得到围栏代码块的闭合 CodeMark', () => {
    const fence = find('```js\ncode\n```\n', 'FencedCode');
    const first = firstChildNamed(fence, 'CodeMark');
    const last = lastChildNamed(fence, 'CodeMark');

    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    expect(first?.from).toBe(0);
    // "```js\ncode\n```\n" → 闭合围栏从 11 开始
    expect(last?.from).toBe(11);
    // 开 / 闭是两个不同的节点
    expect(first?.from).not.toBe(last?.from);
  });

  it('lastChildNamed() 找不到时返回 null', () => {
    const heading = find('# 标题\n', 'ATXHeading1');
    expect(lastChildNamed(heading, 'CodeMark')).toBeNull();
  });
});
