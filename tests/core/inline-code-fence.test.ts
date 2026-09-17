import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

function roundTrip(html: string) {
  const first = createNexusdownEditor({ content: html, contentType: 'html' })
  const markdown = first.getMarkdown()
  first.destroy()
  const second = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
  const out = { markdown, html: second.getHTML(), text: second.getEditor().getText() }
  second.destroy()
  return out
}

/**
 * A code span must be fenced by a longer run of backticks than any run inside it.
 * The stock renderer always used one, so ``a`b`` became `` `a`b` `` and re-parsed
 * as `<code>a</code>b\``. This was documented as an unfixable limitation.
 */
describe('inline code containing backticks', () => {
  it('round-trips a single backtick inside inline code', () => {
    const r = roundTrip('<p><code>a`b</code></p>')
    console.log('MD:', JSON.stringify(r.markdown))
    expect(r.text).toBe('a`b')
    expect(r.html).toContain('<code>a`b</code>')
  })

  it('round-trips a double backtick inside inline code', () => {
    const r = roundTrip('<p><code>a``b</code></p>')
    expect(r.text).toBe('a``b')
    expect(r.html).toContain('<code>a``b</code>')
  })

  it('round-trips code that starts with a backtick', () => {
    const r = roundTrip('<p><code>`x</code></p>')
    expect(r.text).toBe('`x')
    expect(r.html).toContain('<code>`x</code>')
  })

  it('round-trips code that ends with a backtick', () => {
    const r = roundTrip('<p><code>x`</code></p>')
    expect(r.text).toBe('x`')
    expect(r.html).toContain('<code>x`</code>')
  })

  it('leaves ordinary inline code on the single-backtick form', () => {
    const r = roundTrip('<p><code>plain</code></p>')
    expect(r.markdown).toBe('`plain`')
    expect(r.html).toContain('<code>plain</code>')
  })

  it('does not disturb other text in the same paragraph', () => {
    const r = roundTrip('<p>before <code>a`b</code> after</p>')
    expect(r.text).toBe('before a`b after')
    expect(r.html).toContain('<code>a`b</code>')
  })

  it('round-trips inline code alongside other marks', () => {
    const r = roundTrip('<p><strong>b</strong> <code>a`b</code> <em>i</em></p>')
    expect(r.text).toBe('b a`b i')
    expect(r.html).toContain('<code>a`b</code>')
    expect(r.html).toContain('<strong>')
    expect(r.html).toContain('<em>')
  })
})
