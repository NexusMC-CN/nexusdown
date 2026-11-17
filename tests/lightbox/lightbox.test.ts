import { afterEach, describe, expect, it } from 'vitest'
import { mountImageLightbox, type LightboxImage } from '../../src/lightbox/index.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  document.body.replaceChildren()
  document.body.style.overflow = ''
})
function host(html: string): HTMLElement {
  const root = document.createElement('article')
  root.innerHTML = html
  document.body.append(root)
  return root
}
function activate(root: HTMLElement, onOpen?: (images: LightboxImage[], index: number) => void) {
  const cleanup = mountImageLightbox(root, onOpen ? { onOpen } : undefined)
  cleanups.push(cleanup)
  return cleanup
}
function picture(root: ParentNode, index = 0): HTMLImageElement {
  return root.querySelectorAll('img[data-nd-image]')[index] as HTMLImageElement
}
function key(target: Element, value: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}
function dialog(): HTMLElement {
  const element = document.querySelector('[role=dialog]') as HTMLElement | null
  expect(element).not.toBeNull()
  return element!
}
function button(label: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label)
  expect(found).toBeDefined()
  return found!
}
function touch(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true })
  const point = { clientX: x, clientY: y }
  Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', { value: [point] })
  target.dispatchEvent(event)
}
describe('image activation', () => {
  it('groups only eligible images inside this root and preserves the selected index', () => {
    host('<img data-nd-image src="/outside.png">')
    const root = host('<img data-nd-image src="/a.png" alt="A"><a href="/link"><img data-nd-image src="/linked.png"></a><img src="/card.png"><span class="nd-mention-card"><img data-nd-image src="/mention.png"></span><img data-nd-image src="/b.png" data-nd-full="/original.png" title="B">')
    const seen: { images: LightboxImage[]; index: number }[] = []
    activate(root, (images, index) => seen.push({ images, index }))
    picture(root, 3).click()
    expect(seen).toEqual([{ images: [{ url: '/a.png', title: 'A' }, { url: '/b.png', full: '/original.png', title: 'B' }], index: 1 }])
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })
  it('makes marked images keyboard operable and restores their original attributes', () => {
    const root = host('<img data-nd-image src="/a.png" alt="示例">')
    const calls: number[] = []
    const cleanup = activate(root, (_images, index) => calls.push(index))
    expect(picture(root).getAttribute('tabindex')).toBe('0')
    expect(picture(root).getAttribute('role')).toBe('button')
    expect(key(picture(root), 'Enter').defaultPrevented).toBe(true)
    expect(key(picture(root), ' ').defaultPrevented).toBe(true)
    expect(calls).toEqual([0, 0])
    cleanup()
    cleanup()
    expect(picture(root).hasAttribute('tabindex')).toBe(false)
    expect(picture(root).hasAttribute('role')).toBe(false)
    picture(root).click()
    expect(calls).toHaveLength(2)
  })
  it('does not intercept links, modified clicks, cards or editable content', () => {
    const root = host('<a href="#destination"><img data-nd-image src="/linked.png"></a><img data-nd-image src="/a.png"><div class="nd-card"><img data-nd-image src="/card.png"></div><div contenteditable="true"><img data-nd-image src="/editing.png"></div><div class="cm-editor"><img data-nd-image src="/cm.png"></div>')
    const calls: number[] = []
    activate(root, (_images, index) => calls.push(index))
    const linked = new MouseEvent('click', { bubbles: true, cancelable: true })
    picture(root).dispatchEvent(linked)
    expect(linked.defaultPrevented).toBe(false)
    picture(root, 1).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    picture(root, 2).click()
    picture(root, 3).click()
    picture(root, 4).click()
    expect(calls).toEqual([])
  })
  it('reads replaced content and enhances newly inserted images', async () => {
    const root = host('<img data-nd-image src="/old.png">')
    const seen: LightboxImage[][] = []
    const cleanup = activate(root, images => seen.push(images))
    root.innerHTML = '<img data-nd-image src="/new.png" alt="New"><img data-nd-image src="/second.png">'
    await Promise.resolve()
    expect(picture(root).tabIndex).toBe(0)
    key(picture(root, 1), 'Enter')
    expect(seen).toEqual([[{ url: '/new.png', title: 'New' }, { url: '/second.png', title: '' }]])
    cleanup()
    expect(picture(root).hasAttribute('tabindex')).toBe(false)
  })
  it('replaces a duplicate root mount without duplicate callbacks or stale cleanup', () => {
    const root = host('<img data-nd-image src="/a.png">')
    const seen: string[] = []
    const oldCleanup = activate(root, () => seen.push('old'))
    activate(root, () => seen.push('new'))
    oldCleanup()
    picture(root).click()
    expect(seen).toEqual(['new'])
  })
})
describe('default viewer', () => {
  it('opens, moves with buttons and keys, closes, and restores focus and scrolling', () => {
    document.body.style.overflow = 'scroll'
    const root = host('<img data-nd-image src="/a.png" alt="First"><img data-nd-image src="/b.png" alt="Second">')
    activate(root)
    picture(root).focus()
    picture(root).click()
    expect(dialog().querySelector('img')!.getAttribute('src')).toBe('/a.png')
    expect(dialog().contains(document.activeElement)).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    button('下一张').click()
    expect(dialog().querySelector('img')!.getAttribute('src')).toBe('/b.png')
    key(dialog(), 'ArrowRight')
    expect(dialog().querySelector('img')!.getAttribute('src')).toBe('/a.png')
    key(dialog(), 'Escape')
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(document.body.style.overflow).toBe('scroll')
    expect(document.activeElement).toBe(picture(root))
  })
  it('keeps focus in the viewer and supports touch paging without a vertical swipe', () => {
    const root = host('<img data-nd-image src="/a.png"><img data-nd-image src="/b.png">')
    activate(root)
    picture(root).click()
    const close = button('关闭')
    close.focus()
    key(close, 'Tab', { shiftKey: true })
    expect(dialog().contains(document.activeElement)).toBe(true)
    touch(dialog(), 'touchstart', 180, 40)
    touch(dialog(), 'touchend', 40, 45)
    expect(dialog().querySelector('img')!.getAttribute('src')).toBe('/b.png')
    touch(dialog(), 'touchstart', 180, 40)
    touch(dialog(), 'touchend', 160, 180)
    expect(dialog().querySelector('img')!.getAttribute('src')).toBe('/b.png')
  })
  it('hides paging controls for a single image and does not close on image clicks', () => {
    const root = host('<img data-nd-image src="/a.png">')
    activate(root)
    picture(root).click()
    expect([...dialog().querySelectorAll('button')].filter(item => item.textContent !== '×' && item.getAttribute('aria-label') !== '关闭')).toHaveLength(0)
    dialog().querySelector('img')!.click()
    expect(document.querySelector('[role=dialog]')).not.toBeNull()
    dialog().click()
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })
  it('owns its scroll lock across two roots and closes on content replacement', async () => {
    document.body.style.overflow = 'auto'
    const first = host('<img data-nd-image src="/a.png">')
    const second = host('<img data-nd-image src="/b.png">')
    const disposeFirst = activate(first)
    const disposeSecond = activate(second)
    picture(first).click()
    picture(second).click()
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(2)
    disposeFirst()
    expect(document.body.style.overflow).toBe('hidden')
    second.replaceChildren()
    await Promise.resolve()
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(0)
    expect(document.body.style.overflow).toBe('auto')
    disposeFirst()
    disposeSecond()
    expect(document.body.style.overflow).toBe('auto')
  })
  it('keeps viewing motion-free, including reduced motion users', () => {
    const root = host('<img data-nd-image src="/a.png">')
    activate(root)
    picture(root).click()
    expect(dialog().getAnimations?.() ?? []).toHaveLength(0)
    button('关闭').click()
    expect(document.querySelector('[role=dialog]')).toBeNull()
  })
})

describe('mount ownership and source changes', () => {
  it('synchronizes its generated label with image metadata and restores it on cleanup', async () => {
    const root = host('<img data-nd-image src="/a.png" alt="Original">')
    const dispose = activate(root, () => {})
    const image = picture(root)
    expect(image.getAttribute('aria-label')).toBe('查看大图：Original')
    image.alt = 'Updated alt'
    await Promise.resolve()
    expect(image.getAttribute('aria-label')).toBe('查看大图：Updated alt')
    image.title = 'Preferred title'
    await Promise.resolve()
    expect(image.getAttribute('aria-label')).toBe('查看大图：Preferred title')
    image.alt = 'Latest alt'
    await Promise.resolve()
    expect(image.getAttribute('aria-label')).toBe('查看大图：Preferred title')
    image.removeAttribute('title')
    await Promise.resolve()
    expect(image.getAttribute('aria-label')).toBe('查看大图：Latest alt')
    image.removeAttribute('alt')
    await Promise.resolve()
    expect(image.getAttribute('aria-label')).toBe('查看大图')
    dispose()
    expect(image.hasAttribute('aria-label')).toBe(false)
  })
  it('preserves an initial host label when image metadata changes', async () => {
    const root = host('<img data-nd-image src="/a.png" alt="Original" aria-label="Host label">')
    const dispose = activate(root, () => {})
    const image = picture(root)
    image.alt = 'Updated alt'
    image.title = 'Updated title'
    await Promise.resolve()
    expect(image.getAttribute('aria-label')).toBe('Host label')
    dispose()
    expect(image.getAttribute('aria-label')).toBe('Host label')
  })
  it.each([
    { name: 'replacement', value: 'Host override' },
    { name: 'removal', value: null },
  ])('preserves later host label $name during metadata refresh and cleanup', async ({ value }) => {
    const root = host('<img data-nd-image src="/a.png" alt="Original">')
    const dispose = activate(root, () => {})
    const image = picture(root)
    if (value === null) image.removeAttribute('aria-label')
    else image.setAttribute('aria-label', value)
    image.alt = 'Updated alt'
    await Promise.resolve()
    expect(image.getAttribute('aria-label')).toBe(value)
    image.title = 'Updated title'
    await Promise.resolve()
    expect(image.getAttribute('aria-label')).toBe(value)
    dispose()
    expect(image.getAttribute('aria-label')).toBe(value)
  })
  it('keeps a live nested root enhanced when the outer mount is disposed first', () => {
    const outer = host('<img data-nd-image src=/outer.png><section><img data-nd-image src=/inner.png></section>')
    const inner = outer.querySelector('section')!
    const calls: string[] = []
    const disposeOuter = activate(outer, () => calls.push('outer'))
    const disposeInner = activate(inner, () => calls.push('inner'))
    disposeOuter()
    expect(picture(inner).tabIndex).toBe(0)
    expect(picture(inner).getAttribute('role')).toBe('button')
    key(picture(inner), 'Enter')
    expect(calls).toEqual(['inner'])
    disposeInner()
    expect(picture(inner).hasAttribute('tabindex')).toBe(false)
    expect(picture(inner).hasAttribute('role')).toBe(false)
  })
  it('retains nested keyboard access after the outer mount refreshes', async () => {
    const outer = host('<img data-nd-image src=/outer.png><section><img data-nd-image src=/inner.png></section>')
    const inner = outer.querySelector('section')!
    const calls: string[] = []
    activate(outer, () => calls.push('outer'))
    activate(inner, () => calls.push('inner'))
    picture(outer).src = '/changed-outer.png'
    await Promise.resolve()
    expect(picture(inner).tabIndex).toBe(0)
    expect(picture(inner).getAttribute('role')).toBe('button')
    key(picture(inner), 'Enter')
    expect(calls).toEqual(['inner'])
  })
  it('does not activate nested mounts twice and restores both mount enhancements', () => {
    const outer = host('<img data-nd-image src="/outer.png"><section><img data-nd-image src="/inner.png"></section>')
    const inner = outer.querySelector('section')!
    const calls: string[] = []
    const outerDispose = activate(outer, () => calls.push('outer'))
    const innerDispose = activate(inner, () => calls.push('inner'))
    picture(inner).click()
    expect(calls).toEqual(['inner'])
    innerDispose()
    picture(inner).click()
    expect(calls).toEqual(['inner', 'outer'])
    outerDispose()
    expect(picture(inner).hasAttribute('tabindex')).toBe(false)
    expect(picture(inner).hasAttribute('role')).toBe(false)
  })
  it('keeps author supplied accessibility attributes and later host edits', () => {
    const root = host('<img data-nd-image src="/a.png" tabindex="2" role="img" aria-label="original" style="cursor:crosshair">')
    const dispose = activate(root, () => {})
    expect(picture(root).tabIndex).toBe(2)
    expect(picture(root).getAttribute('role')).toBe('img')
    picture(root).setAttribute('aria-label', 'host label')
    picture(root).style.cursor = 'pointer'
    dispose()
    expect(picture(root).getAttribute('aria-label')).toBe('host label')
    expect(picture(root).style.cursor).toBe('pointer')
    expect(picture(root).tabIndex).toBe(2)
  })
  it('closes a stale default viewer when an existing image source changes', async () => {
    const root = host('<img data-nd-image src="/a.png">')
    activate(root)
    picture(root).click()
    expect(document.body.style.overflow).toBe('hidden')
    picture(root).src = '/replacement.png'
    await Promise.resolve()
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    picture(root).click()
    expect(dialog().querySelector('img')!.getAttribute('src')).toBe('/replacement.png')
  })
  it('lets only the top viewer consume Escape and restores the underlying viewer', () => {
    const first = host('<img data-nd-image src="/a.png">')
    const second = host('<img data-nd-image src="/b.png">')
    activate(first)
    activate(second)
    picture(first).click()
    picture(second).click()
    const overlays = [...document.querySelectorAll('[role=dialog]')]
    expect(overlays[0]!.getAttribute('aria-hidden')).toBe('true')
    key(overlays[1]!, 'Escape')
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1)
    expect(dialog().hasAttribute('aria-hidden')).toBe(false)
    expect(dialog().contains(document.activeElement)).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    key(dialog(), 'Escape')
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })
  it('does not forward unsafe image schemes or unsafe original URLs', () => {
    const root = host('<img data-nd-image src="javascript:alert(1)"><img data-nd-image src="/a.png" data-nd-full="data:text/html,unsafe">')
    const seen: LightboxImage[][] = []
    activate(root, images => seen.push(images))
    picture(root).click()
    expect(seen).toHaveLength(0)
    picture(root, 1).click()
    expect(seen).toEqual([[{ url: '/a.png', title: '' }]])
  })
})
