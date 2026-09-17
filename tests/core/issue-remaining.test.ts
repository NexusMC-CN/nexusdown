import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/** Claims from issue #1 comment rounds that no other suite covers yet. */
describe('remaining issue-#1 claims', () => {
  it('rejects an unknown node type instead of showing raw JSON', () => {
    const errors: string[] = []
    const editor = createNexusdownEditor({
      content: JSON.stringify({ type: 'doc', content: [{ type: 'mysteryBlock' }] }),
      contentType: 'json',
    })
    editor.onError((e) => errors.push(e.message))
    return Promise.resolve().then(() => {
      expect(errors.length).toBeGreaterThan(0)
      expect(editor.getHTML()).not.toContain('mysteryBlock')
      editor.destroy()
    })
  })

  it('does not emit a snapshot for a rejected parse', () => {
    const editor = createNexusdownEditor({ content: '<p>good</p>', contentType: 'html' })
    let notifications = 0
    editor.subscribe(() => { notifications += 1 })
    editor.setMarkdown('bad\u0000content')
    expect(notifications).toBe(0)
    expect(editor.getMarkdown()).toBe('good')
    editor.destroy()
  })

  it('keeps the redo stack after a rejected parse', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    editor.setMarkdown('one')
    editor.undo()
    expect(editor.canRedo()).toBe(true)
    editor.setMarkdown('bad\u0000content')
    expect(editor.canRedo()).toBe(true)
    editor.destroy()
  })

  it('parses a JSON string as a document, not literal text', () => {
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    editor.setContent(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }), 'json')
    expect(editor.getHTML()).toContain('<p>hi</p>')
    editor.destroy()
  })

  it('exposes getText() with block separation and image alt', () => {
    const editor = createNexusdownEditor({
      content: '<p>one</p><p>two</p><p><img src="https://e.com/i.png" alt="pic"></p>',
      contentType: 'html',
    })
    const text = editor.getText()
    expect(text).toContain('one')
    expect(text).toContain('two')
    expect(text).toContain('pic')
    expect(text).toContain('\n')
    editor.destroy()
  })

  it('round-trips a nested task list', () => {
    const md = '- [ ] parent\n  - [ ] child\n'
    const a = createNexusdownEditor({ content: md, contentType: 'markdown' })
    const out = a.getMarkdown()
    const html = a.getHTML()
    a.destroy()
    const b = createNexusdownEditor({ content: out, contentType: 'markdown' })
    expect(b.getHTML()).toBe(html)
    b.destroy()
  })
})
