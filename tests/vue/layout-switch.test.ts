import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'

describe('layout switching', () => {
  it('keeps the rich editor mounted and editable after switching layout', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'Hello world', layout: 'rich-left' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const surfaceBefore = wrapper.find('[data-nexusdown="rich-text"] .nexusdown-rich-surface').element
    expect(surfaceBefore.querySelector('.ProseMirror')).not.toBeNull()

    await wrapper.setProps({ layout: 'markdown-left' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const surfaceAfter = wrapper.find('[data-nexusdown="rich-text"] .nexusdown-rich-surface').element
    // Regression: the v-if branch swap replaced the mount target with an empty
    // node, leaving the rich pane blank and uneditable.
    expect(surfaceAfter.querySelector('.ProseMirror'), 'rich editor must be re-mounted').not.toBeNull()
    expect(surfaceAfter.textContent).toContain('Hello world')

    // And switching back must work too.
    await wrapper.setProps({ layout: 'rich-left' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const surfaceBack = wrapper.find('[data-nexusdown="rich-text"] .nexusdown-rich-surface').element
    expect(surfaceBack.querySelector('.ProseMirror')).not.toBeNull()
    expect(surfaceBack.textContent).toContain('Hello world')

    wrapper.unmount()
  })

  it('preserves document content and does not duplicate it across switches', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '# Title\n\nBody', contentType: 'markdown', layout: 'rich-left' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await wrapper.setProps({ layout: 'markdown-left' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.setProps({ layout: 'rich-left' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const vm = wrapper.vm as unknown as { session: { getMarkdown: () => string } }
    expect(vm.session.getMarkdown()).toBe('# Title\n\nBody')
    wrapper.unmount()
  })
})
