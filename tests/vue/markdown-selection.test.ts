import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'
import MarkdownEditor from '../../src/vue/components/MarkdownEditor.vue'

/** Select a range in the textarea and notify the component, as a user would. */
async function selectInTextarea(wrapper: ReturnType<typeof mount>, from: number, to: number) {
  const textarea = wrapper.find('textarea').element as HTMLTextAreaElement
  textarea.focus()
  textarea.setSelectionRange(from, to)
  textarea.dispatchEvent(new Event('select'))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('markdown-side selection', () => {
  it('emits the selection range from MarkdownEditor', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'alpha beta gamma' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await selectInTextarea(wrapper, 0, 5)

    const events = wrapper.emitted('selection-change') as [{ from: number; to: number; text: string } | null][]
    expect(events.at(-1)![0]).toEqual({ from: 0, to: 5, text: 'alpha' })
    wrapper.unmount()
  })

  it('reports a collapsed selection as null', async () => {
    const wrapper = mount(MarkdownEditor, {
      props: { modelValue: 'alpha beta' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await selectInTextarea(wrapper, 3, 3)

    const events = wrapper.emitted('selection-change') as [unknown][]
    expect(events.at(-1)![0]).toBeNull()
    wrapper.unmount()
  })

  it('makes the shared toolbar see the markdown selection', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'alpha beta gamma', contentType: 'markdown', layout: 'rich-left' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: { getSelectedText: () => string } }

    // Regression: the toolbar kept reporting the rich-text selection, so a
    // formatting command applied to the wrong side.
    await selectInTextarea(wrapper, 0, 5)

    const context = (wrapper.vm as unknown as { toolbarContext: { session: { getSelectedText: () => string } } }).toolbarContext
    expect(context.session.getSelectedText()).toBe('alpha')
    expect(vm.session.getSelectedText()).toBe('')
    wrapper.unmount()
  })

  it('falls back to the rich-text selection once the markdown selection collapses', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'alpha beta gamma', contentType: 'markdown' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await selectInTextarea(wrapper, 0, 5)
    let context = (wrapper.vm as unknown as { toolbarContext: { session: { getSelectedText: () => string } } }).toolbarContext
    expect(context.session.getSelectedText()).toBe('alpha')

    await selectInTextarea(wrapper, 6, 6)
    context = (wrapper.vm as unknown as { toolbarContext: { session: { getSelectedText: () => string } } }).toolbarContext
    expect(context.session.getSelectedText()).toBe('')
    wrapper.unmount()
  })
})
