import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * Known limitation: a non-Markdown colour containing nested formatting.
 *
 * Markdown has no syntax for an arbitrary colour, so the value falls back to an
 * inline `<span style="color: ...">`. Inside an inline HTML tag CommonMark leaves
 * the content alone, so formatting written as Markdown there survives as literal
 * characters instead of being applied.
 *
 * This is not fixable from a mark renderer. The manager renders each mark with a
 * synthetic node whose only content is the literal
 * `__TIPTAP_MARKDOWN_PLACEHOLDER__`, then keeps just the text *before* that
 * placeholder as the opening delimiter — a mark can never see or rewrite its own
 * content, so it cannot switch its children to HTML. The library reads an
 * internal `htmlReopen` hook that would address this, but it is missing from the
 * published types, so using it would mean an untyped cast against a private API.
 *
 * These tests pin the current behaviour so a future upgrade that changes it is
 * noticed rather than silently assumed.
 */
function roundTrip(html: string) {
  const first = createNexusdownEditor({ content: html, contentType: 'html' })
  const markdown = first.getMarkdown()
  first.destroy()
  const second = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
  const reloaded = second.getHTML()
  second.destroy()
  return { markdown, reloaded }
}

describe('non-Markdown colour with nested formatting (known limitation)', () => {
  it('uses an HTML fallback for a colour Markdown cannot express', () => {
    const { markdown } = roundTrip('<p><span style="color: var(--brand)">plain</span></p>')
    expect(markdown).toBe('<span style="color: var(--brand)">plain</span>')
  })

  it('produces inline HTML rather than literal Markdown for a nested code span', () => {
    // The code span escapes the wrapper, so the colour no longer covers it and
    // the emitted text separates them. Pinned, not endorsed.
    const { markdown } = roundTrip(
      '<p><span style="color: var(--brand)">plain <code>c</code></span></p>',
    )
    expect(markdown).toContain('<span style="color: var(--brand)">')
    expect(markdown).toContain('</span>')
  })

  it('still round-trips a colour Markdown can express, with nesting intact', () => {
    // The `[color]` shortcode branch has no such problem, so nested marks are
    // preserved there — the limitation is specific to the HTML fallback.
    const { markdown, reloaded } = roundTrip(
      '<p><span style="color: rgb(1,2,3)"><em>it</em> tail</span></p>',
    )
    expect(markdown).toBe('[color color="rgb(1,2,3)"]*it* tail[/color]')
    expect(reloaded).toContain('<em>')
  })

  it('does not leak raw HTML into a colour Markdown can express', () => {
    const { markdown } = roundTrip('<p><span style="color: #ff0000">plain</span></p>')
    expect(markdown).not.toContain('<span')
  })
})
