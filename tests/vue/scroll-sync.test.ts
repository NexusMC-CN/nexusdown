import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'

/**
 * Scroll sync maps the two panes proportionally and must not feed back into
 * itself. The guard matters: writing `scrollTop` on the target fires its own
 * `scroll` event, which would otherwise bounce the position between panes.
 */
describe('pane scroll sync (issue #1 comments)', () => {
  function mountSplit() {
    return mount(NexusdownEditor, {
      props: { modelValue: '# title\n\nbody\n', contentType: 'markdown', syncScroll: true },
      attachTo: document.body,
    })
  }

  it('renders both panes when the layout is split', () => {
    const wrapper = mountSplit()
    expect(wrapper.find('[data-nexusdown="rich-text"]').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(true)
    wrapper.unmount()
  })

  it('does not throw while scrolling with zero-sized panes', async () => {
    // jsdom reports scrollHeight === clientHeight === 0, which makes the
    // proportional ratio degenerate. The handler must tolerate that rather than
    // divide by zero or write NaN into scrollTop.
    const wrapper = mountSplit()
    const rich = wrapper.find('[data-nexusdown="rich-text"]')
    await rich.trigger('scroll')
    expect(Number.isNaN((rich.element as HTMLElement).scrollTop)).toBe(false)
    wrapper.unmount()
  })

  it('honours an explicit syncScroll=false', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '# title\n', contentType: 'markdown', syncScroll: false },
      attachTo: document.body,
    })
    const rich = wrapper.find('[data-nexusdown="rich-text"]')
    await rich.trigger('scroll')
    expect((rich.element as HTMLElement).scrollTop).toBe(0)
    wrapper.unmount()
  })
})
