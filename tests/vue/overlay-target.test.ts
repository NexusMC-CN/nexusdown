import { describe, expect, it } from 'vitest'
import { resolveOverlayTarget, isBehindModalDialog, nexusdownThemeVariables, isNexusdownOverlayTarget } from '../../src/vue/overlay-target'

describe('overlay chain membership', () => {
  it('recognizes roots and their descendants, but not unrelated or non-element targets', () => {
    const root = document.createElement('div')
    root.dataset.nexusdownOverlayRoot = ''
    const child = document.createElement('button')
    root.append(child)
    expect(isNexusdownOverlayTarget(root)).toBe(true)
    expect(isNexusdownOverlayTarget(child)).toBe(true)
    expect(isNexusdownOverlayTarget(document.body)).toBe(false)
    expect(isNexusdownOverlayTarget(document.createTextNode('text'))).toBe(false)
    expect(isNexusdownOverlayTarget(null)).toBe(false)
  })

  it('recognizes elements from another document realm', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    try {
      const root = frame.contentDocument!.createElement('div')
      root.dataset.nexusdownOverlayRoot = ''
      const child = frame.contentDocument!.createElement('button')
      root.append(child)
      expect(isNexusdownOverlayTarget(child)).toBe(true)
    } finally { frame.remove() }
  })
})

describe('overlay teleport target', () => {
  it('falls back to body outside any dialog', () => {
    const host = document.createElement('div')
    document.body.append(host)
    expect(resolveOverlayTarget(host)).toBe('body')
    expect(isBehindModalDialog(host)).toBe(false)
    host.remove()
  })

  it('falls back to body when there is no anchor', () => {
    expect(resolveOverlayTarget(null)).toBe('body')
    expect(resolveOverlayTarget(undefined)).toBe('body')
  })

  it('targets a non-modal dialog element from inside it', () => {
    // A plain `<dialog open>` creates no top layer, so `body` is still correct.
    const dialog = document.createElement('dialog')
    const inner = document.createElement('button')
    dialog.append(inner)
    document.body.append(dialog)
    expect(resolveOverlayTarget(inner)).toBe('body')
    dialog.remove()
  })

  it('targets the dialog when it is an open modal', () => {
    // Regression: overlays teleported to `body` land outside the dialog's top
    // layer, so the browser makes them inert — the menu is painted behind the
    // dialog, its inputs cannot be focused, and its buttons do not respond.
    const dialog = document.createElement('dialog')
    const inner = document.createElement('button')
    dialog.append(inner)
    document.body.append(dialog)

    // jsdom does not implement `showModal`, so emulate the two things the helper
    // relies on: the `:modal` match and a nested ancestor relationship.
    const originalMatches = dialog.matches.bind(dialog)
    dialog.matches = (selector: string) => (selector === ':modal' ? true : originalMatches(selector))

    expect(resolveOverlayTarget(inner)).toBe(dialog)
    expect(isBehindModalDialog(inner)).toBe(true)

    // A non-dialog ancestor still resolves to body.
    const outside = document.createElement('div')
    document.body.append(outside)
    expect(resolveOverlayTarget(outside)).toBe('body')

    dialog.remove()
    outside.remove()
  })

  it('copies the editor theme variables for an overlay teleported to body', () => {
    // Regression: `--nexus-*` is declared on `.nexusdown-editor[data-nexusdown-theme]`
    // and nowhere else, so an overlay teleported to `body` resolved them against
    // `:root` instead: a dark editor opened a light menu, and a host's
    // per-instance overrides were ignored. The overlay cannot be teleported into
    // the editor either, because the editor sets `overflow: hidden`. So the
    // resolved values are mirrored onto the overlay element.
    const editor = document.createElement('section')
    editor.className = 'nexusdown-editor'
    editor.setAttribute('data-nexusdown-theme', 'dark')
    editor.style.setProperty('--nexus-bg', 'rgb(17, 24, 39)')
    editor.style.setProperty('--nexus-text', 'rgb(229, 231, 235)')
    const trigger = document.createElement('button')
    editor.append(trigger)
    document.body.append(editor)

    const variables = nexusdownThemeVariables(trigger)
    expect(variables).not.toBeNull()
    expect(variables?.['--nexus-bg']).toBe('rgb(17, 24, 39)')
    expect(variables?.['--nexus-text']).toBe('rgb(229, 231, 235)')

    editor.remove()
  })

  it('reports no theme variables outside an editor scope', () => {
    const host = document.createElement('div')
    document.body.append(host)
    expect(nexusdownThemeVariables(host)).toBeNull()
    expect(nexusdownThemeVariables(null)).toBeNull()
    host.remove()
  })

  it('copies custom skin tokens and typography without leaking unrelated properties', () => {
    const editor = document.createElement('section')
    editor.className = 'nexusdown-editor'
    editor.style.cssText = '--nexus-focus-ring: purple; --nexus-radius: 4px; --host-secret: red; font-family: monospace; font-size: 15px; line-height: 24px; color-scheme: dark; width: 900px'
    document.body.append(editor)
    const variables = nexusdownThemeVariables(editor)
    expect(variables).toMatchObject({
      '--nexus-focus-ring': 'purple',
      '--nexus-radius': '4px',
      'font-family': 'monospace',
      'font-size': '15px',
      'line-height': '24px',
      'color-scheme': 'dark',
    })
    expect(variables).not.toHaveProperty('--host-secret')
    expect(variables).not.toHaveProperty('width')
    editor.remove()
  })
})
