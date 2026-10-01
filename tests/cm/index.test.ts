/**
 * `nexusdown()` 装配层的测试。
 *
 * 这一组断言的是「开箱即用的编辑器基础」是否真的进了扩展数组 —— 撤销栈、
 * 光标绘制、当前行高亮、基础语法着色。这些扩展**不会**报错缺失，
 * 少了只会表现成「光标看不见」「撤销没反应」这种静默故障，所以必须显式测。
 *
 * 探测手法各选各的：
 * - `history`：`state.field(historyField, false)`（CM6 的 StateField，在就是有）；
 * - `drawSelection`：它没有导出的 facet 可查（`getDrawSelectionConfig` 永远返回
 *   默认值），所以挂一个真 EditorView，断言光标层 `.cm-cursorLayer` 进了 DOM ——
 *   这比查内部标记更接近「光标到底可不可见」这个真实诉求；
 * - `syntaxHighlighting`：`highlightingFor(state, [tags.keyword])` 有没有返回 class。
 *
 * 每个断言都配了**反向对照**（不加该扩展时探测结果为否定），否则「探针永远为真」
 * 会让测试变成摆设。
 */
import { historyField, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, highlightingFor, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { afterEach, describe, expect, it } from 'vitest';

import { nexusdown } from '../../src/cm/index';

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = '';
});

function stateOf(extensions: Extension = nexusdown(), doc = '# 标题'): EditorState {
  return EditorState.create({ doc, extensions: [extensions] });
}

function mount(extensions: Extension = nexusdown(), doc = '# 标题'): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({ state: stateOf(extensions, doc), parent });
  views.push(view);
  return view;
}

/** 只解析 Markdown、不含任何基础设施 —— 用作反向对照。 */
const bareMarkdown = markdown({ base: markdownLanguage, addKeymap: false });

describe('nexusdown() 必需基础设施', () => {
  describe('history（撤销栈）', () => {
    it('状态里有 historyField', () => {
      expect(stateOf().field(historyField, false)).toBeDefined();
    });

    it('反向对照：没有 history() 时 historyField 不存在', () => {
      expect(stateOf(bareMarkdown).field(historyField, false)).toBeUndefined();
    });

    it('history 真的能回滚一次输入', () => {
      const view = mount(nexusdown(), '');
      view.dispatch({ changes: { from: 0, insert: 'hello' }, userEvent: 'input.type' });
      expect(view.state.doc.toString()).toBe('hello');

      // 直接跑 `undo` 命令（`Mod-z` 绑的就是它）。
      // ⚠️ 不走合成 KeyboardEvent：jsdom 里 `navigator.platform` 是空串，
      //    CM6 的 `currentPlatform` 退化成 `"key"`，`Mod-*` 绑定根本匹配不上，
      //    按键模拟会假阴性。
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe('');
    });

    it('historyKeymap 排在 markdownKeymap 之前', () => {
      // `state.facet(keymap)` 返回按优先级铺平的 keymap 列表。
      const maps = stateOf().facet(keymap);
      const historyIdx = maps.findIndex((m) => m.some((b) => b.key === 'Mod-z'));
      const markdownIdx = maps.findIndex((m) => m.some((b) => b.key === 'Mod-b'));

      expect(historyIdx).toBeGreaterThanOrEqual(0);
      expect(markdownIdx).toBeGreaterThanOrEqual(0);
      expect(historyIdx).toBeLessThan(markdownIdx);
    });
  });

  describe('allowMultipleSelections（多光标）', () => {
    /*
     * ★ 这条守的是**命令的「多光标安全」前提**。
     *
     * 所有命令都走 `state.changeByRange()` —— 而它**只在开了这个 facet 时**
     * 才遍历所有选区。少了它，多光标下只有主选区生效，而且**零报错**
     * （`commands.test.ts` 里为此专门钉了一条断言）。
     *
     * 所以这个 facet 不是"可选优化"，是命令正确性的一部分。
     */
    it('nexusdown() 开了 allowMultipleSelections', () => {
      const view = new EditorView({
        state: EditorState.create({ doc: 'x', extensions: [nexusdown()] }),
      })
      expect(view.state.facet(EditorState.allowMultipleSelections)).toBe(true)
      view.destroy()
    })
  })

  describe('drawSelection（光标可见）', () => {
    it('挂载后存在光标层 .cm-cursorLayer', () => {
      const view = mount();
      expect(view.dom.querySelector('.cm-cursorLayer')).not.toBeNull();
    });

    it('反向对照：没有 drawSelection() 时没有光标层', () => {
      const view = mount(bareMarkdown);
      expect(view.dom.querySelector('.cm-cursorLayer')).toBeNull();
    });
  });

  describe('syntaxHighlighting（基础语法着色）', () => {
    it('keyword 这类基础 token 拿得到样式 class', () => {
      expect(highlightingFor(stateOf(), [tags.keyword])).toBeTruthy();
    });

    it('反向对照：没有 syntaxHighlighting 时拿不到 class', () => {
      expect(highlightingFor(stateOf(bareMarkdown), [tags.keyword])).toBeNull();
    });

    it('是 fallback 高亮器（不抢别的高亮器）', () => {
      const withOwn = EditorState.create({
        doc: '# 标题',
        extensions: [
          bareMarkdown,
          // 消费方自己加的高亮器应当赢过 fallback。
          syntaxHighlighting(defaultHighlightStyle),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ],
      });
      expect(highlightingFor(withOwn, [tags.keyword])).toBeTruthy();
    });
  });
});
