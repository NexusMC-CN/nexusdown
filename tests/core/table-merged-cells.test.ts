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
 * Markdown has no syntax for a merged cell.
 *
 * The product decision is that a table is *always* written as a GFM pipe table,
 * so a `colspan` / `rowspan` is flattened into blank padding cells and the merge
 * itself is lost on export. That is the deliberate trade for keeping the output
 * pure: an HTML `<table>` would preserve the merge but would not be Markdown at
 * all — it would force every consumer to enable raw HTML, the very thing the
 * dialect contract forbids.
 */
describe('merged table cells flatten to a GFM pipe table', () => {
  it('writes a colspan table as a pipe table and drops the merge', () => {
    const r = roundTrip('<table><tbody><tr><td colspan="2">wide</td></tr><tr><td>x</td><td>y</td></tr></tbody></table>')
    expect(r.markdown).toContain('|')
    expect(r.markdown).not.toContain('<table>')
    expect(r.html).toContain('wide')
    expect(spanOf(r.html, 'wide').colspan).toBe('1')
  })

  it('writes a rowspan table as a pipe table and drops the merge', () => {
    const r = roundTrip('<table><tbody><tr><td rowspan="2">tall</td><td>a</td></tr><tr><td>b</td></tr></tbody></table>')
    expect(r.markdown).not.toContain('<table>')
    expect(r.html).toContain('tall')
    expect(spanOf(r.html, 'tall').rowspan).toBe('1')
  })

  it('writes a table with both spans as a pipe table and drops the merge', () => {
    const r = roundTrip('<table><tbody><tr><td colspan="2" rowspan="2">big</td><td>a</td></tr><tr><td>b</td></tr></tbody></table>')
    expect(r.markdown).not.toContain('<table>')
    expect(r.html).toContain('big')
    expect(spanOf(r.html, 'big').colspan).toBe('1')
    expect(spanOf(r.html, 'big').rowspan).toBe('1')
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
    expect(r.markdown).toContain('| head |')
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

  it('keeps inline marks inside a formerly merged cell', () => {
    const r = roundTrip('<table><tbody><tr><td colspan="2"><strong>b</strong> and <code>c</code></td></tr><tr><td>x</td><td>y</td></tr></tbody></table>')
    expect(r.html).toContain('<strong>')
    expect(r.html).toContain('<code>')
    expect(r.markdown).toContain('**b** and `c`')
  })
})
