import type { LightboxImage } from './index.js'

export interface Viewer {
  close: (restoreFocus?: boolean) => void
}
interface ScrollLock {
  count: number
  overflow: string
  priority: string
}
interface ActiveViewer {
  element: HTMLElement
  focus: () => void
}

const locks = new WeakMap<HTMLElement, ScrollLock>()
const stacks = new WeakMap<Document, ActiveViewer[]>()

function lockBody(body: HTMLElement | null): () => void {
  if (!body) return () => {}
  const state = locks.get(body) ?? {
    count: 0,
    overflow: body.style.getPropertyValue('overflow'),
    priority: body.style.getPropertyPriority('overflow'),
  }
  state.count++
  locks.set(body, state)
  body.style.setProperty('overflow', 'hidden')
  let released = false
  return () => {
    if (released) return
    released = true
    state.count--
    if (state.count !== 0) return
    locks.delete(body)
    if (state.overflow) body.style.setProperty('overflow', state.overflow, state.priority)
    else body.style.removeProperty('overflow')
  }
}

function style(element: HTMLElement, values: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, values)
}

/** All DOM access is scoped to this call; importing this module is safe in Node. */
export function openViewer(
  document: Document,
  images: LightboxImage[],
  initial: number,
  origin: HTMLImageElement,
  onClose: () => void,
): Viewer {
  const body = document.body
  const previousFocus = document.activeElement as HTMLElement | null
  const overlay = document.createElement('div')
  overlay.setAttribute('data-nd-lightbox', '')
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.tabIndex = -1
  style(overlay, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147480000',
    display: 'grid',
    placeItems: 'center',
    padding: '56px 48px 64px',
    boxSizing: 'border-box',
    background: 'rgba(12,14,18,.94)',
    color: '#fff',
    touchAction: 'pan-y',
    overscrollBehavior: 'contain',
    fontFamily: 'system-ui,sans-serif',
  })

  const image = document.createElement('img')
  image.draggable = false
  style(image, {
    maxWidth: '100%',
    maxHeight: 'calc(100vh - 128px)',
    objectFit: 'contain',
    borderRadius: '8px',
  })
  const status = document.createElement('p')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  style(status, {
    position: 'absolute',
    left: '20px',
    right: '20px',
    bottom: 'max(16px, env(safe-area-inset-bottom))',
    margin: '0',
    textAlign: 'center',
    overflowWrap: 'anywhere',
    fontSize: '14px',
  })
  function control(label: string, text: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.textContent = text
    style(button, {
      position: 'absolute',
      display: 'grid',
      placeItems: 'center',
      minWidth: '40px',
      minHeight: '40px',
      padding: '4px 10px',
      border: '1px solid rgba(255,255,255,.35)',
      borderRadius: '50%',
      background: 'rgba(20,22,26,.8)',
      color: '#fff',
      font: '28px system-ui,sans-serif',
      cursor: 'pointer',
      outlineOffset: '4px',
    })
    return button
  }
  const closeButton = control('关闭', '×')
  style(closeButton, {
    right: 'max(12px, env(safe-area-inset-right))',
    top: 'max(12px, env(safe-area-inset-top))',
  })
  const previous = control('上一张', '‹')
  const next = control('下一张', '›')
  style(previous, { left: 'max(4px, env(safe-area-inset-left))', top: '50%', transform: 'translateY(-50%)' })
  style(next, { right: 'max(4px, env(safe-area-inset-right))', top: '50%', transform: 'translateY(-50%)' })
  overlay.append(image, closeButton, status)
  if (images.length > 1) overlay.append(previous, next)
  let index = initial
  let closed = false
  let touchStart: { x: number; y: number } | null = null
  const stack = stacks.get(document) ?? []
  stacks.set(document, stack)
  const entry: ActiveViewer = {
    element: overlay,
    focus: () => closeButton.focus({ preventScroll: true }),
  }
  const isTop = () => stack.at(-1) === entry

  function show(): void {
    const current = images[index]!
    image.src = current.full || current.url
    image.alt = current.title || ''
    overlay.setAttribute('aria-label', current.title || '查看大图')
    status.textContent = (current.title ? current.title + ' · ' : '') +
      (images.length > 1 ? String(index + 1) + ' / ' + String(images.length) : '')
  }
  function move(step: number): void {
    if (closed || images.length === 1) return
    index = (index + step + images.length) % images.length
    show()
  }
  function close(restoreFocus = true): void {
    if (closed) return
    const wasTop = isTop()
    closed = true
    const position = stack.indexOf(entry)
    if (position !== -1) stack.splice(position, 1)
    overlay.remove()
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('focusin', onFocus)
    unlock()
    onClose()
    const top = stack.at(-1)
    if (top) {
      top.element.removeAttribute('aria-hidden')
      top.element.inert = false
    } else {
      stacks.delete(document)
    }
    if (!restoreFocus || !wasTop) return
    if (top) top.focus()
    else if (previousFocus?.isConnected && previousFocus !== body) previousFocus.focus({ preventScroll: true })
    else if (origin.isConnected) origin.focus({ preventScroll: true })
  }
  function onKey(event: KeyboardEvent): void {
    if (closed || !isTop() || event.defaultPrevented) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    } else if (event.key === 'Tab') {
      const controls = images.length > 1 ? [closeButton, previous, next] : [closeButton]
      const current = controls.indexOf(document.activeElement as HTMLButtonElement)
      const nextIndex = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      event.preventDefault()
      controls[nextIndex]!.focus({ preventScroll: true })
    }
  }
  function onFocus(event: FocusEvent): void {
    if (closed || !isTop() || overlay.contains(event.target as Node | null)) return
    entry.focus()
  }
  overlay.addEventListener('click', event => { if (event.target === overlay && isTop()) close() })
  closeButton.addEventListener('click', () => close())
  previous.addEventListener('click', () => move(-1))
  next.addEventListener('click', () => move(1))
  overlay.addEventListener('touchstart', event => {
    touchStart = event.touches.length === 1
      ? { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY }
      : null
  }, { passive: true })
  overlay.addEventListener('touchend', event => {
    const start = touchStart
    touchStart = null
    if (!start || event.changedTouches.length !== 1) return
    const touch = event.changedTouches[0]!
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx > 0 ? -1 : 1)
  }, { passive: true })
  overlay.addEventListener('touchcancel', () => { touchStart = null }, { passive: true })

  const prior = stack.at(-1)
  if (prior) {
    prior.element.setAttribute('aria-hidden', 'true')
    prior.element.inert = true
  }
  stack.push(entry)
  const unlock = lockBody(body)
  show()
  body.append(overlay)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('focusin', onFocus)
  entry.focus()
  return { close }
}
