import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'

/**
 * The Markdown panel must not be rewritten while the user types into it.
 *
 * Regression: the session echoed its normalised Markdown back into the textarea
 * on every snapshot. Unfinished markup is normalised on the way through, so
 * typing `see [link` came back as `see \[link` and the characters could never be
 * typed at all.
 */
describe('markdown panel typing (issue #1 comments)', () => {
  async function typeIntoMarkdown(text: string) {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '', contentType: 'markdown' },
      attachTo: document.body,
    })
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)

    const element = textarea.element as HTMLTextAreaElement
    element.value = text
    await textarea.trigger('input')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const current = (wrapper.find('textarea').element as HTMLTextAreaElement).value
    wrapper.unmount()
    return current
  }

  it('keeps an unfinished link bracket as typed', async () => {
    expect(await typeIntoMarkdown('see [link')).toBe('see [link')
  })

  it('keeps a lone asterisk as typed', async () => {
    expect(await typeIntoMarkdown('a * b')).toBe('a * b')
  })

  it('keeps an unfinished emphasis marker as typed', async () => {
    expect(await typeIntoMarkdown('**bold')).toBe('**bold')
  })

  it('keeps an unfinished backtick as typed', async () => {
    expect(await typeIntoMarkdown('`code')).toBe('`code')
  })
})
