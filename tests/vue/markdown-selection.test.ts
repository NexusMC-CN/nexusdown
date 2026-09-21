import { describe, expect, it, vi } from 'vitest'
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

  it('applies bold to the markdown selection instead of the rich selection', async () => {
    Object.defineProperty(HTMLElement.prototype, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
    Object.defineProperty(Node.prototype, 'getClientRects', { configurable: true, value: () => [] })
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'alpha beta gamma', contentType: 'markdown' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await selectInTextarea(wrapper, 0, 5)
    await wrapper.get('button[aria-label="粗体"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toContain('**alpha**')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).not.toContain('**beta**')
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('applies a link to the markdown selection instead of the rich selection', async () => {
    Object.defineProperty(HTMLElement.prototype, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'alpha beta gamma', contentType: 'markdown' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await selectInTextarea(wrapper, 6, 10)
    await wrapper.get('button[aria-label="链接"]').trigger('click')
    const menu = document.body.querySelector('[data-nexusdown="link-menu"]') as HTMLElement
    const href = menu.querySelector('input[aria-label="链接地址"]') as HTMLInputElement
    href.value = 'https://example.com'
    href.dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()
    ;(menu.querySelector('button[aria-label="应用链接"]') as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()

    const value = (wrapper.find('textarea').element as HTMLTextAreaElement).value
    expect(value).toContain('[beta](https://example.com)')
    expect(value).not.toContain('[alpha]')
    wrapper.unmount()
  })

  it('maps a repeated markdown selection to its source occurrence', async () => {
    Object.defineProperty(HTMLElement.prototype, 'getClientRects', { configurable: true, value: () => [] })
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'alpha alpha', contentType: 'markdown' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await selectInTextarea(wrapper, 6, 11)
    await wrapper.get('button[aria-label="粗体"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('alpha **alpha**')
    wrapper.unmount()
  })
})
