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

describe('inline marks survive an HTML-fallback block', () => {
  it('keeps bold/italic/code/highlight/underline inside an aligned block', () => {
    const r = roundTrip('<p style="text-align: center"><strong>b</strong> <em>i</em> <code>c</code> <mark>h</mark> <u>u</u></p>')
    console.log('MD:', JSON.stringify(r.markdown))
    console.log('HTML:', JSON.stringify(r.html))
    expect(r.html).toContain('<strong>')
    expect(r.html).toContain('<em>')
    expect(r.html).toContain('<code>')
    expect(r.html).toContain('<mark>')
    expect(r.html).toContain('<u>')
    expect(r.text).toBe('b i c h u')
    expect(r.html).toContain('text-align: center')
  })

  it('keeps marks inside an indented block', () => {
    const r = roundTrip('<p style="margin-left: 2em"><strong>bold</strong> text</p>')
    expect(r.html).toContain('<strong>bold</strong>')
    expect(r.text).toBe('bold text')
  })

  it('keeps a coloured highlight inside an aligned block', () => {
    const r = roundTrip('<p style="text-align: right"><mark data-color="#ff0000">x</mark></p>')
    console.log('colored MD:', JSON.stringify(r.markdown))
    expect(r.html).toContain('<mark')
    expect(r.html).toContain('#ff0000')
    expect(r.text).toBe('x')
  })

  it('keeps text colours inside an aligned block', () => {
    const r = roundTrip('<p style="text-align: center"><span style="color: #ff0000">red</span></p>')
    expect(r.text).toBe('red')
    expect(r.html).toMatch(/#ff0000|rgb\(255, 0, 0\)/)
  })

  it('does not lose literal text that looks like markup', () => {
    const r = roundTrip('<p style="text-align: center">a &lt;b&gt; c &amp; d</p>')
    expect(r.text).toBe('a <b> c & d')
  })

  it('still preserves alignment itself', () => {
    const r = roundTrip('<p style="text-align: center">plain</p>')
    expect(r.html).toContain('text-align: center')
    expect(r.text).toBe('plain')
  })

  it('leaves a plain paragraph on the Markdown path', () => {
    // No alignment/indent means the normal Markdown renderers still apply.
    const r = roundTrip('<p><strong>b</strong> and <mark>h</mark></p>')
    expect(r.markdown).toContain('**b**')
    expect(r.markdown).toContain('==h==')
    expect(r.html).toContain('<strong>')
    expect(r.html).toContain('<mark>')
  })
})
