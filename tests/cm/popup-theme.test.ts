// @vitest-environment jsdom
import { forceParsing } from '@codemirror/language'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mountEditor } from '../../src/cm/mount.js'

const cleanup: (() => void)[] = []
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose())
  vi.restoreAllMocks()
  document.body.replaceChildren()
  document.head.querySelectorAll('[data-popup-test]').forEach(element => element.remove())
})

async function openEditor(color = '#123456', skin = 'test-skin') {
  const parent = document.body.appendChild(document.createElement('section'))
  parent.setAttribute('data-nexusdown-skin', skin)
  const view = mountEditor({ parent, doc: 'intro\n\n| A | B |\n| --- | --- |\n| a | b |\n\ntail' })
  cleanup.push(() => view.destroy())
  Object.assign(view.dom.style, {
    fontFamily: 'monospace', fontSize: '19px', lineHeight: '27px', direction: 'rtl', colorScheme: 'dark', width: '500px',
  })
  view.dom.style.setProperty('--nd-brand', color)
  view.dom.style.setProperty('--nd-surface', '#203040')
  expect(forceParsing(view, view.state.doc.length, 1000)).toBe(true)
  // jsdom has no layout; only the coordinates are supplied. Parsing, DOM events,
  // menu actions and MutationObserver delivery remain real.
  vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 20, right: 30, top: 80, bottom: 100 })
  const button = view.dom.querySelector<HTMLButtonElement>('.nd-variant-hover')!
  async function open() {
    const widget = view.dom.querySelector<HTMLElement>('.nd-table')!
    widget.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 140))
    expect(button.hidden).toBe(false)
    button.click()
    const menu = document.body.querySelector<HTMLElement>('.nd-variant-menu')!
    expect(menu).not.toBeNull()
    return menu
  }
  return { view, parent, open, menu: await open() }
}

async function flushTheme() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('detached variant popup themes', () => {
  // A direct body append without an owner theme bridge loses these values.
  it('inherits the owning editor theme before showing the menu, without copying geometry', async () => {
    const { menu } = await openEditor()
    expect(menu.parentElement).toBe(document.body)
    expect(menu.style.getPropertyValue('--nd-brand')).toBe('#123456')
    expect(menu.style.getPropertyValue('--nd-surface')).toBe('#203040')
    expect(menu.getAttribute('data-nexusdown-skin')).toBe('test-skin')
    expect(menu.style.fontFamily).toBe('monospace')
    expect(menu.style.fontSize).toBe('19px')
    expect(menu.style.lineHeight).toBe('27px')
    expect(menu.style.direction).toBe('rtl')
    expect(menu.style.colorScheme).toBe('dark')
    expect(menu.style.width).toBe('')
    expect(menu.style.top).not.toBe('')
  })

  it('refreshes on arbitrary ancestor attributes and removes vanished variables and skin markers', async () => {
    const style = document.head.appendChild(document.createElement('style'))
    style.dataset.popupTest = ''
    style.textContent = '[data-palette="alternate"] .cm-editor { --nd-live: #fedcba; }'
    const { parent, view, menu } = await openEditor()
    parent.dataset.palette = 'alternate'
    await flushTheme()
    expect(menu.style.getPropertyValue('--nd-live')).toBe('#fedcba')
    view.dom.style.setProperty('--nd-brand', '#654321')
    parent.setAttribute('data-nexusdown-skin', 'changed')
    await flushTheme()
    expect(menu.style.getPropertyValue('--nd-brand')).toBe('#654321')
    expect(menu.getAttribute('data-nexusdown-skin')).toBe('changed')
    parent.removeAttribute('data-palette')
    parent.removeAttribute('data-nexusdown-skin')
    view.dom.style.removeProperty('--nd-surface')
    await flushTheme()
    expect(menu.style.getPropertyValue('--nd-live')).toBe('')
    expect(menu.style.getPropertyValue('--nd-surface')).toBe('')
    expect(menu.hasAttribute('data-nexusdown-skin')).toBe(false)
  })

  it('keeps different owners isolated, including a toast after its menu closes', async () => {
    const first = await openEditor('#112233', 'first')
    first.menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click()
    const toast = document.body.querySelector<HTMLElement>('.nd-variant-toast')!
    const second = await openEditor('#aabbcc', 'second')
    expect(toast.style.getPropertyValue('--nd-brand')).toBe('#112233')
    expect(second.menu.style.getPropertyValue('--nd-brand')).toBe('#aabbcc')
    first.view.dom.style.setProperty('--nd-brand', '#445566')
    await flushTheme()
    expect(toast.style.getPropertyValue('--nd-brand')).toBe('#445566')
    expect(second.menu.style.getPropertyValue('--nd-brand')).toBe('#aabbcc')
    expect(toast.getAttribute('data-nexusdown-skin')).toBe('first')
    expect(second.menu.getAttribute('data-nexusdown-skin')).toBe('second')
  })

  it('stops updating closed menus across repeated openings', async () => {
    const editor = await openEditor()
    const closed = [editor.menu]
    for (let index = 0; index < 3; index++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(closed.at(-1)!.isConnected).toBe(false)
      const menu = await editor.open()
      expect(menu.style.getPropertyValue('--nd-brand')).toBe('#123456')
      closed.push(menu)
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    editor.view.dom.style.setProperty('--nd-brand', '#abcdef')
    await flushTheme()
    for (const menu of closed) expect(menu.style.getPropertyValue('--nd-brand')).toBe('#123456')
  })

  it('removes active toasts and menus when their editor is destroyed', async () => {
    const editor = await openEditor()
    editor.menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click()
    const toast = document.body.querySelector<HTMLElement>('.nd-variant-toast')!
    expect(toast.isConnected).toBe(true)
    editor.view.destroy()
    expect(toast.isConnected).toBe(false)
    editor.view.dom.style.setProperty('--nd-brand', '#ffffff')
    await flushTheme()
    expect(toast.style.getPropertyValue('--nd-brand')).toBe('#123456')
  })

  it('expires toast themes and does not retain a detached owner', async () => {
    const editor = await openEditor()
    editor.menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click()
    const toast = document.body.querySelector<HTMLElement>('.nd-variant-toast')!
    await new Promise(resolve => setTimeout(resolve, 1450))
    expect(toast.isConnected).toBe(false)
    editor.view.dom.style.setProperty('--nd-brand', '#ffffff')
    await flushTheme()
    expect(toast.style.getPropertyValue('--nd-brand')).toBe('#123456')
    const menu = await editor.open()
    editor.parent.remove()
    await flushTheme()
    expect(menu.isConnected).toBe(false)
  })

  it('releases document close handlers when the owner is removed before view.destroy', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const editor = await openEditor()
    const closes = add.mock.calls.filter(([type]) => type === 'pointerdown' || type === 'keydown')
    expect(closes).toHaveLength(2)
    const remove = vi.spyOn(document, 'removeEventListener')
    editor.parent.remove()
    await flushTheme()
    expect(editor.menu.isConnected).toBe(false)
    // These spies forward to the real document: the exact listeners installed
    // by the live menu must be released along with its theme observer.
    for (const [type, listener] of closes) expect(remove).toHaveBeenCalledWith(type, listener)
  })
})
