// @vitest-environment jsdom
import { EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { h, ref } from 'vue'
import NexusdownEditor from '../../src/editor/Editor.vue'
import type { MarkdownItPlugin } from '../../src/render/index.js'

// Exercise the real component and engine before the package has been rebuilt.
vi.mock('@nexusmc-cn/nexusdown/cm', () => import('../../src/cm/index.js'))

const cleanup: (() => void)[] = []
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

async function editor(props: Record<string, unknown> = {}, parent: HTMLElement = document.body) {
  const wrapper = mount(NexusdownEditor, { props: { modelValue: 'plain', ...props }, attachTo: parent })
  cleanup.push(() => wrapper.unmount())
  await flushPromises()
  const view = (wrapper.vm as unknown as { view: EditorView }).view
  expect(view).not.toBeNull()
  return { wrapper, view }
}
function bounds(element: Element, x: number, y: number, width: number, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(x, y, width, height))
}
function margins(view: EditorView) {
  return view.state.facet(EditorView.scrollMargins).map(source => source(view))
}

describe('NexusdownEditor configuration and layout', () => {
  it('keeps mode switching and toolbar in one bounded sticky header by default', async () => {
    const { wrapper } = await editor()
    expect(wrapper.classes()).toContain('nd-editor--container')
    const chrome = wrapper.get('.nd-editor__chrome')
    expect(chrome.classes()).toContain('nd-editor__chrome--sticky')
    expect(chrome.find('[data-mode="preview"]').exists()).toBe(true)
    expect(chrome.find('.cm-toolbar').isVisible()).toBe(true)
    expect((wrapper.element as HTMLElement).style.getPropertyValue('--nd-editor-sticky-top')).toBe('')

    await chrome.get('[data-mode="preview"]').trigger('click')
    expect(chrome.get('[data-mode="edit"]').isVisible()).toBe(true)
    expect(chrome.get('.cm-toolbar').isVisible()).toBe(false)
    expect(wrapper.get('.nd-editor__preview').isVisible()).toBe(true)
  })

  it('changes scroll mode and normalizes only supplied sticky offsets without remounting', async () => {
    const { wrapper, view } = await editor({ scrollMode: 'page', toolbarOffset: 56 })
    expect(wrapper.classes()).toContain('nd-editor--page')
    expect((wrapper.element as HTMLElement).style.getPropertyValue('--nd-editor-sticky-top')).toBe('56px')
    await wrapper.setProps({ scrollMode: 'container', toolbarOffset: '3rem', stickyToolbar: false } as never)
    expect(wrapper.classes()).toContain('nd-editor--container')
    expect(wrapper.classes()).not.toContain('nd-editor--page')
    expect(wrapper.get('.nd-editor__chrome').classes()).not.toContain('nd-editor__chrome--sticky')
    expect((wrapper.element as HTMLElement).style.getPropertyValue('--nd-editor-sticky-top')).toBe('3rem')
    expect((wrapper.vm as unknown as { view: EditorView }).view).toBe(view)
    await wrapper.setProps({ toolbarOffset: undefined } as never)
    expect((wrapper.element as HTMLElement).style.getPropertyValue('--nd-editor-sticky-top')).toBe('')
  })

  it('installs extensions at mount and retains the existing view when props change', async () => {
    const { wrapper, view } = await editor({ extensions: EditorState.readOnly.of(true) })
    expect(view.state.readOnly).toBe(true)
    await wrapper.setProps({ extensions: [] } as never)
    expect((wrapper.vm as unknown as { view: EditorView }).view).toBe(view)
    expect(view.state.readOnly).toBe(true)
  })

  it.each(['raw', 'ref'] as const)('preserves external decoration plugins supplied through a %s array', async mode => {
    const plugin = ViewPlugin.define(() => ({
      decorations: Decoration.set([Decoration.mark({ class: 'host-marker' }).range(0, 5)]),
    }), { decorations: value => value.decorations })
    // Vue still proxies the value; avoid recursively unwrapping CM's types.
    const extensions = (mode === 'ref' ? ref<unknown>([plugin]).value : [plugin]) as Extension
    // Use a real parent: VTU's directly supplied props are reactive themselves.
    const wrapper = mount({ setup: () => () => h(NexusdownEditor, { modelValue: 'plain', extensions }) }, { attachTo: document.body })
    cleanup.push(() => wrapper.unmount())
    await flushPromises()
    const view = (wrapper.findComponent(NexusdownEditor).vm as unknown as { view: EditorView }).view
    expect(wrapper.find('.host-marker').exists()).toBe(true)
    expect(view.plugin(plugin)).not.toBeNull()
  })

  it('uses custom toolbar actions and forwards their original error payload', async () => {
    const failure = new Error('dialog failed')
    const { wrapper } = await editor({ toolbar: { groups: [{ id: 'app', label: '应用', items: [{
      id: 'dialog', label: '外部对话框', run: () => { throw failure },
    }] }] } })
    await wrapper.get('button[aria-label="外部对话框"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('action-error')).toEqual([[{ id: 'dialog', error: failure }]])
  })

  it('renders preview plugins and refreshes on plugin replacement while keeping the editor', async () => {
    const marker = (value: string): MarkdownItPlugin => md => {
      const render = md.renderer.rules.text!
      md.renderer.rules.text = (tokens, index, options, env, self) =>
        `<mark data-marker="${value}">${render(tokens, index, options, env, self)}</mark>`
    }
    const { wrapper, view } = await editor({ previewPlugins: [marker('first')] })
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.get('.nd-editor__preview mark').attributes('data-marker')).toBe('first')
    await wrapper.setProps({ previewPlugins: [marker('next')] } as never)
    expect(wrapper.get('.nd-editor__preview mark').attributes('data-marker')).toBe('next')
    expect((wrapper.vm as unknown as { view: EditorView }).view).toBe(view)
  })

  it.each([
    { title: 'page viewport with navigation offset', mode: 'page', contentTop: -500, chromeTop: 48, chromeHeight: 92, want: 140 },
    { title: 'large internal scroller under the sticky header', mode: 'container', contentTop: -200, chromeTop: 48, chromeHeight: 92, want: 140 },
    { title: 'internal scroller below the header', mode: 'container', contentTop: 240, chromeTop: 100, chromeHeight: 92, want: 0 },
    { title: 'wrapped toolbar', mode: 'page', contentTop: -500, chromeTop: 48, chromeHeight: 160, want: 208 },
    { title: 'header reaching its editor boundary', mode: 'page', contentTop: -500, chromeTop: -60, chromeHeight: 92, want: 32 },
    { title: 'header leaving its editor boundary', mode: 'page', contentTop: -500, chromeTop: -120, chromeHeight: 92, want: 0 },
  ])('measures actual cursor obstruction for $title', async ({ mode, contentTop, chromeTop, chromeHeight, want }) => {
    const { wrapper, view } = await editor({ scrollMode: mode })
    bounds(wrapper.get('.nd-editor__chrome').element, 20, chromeTop, 600, chromeHeight)
    bounds(view.scrollDOM, 20, contentTop, 600, 1400)
    expect(margins(view)).toContainEqual({ top: want })
  })

  it.each(['page', 'container'] as const)('reserves the returning sticky header when an entire %s editor is above the viewport', async scrollMode => {
    const { wrapper, view } = await editor({ scrollMode, toolbarOffset: 64 })
    const header = wrapper.get('.nd-editor__chrome').element as HTMLElement
    // In a real browser the sticky CSS resolves the inherited offset to pixels.
    header.style.top = '64px'
    bounds(header, 20, -420, 600, 92)
    bounds(view.scrollDOM, 20, -1600, 600, 1200)
    expect(margins(view)).toContainEqual({ top: 156 })
  })

  it('reserves the returning header relative to an ancestor scrollport', async () => {
    const parent = document.body.appendChild(document.createElement('div'))
    parent.style.overflowX = 'auto'
    parent.style.overflowY = 'auto'
    bounds(parent, 0, 180, 680, 400)
    const { wrapper, view } = await editor({ scrollMode: 'page', toolbarOffset: '48px' }, parent)
    const header = wrapper.get('.nd-editor__chrome').element as HTMLElement
    header.style.top = '48px'
    bounds(header, 20, -320, 600, 92)
    bounds(view.scrollDOM, 20, -1400, 600, 1200)
    expect(margins(view)).toContainEqual({ top: 140 })
  })

  it('measures from the containing scroll viewport and isolates multiple editors', async () => {
    const parent = document.body.appendChild(document.createElement('div'))
    parent.style.overflow = 'auto'
    // jsdom does not expand overflow shorthand into computed axis values.
    parent.style.overflowX = 'auto'
    parent.style.overflowY = 'auto'
    bounds(parent, 0, 180, 680, 400)
    const first = await editor({ scrollMode: 'page' }, parent)
    const second = await editor({ scrollMode: 'page' })
    bounds(first.wrapper.get('.nd-editor__chrome').element, 20, 228, 600, 92)
    bounds(first.view.scrollDOM, 20, -400, 600, 1400)
    bounds(second.wrapper.get('.nd-editor__chrome').element, 20, 400, 600, 92)
    bounds(second.view.scrollDOM, 20, 492, 600, 800)
    expect(margins(first.view)).toContainEqual({ top: 140 })
    expect(margins(second.view)).toContainEqual({ top: 0 })

    await first.wrapper.setProps({ stickyToolbar: false } as never)
    expect(margins(first.view)).toContain(null)
    expect(margins(second.view)).toContainEqual({ top: 0 })
  })

  it('does not reserve stale chrome obstruction while previewing or after unmount', async () => {
    const { wrapper, view } = await editor({ scrollMode: 'page' })
    bounds(wrapper.get('.nd-editor__chrome').element, 20, 0, 600, 90)
    bounds(view.scrollDOM, 20, -400, 600, 1400)
    const source = view.state.facet(EditorView.scrollMargins).find(source => source(view)?.top === 90)
    expect(source).toBeTypeOf('function')
    expect(source!(view)).toEqual({ top: 90 })
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(source!(view)).toBeNull()
    wrapper.unmount()
    expect(source!(view)).toBeNull()
  })

  it('remeasures changed header geometry and disconnects its observer on unmount', async () => {
    const observers: ControlledResizeObserver[] = []
    class ControlledResizeObserver {
      readonly targets = new Set<Element>()
      disconnected = false
      constructor(readonly callback: ResizeObserverCallback) { observers.push(this) }
      observe(target: Element) { this.targets.add(target) }
      unobserve(target: Element) { this.targets.delete(target) }
      disconnect() { this.disconnected = true; this.targets.clear() }
      resize() { this.callback([], this as unknown as ResizeObserver) }
    }
    // jsdom has no layout observer. Keep the editor and its measure scheduling real.
    vi.stubGlobal('ResizeObserver', ControlledResizeObserver)
    const { wrapper, view } = await editor({ scrollMode: 'page' })
    const header = wrapper.get('.nd-editor__chrome').element
    const observer = observers.find(observer => observer.targets.has(header))
    expect(observer).toBeDefined()
    const measure = vi.spyOn(view, 'requestMeasure')
    measure.mockClear()
    observer!.resize()
    expect(measure).toHaveBeenCalledOnce()

    wrapper.unmount()
    expect(observer!.disconnected).toBe(true)
    measure.mockClear()
    observer!.resize()
    expect(measure).not.toHaveBeenCalled()
  })
})
