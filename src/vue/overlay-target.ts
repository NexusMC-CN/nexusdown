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
 * Returns the nearest open modal `<dialog>` ancestor, or `document.body` when
 * there is none. Safe to call during SSR: it returns `'body'` when no document
 * exists.
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
  if (dialog instanceof HTMLDialogElement && dialog.matches(':modal')) return dialog
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

/**
 * The theme variables an overlay must re-declare to match its editor.
 *
 * `--nexus-*` is declared on `.nexusdown-editor[data-nexusdown-theme]`, so an
 * overlay teleported to `body` resolves them against `:root` instead: a dark
 * editor would open a light menu, and a host's per-instance overrides would be
 * ignored.
 */
const THEME_VARIABLES = [
  '--nexus-bg',
  '--nexus-panel',
  '--nexus-border',
  '--nexus-text',
  '--nexus-muted',
  '--nexus-accent',
] as const

/**
 * Read the resolved `--nexus-*` values from `anchor`'s editor scope.
 *
 * Returns `null` when there is no editor ancestor, no document, or no computed
 * styles available, so callers can leave the overlay's styles untouched.
 *
 * @param anchor - Element to start the search from, normally the overlay trigger.
 */
export function nexusdownThemeVariables(anchor: Element | null | undefined): Record<string, string> | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  const scope = anchor?.closest?.('.nexusdown-editor')
  if (!scope) return null
  const view = document.defaultView
  if (!view?.getComputedStyle) return null
  const computed = view.getComputedStyle(scope)
  const variables: Record<string, string> = {}
  for (const name of THEME_VARIABLES) {
    const value = computed.getPropertyValue(name).trim()
    if (value) variables[name] = value
  }
  return Object.keys(variables).length > 0 ? variables : null
}
