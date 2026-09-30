import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { decorateBlockquote } from '../../src/cm/decorate/blockquote';
import { decorateHeading } from '../../src/cm/decorate/heading';
import { decorateInline } from '../../src/cm/decorate/inline';
import { HIDE, MARK_CLASS } from '../../src/cm/decorate/shared';
import { foldedBlocks, toggleFold } from '../../src/cm/fold';
import { nexusdownLivePreview, type LivePreviewPluginValue } from '../../src/cm/plugin';
import type {
  DecorateFn,
  DecorationRanges,
  LinkDecorateFn,
  LivePreviewDecorators,
  MarkdownNode,
} from '../../src/cm/types';

interface Call {
  kind: string;
  name: string;
  from: number;
  to: number;
}

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = '';
});

function mount(
  doc: string,
  decorators: Partial<LivePreviewDecorators> = {},
  extra: Extension[] = [],
) {
  const plugin = nexusdownLivePreview({ decorators });
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, addKeymap: false }), plugin, ...extra],
  });
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  views.push(view);

  const instance = view.plugin(plugin as unknown as ViewPlugin<LivePreviewPluginValue>);
  if (!instance) throw new Error('插件没有挂上');
  return { view, instance };
}

/** 记录「谁被分发到、分发了哪个节点」的包装器。 */
function spy(kind: string, calls: Call[], fn: DecorateFn): DecorateFn {
  return (ranges, atomicRanges, node, doc, selection) => {
    calls.push({ kind, name: node.name, from: node.from, to: node.to });
    fn(ranges, atomicRanges, node, doc, selection);
  };
}

function spyLink(kind: string, calls: Call[], fn: LinkDecorateFn): LinkDecorateFn {
  return (ranges, atomicRanges, node, doc, selection, references, urlPolicy) => {
    calls.push({ kind, name: node.name, from: node.from, to: node.to });
    fn(ranges, atomicRanges, node, doc, selection, references, urlPolicy);
  };
}

/** 只记录、推一个 mark 的占位装饰器（list / fence / block 用）。 */
function fakeDecorate(kind: string, calls: Call[]): DecorateFn {
  return (ranges: DecorationRanges, _atomicRanges: DecorationRanges, node: MarkdownNode) => {
    calls.push({ kind, name: node.name, from: node.from, to: node.to });
    ranges.push(Decoration.mark({ class: 'nd-test-' + kind }).range(node.from, node.to));
  };
}

const fakeLink = (): LinkDecorateFn => () => {};

function fakeUpdate(view: EditorView, over: Record<string, unknown> = {}): ViewUpdate {
  return {
    view,
    startState: view.state,
    state: view.state,
    docChanged: false,
    viewportChanged: false,
    selectionSet: false,
    ...over,
  } as unknown as ViewUpdate;
}

/** 只覆盖 `composing` 的 view 代理，用来模拟 IME 组合开始 / 结束。 */
function withComposing(view: EditorView, composing: boolean): EditorView {
  return Object.create(view, { composing: { value: composing, configurable: true } }) as EditorView;
}

/** 取当前所有 atomicRanges provider 里最大的那个结果（本测试里只有我们一家）。 */
function providedAtomicRanges(view: EditorView): number {
  const providers = view.state.facet(EditorView.atomicRanges);
  let max = 0;
  for (const provider of providers) max = Math.max(max, provider(view).size);
  return max;
}

describe('nexusdownLivePreview', () => {
  it('能构造：插件实例上有 decorations / atomicDecorations 两个 DecorationSet', () => {
    const { instance } = mount('# 标题\n');

    expect(instance.decorations).toBeDefined();
    expect(instance.atomicDecorations).toBeDefined();
    expect(typeof instance.decorations.size).toBe('number');
  });

  it('能 build：装饰数量正确（标题行 + `# ` + 样式 mark + 两个 `**`）', () => {
    // "# 这是 **粗体** 标题"
    //   ATXHeading1[0,14] / HeaderMark[0,1] / StrongEmphasis[5,11]
    //   EmphasisMark[5,7] / EmphasisMark[9,11]
    const { view, instance } = mount('# 这是 **粗体** 标题\n\n正文', {
      heading: decorateHeading,
      inline: decorateInline,
    });

    // 光标在标题行 → 全部揭示态：1 line + 1 样式 mark + 3 MUTED_MARK
    expect(instance.decorations.size).toBe(5);
    expect(instance.atomicDecorations.size).toBe(0);

    // 光标挪到最后一行 → `# ` 和两个 `**` 变成 HIDE：装饰总量不变，atomic 变成 3
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(instance.decorations.size).toBe(5);
    expect(instance.atomicDecorations.size).toBe(3);
  });

  it('★ provide 给的是独立的 atomicDecorations，不是 decorations', () => {
    const { view, instance } = mount('# 这是 **粗体** 标题\n\n正文', {
      heading: decorateHeading,
      inline: decorateInline,
    });

    // 光标挪到最后一行 → 非揭示态
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    expect(instance.decorations.size).toBe(5);
    expect(instance.atomicDecorations.size).toBe(3);

    // 如果 provide 误把 decorations 当 atomicRanges，这里会是 5
    expect(providedAtomicRanges(view)).toBe(3);
    expect(providedAtomicRanges(view)).not.toBe(instance.decorations.size);
  });

  it('光标在别的行 → 标记被隐藏；光标回到标题行 → atomicRanges 清空', () => {
    const { view, instance } = mount('# 这是 **粗体** 标题\n\n正文', {
      heading: decorateHeading,
      inline: decorateInline,
    });

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(instance.atomicDecorations.size).toBe(3);
    expect(providedAtomicRanges(view)).toBe(3);

    // 揭示态里一个 `.nd-mark` 都不该出现在 atomicRanges 里
    let muted = 0;
    instance.atomicDecorations.between(0, view.state.doc.length, (_f, _t, value) => {
      if (value.spec.class === MARK_CLASS) muted++;
    });
    expect(muted).toBe(0);

    view.dispatch({ selection: { anchor: 3 } });
    expect(instance.atomicDecorations.size).toBe(0);
    expect(providedAtomicRanges(view)).toBe(0);
    // 装饰总量不变，只是 HIDE 换成了 MUTED_MARK
    expect(instance.decorations.size).toBe(5);
  });

  it('★ 坑 ② 的解法：heading 继续下降，标题里的 StrongEmphasis 被 inline 处理', () => {
    const calls: Call[] = [];
    mount('# 这是 **粗体** 标题\n', {
      heading: spy('heading', calls, decorateHeading),
      inline: spy('inline', calls, decorateInline),
    });

    const headingCalls = calls.filter((c) => c.kind === 'heading');
    const inlineCalls = calls.filter((c) => c.kind === 'inline');

    // heading 只被调用一次（同一节点不会处理两遍）
    expect(headingCalls.map((c) => c.name)).toEqual(['ATXHeading1']);
    // ★ 关键：标题里的嵌套行内标记被处理了
    expect(inlineCalls.map((c) => c.name)).toEqual(['StrongEmphasis']);
    expect(inlineCalls[0]).toMatchObject({ from: 5, to: 11 });
  });

  it('★ 坑 ② 的解法：HeaderMark 不会被 inline 逻辑重复处理', () => {
    const calls: Call[] = [];
    const { view, instance } = mount('# 这是 **粗体** 标题\n\n正文', {
      heading: spy('heading', calls, decorateHeading),
      inline: spy('inline', calls, decorateInline),
    });

    // inline 只认 INLINE_NODES（样式节点），永远看不到 HeaderMark / EmphasisMark
    const inlineNames = calls.filter((c) => c.kind === 'inline').map((c) => c.name);
    expect(inlineNames).not.toContain('HeaderMark');
    expect(inlineNames).not.toContain('EmphasisMark');

    // 光标挪到最后一行 → 非揭示态，`# ` 才会以 HIDE 的形式进 atomicRanges
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    // 而且 `# ` 只被隐藏了**一次**（区间 [0,2)）
    const hidden: Array<[number, number]> = [];
    instance.atomicDecorations.between(0, 3, (from, to, value) => {
      if (value === HIDE) hidden.push([from, to]);
    });
    expect(hidden).toEqual([[0, 2]]);
  });

  it('★ Link 是 return false：链接里的行内标记不再被处理', () => {
    const calls: Call[] = [];
    mount('[**粗**](https://example.com)\n', {
      link: spyLink('link', calls, fakeLink()),
      inline: spy('inline', calls, decorateInline),
    });

    expect(calls.filter((c) => c.kind === 'link').map((c) => c.name)).toEqual(['Link']);
    // Link 下面确实有 StrongEmphasis（[**粗**](url) → Link > StrongEmphasis），
    // 但 return false 让它不再被遍历到。
    expect(calls.filter((c) => c.kind === 'inline')).toHaveLength(0);
  });

  it('★ 行内嵌套：`***粗斜体***` 两层都被分发（INLINE_NODES 不 return false）', () => {
    // 真实语法树：Paragraph > Emphasis[0,9] > EmphasisMark[0,1] + StrongEmphasis[1,8]
    //                                                  + EmphasisMark[1,3] + EmphasisMark[6,8]
    //                                                  + EmphasisMark[8,9]
    const calls: Call[] = [];
    const { view, instance } = mount('***粗斜体***\n\n正文', {
      inline: spy('inline', calls, decorateInline),
    });

    expect(calls.filter((c) => c.kind === 'inline').map((c) => c.name)).toEqual([
      'Emphasis',
      'StrongEmphasis',
    ]);

    // 光标在标题行 → 揭示态：2 个样式 mark + 4 个 MUTED_MARK
    expect(instance.decorations.size).toBe(6);
    expect(instance.atomicDecorations.size).toBe(0);

    // 光标挪到最后一行 → 4 个定界符变 HIDE
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(instance.decorations.size).toBe(6);
    expect(instance.atomicDecorations.size).toBe(4);
  });

  it('Blockquote 不 return false：引用块里的行内标记被处理', () => {
    const calls: Call[] = [];
    mount('> **粗**\n> 二行\n', {
      blockquote: spy('blockquote', calls, decorateBlockquote),
      inline: spy('inline', calls, decorateInline),
    });

    expect(calls.filter((c) => c.kind === 'blockquote').map((c) => c.name)).toEqual(['Blockquote']);
    expect(calls.filter((c) => c.kind === 'inline').map((c) => c.name)).toEqual(['StrongEmphasis']);
  });

  it('ListItem 不 return false：列表项里的行内标记被处理', () => {
    const calls: Call[] = [];
    mount('- **粗**\n- b\n', {
      listItem: fakeDecorate('listItem', calls),
      inline: spy('inline', calls, decorateInline),
    });

    expect(calls.filter((c) => c.kind === 'listItem')).toHaveLength(2);
    expect(calls.filter((c) => c.kind === 'inline').map((c) => c.name)).toEqual(['StrongEmphasis']);
  });

  it('FencedCode 会被分发（不 return false，留给 lezer overlay）', () => {
    const calls: Call[] = [];
    const { instance } = mount('```js\nconst a = 1;\n```\n\n尾段\n', {
      fencedCode: fakeDecorate('fencedCode', calls),
    });

    expect(calls.filter((c) => c.kind === 'fencedCode').map((c) => c.name)).toEqual(['FencedCode']);
    expect(instance.decorations.size).toBeGreaterThan(0);
  });

  it('★ 折叠状态变化会触发装饰重建（dispatch effect 时 docChanged 等全是 false）', () => {
    /*
     * 这条守着用户实际报的问题：点了折叠按钮**毫无反应**，而且**零报错**。
     *
     * 根因：`toggleFold` 是**纯视图状态**（不碰文档），所以 dispatch 它时
     * `docChanged` / `selectionSet` / `viewportChanged` **全是 false** ——
     * `plugin.ts` 的 `update()` 里没有"折叠变了"这个条件，装饰就不重算。
     * effect 生效了、`foldedBlocks` 也更新了，界面就是纹丝不动。
     */
    const calls: Call[] = []
    const { view, instance } = mount(
      '```js\nconst a = 1;\n```\n\n尾段\n',
      { fencedCode: fakeDecorate('fencedCode', calls) },
      [foldedBlocks],
    );

    const callsBefore = calls.length;
    const decoBefore = instance.decorations;

    // 纯视图事务：只带 effect，不碰文档、不动选区
    view.dispatch({ effects: toggleFold.of(0) });

    expect(calls.length).toBeGreaterThan(callsBefore);
    expect(instance.decorations).not.toBe(decoBefore);
  });

  it('Image / HorizontalRule 交给 block 装饰器，且不再下降', () => {
    const calls: Call[] = [];
    mount('---\n\n![alt](x.png)\n', {
      block: fakeDecorate('block', calls),
      inline: spy('inline', calls, decorateInline),
    });

    expect(calls.filter((c) => c.kind === 'block').map((c) => c.name)).toEqual([
      'HorizontalRule',
      'Image',
    ]);
    expect(calls.filter((c) => c.kind === 'inline')).toHaveLength(0);
  });

  it('★ IME 门控有边沿检测：组合期间不重建，组合结束的边沿强制重建一次', () => {
    const calls: Call[] = [];
    const { view, instance } = mount('# 标题 **粗**\n', {
      heading: spy('heading', calls, decorateHeading),
      inline: spy('inline', calls, decorateInline),
    });

    const afterMount = calls.length;
    expect(afterMount).toBeGreaterThan(0);

    // ① 组合期间：绝不能重建（IME 依赖稳定的 DOM，重建会丢字）
    instance.update(fakeUpdate(withComposing(view, true)));
    expect(calls.length).toBe(afterMount);

    // ② 组合结束的**边沿**：即使 docChanged / viewportChanged / selectionSet 全是 false，
    //    也必须重建一次 —— 这正是 silkdown 缺的那条分支。
    instance.update(fakeUpdate(view));
    expect(calls.length).toBeGreaterThan(afterMount);

    // ③ 边沿已经消费掉：再来的空更新不该重建
    const afterEdge = calls.length;
    instance.update(fakeUpdate(view));
    expect(calls.length).toBe(afterEdge);

    // ④ 但真正的内容变化仍然触发重建
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(calls.length).toBeGreaterThan(afterEdge);
  });

  it('只有可见区被遍历：短文档就是整篇，装饰数量对得上', () => {
    const calls: Call[] = [];
    const { view, instance } = mount('# 标题\n', {
      heading: spy('heading', calls, decorateHeading),
    });

    expect(calls).toHaveLength(1);
    expect(view.visibleRanges.length).toBeGreaterThan(0);
    expect(instance.decorations.size).toBe(2); // line + HIDE `# `
  });
});
