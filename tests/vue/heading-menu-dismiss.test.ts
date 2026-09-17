import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import HeadingPicker from '../../src/vue/HeadingPicker.vue'

/**
 * The heading menu must dismiss on an outside click or Escape.
 *
 * Regression guard: the menu is teleported to `body`, so "outside" cannot be
 * decided by DOM ancestry within the component — the handler must test the menu
 * and trigger explicitly.
 */
describe('heading menu dismissal (issue #1 comments)', () => {
  async function openMenu() {
    const wrapper = mount(HeadingPicker, { props: { activeLevel: 1 }, attachTo: document.body })
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    return wrapper
  }

  const menu = () => document.querySelector('[data-nexusdown="heading-menu"]')

  it('opens on trigger click', async () => {
    const wrapper = await openMenu()
    expect(menu()).not.toBeNull()
    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = await openMenu()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(menu()).toBeNull()
    wrapper.unmount()
  })

  it('closes on an outside pointer press', async () => {
    const wrapper = await openMenu()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(menu()).toBeNull()
    wrapper.unmount()
  })

  it('stays open when the press lands inside the menu', async () => {
    const wrapper = await openMenu()
    const panel = menu()!
    panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(menu()).not.toBeNull()
    wrapper.unmount()
  })

  it('stays open when the press lands on the trigger', async () => {
    const wrapper = await openMenu()
    wrapper.find('button').element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(menu()).not.toBeNull()
    wrapper.unmount()
  })

  it('removes its document listeners once closed', async () => {
    const wrapper = await openMenu()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(menu()).toBeNull()
    // Re-dispatching must be a no-op rather than throwing on stale refs.
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }).not.toThrow()
    wrapper.unmount()
  })
})
