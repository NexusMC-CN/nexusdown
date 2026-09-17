import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

describe('link editing with styled content (issue #1 comments)', () => {
  it('reports the whole link label when the cursor sits in a styled fragment', () => {
    // Regression: a link whose label mixes styling is several text nodes
    // (`ab` + bold `cd` + `ef`). Only the node under the cursor was read, so the
    // dialog showed "ef" as the label and looked as though text had been lost.
    const editor = createNexusdownEditor({
      content: '<p><a href="https://x.com">ab<strong>cd</strong>ef</a></p>',
      contentType: 'html',
    })
    const instance = editor.getEditor()

    instance.commands.setTextSelection(6)
    expect(editor.getSelectedText()).toBe('abcdef')

    // The same must hold from the other fragments.
    instance.commands.setTextSelection(2)
    expect(editor.getSelectedText()).toBe('abcdef')
    instance.commands.setTextSelection(4)
    expect(editor.getSelectedText()).toBe('abcdef')

    editor.destroy()
  })

  it('keeps bold on the text when a link is applied to it', () => {
    // Regression: replacing the selection with a text node carrying only the
    // link mark silently dropped every other mark, so linking bold text produced
    // unformatted text.
    const editor = createNexusdownEditor({
      content: '<p><strong>bold text</strong></p>',
      contentType: 'html',
    })
    editor.getEditor().commands.selectAll()

    editor.commands.setLink('https://x.com', 'bold text')

    const html = editor.getHTML()
    expect(html).toContain('href="https://x.com"')
    expect(html).toContain('<strong>')
    editor.destroy()
  })

  it('keeps italic on the text when a link is applied to it', () => {
    const editor = createNexusdownEditor({
      content: '<p><em>italic text</em></p>',
      contentType: 'html',
    })
    editor.getEditor().commands.selectAll()

    editor.commands.setLink('https://x.com', 'italic text')

    const html = editor.getHTML()
    expect(html).toContain('href="https://x.com"')
    expect(html).toContain('<em>')
    editor.destroy()
  })

  it('replaces the whole link when relabelling from inside it', () => {
    // The original issue-#1 fix: editing a link from inside must not leave
    // fragments behind. Styled labels must satisfy this too.
    const editor = createNexusdownEditor({
      content: '<p><a href="https://x.com">ab<strong>cd</strong>ef</a></p>',
      contentType: 'html',
    })
    editor.getEditor().commands.setTextSelection(6)

    editor.commands.setLink('https://y.com', 'new')

    const html = editor.getHTML()
    expect(html).toContain('href="https://y.com"')
    expect(html).toContain('>new<')
    // The old label fragments must be gone. Check inside the anchor only, since
    // the boilerplate `rel="noopener noreferrer nofollow"` contains "ef".
    const label = /<a[^>]*>([\s\S]*?)<\/a>/.exec(html)?.[1] ?? ''
    expect(label).toBe('new')
    editor.destroy()
  })

  it('does not merge two separate links into one range', () => {
    const editor = createNexusdownEditor({
      content: '<p><a href="https://a.com">one</a> gap <a href="https://b.com">two</a></p>',
      contentType: 'html',
    })
    const instance = editor.getEditor()
    // Place the cursor inside the first link.
    instance.commands.setTextSelection(3)
    expect(editor.getSelectedText()).toBe('one')
    editor.destroy()
  })
})
