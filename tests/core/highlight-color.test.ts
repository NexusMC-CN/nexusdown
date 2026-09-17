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

describe('highlight colour in Markdown (issue #1 comments)', () => {
  it('keeps a custom highlight colour through a round trip', () => {
    // Regression: the renderer emitted a bare `==...==`, so `data-color` was
    // dropped and a custom highlight reverted to the default on reload.
    const { markdown, reloaded } = roundTrip(
      '<p><mark data-color="#ff0000" style="background-color: #ff0000">hi</mark></p>',
    )
    expect(markdown).toBe('=={#ff0000}hi==')
    expect(reloaded).toContain('data-color="#ff0000"')
    expect(reloaded).toContain('<mark')
  })

  it('leaves a default highlight as a plain delimiter pair', () => {
    const { markdown, reloaded } = roundTrip('<p><mark>hi</mark></p>')
    expect(markdown).toBe('==hi==')
    expect(reloaded).toContain('<mark>')
  })

  it('still parses a plain ==text== written by hand', () => {
    const editor = createNexusdownEditor({ content: '==hi==\n', contentType: 'markdown' })
    expect(editor.getHTML()).toContain('<mark>')
    editor.destroy()
  })

  it('treats the colour syntax as literal text when not a highlight', () => {
    // `=={red}==` with no link to any mark must not silently become a highlight
    // carrying a bogus colour.
    const { reloaded } = roundTrip('<p>literal == braces ==</p>')
    expect(reloaded).not.toContain('data-color')
  })
})
