import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'
import type { NexusdownEditorSession } from '../../src/core/session'

describe('NexusdownEditor', () => {
  it('renders rich text, markdown, and one shared toolbar', () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '# Hello', contentType: 'markdown' } })
    expect(wrapper.find('[data-nexusdown="rich-text"]').exists()).toBe(true)
    expect(wrapper.find('[data-nexusdown="markdown"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-nexusdown="toolbar"]').length).toBe(1)
    expect(wrapper.findAll('iconify-icon').length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('emits markdown updates from the markdown surface', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '# Hello' } })
    await wrapper.get('[data-nexusdown="markdown"]').setValue('# Updated')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['# Updated'])
    wrapper.unmount()
  })

  it('mounts the rich text surface as a Tiptap EditorView', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '**Bold**' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.find('[data-nexusdown="rich-text"] .ProseMirror').exists()).toBe(true)
    wrapper.unmount()
  })

  it('uses html when an external html model value changes', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '<p>First</p>', contentType: 'html' },
    })
    await wrapper.setProps({ modelValue: '<h2>Second</h2>' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.find('[data-nexusdown="rich-text"] h2').text()).toBe('Second')
    wrapper.unmount()
  })

  it('makes the Tiptap surface readonly when readonly is enabled', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Text', readonly: true } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.get('.ProseMirror').attributes('contenteditable')).toBe('false')
    wrapper.unmount()
  })

  it('applies toolbar formatting to the selection in the visible EditorView', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Selected text' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    vm.session.getEditor().commands.selectAll()
    await wrapper.get('button[aria-label="粗体"]').trigger('click')
    expect(wrapper.get('.ProseMirror strong').text()).toBe('Selected text')
    wrapper.unmount()
  })
})
