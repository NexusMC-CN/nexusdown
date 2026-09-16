import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'

describe('scroll synchronisation targets', () => {
  it('exposes the textarea itself as the markdown scroll element', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'a\n'.repeat(200), contentType: 'markdown' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const handle = (wrapper.vm as unknown as {
      markdownEditor: { getScrollElement: () => HTMLElement | null }
    }).markdownEditor

    const textarea = wrapper.find('textarea').element
    // Regression target: syncing to the outer wrapper (which is
    // `overflow: hidden`) would be a no-op, because the textarea is the element
    // that actually scrolls.
    expect(handle.getScrollElement()).toBe(textarea)
    wrapper.unmount()
  })

  it('scrolls the textarea when the rich pane scrolls', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'a\n'.repeat(200), contentType: 'markdown', syncScroll: true },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const textarea = wrapper.find('textarea').element as HTMLTextAreaElement
    // jsdom does not lay out, so give both panes a scroll range to work with.
    // `clientHeight` must be defined before `scrollHeight` is read by the
    // handler; both are plain mocks because jsdom reports 0 for each.
    Object.defineProperty(textarea, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(textarea, 'clientHeight', { value: 400, configurable: true })

    const richPane = wrapper.find('[data-nexusdown="rich-text"]').element as HTMLElement
    Object.defineProperty(richPane, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(richPane, 'clientHeight', { value: 500, configurable: true })

    // scrollRange(rich) = 1000 - 500 = 500; ratio = 500 / 500 = 1 (fully scrolled).
    // scrollRange(markdown) = 2000 - 400 = 1600; target = 1 * 1600 = 1600.
    richPane.scrollTop = 500

    richPane.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(textarea.scrollTop).toBe(1600)
    wrapper.unmount()
  })

  it('does not sync when syncScroll is disabled', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'a\n'.repeat(200), contentType: 'markdown', syncScroll: false },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const textarea = wrapper.find('textarea').element as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(textarea, 'clientHeight', { value: 400, configurable: true })

    const richPane = wrapper.find('[data-nexusdown="rich-text"]').element as HTMLElement
    Object.defineProperty(richPane, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(richPane, 'clientHeight', { value: 500, configurable: true })
    richPane.scrollTop = 500

    richPane.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(textarea.scrollTop).toBe(0)
    wrapper.unmount()
  })
})
