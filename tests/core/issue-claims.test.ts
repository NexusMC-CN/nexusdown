import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * Consolidated guards for issue-#1 claims that were investigated, found not to
 * be defects, and are pinned here so a later change cannot reintroduce them
 * unnoticed.
 */
describe('issue #1 claims confirmed working', () => {
  it('reports an unknown node type instead of silently emptying the document', async () => {
    // The project's own validation catches this; without it ProseMirror coerces
    // the unusable JSON into a paragraph of raw JSON text.
    const errors: string[] = []
    const editor = createNexusdownEditor({
      content: JSON.stringify({
        type: 'doc',
        content: [{ type: 'mysteryBlock', content: [{ type: 'text', text: 'hi' }] }],
      }),
      contentType: 'json',
    })
    editor.onError((error) => errors.push(error.message))
    await Promise.resolve()
    await Promise.resolve()
    expect(errors.join()).toContain('mysteryBlock')
    expect(editor.getHTML()).not.toContain('mysteryBlock')
    editor.destroy()
  })

  it('rejects an unknown node type through setContent and keeps the old document', () => {
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    const errors: string[] = []
    editor.onError((error) => errors.push(error.message))
    editor.setContent(JSON.stringify({ type: 'doc', content: [{ type: 'mysteryBlock' }] }), 'json')
    expect(errors.join()).toContain('mysteryBlock')
    expect(editor.getHTML()).toBe('<p>x</p>')
    editor.destroy()
  })

  it('emits one notification per edit', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    let count = 0
    editor.subscribe(() => { count += 1 })
    editor.getEditor().commands.insertContent('x')
    expect(count).toBe(1)
    editor.destroy()
  })

  it('keeps a base64 image through an HTML reload', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    const editor = createNexusdownEditor({
      content: `<p><img src="${src}" alt="x"></p>`,
      contentType: 'html',
    })
    const html = editor.getHTML()
    expect(html).toContain('data:image/png')
    const reloaded = createNexusdownEditor({ content: html, contentType: 'html' })
    expect(reloaded.getHTML()).toContain('data:image/png')
    reloaded.destroy()
    editor.destroy()
  })

  it('keeps the redo stack after a rejected edit', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    editor.setMarkdown('one')
    editor.undo()
    expect(editor.canRedo()).toBe(true)
    editor.setMarkdown('bad\u0000content')
    expect(editor.canRedo()).toBe(true)
    editor.destroy()
  })

  it('marks a history step as coming from history', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    const sources: string[] = []
    editor.subscribe((snapshot) => sources.push(snapshot.source))
    editor.setMarkdown('one')
    editor.undo()
    expect(sources).toContain('history')
    editor.destroy()
  })

  it('escapes a literal ==text== so it does not become a highlight', () => {
    const editor = createNexusdownEditor({ content: '<p>a ==b== c</p>', contentType: 'html' })
    const markdown = editor.getMarkdown()
    const reloaded = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
    expect(reloaded.getHTML()).not.toContain('<mark>')
    reloaded.destroy()
    editor.destroy()
  })

  it('keeps a highlight whose content contains a single equals sign', () => {
    const editor = createNexusdownEditor({ content: '<p><mark>a=b</mark></p>', contentType: 'html' })
    const markdown = editor.getMarkdown()
    const reloaded = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
    expect(reloaded.getHTML()).toContain('<mark>')
    reloaded.destroy()
    editor.destroy()
  })

  it('reports no text colour when only other textStyle attributes are set', () => {
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    expect(editor.hasTextColor()).toBe(false)
    expect(editor.hasTextColor('#ff0000')).toBe(false)
    editor.destroy()
  })
})

describe('line-start markers survive a round trip', () => {
  for (const text of ['# not a heading', '- not a list', '1. not ordered', '> not a quote']) {
    it(`keeps ${JSON.stringify(text)} as a paragraph`, () => {
      const editor = createNexusdownEditor({ content: `<p>${text}</p>`, contentType: 'html' })
      const markdown = editor.getMarkdown()
      const reloaded = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
      const html = reloaded.getHTML()
      expect(html).not.toContain('<h1')
      expect(html).not.toContain('<ul')
      expect(html).not.toContain('<ol')
      expect(html).not.toContain('<blockquote')
      // The escape backslash must not survive into the rendered text.
      expect(html).not.toContain('\\')
      expect(html).toContain(text.replace(/^[#\->\d.]+\s*/, ''))
      reloaded.destroy()
      editor.destroy()
    })
  }
})
