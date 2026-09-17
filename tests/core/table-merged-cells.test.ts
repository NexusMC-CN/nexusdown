import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

function roundTrip(html: string) {
  const first = createNexusdownEditor({ content: html, contentType: 'html' })
  const markdown = first.getMarkdown()
  first.destroy()
  const second = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
  const out = { markdown, html: second.getHTML() }
  second.destroy()
  return out
}

function spanOf(html: string, text: string): { colspan: string | null; rowspan: string | null } {
  const match = new RegExp(`<t[dh]([^>]*)>\\s*(?:<p>)?${text}`).exec(html)
  const attrs = match?.[1] ?? ''
  return {
    colspan: /colspan="(\d+)"/.exec(attrs)?.[1] ?? null,
    rowspan: /rowspan="(\d+)"/.exec(attrs)?.[1] ?? null,
  }
}

/**
 * The CHANGELOG listed merged cells as an unfixable limitation because Markdown
 * has no such syntax. The schema does carry `colspan` / `rowspan`, and HTML
 * preserves them, so a merged table is now exported as HTML instead of being
 * flattened into blank padding cells.
 */
describe('merged table cells survive a Markdown round trip', () => {
  it('preserves colspan', () => {
    const r = roundTrip('<table><tbody><tr><td colspan="2">wide</td></tr><tr><td>x</td><td>y</td></tr></tbody></table>')
    console.log('MD:', JSON.stringify(r.markdown))
    expect(r.markdown).toContain('<table>')
    expect(spanOf(r.html, 'wide').colspan).toBe('2')
  })

  it('preserves rowspan', () => {
    const r = roundTrip('<table><tbody><tr><td rowspan="2">tall</td><td>a</td></tr><tr><td>b</td></tr></tbody></table>')
    expect(spanOf(r.html, 'tall').rowspan).toBe('2')
  })

  it('preserves a table with both spans', () => {
    const r = roundTrip('<table><tbody><tr><td colspan="2" rowspan="2">big</td><td>a</td></tr><tr><td>b</td></tr></tbody></table>')
    const span = spanOf(r.html, 'big')
    expect(span.colspan).toBe('2')
    expect(span.rowspan).toBe('2')
  })

  it('keeps cell text intact', () => {
    const r = roundTrip('<table><tbody><tr><td colspan="2">wide</td></tr><tr><td>x</td><td>y</td></tr></tbody></table>')
    expect(r.html).toContain('wide')
    expect(r.html).toContain('x')
    expect(r.html).toContain('y')
  })

  it('keeps header cells as th', () => {
    const r = roundTrip('<table><tbody><tr><th colspan="2">head</th></tr><tr><td>a</td><td>b</td></tr></tbody></table>')
    expect(r.html).toContain('<th')
  })

  it('still uses Markdown for an unmerged table', () => {
    const r = roundTrip('<table><tbody><tr><th>h1</th><th>h2</th></tr><tr><td>a</td><td>b</td></tr></tbody></table>')
    expect(r.markdown).toContain('|')
    expect(r.markdown).not.toContain('<table>')
    // The editor's own serializer always writes explicit span attributes, so
    // match the cells rather than a bare `<td>`.
    expect(r.html).toMatch(/<td[^>]*>\s*<p>a<\/p>/)
    expect(r.html).toMatch(/<td[^>]*>\s*<p>b<\/p>/)
  })

  it('keeps inline marks inside a merged cell', () => {
    const r = roundTrip('<table><tbody><tr><td colspan="2"><strong>b</strong> and <code>c</code></td></tr><tr><td>x</td><td>y</td></tr></tbody></table>')
    expect(r.html).toContain('<strong>')
    expect(r.html).toContain('<code>')
  })
})
