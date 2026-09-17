import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/** html -> markdown -> reload -> html. */
function roundTrip(html: string): { markdown: string; reloaded: string } {
  const first = createNexusdownEditor({ content: html, contentType: 'html' })
  const markdown = first.getMarkdown()
  first.destroy()
  const second = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
  const reloaded = second.getHTML()
  second.destroy()
  return { markdown, reloaded }
}

function fromHtml(html: string): string {
  const editor = createNexusdownEditor({ content: html, contentType: 'html' })
  const out = editor.getMarkdown()
  editor.destroy()
  return out
}

describe('highlight and underline delimiters (issue #1 comments)', () => {
  it('escapes == in ordinary prose so it does not become a highlight', () => {
    const { markdown, reloaded } = roundTrip('<p>==not highlight==</p>')
    expect(markdown).toBe('\\=\\=not highlight\\=\\=')
    expect(reloaded).not.toContain('<mark>')
    expect(reloaded).toContain('==not highlight==')
  })

  it('escapes ++ in ordinary prose so it does not become an underline', () => {
    const { markdown, reloaded } = roundTrip('<p>++not underline++</p>')
    expect(markdown).toBe('\\+\\+not underline\\+\\+')
    expect(reloaded).not.toContain('<u>')
    expect(reloaded).toContain('++not underline++')
  })

  it('keeps a real highlight working', () => {
    const { markdown, reloaded } = roundTrip('<p><mark>highlighted</mark></p>')
    expect(markdown).toBe('==highlighted==')
    expect(reloaded).toContain('<mark>')
  })

  it('round-trips a single = inside highlighted text', () => {
    // The `=` inside the content must be escaped, otherwise `==a=b==` closes the
    // highlight at the inner `=`: it re-parses as `<mark>a</mark>b==`, losing the
    // mark and leaking the raw delimiters into the text. The mark's own renderer
    // cannot do this (it only ever sees a synthetic placeholder node), so the
    // escape happens on the real text node and the tokenizer consumes `\\.` as a
    // unit — see `escapeProseDelimitersDeep` and the highlight tokenizer.
    const { markdown, reloaded } = roundTrip('<p><mark>a=b</mark></p>')
    expect(markdown).toBe('==a\\=b==')
    expect(reloaded).toContain('<mark>')
    expect(reloaded).toContain('a=b')
    // The mark must survive intact, not be truncated at the inner `=`.
    expect(reloaded.match(/<mark>/g)?.length).toBe(1)
    expect(reloaded).not.toContain('b==')
  })

  it('round-trips a double == inside highlighted text', () => {
    // Regression: `==` inside the content previously rendered unescaped as
    // `==a==b==`, which re-parsed as `<mark>a</mark>b==`.
    const { markdown, reloaded } = roundTrip('<p><mark>a==b</mark></p>')
    expect(markdown).toBe('==a\\=\\=b==')
    expect(reloaded.match(/<mark>/g)?.length).toBe(1)
    expect(reloaded).toContain('a==b')
  })

  it('does not nest highlights when the content contains delimiters', () => {
    // `x==y==z` escaped to `==x\=\=y\=\=z==` round-tripped into a NESTED
    // highlight (`x<mark>y</mark>z`) because the unescaped content was
    // re-tokenised. Escaped content is taken literally now.
    const { reloaded } = roundTrip('<p><mark>x==y==z</mark></p>')
    expect(reloaded.match(/<mark>/g)?.length).toBe(1)
    expect(reloaded).toContain('x==y==z')
  })

  it('round-trips a + and ++ inside underlined text', () => {
    for (const inner of ['+', '++', 'a+b', 'a++b']) {
      const { reloaded } = roundTrip(`<p><u>${inner}</u></p>`)
      expect(reloaded.match(/<u>/g)?.length).toBe(1)
      expect(reloaded).toContain(inner)
      // The escape must be consumed, not rendered as a literal backslash.
      const text = reloaded.replace(/<[^>]+>/g, '')
      expect(text).not.toContain('\\')
    }
  })

  it('escapes a + inside underlined text', () => {
    const { reloaded } = roundTrip('<p><u>a+b</u></p>')
    expect(reloaded).toContain('<u>')
    expect(reloaded).toContain('a+b')
  })

  it('does not escape == that is already escaped', () => {
    // Reading back an escaped document must not accumulate backslashes.
    const once = fromHtml('<p>==x==</p>')
    const editor = createNexusdownEditor({ content: once, contentType: 'markdown' })
    const twice = editor.getMarkdown()
    editor.destroy()
    expect(twice).toBe(once)
  })
})
