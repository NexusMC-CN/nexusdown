import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

function roundTrip(html: string): { markdown: string; reloaded: string } {
  const first = createNexusdownEditor({ content: html, contentType: 'html' })
  const markdown = first.getMarkdown()
  first.destroy()
  const second = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
  const reloaded = second.getHTML()
  second.destroy()
  return { markdown, reloaded }
}

/**
 * Link and image destinations must survive a Markdown round trip.
 *
 * A destination containing a space, parenthesis or angle bracket is written in
 * the `<...>` form so it cannot end early, and a title is quoted with its
 * backslashes and quotes escaped.
 */
describe('link and image destination escaping (issue #1 comments)', () => {
  it('keeps an unpaired parenthesis in a link destination', () => {
    const { markdown, reloaded } = roundTrip('<p><a href="https://x.com/a(1">t</a></p>')
    expect(markdown).toBe('[t](<https://x.com/a(1>)')
    expect(reloaded).toContain('href="https://x.com/a(1"')
  })

  it('keeps an unpaired parenthesis in an image destination', () => {
    const { markdown, reloaded } = roundTrip('<p><img src="https://x.com/a(1.png" alt="a"></p>')
    expect(markdown).toContain('![a](<https://x.com/a(1.png>)')
    expect(reloaded).toContain('src="https://x.com/a(1.png"')
  })

  it('keeps a link title, escaping its quotes', () => {
    // Regression: the mark's `title` attribute was never emitted, so the
    // tooltip was dropped on export even though the mark still held it.
    const { markdown, reloaded } = roundTrip(
      '<p><a href="https://x.com" title="say &quot;hi&quot;">t</a></p>',
    )
    expect(markdown).toBe('[t](https://x.com "say \\"hi\\"")')
    expect(reloaded).toContain('title="say &quot;hi&quot;"')
  })

  it('keeps an image title, escaping its quotes', () => {
    const { markdown, reloaded } = roundTrip(
      '<p><img src="https://x.com/a.png" alt="a" title="say &quot;hi&quot;"></p>',
    )
    expect(markdown).toContain('"say \\"hi\\""')
    expect(reloaded).toContain('title="say &quot;hi&quot;"')
  })

  it('keeps an unpaired bracket in an image description', () => {
    const { markdown, reloaded } = roundTrip('<p><img src="https://x.com/a.png" alt="a]b[c"></p>')
    expect(markdown).toContain('a\\]b\\[c')
    expect(reloaded).toContain('alt="a]b[c"')
  })

  it('leaves an ordinary link unchanged', () => {
    const { markdown, reloaded } = roundTrip('<p><a href="https://x.com">t</a></p>')
    expect(markdown).toBe('[t](https://x.com)')
    expect(reloaded).toContain('href="https://x.com"')
  })
})
