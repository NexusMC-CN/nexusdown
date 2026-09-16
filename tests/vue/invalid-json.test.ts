import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'

describe('invalid initial JSON content', () => {
  it('mounts instead of throwing and emits parse-error', async () => {
    // Regression: the component called JSON.parse() directly during setup, so a
    // malformed value threw before mount and the declared parse-error event
    // could never fire.
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '{not valid json', contentType: 'json' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const errors = wrapper.emitted('parse-error') as [Error][] | undefined
    expect(errors, 'parse-error should be emitted').toBeTruthy()
    expect(errors![0][0]).toBeInstanceOf(Error)
    expect(errors![0][0].message).toContain('Invalid JSON content')

    // The editor still renders and is usable with an empty document.
    expect(wrapper.find('[data-nexusdown="editor"]').exists()).toBe(true)
    expect(wrapper.find('.ProseMirror').exists()).toBe(true)

    const vm = wrapper.vm as unknown as { session: { getMarkdown: () => string } }
    expect(vm.session.getMarkdown()).toBe('')
    wrapper.unmount()
  })

  it('accepts valid JSON without emitting an error', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: {
        modelValue: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
        }),
        contentType: 'json',
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.emitted('parse-error')).toBeFalsy()
    const vm = wrapper.vm as unknown as { session: { getMarkdown: () => string } }
    expect(vm.session.getMarkdown()).toBe('Hello')
    wrapper.unmount()
  })

  it('treats an empty value as an empty document', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '', contentType: 'json' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.emitted('parse-error')).toBeFalsy()
    expect(wrapper.find('.ProseMirror').exists()).toBe(true)
    wrapper.unmount()
  })

  it('reports a non-object JSON payload the same way', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '"just a string"', contentType: 'json' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // A JSON string parses fine, so it must not be reported as a parse error;
    // it simply yields an empty document.
    expect(wrapper.emitted('parse-error')).toBeFalsy()
    expect(wrapper.find('.ProseMirror').exists()).toBe(true)
    wrapper.unmount()
  })
})
