import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'

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
