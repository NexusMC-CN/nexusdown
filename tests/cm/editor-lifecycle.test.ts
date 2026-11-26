// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import NexusdownEditor from '../../src/editor/Editor.vue'

// Keep the editor, its DOM and its resources real across the package boundary.
vi.mock('@nexusmc-cn/nexusdown/cm', () => import('../../src/cm/index.js'))

const cleanup: (() => void)[] = []
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose())
  document.body.replaceChildren()
})

it('does not create a late editor after unmounting before the engine resolves', async () => {
  const wrapper = mount(NexusdownEditor, { props: { modelValue: 'quickly closed' }, attachTo: document.body })
  cleanup.push(() => wrapper.unmount())
  const exposed = wrapper.vm as unknown as { view: EditorView | null }
  const host = wrapper.get('.nd-editor__content').element
  expect(exposed.view).toBeNull()
  wrapper.unmount()

  await flushPromises()

  expect(exposed.view).toBeNull()
  expect(host.querySelector('.cm-editor')).toBeNull()
  expect(document.querySelector('.cm-editor')).toBeNull()
  expect(wrapper.emitted('update:modelValue')).toBeUndefined()
})

it('destroys the mounted editor and clears its retained host when unmounted', async () => {
  const wrapper = mount(NexusdownEditor, { props: { modelValue: 'opened editor' }, attachTo: document.body })
  cleanup.push(() => wrapper.unmount())
  await flushPromises()
  const exposed = wrapper.vm as unknown as { view: EditorView | null }
  const view = exposed.view!
  const host = wrapper.get('.nd-editor__content').element
  expect(host.querySelector('.cm-editor')).toBe(view.dom)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'edited document' } })
  expect(wrapper.emitted('update:modelValue')).toEqual([['edited document']])

  wrapper.unmount()
  await flushPromises()

  expect(exposed.view).toBeNull()
  expect(host.querySelector('.cm-editor')).toBeNull()
  expect(document.querySelector('.cm-editor')).toBeNull()
})
