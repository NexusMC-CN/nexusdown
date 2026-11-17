// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import NexusdownEditor from '../../src/editor/Editor.vue'
import { renderEditorPreview, undo, redo } from '../../src/cm/index.js'
import { renderMarkdown } from '../../src/render/index.js'
import { editingRange } from '../../src/cm/plugin.js'

// Redirect the package boundary to the real source engine, with no fake CM behavior.
vi.mock('@nexusmc-cn/nexusdown/cm', () => import('../../src/cm/index.js'))
const nl = String.fromCharCode(10)
const cleanup: (() => void)[] = []
beforeAll(() => {
  // jsdom has no layout. The CM document, DOM, events and history stay real.
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose())
  document.body.replaceChildren()
})
async function editor(source: string, props: Record<string, unknown> = {}) {
  const wrapper = mount(NexusdownEditor, { props: { modelValue: source, ...props }, attachTo: document.body })
  cleanup.push(() => wrapper.unmount())
  await flushPromises()
  const view = (wrapper.vm as unknown as { view: EditorView }).view
  expect(view).not.toBeNull()
  return { wrapper, view }
}
const source = [
  '[TOC]', '', '# 安装 {#install}', '', '正文[^note]', '',
  '::: note 提示', '正文 **加粗**', ':::', '',
  '术语', ': 定义', '', '[^note]: 脚注说明',
].join(nl)

describe('NexusdownEditor document preview', () => {
  it('renders every new syntax with the publishing renderer and an explicit prefix', async () => {
    const { wrapper } = await editor(source, { idPrefix: 'preview-a', headingNumbers: true })
    await wrapper.get('[data-mode="preview"]').trigger('click')
    const preview = wrapper.get('.nd-editor__preview')
    const expected = document.createElement('div')
    expected.innerHTML = renderMarkdown(source, { idPrefix: 'preview-a', headingNumbers: true, data: {} })
    expect(preview.element.innerHTML).toBe(expected.innerHTML)
    expect(preview.find('.nd-toc a').attributes('href')).toBe('#preview-a-install')
    expect(preview.find('.nd-container--note strong').text()).toBe('加粗')
    expect(preview.find('dl dd').text()).toBe('定义')
    expect(preview.find('.footnote-item').attributes('id')).toBe('preview-a-fn1')
    expect(preview.find('.nd-heading-number').text()).toBe('1')
  })
  it('keeps the same view, selection, source edits, undo and redo across mode changes', async () => {
    const { wrapper, view } = await editor(source)
    const insert = nl + nl + '修改 **保存**'
    view.dispatch({ changes: { from: view.state.doc.length, insert }, selection: { anchor: 3 }, userEvent: 'input.type' })
    const selection = view.state.selection
    const changed = view.state.doc.toString()
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.get('.nd-editor__preview').text()).toContain('修改 保存')
    await wrapper.get('[data-mode="edit"]').trigger('click')
    expect((wrapper.vm as unknown as { view: EditorView }).view).toBe(view)
    expect(view.state.selection.eq(selection)).toBe(true)
    expect(view.state.doc.toString()).toBe(changed)
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(source)
    expect(redo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(changed)
    expect(wrapper.emitted('update:modelValue')).toEqual([[changed], [source], [changed]])
  })
  it('keeps all extension source reachable and retains changes made in the source', async () => {
    const { wrapper, view } = await editor(source)
    expect(view.state.doc.toString()).toBe(source)
    const from = source.indexOf('定义')
    view.dispatch({ selection: { anchor: from, head: from + 2 } })
    view.dispatch({ changes: { from, to: from + 2, insert: '新的定义' } })
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.get('.nd-editor__preview dl dd').text()).toBe('新的定义')
    await wrapper.get('[data-mode="edit"]').trigger('click')
    expect(view.state.doc.toString()).toContain(': 新的定义')
  })
  it('isolates generated heading, footnote and carousel anchors across real instances', async () => {
    const doc = [source, '', '![一](https://example.com/1.png)', '![二](https://example.com/2.png)'].join(nl)
    const first = await editor(doc)
    const second = await editor(doc)
    await first.wrapper.get('[data-mode="preview"]').trigger('click')
    await second.wrapper.get('[data-mode="preview"]').trigger('click')
    const a = first.wrapper.get('.nd-editor__preview')
    const b = second.wrapper.get('.nd-editor__preview')
    const idsA = a.findAll('[id]').map(node => node.attributes('id'))
    const idsB = new Set(b.findAll('[id]').map(node => node.attributes('id')))
    expect(idsA.length).toBeGreaterThan(4)
    expect(idsA.some(id => idsB.has(id))).toBe(false)
    for (const fragment of [a, b]) {
      const localIds = new Set(fragment.findAll('[id]').map(node => node.attributes('id')))
      for (const link of fragment.findAll('a[href^="#"]')) expect(localIds.has(link.attributes('href')!.slice(1))).toBe(true)
      expect(fragment.find('.nd-heading-number').exists()).toBe(false)
    }
  })
  it('renders supplied math, mentions and link data without calling resolveLinks', async () => {
    const mathRenderer = { renderToString: (tex: string) => '<span class="injected-math">' + tex + '</span>' }
    const mentions = new Map([['resource', { title: '已解析资源', href: '/resource', kind: 'resource' as const }]])
    const links = new Map([['https://example.com/post', { card: { title: '已有卡片数据' } }]])
    const resolveLinks = vi.fn()
    const { wrapper } = await editor('行内 $x$ 与 @resource' + nl + nl + 'https://example.com/post', { mathRenderer, mentions, renderData: { links }, resolveLinks })
    await wrapper.get('[data-mode="preview"]').trigger('click')
    const preview = wrapper.get('.nd-editor__preview')
    expect(preview.get('.injected-math').text()).toBe('x')
    expect(preview.text()).toContain('已解析资源')
    expect(preview.text()).toContain('已有卡片数据')
    expect(resolveLinks).not.toHaveBeenCalled()
  })
  it('refuses mode changes during IME and preserves the final real DOM commit', async () => {
    const { wrapper, view } = await editor('plain')
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const text = view.contentDOM.querySelector('.cm-line')!.firstChild as Text
    text.data = 'plainn'
    await Promise.resolve()
    expect(view.composing).toBe(true)
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.find('.nd-editor__preview').exists()).toBe(false)
    expect(wrapper.get('.nd-editor__editing').isVisible()).toBe(true)
    text.data = 'plain你'
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await flushPromises()
    expect(view.state.doc.toString()).toBe('plain你')
    await new Promise(resolve => setTimeout(resolve, 60))
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.get('.nd-editor__preview').text()).toBe('plain你')
  })
  it('keeps table alignments, Emoji and strikethrough editable with existing widgets', async () => {
    const doc = ['intro', '', '| 左 | 中 | 右 |', '| :--- | :---: | ---: |', '| :smile: | ~~删除~~ | 值 |', '', 'tail'].join(nl)
    const { wrapper, view } = await editor(doc)
    const table = wrapper.get('.nd-table table')
    expect(table.findAll('th').map(node => (node.element as HTMLElement).style.textAlign)).toEqual(['left', 'center', 'right'])
    wrapper.get('.nd-table td').element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(view.state.field(editingRange)).not.toBeNull()
    const pos = view.state.doc.toString().indexOf('删除')
    view.dispatch({ changes: { from: pos, to: pos + 2, insert: '改过' } })
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.get('.nd-editor__preview s').text()).toBe('改过')
    expect(wrapper.get('.nd-editor__preview').text()).toContain('😄')
    await wrapper.get('[data-mode="edit"]').trigger('click')
    expect(view.state.doc.toString()).toContain('~~改过~~')
    expect(view.state.doc.toString()).toContain(':smile:')
  })
  it('keeps ordinary editor images as source editing interactions', async () => {
    const { wrapper, view } = await editor('intro' + nl + nl + '![图](https://example.com/a.png)' + nl + nl + 'tail')
    wrapper.get('.cm-editor img').element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(view.state.doc.toString()).toContain('![图]')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.find('.cm-editor img').exists()).toBe(true)
    // jsdom has no click coordinates; reveal image source with a real CM selection.
    const alt = view.state.doc.toString().indexOf('图')
    view.dispatch({ selection: { anchor: alt, head: alt + 1 } })
    expect(view.contentDOM.textContent).toContain('![图]')
    view.dispatch({ changes: { from: alt, to: alt + 1, insert: '修改图' } })
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.find('.nd-editor__preview img').exists()).toBe(true)
    expect(wrapper.get('.nd-editor__preview img').attributes('alt')).toBe('修改图')
  })
  it('replaces external source while previewing and still edits the current document', async () => {
    const { wrapper, view } = await editor('# 原文')
    await wrapper.get('[data-mode="preview"]').trigger('click')
    await wrapper.setProps({ modelValue: '# 新稿' } as never)
    expect(wrapper.get('.nd-editor__preview h1').text()).toBe('新稿')
    await wrapper.get('[data-mode="edit"]').trigger('click')
    expect(view.state.doc.toString()).toBe('# 新稿')
  })
  it('exposes a synchronous helper with the same rendering contract', () => {
    expect(renderEditorPreview(source, { idPrefix: 'helper', headingNumbers: true }))
      .toBe(renderMarkdown(source, { idPrefix: 'helper', headingNumbers: true }))
  })
})
