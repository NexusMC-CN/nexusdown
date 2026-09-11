import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MarkdownEditor from '../../src/vue/components/MarkdownEditor.vue'
import { useNexusdownTheme } from '../../src/vue/composables/useNexusdownTheme'

describe('MarkdownEditor', () => {
  it('keeps the markdown textarea selector and renders syntax tokens', () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '# heading\n\n**bold**' } })

    expect(wrapper.find('[data-nexusdown="markdown"]').exists()).toBe(true)
    const code = wrapper.get('[data-nexusdown="markdown-highlight"]')
    expect(code.find('.hljs-section').exists()).toBe(true)
    expect(code.find('.hljs-strong').exists()).toBe(true)
    expect(code.html()).not.toContain('<textarea')
  })

  it('renders inline color HTML with the same color in the markdown mirror', () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '<span style="color: #ff0000">colored</span>' } })

    const colored = wrapper.get('[data-nexusdown="markdown-color"]')
    expect(colored.text()).toBe('colored')
    expect(colored.attributes('style')).toContain('color: #ff0000')
  })

  it('renders the color shortcode with the same color in the markdown mirror', () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: '[color color="#ff0000"]colored[/color]' } })

    const colored = wrapper.get('[data-nexusdown="markdown-color"]')
    expect(colored.text()).toBe('colored')
    expect(colored.attributes('style')).toContain('color: #ff0000')
  })

  it('emits input updates and mirrors scroll position', async () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: 'hello' } })
    const textarea = wrapper.get('[data-nexusdown="markdown"]').element as HTMLTextAreaElement
    textarea.value = 'updated'
    await wrapper.get('[data-nexusdown="markdown"]').trigger('input')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['updated'])

    const pre = wrapper.get('[data-nexusdown="markdown-highlight"]')
      .element.parentElement as HTMLElement
    textarea.scrollTop = 42
    textarea.scrollLeft = 7
    await wrapper.get('[data-nexusdown="markdown"]').trigger('scroll')
    expect(pre.scrollTop).toBe(42)
    expect(pre.scrollLeft).toBe(7)
  })

  it('passes readonly state to the textarea', () => {
    const wrapper = mount(MarkdownEditor, { props: { modelValue: 'text', readonly: true } })
    expect(wrapper.get('[data-nexusdown="markdown"]').attributes('readonly')).toBeDefined()
  })
})

describe('useNexusdownTheme', () => {
  it('resolves explicit light and dark themes reactively', async () => {
    const Harness = defineComponent({
      setup() {
        const requested = ref<'light' | 'dark' | 'system'>('light')
        const { resolvedTheme } = useNexusdownTheme(requested)
        return { requested, resolvedTheme }
      },
      render() {
        return h('div', { 'data-theme': this.resolvedTheme })
      },
    })
    const wrapper = mount(Harness)
    expect(wrapper.get('div').attributes('data-theme')).toBe('light')
    ;(wrapper.vm as unknown as { requested: string }).requested = 'dark'
    await wrapper.vm.$nextTick()
    expect(wrapper.get('div').attributes('data-theme')).toBe('dark')
  })

  it('uses a safe light fallback when system matchMedia is unavailable', () => {
    const original = window.matchMedia
    // jsdom does not provide matchMedia in all versions; emulate that runtime.
    vi.stubGlobal('matchMedia', undefined)
    const { resolvedTheme } = useNexusdownTheme('system')
    expect(resolvedTheme.value).toBe('light')
    vi.stubGlobal('matchMedia', original)
  })

  it('subscribes to system theme changes after switching to system', async () => {
    const callbacks = new Set<() => void>()
    const media = {
      matches: true,
      addEventListener: (_event: string, callback: () => void) => callbacks.add(callback),
      removeEventListener: (_event: string, callback: () => void) => callbacks.delete(callback),
    }
    vi.stubGlobal('matchMedia', () => media)
    const Harness = defineComponent({
      setup() {
        const requested = ref<'light' | 'dark' | 'system'>('light')
        const { resolvedTheme } = useNexusdownTheme(requested)
        return { requested, resolvedTheme }
      },
      render() {
        return h('div', { 'data-theme': this.resolvedTheme })
      },
    })
    const wrapper = mount(Harness)
    ;(wrapper.vm as unknown as { requested: string }).requested = 'system'
    await wrapper.vm.$nextTick()
    expect(wrapper.get('div').attributes('data-theme')).toBe('dark')

    media.matches = false
    callbacks.forEach((callback) => callback())
    await wrapper.vm.$nextTick()
    expect(wrapper.get('div').attributes('data-theme')).toBe('light')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})
