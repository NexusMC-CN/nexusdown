/**
 * 两个 widget 的单元测试（ImageWidget / TaskCheckboxWidget），
 * 外加 `markdownKeymap` 的切换逻辑。
 *
 * widget 的 `eq()` 和 `ignoreEvent()` 是**纯函数**，可以直接断言；
 * `toDOM()` 里绑的 `change` 处理器需要一个真 `EditorView` 才 dispatch 得出去，
 * 所以这里用 jsdom 真挂一个编辑器（和 `plugin.test.ts` 同一套做法）。
 *
 * ⚠️ `ignoreEvent` 的方向是**反直觉**的：返回 `false` = 放行给 widget 自己处理，
 * 返回 `true` = 交给 CM。复选框必须放行 `mousedown` / `click`，反着写就点不动。
 */
import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';

import { markdownKeymap } from '../../src/cm/shortcuts';
import { ImageWidget } from '../../src/cm/widgets/image';
import { TaskCheckboxWidget } from '../../src/cm/widgets/task';

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = '';
});

/** 挂一个真编辑器。扩展顺序和 `nexusdown()` 的装配保持一致。 */
function mount(doc: string, selection?: EditorSelection, extra: Extension[] = []): EditorView {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      markdown({ base: markdownLanguage, addKeymap: false }),
      // ★ 没有这个 facet，`EditorState.create` 会把多光标选区**折叠成单选**
      //   （state 源码里就是 `selection = selection.asSingle()`），
      //   多光标用例会静默地只跑第一个光标。
      EditorState.allowMultipleSelections.of(true),
      markdownKeymap,
      ...extra,
    ],
  });
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  views.push(view);
  return view;
}

/** 从 keymap facet 里取出绑定并直接执行 —— 不依赖 jsdom 的键盘事件模拟。 */
function runKey(view: EditorView, key: string): boolean {
  const bindings: readonly KeyBinding[] = view.state.facet(keymap).flat();
  const binding = bindings.find((b) => b.key === key);
  if (!binding?.run) throw new Error(`keymap 里没有 ${key} 的绑定`);
  return binding.run(view);
}

describe('ImageWidget', () => {
  it('eq()：src 和 alt 都相同才算相等', () => {
    const a = new ImageWidget('https://example.com/a.png', '图');

    expect(a.eq(new ImageWidget('https://example.com/a.png', '图'))).toBe(true);
    expect(a.eq(new ImageWidget('https://example.com/b.png', '图'))).toBe(false);
    expect(a.eq(new ImageWidget('https://example.com/a.png', '别的'))).toBe(false);
  });

  it('toDOM()：<img> + class + 懒加载 + 异步解码', () => {
    const el = new ImageWidget('https://example.com/a.png', '图').toDOM() as HTMLImageElement;

    expect(el.tagName).toBe('IMG');
    expect(el.className).toBe('nd-image-widget');
    expect(el.getAttribute('src')).toBe('https://example.com/a.png');
    expect(el.getAttribute('alt')).toBe('图');
    // ★ 这两条是「几十张图时滚动会不会卡」的关键。
    expect(el.loading).toBe('lazy');
    expect(el.decoding).toBe('async');
  });

  it('ignoreEvent()：一律返回 false，点击交给 CM 做光标定位', () => {
    const widget = new ImageWidget('a.png', '图');

    expect(widget.ignoreEvent(new MouseEvent('mousedown'))).toBe(false);
    expect(widget.ignoreEvent(new MouseEvent('click'))).toBe(false);
    expect(widget.ignoreEvent(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
  });
});

describe('TaskCheckboxWidget', () => {
  /** doc 固定为 `- [ ] 待办`，`[ ]` 落在 [2,5)。 */
  function checkbox(doc: string, checked: boolean) {
    const view = mount(doc);
    const widget = new TaskCheckboxWidget(checked, 2, 5);
    return { view, widget, input: widget.toDOM(view) as HTMLInputElement };
  }

  it('eq()：checked / from / to 三者全等才算相等', () => {
    const a = new TaskCheckboxWidget(false, 2, 5);

    expect(a.eq(new TaskCheckboxWidget(false, 2, 5))).toBe(true);
    // 勾选状态变了 → 必须重建 DOM（否则界面不会跟着变）
    expect(a.eq(new TaskCheckboxWidget(true, 2, 5))).toBe(false);
    // 坐标变了 → 必须重建（否则 change 会写到错的区间上）
    expect(a.eq(new TaskCheckboxWidget(false, 3, 5))).toBe(false);
    expect(a.eq(new TaskCheckboxWidget(false, 2, 6))).toBe(false);
  });

  it('toDOM()：<input type="checkbox">，checked 跟着构造参数走', () => {
    const off = checkbox('- [ ] 待办', false);
    expect(off.input.tagName).toBe('INPUT');
    expect(off.input.type).toBe('checkbox');
    expect(off.input.className).toBe('nd-task-checkbox');
    expect(off.input.checked).toBe(false);

    const on = checkbox('- [x] 待办', true);
    expect(on.input.checked).toBe(true);
  });

  it('★ ignoreEvent()：放行 mousedown / click，其余交给 CM', () => {
    const { widget } = checkbox('- [ ] 待办', false);

    // 白名单：这两个必须放行，否则复选框点不动
    expect(widget.ignoreEvent(new MouseEvent('mousedown'))).toBe(false);
    expect(widget.ignoreEvent(new MouseEvent('click'))).toBe(false);
    // 其余一律 CM 接管
    expect(widget.ignoreEvent(new KeyboardEvent('keydown', { key: 'a' }))).toBe(true);
    expect(widget.ignoreEvent(new Event('input'))).toBe(true);
  });

  it('★ mousedown 上 preventDefault —— 不让 input 抢焦点、不让 CM 挪光标', () => {
    const { input } = checkbox('- [ ] 待办', false);

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  /*
   * ⚠️ 这里**不能**用 `input.click()` 模拟：jsdom 没实现复选框的激活行为 ——
   * `click()` 既不会翻转 `checked`，也不会派发 `change`（实测），
   * 那样测的是 jsdom 而不是我们的代码。所以显式走浏览器的那两步。
   */
  it('★ 勾选 → dispatch 出的 change 把 `[ ]` 换成 `[x]`', () => {
    const { view, input } = checkbox('- [ ] 待办', false);
    expect(view.state.doc.toString()).toBe('- [ ] 待办');

    // 浏览器会先翻转 checked，再派发 change
    input.checked = true;
    input.dispatchEvent(new Event('change'));

    expect(view.state.doc.toString()).toBe('- [x] 待办');
  });

  it('★ 取消勾选 → `[x]` 换回 `[ ]`', () => {
    const { view, input } = checkbox('- [x] 待办', true);

    input.checked = false;
    input.dispatchEvent(new Event('change'));

    expect(view.state.doc.toString()).toBe('- [ ] 待办');
  });
});

describe('markdownKeymap —— 粗体 / 斜体 / 行内代码', () => {
  it('无选中：扩展到光标所在的词', () => {
    const view = mount('hello world', EditorSelection.single(2));

    expect(runKey(view, 'Mod-b')).toBe(true);

    expect(view.state.doc.toString()).toBe('**hello** world');
    // 包完之后词仍然选中，接着可以继续操作
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(7);
  });

  it('有选中：直接包裹，选区跟着右移', () => {
    const view = mount('hello', EditorSelection.single(1, 4));

    expect(runKey(view, 'Mod-i')).toBe(true);

    expect(view.state.doc.toString()).toBe('h*ell*o');
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(5);
  });

  it('空白处：插入成对定界符，光标停在正中间', () => {
    // `ab  cd` 里位置 3 左右都是空格 → `wordAt` 返回 null，走「空白处」分支。
    const view = mount('ab  cd', EditorSelection.single(3));

    expect(runKey(view, 'Mod-b')).toBe(true);

    expect(view.state.doc.toString()).toBe('ab **** cd');
    expect(view.state.selection.main.head).toBe(5);
    expect(view.state.selection.main.empty).toBe(true);
  });

  it('★ 已在节点内（光标）：解包，不是再包一层', () => {
    const view = mount('**bold**', EditorSelection.single(3));

    expect(runKey(view, 'Mod-b')).toBe(true);

    expect(view.state.doc.toString()).toBe('bold');
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(4);
  });

  it('★ 已在节点内（选中内容）：解包', () => {
    const view = mount('**bold**', EditorSelection.single(2, 6));

    expect(runKey(view, 'Mod-b')).toBe(true);

    expect(view.state.doc.toString()).toBe('bold');
  });

  it('★ 解包删的是节点自己的定界符子节点：`***x***` 解掉外层 `*` 后 `**` 完整', () => {
    const em = mount('***x***', EditorSelection.single(3));
    expect(runKey(em, 'Mod-i')).toBe(true);
    // 删掉 EmphasisMark[0,1) 和 [6,7) → 剩下的 `**x**` 一点没少
    expect(em.state.doc.toString()).toBe('**x**');

    const strong = mount('***x***', EditorSelection.single(3));
    expect(runKey(strong, 'Mod-b')).toBe(true);
    // 删掉 EmphasisMark[1,3) 和 [4,6) → 剩下的 `*x*`
    expect(strong.state.doc.toString()).toBe('*x*');
  });

  it('★ 节点在光标之前（不覆盖光标）时不误判为「已在节点内」', () => {
    const view = mount('**a** bc', EditorSelection.single(8));

    expect(runKey(view, 'Mod-b')).toBe(true);

    expect(view.state.doc.toString()).toBe('**a** **bc**');
  });

  it('行内代码用反引号', () => {
    const view = mount('foo bar', EditorSelection.single(1));

    expect(runKey(view, 'Mod-`')).toBe(true);

    expect(view.state.doc.toString()).toBe('`foo` bar');
  });

  it('★ 多光标：每个选区各算各的，后面的选区坐标会自动前移', () => {
    const view = mount(
      'aa bb',
      EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)]),
    );

    expect(runKey(view, 'Mod-b')).toBe(true);

    expect(view.state.doc.toString()).toBe('**aa** **bb**');
    const ranges = view.state.selection.ranges;
    expect(ranges.map((r) => [r.from, r.to])).toEqual([
      [2, 4],
      [9, 11],
    ]);
  });

  it('★ 撤销粒度：`format.nexusdown` 和 `input.type` 是两个独立的 undo step', () => {
    const view = mount('hello', EditorSelection.single(5), [history()]);

    view.dispatch({ changes: { from: 5, insert: '!' }, userEvent: 'input.type' });
    expect(view.state.doc.toString()).toBe('hello!');

    expect(runKey(view, 'Mod-b')).toBe(true);
    // 光标在 5（`o` 和 `!` 之间）→ 词边界只吃 `hello`，`!` 留在外面
    expect(view.state.doc.toString()).toBe('**hello**!');

    // 第一次撤销只回退「加粗」，不会把打的字一起撤掉
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('hello!');

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('hello');
  });

  it('Enter 在列表里继续列表标记（addKeymap: false 之后这条只能由我们提供）', () => {
    const view = mount('- a', EditorSelection.single(3));

    expect(runKey(view, 'Enter')).toBe(true);

    expect(view.state.doc.toString()).toBe('- a\n- ');
  });

  it('Enter 在普通段落里不接管（交给默认行为）', () => {
    const view = mount('plain', EditorSelection.single(5));

    expect(runKey(view, 'Enter')).toBe(false);
  });
});
