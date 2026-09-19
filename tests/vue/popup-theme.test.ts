import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'
import HeadingPicker from '../../src/vue/HeadingPicker.vue'
import LinkPicker from '../../src/vue/LinkPicker.vue'
import ImagePicker from '../../src/vue/components/ImagePicker.vue'

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 30))
  await nextTick()
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/**
 * End-to-end check that a teleported popup carries the editor's theme: the
 * `--nexus-*` variables live only on `.nexusdown-editor`, so a menu teleported
 * to `body` would otherwise resolve them against `:root` (light) even in dark
 * mode.
 */
describe('popup theme inheritance (issue #1)', () => {
  async function openLinkMenu(theme: 'light' | 'dark') {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '<p>hello</p>', contentType: 'html', theme },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Drive the theme variables deterministically; jsdom does not cascade the
    // component stylesheet, so set them the way the host stylesheet would.
    const editorSection = document.querySelector('.nexusdown-editor') as HTMLElement
    editorSection.style.setProperty('--nexus-bg', theme === 'dark' ? 'rgb(17, 24, 39)' : 'rgb(255, 255, 255)')
    editorSection.style.setProperty('--nexus-text', theme === 'dark' ? 'rgb(229, 231, 235)' : 'rgb(31, 41, 55)')

    const linkButton = wrapper.find('button[aria-label="链接"]')
    await linkButton.trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const menu = document.querySelector('[data-nexusdown="link-menu"]') as HTMLElement | null
    return { wrapper, menu }
  }

  it('mirrors the dark editor palette onto the teleported link menu', async () => {
    const { wrapper, menu } = await openLinkMenu('dark')
    expect(menu).not.toBeNull()
    // The menu really is teleported outside the editor.
    expect(menu?.closest('.nexusdown-editor')).toBeNull()
    expect(menu?.style.getPropertyValue('--nexus-bg')).toBe('rgb(17, 24, 39)')
    expect(menu?.style.getPropertyValue('--nexus-text')).toBe('rgb(229, 231, 235)')
    wrapper.unmount()
  })

  it('mirrors the light editor palette onto the teleported link menu', async () => {
    const { wrapper, menu } = await openLinkMenu('light')
    expect(menu?.style.getPropertyValue('--nexus-bg')).toBe('rgb(255, 255, 255)')
    wrapper.unmount()
  })
})

describe('live popup skin bridge', () => {
  const pickers = [
    { component: HeadingPicker, button: '标题', menu: 'heading-menu' },
    { component: LinkPicker, button: '链接', menu: 'link-menu' },
    { component: ImagePicker, button: '图片', menu: 'image-menu' },
  ]

  it.each(pickers)('refreshes $menu when its ancestor palette or root skin changes', async ({ component, button, menu }) => {
    const host = document.createElement('div')
    host.className = 'palette-one'
    document.body.append(host)
    const style = document.createElement('style')
    style.textContent = `
      .palette-one .nexusdown-editor { --nexus-accent: red; --nexus-focus-ring: pink; font-family: monospace; }
      .palette-two .nexusdown-editor { --nexus-accent: blue; --nexus-focus-ring: cyan; font-family: serif; }
      [data-theme="dark"] .nexusdown-editor { --nexus-accent: purple; }
    `
    document.head.append(style)
    const wrapper = mount(defineComponent({
      setup: () => () => h('section', { class: 'nexusdown-editor', 'data-nexusdown-skin': 'first' }, [h(component)]),
    }), { attachTo: host })
    try {
      await wrapper.find(`button[aria-label="${button}"]`).trigger('click')
      await settle()
      const popup = document.querySelector<HTMLElement>(`[data-nexusdown="${menu}"]`)!
      expect(popup.closest('.nexusdown-editor')).toBeNull()
      expect(popup.getAttribute('data-nexusdown-skin')).toBe('first')
      expect(popup.style.getPropertyValue('--nexus-focus-ring')).toBe('pink')
      host.className = 'palette-two'
      await settle()
      expect(popup.style.getPropertyValue('--nexus-accent')).toBe('blue')
      expect(popup.style.fontFamily).toBe('serif')
      host.setAttribute('data-theme', 'dark')
      await settle()
      expect(popup.style.getPropertyValue('--nexus-accent')).toBe('purple')
      wrapper.element.setAttribute('data-nexusdown-skin', 'second')
      ;(wrapper.element as HTMLElement).style.setProperty('--nexus-focus-ring', 'orange')
      await settle()
      expect(popup.getAttribute('data-nexusdown-skin')).toBe('second')
      expect(popup.style.getPropertyValue('--nexus-focus-ring')).toBe('orange')
      wrapper.element.removeAttribute('data-nexusdown-skin')
      ;(wrapper.element as HTMLElement).style.removeProperty('--nexus-focus-ring')
      host.className = ''
      await settle()
      expect(popup.hasAttribute('data-nexusdown-skin')).toBe(false)
      expect(popup.style.getPropertyValue('--nexus-focus-ring')).toBe('')
    } finally {
      wrapper.unmount()
      style.remove()
    }
  })

  it('forwards the consumer skin attribute from the editor to its popup', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '<p>hello</p>', contentType: 'html' },
      attrs: { 'data-nexusdown-skin': 'custom' },
      attachTo: document.body,
    })
    try {
      await settle()
      await wrapper.find('button[aria-label="链接"]').trigger('click')
      await settle()
      expect(document.querySelector('[data-nexusdown="link-menu"]')?.getAttribute('data-nexusdown-skin')).toBe('custom')
    } finally {
      wrapper.unmount()
    }
  })

  it('isolates editors and stops observing on close or unmount without watching popup mutations', async () => {
    // Keep the real observers: takeRecords exposes queued DOM notifications,
    // so cleanup is verified even after an unmounted trigger ref becomes null.
    const observing = vi.spyOn(MutationObserver.prototype, 'observe')
    const wrapper = mount(defineComponent({
      setup: () => () => h('div', [
        h('section', { class: 'nexusdown-editor', style: '--nexus-accent: red', 'data-nexusdown-skin': 'one' }, [h(HeadingPicker)]),
        h('section', { class: 'nexusdown-editor', style: '--nexus-accent: blue', 'data-nexusdown-skin': 'two' }, [h(HeadingPicker)]),
      ]),
    }), { attachTo: document.body })
    const triggers = wrapper.findAll('button[aria-label="标题"]')
    await triggers[0].trigger('click')
    await triggers[1].trigger('click')
    await settle()
    const firstObserver = observing.mock.contexts[0] as MutationObserver
    const [first, second] = document.querySelectorAll<HTMLElement>('[data-nexusdown="heading-menu"]')
    const sections = wrapper.findAll('section')
    const measure = vi.spyOn(triggers[0].element, 'getBoundingClientRect')
    ;(sections[1].element as HTMLElement).style.setProperty('--nexus-accent', 'green')
    await settle()
    expect(second.style.getPropertyValue('--nexus-accent')).toBe('green')
    expect(first.style.getPropertyValue('--nexus-accent')).toBe('red')
    expect(measure).not.toHaveBeenCalled()
    first.style.setProperty('--nexus-accent', 'orange')
    await settle()
    expect(measure).not.toHaveBeenCalled()
    expect(first.style.getPropertyValue('--nexus-accent')).toBe('orange')
    await triggers[0].trigger('click')
    ;(sections[0].element as HTMLElement).style.setProperty('--nexus-accent', 'purple')
    expect(firstObserver.takeRecords()).toEqual([])
    await settle()
    expect(measure).not.toHaveBeenCalled()
    await triggers[0].trigger('click')
    await settle()
    expect(document.querySelector<HTMLElement>('[data-nexusdown-skin="one"][data-nexusdown="heading-menu"]')?.style.getPropertyValue('--nexus-accent')).toBe('purple')
    measure.mockClear()
    wrapper.unmount()
    document.documentElement.setAttribute('data-theme', 'dark')
    for (const observer of new Set(observing.mock.contexts as MutationObserver[])) expect(observer.takeRecords()).toEqual([])
    await settle()
    expect(measure).not.toHaveBeenCalled()
    document.documentElement.removeAttribute('data-theme')
  })
})
