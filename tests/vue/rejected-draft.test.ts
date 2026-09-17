import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'

/**
 * A rejected Markdown edit must not linger in the panel.
 *
 * Regression: the session refuses unparseable input (a NUL character, say) and
 * restores the previous document, but the textarea kept the draft while
 * `v-model` and the rich-text pane had already reverted — the panel disagreed
 * with everything else and the refusal was invisible. Vue also skips the DOM
 * patch when the prop goes back to the value it already had, so the panel is
 * asked to resync explicitly.
 */
describe('rejected draft does not linger (issue #1 comments)', () => {
  async function typeInto(text: string) {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'ok\n', contentType: 'markdown' },
      attachTo: document.body,
    })
    const textarea = wrapper.find('textarea')
    ;(textarea.element as HTMLTextAreaElement).value = text
    await textarea.trigger('input')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const state = {
      value: (wrapper.find('textarea').element as HTMLTextAreaElement).value,
      errors: wrapper.emitted('parse-error')?.length ?? 0,
    }
    wrapper.unmount()
    return state
  }

  it('reverts the panel when the input contains a NUL', async () => {
    const { value, errors } = await typeInto('bad\u0000content')
    expect(value).toBe('ok')
    expect(value).not.toContain('\u0000')
    expect(errors).toBeGreaterThan(0)
  })

  it('reverts the panel after several rejected edits', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'ok\n', contentType: 'markdown' },
      attachTo: document.body,
    })
    for (const draft of ['x\u0000', 'y\u0000z', 'q\u0000']) {
      const textarea = wrapper.find('textarea')
      ;(textarea.element as HTMLTextAreaElement).value = draft
      await textarea.trigger('input')
      await wrapper.vm.$nextTick()
    }
    await wrapper.vm.$nextTick()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('ok')
    wrapper.unmount()
  })

  it('keeps valid content that parses', async () => {
    const { value, errors } = await typeInto('## heading\n')
    expect(value).toBe('## heading\n')
    expect(errors).toBe(0)
  })
})
