import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type DefineComponent } from 'vue'
import { EditorState, StateEffect } from '@codemirror/state'
import Toolbar from '../../src/editor/Toolbar.vue'
import { mountEditor, toggleBold, type EditorView } from '../../src/cm/index.js'
import type { NexusdownToolbarProps } from '../../src/editor/index.js'

vi.mock('@nexusmc-cn/nexusdown/cm', () => import('../../src/cm/index.js'))

// jsdom has no text geometry; focus assertions do not depend on layout.
const oldRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const oldBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterAll(() => {
  if (oldRects) Object.defineProperty(Range.prototype, 'getClientRects', oldRects)
  else Reflect.deleteProperty(Range.prototype, 'getClientRects')
  if (oldBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', oldBounds)
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
})

const dispose: (() => void)[] = []
afterEach(() => dispose.splice(0).reverse().forEach(fn => fn()))
function editor(doc = 'selected') {
  const parent = document.body.appendChild(document.createElement('div'))
  const view = mountEditor({ parent, doc })
  dispose.push(() => { view.destroy(); parent.remove() })
  return view
}
function toolbar(view: EditorView | null, props: Omit<Partial<NexusdownToolbarProps>, 'view'> = {}) {
  const wrapper = mount(Toolbar as DefineComponent<NexusdownToolbarProps>, { props: { view, ...props }, attachTo: document.body })
  dispose.push(() => wrapper.unmount())
  return wrapper
}
function labels(wrapper: VueWrapper) {
  return wrapper.findAll('.row button[aria-label]').map(button => button.attributes('aria-label'))
}
async function press(element: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  await nextTick()
  return event
}

// Catch accidentally exposing every extension in the default common-action row.
it('keeps common actions inline and puts all six extensions in a labelled dropdown', async () => {
  const wrapper = toolbar(editor())
  expect(labels(wrapper)).toContain('插入链接')
  expect(labels(wrapper)).not.toContain('行内公式')
  expect(labels(wrapper)).not.toContain('块变体')
  await wrapper.get('button[aria-label="扩展"]').trigger('click')
  const menu = wrapper.get('[role="menu"][aria-label="扩展"]')
  expect(menu.findAll('button').map(button => button.attributes('aria-label'))).toEqual([
    '行内公式', '块级公式', '提及', '插入引用', '链接与媒体', '块变体',
  ])
})

// Catch falling back to the defaults or keeping an unconfigured special button.
it('replaces the complete layout, respects order and hides empty groups', async () => {
  const wrapper = toolbar(editor(), { config: { groups: [
    { id: 'empty', label: '空分类', items: [] },
    { id: 'chosen', label: '我的常用', items: ['h2', 'bold', 'blockVariants'] },
  ] } })
  expect(labels(wrapper)).toEqual(['二级标题', '加粗（Ctrl/⌘ + B）', '块变体'])
  expect(wrapper.find('[role="group"][aria-label="我的常用"]').exists()).toBe(true)
  expect(wrapper.find('[aria-label="空分类"]').exists()).toBe(false)
  await wrapper.setProps({ config: { groups: [] } })
  expect(wrapper.findAll('.row button')).toHaveLength(0)
})

// Catch icon-based keys and ignoring custom Vue components or command context.
it('runs distinct custom actions sharing one icon and reflects programmatic command state', async () => {
  const view = editor('text')
  view.dispatch({ selection: { anchor: 0, head: 4 } })
  const icon = defineComponent({ render: () => h('svg', { 'data-custom-icon': '' }, [h('path', { d: 'M0 0h1' })]) })
  const wrapper = toolbar(view, { config: { groups: [{ id: 'custom', label: '自定义', items: [
    { id: 'wrap', label: '自定义加粗', icon, active: ({ view }: { view: EditorView }) => view.state.doc.toString().startsWith('**'), run: ({ runCommand }: { runCommand: (command: typeof toggleBold) => boolean }) => runCommand(toggleBold) },
    { id: 'append', label: '附加内容', icon, disabled: ({ view }: { view: EditorView }) => view.state.doc.length > 4, run: ({ view }: { view: EditorView }) => { view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } }) } },
  ] }] } })
  expect(wrapper.findAll('[data-custom-icon]')).toHaveLength(2)
  await wrapper.get('button[aria-label="自定义加粗"]').trigger('click')
  expect(view.state.doc.toString()).toBe('**text**')
  expect(wrapper.get('button[aria-label="自定义加粗"]').attributes('aria-pressed')).toBe('true')
  expect(wrapper.get('button[aria-label="附加内容"]').attributes('disabled')).toBeDefined()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'ok' } })
  await nextTick()
  expect(wrapper.get('button[aria-label="附加内容"]').attributes('disabled')).toBeUndefined()
})

// Catch a toolbar state cache that only reacts to DOM keyboard/mouse events.
it('updates built-in active and read-only states after real editor transactions', async () => {
  const view = editor('**text**')
  const wrapper = toolbar(view, { config: { groups: [{ id: 'format', label: '格式', items: ['bold', 'link', 'undo'] }] } })
  view.dispatch({ selection: { anchor: 3 } })
  await nextTick()
  expect(wrapper.get('button[aria-label="加粗（Ctrl/⌘ + B）"]').attributes('aria-pressed')).toBe('true')
  view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) })
  await nextTick()
  expect(wrapper.findAll('.row button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
  await wrapper.get('button[aria-label="插入链接"]').trigger('click')
  expect(wrapper.find('.link-panel').exists()).toBe(false)
})

// Catch missing keyboard access or focus returning to a hidden menu entry.
it('navigates dropdown entries with arrows and restores its trigger on Escape', async () => {
  const wrapper = toolbar(editor(), { config: { groups: [{ id: 'more', label: '更多', display: 'dropdown', items: ['h1', 'h2'] }] } })
  const trigger = wrapper.get('button[aria-label="更多"]')
  await trigger.trigger('keydown', { key: 'ArrowDown' })
  const items = wrapper.findAll('[role="menuitem"]')
  expect(document.activeElement).toBe(items[0]!.element)
  await items[0]!.trigger('keydown', { key: 'ArrowUp' })
  expect(document.activeElement).toBe(items[1]!.element)
  await items[1]!.trigger('keydown', { key: 'Escape' })
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  expect(document.activeElement).toBe(trigger.element)
})

it('executes keyboard menu selections and closes menus on outside clicks or ancestor scrolling', async () => {
  const view = editor('text')
  const wrapper = toolbar(view, { config: { groups: [{ id: 'more', label: '更多', display: 'dropdown', items: ['h1', 'h2'] }] } })
  await wrapper.get('button[aria-label="更多"]').trigger('click')
  await wrapper.get('[role="menuitem"]').trigger('keydown', { key: 'Enter' })
  expect(view.state.doc.toString()).toBe('# text')
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  await wrapper.get('button[aria-label="更多"]').trigger('click')
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  await nextTick()
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  await wrapper.get('button[aria-label="更多"]').trigger('click')
  window.dispatchEvent(new Event('scroll'))
  await nextTick()
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
})

// Catch duplicate async invocation and stealing focus from an external dialog.
it('disables an async action while pending and preserves external focus on completion', async () => {
  const view = editor()
  const input = document.body.appendChild(document.createElement('input'))
  dispose.push(() => input.remove())
  let complete!: () => void
  let calls = 0
  const wrapper = toolbar(view, { config: { groups: [{ id: 'external', label: '外部', items: [{
    id: 'upload', label: '上传', run: () => { calls++; input.focus(); return new Promise<void>(resolve => { complete = resolve }) },
  }] }] } })
  const button = wrapper.get('button[aria-label="上传"]')
  await button.trigger('click')
  expect(button.attributes('disabled')).toBeDefined()
  expect(button.attributes('aria-busy')).toBe('true')
  await button.trigger('click')
  expect(calls).toBe(1)
  complete()
  await flushPromises()
  expect(button.attributes('disabled')).toBeUndefined()
  expect(document.activeElement).toBe(input)
})

it.each(['throw', 'reject'] as const)('reports %s errors visibly and emits the action id', async mode => {
  const error = new Error('上传失败')
  const wrapper = toolbar(editor(), { config: { groups: [{ id: 'external', label: '外部', items: [{
    id: 'upload', label: '上传', run: () => { if (mode === 'throw') throw error; return Promise.reject(error) },
  }] }] } })
  await wrapper.get('button[aria-label="上传"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('上传失败')
  expect(wrapper.emitted('action-error')).toEqual([[{ id: 'upload', error }]])
  expect(wrapper.get('button[aria-label="上传"]').attributes('disabled')).toBeUndefined()
})

// Catch late async callbacks editing either the old draft or its replacement.
it.each(['replace', 'unmount'] as const)('aborts actions on view %s and rejects their late runCommand', async mode => {
  const view = editor('old')
  let signal!: AbortSignal
  let resume!: () => void
  let result: boolean | undefined
  const wrapper = toolbar(view, { config: { groups: [{ id: 'external', label: '外部', items: [{
    id: 'late', label: '延迟操作', run: async (context: { signal: AbortSignal; runCommand: (command: typeof toggleBold) => boolean }) => {
      signal = context.signal
      await new Promise<void>(resolve => { resume = resolve })
      result = context.runCommand(toggleBold)
    },
  }] }] } })
  await wrapper.get('button[aria-label="延迟操作"]').trigger('click')
  const replacement = editor('new')
  if (mode === 'replace') await wrapper.setProps({ view: replacement })
  else wrapper.unmount()
  expect(signal.aborted).toBe(true)
  resume()
  await flushPromises()
  expect(result).toBe(false)
  expect(view.state.doc.toString()).toBe('old')
  expect(replacement.state.doc.toString()).toBe('new')
})

it('keeps unavailable and read-only custom actions inert', async () => {
  let calls = 0
  const config = { groups: [{ id: 'custom', label: '自定义', items: [{ id: 'no', label: '禁用操作', run: () => { calls++ } }] }] }
  const wrapper = toolbar(null, { config })
  await wrapper.get('button').trigger('click')
  const view = editor()
  view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) })
  await wrapper.setProps({ view })
  await wrapper.get('button').trigger('click')
  expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  expect(calls).toBe(0)
})

// Catch preserving a mutable panel after the editor changes to read-only.
it('closes an already-open insertion panel when a transaction makes the view read-only', async () => {
  const view = editor()
  const wrapper = toolbar(view)
  await wrapper.get('button[aria-label="插入链接"]').trigger('click')
  expect(wrapper.find('.link-panel').exists()).toBe(true)
  view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) })
  await nextTick()
  expect(wrapper.find('.link-panel').exists()).toBe(false)
})

// Catch a stale variant menu remaining visible after another formatting action.
it('keeps configured block variants working and dismisses them for another action', async () => {
  const view = editor('```js\ncode\n```')
  view.dispatch({ selection: { anchor: 8 } })
  const wrapper = toolbar(view, { config: { groups: [{ id: 'variant', label: '变体', items: ['blockVariants', 'bold'] }] } })
  await wrapper.get('button[aria-label="块变体"]').trigger('click')
  expect(wrapper.get('[role="menu"][aria-label="块变体"]').text()).toContain('行号')
  const item = wrapper.findAll('.variant-item').find(button => button.text().includes('行号'))!
  await item.trigger('click')
  expect(view.state.doc.toString()).toContain('{lines}')
  expect(wrapper.find('.variant-pop').exists()).toBe(false)
  view.dispatch({ selection: { anchor: 8 } })
  await wrapper.get('button[aria-label="块变体"]').trigger('click')
  expect(wrapper.find('.variant-pop').exists()).toBe(true)
  await wrapper.get('button[aria-label="加粗（Ctrl/⌘ + B）"]').trigger('click')
  expect(wrapper.find('.variant-pop').exists()).toBe(false)
})

it('aborts an action when a dynamic layout removes its entry', async () => {
  let signal!: AbortSignal
  let complete!: () => void
  let applied: boolean | undefined
  const view = editor('draft')
  const wrapper = toolbar(view, { config: { groups: [{ id: 'custom', label: '自定义', items: [{
    id: 'late', label: '延迟操作', run: async (context: { signal: AbortSignal; runCommand: (command: typeof toggleBold) => boolean }) => {
      signal = context.signal
      await new Promise<void>(resolve => { complete = resolve })
      applied = context.runCommand(toggleBold)
    },
  }] }] } })
  await wrapper.get('button[aria-label="延迟操作"]').trigger('click')
  await wrapper.setProps({ config: { groups: [] } })
  expect(signal.aborted).toBe(true)
  complete()
  await flushPromises()
  expect(applied).toBe(false)
  expect(view.state.doc.toString()).toBe('draft')
  expect(wrapper.findAll('.row button')).toHaveLength(0)
})

it('keeps a dropdown open during unrelated scrolling and closes for its ancestor', async () => {
  const wrapper = toolbar(editor(), { config: { groups: [{ id: 'more', label: '更多', display: 'dropdown', items: ['h1'] }] } })
  const other = editor('other editor')
  await wrapper.get('button[aria-label="更多"]').trigger('click')
  other.scrollDOM.dispatchEvent(new Event('scroll'))
  await nextTick()
  expect(wrapper.find('.category-menu').exists()).toBe(true)
  wrapper.element.parentElement!.dispatchEvent(new Event('scroll'))
  await nextTick()
  expect(wrapper.find('.category-menu').exists()).toBe(false)
})

// Catch Escape becoming unreachable when a category contains no enabled entry.
it('closes a read-only category with Escape while focus remains on its trigger', async () => {
  const view = editor()
  view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) })
  const wrapper = toolbar(view)
  const trigger = wrapper.get('button[aria-label="扩展"]').element as HTMLButtonElement
  trigger.focus()
  await press(trigger, 'ArrowDown')
  expect(wrapper.find('.category-menu').exists()).toBe(true)
  expect(document.activeElement).toBe(trigger)
  const escape = await press(trigger, 'Escape')
  expect(escape.defaultPrevented).toBe(true)
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  expect(document.activeElement).toBe(trigger)
})

// Catch focus landing in a variant menu outside the category Escape handler.
it('closes the parent category when keyboard activation opens block variants', async () => {
  const view = editor('```js\ncode\n```')
  view.dispatch({ selection: { anchor: 8 } })
  const wrapper = toolbar(view)
  const trigger = wrapper.get('button[aria-label="扩展"]').element as HTMLButtonElement
  trigger.focus()
  await press(trigger, 'ArrowUp')
  const variant = wrapper.get('button[aria-label="块变体"]').element
  expect(document.activeElement).toBe(variant)
  await press(variant, 'Enter')
  expect(wrapper.find('.category-menu').exists()).toBe(false)
  expect(wrapper.find('[role="menu"][aria-label="块变体"]').exists()).toBe(true)
  expect(document.activeElement).toBe(wrapper.get('.variant-item').element)
})

it.each(['inline', 'dropdown'] as const)('handles Escape from a %s block variant entry and returns to its visible trigger', async display => {
  const view = editor('```js\ncode\n```')
  view.dispatch({ selection: { anchor: 8 } })
  const wrapper = toolbar(view, { config: { groups: [{ id: 'variants', label: '变体分类', display, items: ['blockVariants'] }] } })
  if (display === 'dropdown') await wrapper.get('button[aria-label="变体分类"]').trigger('click')
  const source = wrapper.get('button[aria-label="块变体"]').element as HTMLButtonElement
  // Focus this menu entry explicitly; Escape still uses a real bubbling key event.
  source.click()
  await nextTick()
  const item = wrapper.get('.variant-item').element as HTMLButtonElement
  item.focus()
  const escape = await press(item, 'Escape')
  expect(escape.defaultPrevented).toBe(true)
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  const target = display === 'dropdown' ? wrapper.get('button[aria-label="变体分类"]').element : source
  expect(document.activeElement).toBe(target)
})
