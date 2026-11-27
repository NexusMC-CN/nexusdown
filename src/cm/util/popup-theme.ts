/**
 * Keep a body-mounted popup in its explicit owner's theme scope. Call before
 * insertion/measurement, and dispose when the popup closes. No layout styles
 * or application-specific theme conventions cross this boundary.
 */
export function inheritPopupTheme(owner: HTMLElement, popup: HTMLElement, onDetach?: () => void): () => void {
  const document = owner.ownerDocument
  const window = document.defaultView
  if (!window) return () => {}

  const inherited = new Map<string, string>()
  const explicit = new Set(Array.from(popup.style))
  let explicitSkin = popup.hasAttribute('data-nexusdown-skin')
  let inheritedSkin: string | null = null
  let disposed = false

  const sync = (): void => {
    const computed = window.getComputedStyle(owner)
    const values = new Map<string, string>()
    for (let index = 0; index < computed.length; index++) {
      const name = computed.item(index)
      if (name.startsWith('--nd-')) values.set(name, computed.getPropertyValue(name))
    }
    for (const name of ['font-family', 'font-size', 'line-height', 'direction', 'color-scheme']) {
      values.set(name, computed.getPropertyValue(name))
    }
    for (const name of new Set([...inherited.keys(), ...values.keys()])) {
      // Inline values provided by the popup, including changes made while open,
      // belong to that popup and take precedence over inherited values.
      const previous = inherited.get(name)
      const current = popup.style.getPropertyValue(name)
      if (previous === undefined ? current !== '' : current !== previous || popup.style.getPropertyPriority(name)) {
        explicit.add(name)
        inherited.delete(name)
      }
      if (explicit.has(name)) continue
      const value = values.get(name) ?? ''
      if (value) {
        if (popup.style.getPropertyValue(name) !== value) popup.style.setProperty(name, value)
        inherited.set(name, value)
      } else {
        if (inherited.has(name)) popup.style.removeProperty(name)
        inherited.delete(name)
      }
    }

    if (popup.getAttribute('data-nexusdown-skin') !== inheritedSkin) explicitSkin = true
    if (!explicitSkin) {
      const skin = owner.closest('[data-nexusdown-skin]')?.getAttribute('data-nexusdown-skin') ?? null
      if (skin !== null) popup.setAttribute('data-nexusdown-skin', skin)
      else if (inheritedSkin !== null) popup.removeAttribute('data-nexusdown-skin')
      inheritedSkin = skin
    }
  }

  const media = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)']
    .map(query => window.matchMedia?.(query))
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    for (const query of media) query?.removeEventListener('change', refresh)
  }
  const refresh = (): void => {
    if (disposed) return
    if (!owner.isConnected || !popup.isConnected) {
      dispose()
      onDetach?.()
      popup.remove()
      return
    }
    observeAncestors()
    sync()
  }
  const observer = new window.MutationObserver(refresh)
  const observeAncestors = (): void => {
    observer.disconnect()
    // Observe every attribute: themes may use class/style, data-theme, or an
    // arbitrary scoped-stylesheet identifier. Child lists catch removed or
    // reparented owners without observing popup writes or the whole subtree.
    for (let ancestor: HTMLElement | null = owner; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, childList: true })
    }
    observer.observe(document, { childList: true })
  }

  sync()
  observeAncestors()
  for (const query of media) query?.addEventListener('change', refresh)
  return dispose
}
