import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * A block that falls back to inline HTML (alignment or indent has no Markdown
 * syntax) previously converted the `=`/`+` escaping sentinels into real
 * backslashes. Nothing on the HTML path consumes an escape, so the user's text
 * visibly became `\=\=x\=\=` after a round trip.
 */
function roundTrip(html: string) {
  const first = createNexusdownEditor({ content: html, contentType: 'html' })
  const markdown = first.getMarkdown()
  first.destroy()
  const second = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
  const out = { markdown, html: second.getHTML(), text: second.getEditor().getText() }
  second.destroy()
  return out
}

describe('HTML fallback blocks keep literal delimiters intact', () => {
  it('does not leak a backslash into an aligned paragraph', () => {
    const r = roundTrip('<p style="text-align: center">==x==</p>')
    expect(r.markdown).not.toContain('\\')
    expect(r.text).toBe('==x==')
    expect(r.html).toContain('text-align: center')
  })

  it('does not leak a backslash into an indented paragraph', () => {
    const r = roundTrip('<p style="margin-left: 2em">==x==</p>')
    expect(r.text).toBe('==x==')
    expect(r.markdown).not.toContain('\\')
  })

  it('does not leak a backslash for ++ inside an aligned block', () => {
    const r = roundTrip('<p style="text-align: right">++y++</p>')
    expect(r.text).toBe('++y++')
    expect(r.markdown).not.toContain('\\')
  })

  it('still escapes delimiters in a plain paragraph', () => {
    // The plain path DOES run the manager's escaper, so it must keep escaping.
    const r = roundTrip('<p>==x==</p>')
    expect(r.markdown).toBe('\\=\\=x\\=\\=')
    expect(r.text).toBe('==x==')
  })

  // Marks inside the fallback block used to degrade to literal markup: the block
  // is inline HTML and CommonMark does not process Markdown inside an inline HTML
  // tag, so `==hi==` came back as literal text. The fallback now renders its
  // children as HTML too, so the mark survives — see `html-fallback-marks.test.ts`
  // for the full matrix (bold/italic/code/highlight colour/underline/text colour).
  it('keeps a mark inside an aligned block', () => {
    const r = roundTrip('<p style="text-align: center"><mark>hi</mark></p>')
    expect(r.text).toBe('hi')
    expect(r.html).toContain('<mark>')
  })
})
