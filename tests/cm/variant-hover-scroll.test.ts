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
})

async function openMenu() {
  const parent = document.body.appendChild(document.createElement('div'))
  parent.style.overflow = 'auto'
  const view = mountEditor({ parent, doc: 'intro\n\n| A | B |\n| --- | --- |\n| a | b |\n\ntail' })
  cleanup.push(() => view.destroy())
  expect(forceParsing(view, view.state.doc.length, 1000)).toBe(true)
  vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 20, right: 30, top: 80, bottom: 100 })
  const widget = view.dom.querySelector<HTMLElement>('.nd-table')!
  expect(widget).not.toBeNull()
  widget.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 140))
  const button = view.dom.querySelector<HTMLButtonElement>('.nd-variant-hover')!
  expect(button.hidden).toBe(false)
  button.click()
  expect(document.body.querySelector('[role="menu"][aria-label="块变体"]')).not.toBeNull()
  return { view, parent, button }
}

describe('block variant menus on scroll', () => {
  it.each(['ancestor', 'editor', 'window'] as const)('closes the body menu and hover handle when the %s scrolls', async target => {
    const { view, parent, button } = await openMenu()
    const scroller = target === 'ancestor' ? parent : target === 'editor' ? view.scrollDOM : window
    scroller.dispatchEvent(new Event('scroll'))
    expect(document.body.querySelector('[role="menu"][aria-label="块变体"]')).toBeNull()
    expect(button.hidden).toBe(true)
  })

  it('disposes an open menu and scroll handlers with the editor', async () => {
    const { view, parent } = await openMenu()
    view.destroy()
    parent.dispatchEvent(new Event('scroll'))
    expect(document.body.querySelector('[role="menu"][aria-label="块变体"]')).toBeNull()
    expect(parent.querySelector('.nd-variant-hover')).toBeNull()
  })
})
