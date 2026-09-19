/**
 * Teleport target resolution for overlay UI (menus, pickers, popovers).
 *
 * Overlays are teleported to `document.body` so they escape the editor's
 * `overflow: hidden` containers and stacking contexts. Inside a native modal
 * dialog opened with `showModal()`, however, the body is *outside* the dialog's
 * top layer: the browser makes everything else inert, so a menu teleported there
 * is painted behind the dialog, cannot be focused, and its buttons do not
 * respond. Teleporting into the dialog element itself keeps the overlay in the
 * top layer while still escaping the editor's own containment.
 */

/**
 * The element an overlay should be teleported into.
 *
 * Returns the nearest already-teleported overlay root inside an open modal,
 * otherwise the modal `<dialog>` itself, or `document.body` when there is none.
 * Safe to call during SSR: it returns `'body'` when no document exists.
 *
 * Note: an overlay teleported to `body` sits outside `.nexusdown-editor`, which
 * is where the `--nexus-*` theme variables are declared. Teleporting *into* the
 * editor is not an option — it sets `overflow: hidden`, so a `position: fixed`
 * menu would be clipped. The caller instead mirrors the active theme onto the
 * overlay element itself; see `nexusdownThemeVariables`.
 *
 * @param anchor - Element to start the search from, normally the overlay's trigger.
 */
export function resolveOverlayTarget(anchor: Element | null | undefined): string | Element {
  if (typeof document === 'undefined') return 'body'
  const dialog = anchor?.closest?.('dialog')
  // `:modal` matches only dialogs opened with `showModal()`; a non-modal dialog
  // does not create a top layer, so `body` remains correct and less surprising.
  if (dialog instanceof HTMLDialogElement && dialog.matches(':modal')) {
    // Keep nested pickers inside their already-teleported parent. Sending both
    // Teleports to the same modal target leaves Vue with sibling anchor ranges
    // to reconcile when the parent closes.
    return anchor?.closest?.('[data-nexusdown-overlay-root]') ?? dialog
  }
  return 'body'
}

/**
 * Whether an overlay teleported to `body` would be blocked by a modal dialog.
 *
 * Exposed so callers can assert the condition in tests without a real browser.
 */
export function isBehindModalDialog(anchor: Element | null | undefined): boolean {
  return typeof document !== 'undefined' && resolveOverlayTarget(anchor) !== 'body'
}

/** An overlay root or one of its descendants, including another document realm. */
export function isNexusdownOverlayTarget(target: EventTarget | null): boolean {
  const element = target as Element | null
  const ElementClass = element?.ownerDocument?.defaultView?.Element
  return Boolean(ElementClass && element instanceof ElementClass && element.closest('[data-nexusdown-overlay-root]'))
}

/**
 * Read all resolved `--nexus-*` values and inherited typography from the editor.
 * Enumerating computed properties also carries tokens introduced by host skins
 * without coupling Nexusdown to any particular skin or component library.
 *
 * Returns `null` when there is no editor ancestor, no document, or no computed
 * styles available, so callers can leave the overlay's styles untouched.
 *
 * @param anchor - Element to start the search from, normally the overlay trigger.
 */
export function nexusdownThemeVariables(anchor: Element | null | undefined): Record<string, string> | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  // A secondary picker can be rendered from an overflow menu that has already
  // been teleported out of the editor. In that case the overflow root is the
  // nearest theme bridge and carries the editor's mirrored variables.
  const scope = anchor?.closest?.('.nexusdown-editor, [data-nexusdown-overlay-root]')
  if (!scope) return null
  const view = scope.ownerDocument.defaultView
  if (!view?.getComputedStyle) return null
  const computed = view.getComputedStyle(scope)
  const variables: Record<string, string> = {}
  const names = ['font-family', 'font-size', 'line-height', 'color-scheme']
  for (let index = 0; index < computed.length; index++) {
    const name = computed.item(index)
    if (name.startsWith('--nexus-')) names.push(name)
  }
  for (const name of names) {
    const value = computed.getPropertyValue(name).trim()
    if (value) variables[name] = value
  }
  return Object.keys(variables).length > 0 ? variables : null
}
