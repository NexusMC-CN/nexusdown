import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/index.js'

/** Align the first block and round-trip the document through Markdown. */
function alignAndRoundTrip(content: string, alignment?: 'left' | 'center' | 'right' | 'justify') {
  const session = createNexusdownEditor({ content, contentType: 'html' })
  session.getEditor().commands.focus('end')
  const applied = session.commands.setTextAlign(alignment)
  const markdown = session.getMarkdown()
  const round = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
  const first = round.getJSON().content?.[0] as { attrs?: { textAlign?: string } } | undefined
  const result = {
    applied,
    markdown,
    html: session.getHTML(),
    reparsedAlign: first?.attrs?.textAlign ?? null,
    reparsedHTML: round.getHTML(),
  }
  session.destroy()
  round.destroy()
  return result
}

describe('text alignment', () => {
  it('applies each alignment and exposes it in HTML', () => {
    for (const alignment of ['center', 'right', 'justify'] as const) {
      const session = createNexusdownEditor({ content: '<p>text</p>', contentType: 'html' })
      session.getEditor().commands.focus('end')
      expect(session.commands.setTextAlign(alignment)).toBe(true)
      expect(session.getHTML()).toContain(`text-align: ${alignment}`)
      session.destroy()
    }
  })

  it('keeps a left-aligned paragraph as bare Markdown', () => {
    const result = alignAndRoundTrip('<p>plain</p>', 'left')
    expect(result.markdown).toBe('plain')
  })

  it('round-trips paragraph alignment through Markdown', () => {
    const result = alignAndRoundTrip('<p>hello</p>', 'center')

    expect(result.markdown).toContain('text-align: center')
    expect(result.markdown).toContain('hello')
    expect(result.reparsedAlign).toBe('center')
  })

  it('round-trips heading alignment and preserves the heading level', () => {
    const result = alignAndRoundTrip('<h2>Title</h2>', 'right')

    // Regression: an earlier version emitted <p> for aligned headings, losing
    // the level entirely.
    expect(result.markdown).toContain('<h2')
    expect(result.markdown).not.toContain('<p')
    expect(result.reparsedAlign).toBe('right')
    expect(result.reparsedHTML).toContain('<h2')
  })

  it('round-trips h3 alignment', () => {
    const result = alignAndRoundTrip('<h3>Deep</h3>', 'justify')
    expect(result.markdown).toContain('<h3')
    expect(result.reparsedAlign).toBe('justify')
  })

  it('clears alignment when called without an argument', () => {
    const session = createNexusdownEditor({ content: '<p>text</p>', contentType: 'html' })
    session.getEditor().commands.focus('end')
    session.commands.setTextAlign('center')
    expect(session.getMarkdown()).toContain('center')

    session.commands.setTextAlign()
    expect(session.getMarkdown()).toBe('text')
    expect(session.getHTML()).not.toContain('text-align')
    session.destroy()
  })

  it('does not recurse when rendering (guard against renderChildren self-loop)', () => {
    // Regression: passing the node back to renderChildren re-entered the same
    // handler and blew the stack.
    expect(() => alignAndRoundTrip('<h2>Title</h2>', 'center')).not.toThrow()
  })

  it('leaves unaligned headings and paragraphs byte-identical on export', () => {
    // Regression: overriding the paragraph/heading renderers to add alignment
    // support initially returned only the children, which silently stripped the
    // `#` prefix from every heading in the document.
    for (const markdown of ['# H1', '## H2', '###### H6', 'just a paragraph']) {
      const session = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
      expect(session.getMarkdown(), `round-trip of ${JSON.stringify(markdown)}`).toBe(markdown)
      session.destroy()
    }
  })
})

describe('indentation', () => {
  it('indents a paragraph and round-trips the level', () => {
    const session = createNexusdownEditor({ content: '<p>text</p>', contentType: 'html' })
    session.getEditor().commands.focus('end')

    expect(session.commands.indent()).toBe(true)
    const markdown = session.getMarkdown()
    expect(markdown).toContain('margin-left')

    const round = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
    const first = round.getJSON().content?.[0] as { attrs?: { indent?: number } } | undefined
    expect(first?.attrs?.indent).toBe(1)
    session.destroy()
    round.destroy()
  })

  it('outdents back to no indent', () => {
    const session = createNexusdownEditor({ content: '<p>text</p>', contentType: 'html' })
    session.getEditor().commands.focus('end')

    session.commands.indent()
    session.commands.indent()
    expect(session.getMarkdown()).toContain('margin-left: 4em')

    session.commands.outdent()
    expect(session.getMarkdown()).toContain('margin-left: 2em')

    session.commands.outdent()
    expect(session.getMarkdown()).toBe('text')
    session.destroy()
  })

  it('refuses to outdent below zero', () => {
    const session = createNexusdownEditor({ content: '<p>text</p>', contentType: 'html' })
    session.getEditor().commands.focus('end')
    expect(session.commands.outdent()).toBe(false)
    session.destroy()
  })

  it('sinks and lifts list items instead of setting the attribute', () => {
    const session = createNexusdownEditor({ content: '<ul><li><p>a</p></li><li><p>b</p></li></ul>', contentType: 'html' })
    const editor = session.getEditor()
    // Put the cursor inside the second list item.
    editor.commands.setTextSelection(editor.state.doc.content.size - 3)

    const before = session.getJSON()
    expect(session.commands.indent()).toBe(true)
    const after = session.getJSON()
    // A nested list appears rather than a margin-left attribute.
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before))
    session.destroy()
  })

  it('caps indentation at the maximum level', () => {
    const session = createNexusdownEditor({ content: '<p>text</p>', contentType: 'html' })
    session.getEditor().commands.focus('end')

    let accepted = 0
    for (let i = 0; i < 20; i += 1) {
      if (session.commands.indent()) accepted += 1
    }
    expect(accepted).toBe(8)
    session.destroy()
  })
})
