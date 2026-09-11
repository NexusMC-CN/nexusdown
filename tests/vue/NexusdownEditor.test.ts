import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'

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
})
