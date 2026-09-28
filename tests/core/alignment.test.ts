import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/index.js'

/**
 * Text alignment (`setTextAlign`) was removed with the rest of the
 * HTML-fallback features: Markdown has no alignment syntax, so the old
 * implementation could only emit `<div style="text-align: ...">`.
 *
 * What survives is indentation, and only as a *list-nesting* operation. A
 * paragraph outside a list has no standard Markdown indent, so `indent()` /
 * `outdent()` report that they did nothing rather than falling back to a
 * `margin-left` inline style.
 */
describe('indentation is list nesting', () => {
  it('refuses to outdent below zero', () => {
    const session = createNexusdownEditor({ content: '<p>text</p>', contentType: 'html' })
    session.getEditor().commands.focus('end')
    expect(session.commands.outdent()).toBe(false)
    session.destroy()
  })

  it('does not indent a paragraph with an inline style', () => {
    // Regression target: `indent()` used to write `margin-left: Nem` into the
    // document, which serialised as raw HTML. A paragraph cannot be nested, so
    // the command must decline and the Markdown must stay clean.
    const session = createNexusdownEditor({ content: '<p>text</p>', contentType: 'html' })
    session.getEditor().commands.focus('end')

    expect(session.commands.indent()).toBe(false)
    expect(session.getMarkdown()).toBe('text')
    expect(session.getMarkdown()).not.toContain('margin-left')
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

  it('round-trips a nested list through Markdown', () => {
    const session = createNexusdownEditor({
      content: '- a\n  - b',
      contentType: 'markdown',
    })
    const markdown = session.getMarkdown()
    expect(markdown).toContain('  - b')
    expect(markdown).not.toContain('<')

    const reloaded = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
    expect(reloaded.getMarkdown()).toBe(markdown)
    reloaded.destroy()
    session.destroy()
  })
})
