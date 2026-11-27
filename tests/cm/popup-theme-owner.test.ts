// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inheritPopupTheme } from '../../src/cm/util/popup-theme.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose())
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
function elements() {
  const scope = document.body.appendChild(document.createElement('section'))
  const owner = scope.appendChild(document.createElement('div'))
  owner.style.setProperty('--nd-brand', '#123456')
  const popup = document.createElement('div')
  return { scope, owner, popup }
}
function bind(owner: HTMLElement, popup: HTMLElement) {
  const dispose = inheritPopupTheme(owner, popup)
  cleanups.push(dispose)
  popup.ownerDocument.body.append(popup)
  return dispose
}

describe('popup theme owner boundary', () => {
  it('preserves popup inline overrides present before binding or applied while open', async () => {
    const { owner, popup } = elements()
    popup.style.setProperty('--nd-brand', '#fedcba')
    popup.style.fontSize = '12px'
    popup.style.top = '45px'
    popup.setAttribute('data-nexusdown-skin', 'popup-skin')
    bind(owner, popup)
    owner.style.setProperty('--nd-brand', '#abcdef')
    owner.setAttribute('data-nexusdown-skin', 'owner-skin')
    popup.style.lineHeight = '40px'
    await settle()
    expect(popup.style.getPropertyValue('--nd-brand')).toBe('#fedcba')
    expect(popup.style.fontSize).toBe('12px')
    expect(popup.style.lineHeight).toBe('40px')
    expect(popup.style.top).toBe('45px')
    expect(popup.getAttribute('data-nexusdown-skin')).toBe('popup-skin')
  })

  // An initially absent owner value must not overwrite a popup's later choice.
  it('preserves popup overrides added before a new owner variable or skin first appears', async () => {
    const { owner, popup } = elements()
    bind(owner, popup)
    popup.style.setProperty('--nd-later', 'popup-value')
    popup.setAttribute('data-nexusdown-skin', 'popup-skin')
    owner.style.setProperty('--nd-later', 'owner-value')
    owner.setAttribute('data-nexusdown-skin', 'owner-skin')
    await settle()
    expect(popup.style.getPropertyValue('--nd-later')).toBe('popup-value')
    expect(popup.getAttribute('data-nexusdown-skin')).toBe('popup-skin')
  })

  it('uses the closest skin, including an explicit empty marker, after owner reparenting', async () => {
    const { scope, owner, popup } = elements()
    scope.setAttribute('data-nexusdown-skin', 'outer')
    owner.setAttribute('data-nexusdown-skin', '')
    bind(owner, popup)
    expect(popup.getAttribute('data-nexusdown-skin')).toBe('')
    owner.removeAttribute('data-nexusdown-skin')
    await settle()
    expect(popup.getAttribute('data-nexusdown-skin')).toBe('outer')
    const next = document.body.appendChild(document.createElement('section'))
    next.setAttribute('data-nexusdown-skin', 'next')
    next.append(owner)
    await settle()
    expect(popup.getAttribute('data-nexusdown-skin')).toBe('next')
    next.setAttribute('data-nexusdown-skin', 'updated')
    await settle()
    expect(popup.getAttribute('data-nexusdown-skin')).toBe('updated')
  })

  it('reads computed values from the owner document window', () => {
    const frame = document.body.appendChild(document.createElement('iframe'))
    const frameDocument = frame.contentDocument!
    const owner = frameDocument.body.appendChild(frameDocument.createElement('div'))
    owner.style.setProperty('--nd-brand', '#abcdef')
    const popup = frameDocument.createElement('div')
    const outerRead = vi.spyOn(window, 'getComputedStyle')
    bind(owner, popup)
    expect(popup.style.getPropertyValue('--nd-brand')).toBe('#abcdef')
    expect(outerRead).not.toHaveBeenCalled()
  })

  it('stops all owner style reads after idempotent disposal, including pending mutation delivery', async () => {
    const { owner, popup } = elements()
    const dispose = bind(owner, popup)
    const read = vi.spyOn(window, 'getComputedStyle')
    owner.style.setProperty('--nd-brand', '#abcdef')
    dispose()
    dispose()
    await settle()
    owner.style.setProperty('--nd-brand', '#fedcba')
    await settle()
    expect(popup.style.getPropertyValue('--nd-brand')).toBe('#123456')
    expect(read).not.toHaveBeenCalled()
  })
})
