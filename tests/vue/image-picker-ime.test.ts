import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ImagePicker from '../../src/vue/components/ImagePicker.vue'

/**
 * Enter applies the dialog, but must not fire on the Enter that confirms an IME
 * candidate — for Chinese/Japanese/Korean input that Enter arrives as a keydown
 * carrying `isComposing`, and acting on it submitted the dialog mid-word.
 */
async function openPicker() {
  const wrapper = mount(ImagePicker, { attachTo: document.body })
  await wrapper.find('button').trigger('click')
  await wrapper.vm.$nextTick()
  const src = document.querySelector<HTMLInputElement>('input[aria-label="图片地址"]')!
  const alt = document.querySelector<HTMLInputElement>('input[aria-label="图片描述"]')!
  src.value = 'https://x.com/a.png'
  src.dispatchEvent(new Event('input', { bubbles: true }))
  alt.value = '中文'
  alt.dispatchEvent(new Event('input', { bubbles: true }))
  await wrapper.vm.$nextTick()
  return { wrapper, src, alt }
}

function pressEnter(target: HTMLInputElement, isComposing: boolean) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  Object.defineProperty(event, 'isComposing', { value: isComposing })
  target.dispatchEvent(event)
}

describe('image picker IME handling (issue #1 comments)', () => {
  it('does not apply on the Enter that confirms a composition', async () => {
    const { wrapper, alt } = await openPicker()
    pressEnter(alt, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('apply')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not apply on a composition Enter in the source field', async () => {
    const { wrapper, src } = await openPicker()
    pressEnter(src, true)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('apply')).toBeUndefined()
    wrapper.unmount()
  })

  it('treats keyCode 229 as a composition', async () => {
    const { wrapper, alt } = await openPicker()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'keyCode', { value: 229 })
    alt.dispatchEvent(event)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('apply')).toBeUndefined()
    wrapper.unmount()
  })

  it('still applies on an ordinary Enter', async () => {
    const { wrapper, alt } = await openPicker()
    pressEnter(alt, false)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('apply')).toEqual([[{ src: 'https://x.com/a.png', alt: '中文' }]])
    wrapper.unmount()
  })
})
