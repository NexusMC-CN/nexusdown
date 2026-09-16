import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/index.js'

// Helpers -------------------------------------------------------------------

/** Drive the session's own paste handler the way ProseMirror would. */
function paste(session: ReturnType<typeof createNexusdownEditor>, text: string, html = ''): boolean {
  const view = session.getEditor().view
  const fakeEvent = {
    clipboardData: {
      files: [],
      getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : ''),
    },
    preventDefault: () => undefined,
  }
  const handler = (fn: (v: unknown, e: unknown) => boolean) => fn(view, fakeEvent)
  return Boolean(view.someProp('handlePaste', handler as never))
}

describe('Markdown-aware paste', () => {
  it('is the default-off behaviour: plain mode keeps markdown literal', () => {
    const session = createNexusdownEditor({ content: '<p></p>', contentType: 'html' })
    const editor = session.getEditor()
    editor.commands.focus('end')

    // jsdom does not implement ClipboardEvent, which `view.pasteText()` builds
    // internally, so stub just that call and assert the handler chose the
    // literal-text branch instead of the markdown parser.
    const pasted: string[] = []
    const view = editor.view as unknown as { pasteText: (value: string) => void }
    const original = view.pasteText
    view.pasteText = (value: string) => { pasted.push(value) }

    let handled: boolean
    try {
      handled = paste(session, '# Title')
    } finally {
      view.pasteText = original
    }

    expect(handled).toBe(true)
    expect(pasted).toEqual(['# Title'])
    // No heading node: the markdown was inserted as literal text.
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph')
    session.destroy()
  })

  it('parses pasted markdown into real nodes in markdown mode', () => {
    const session = createNexusdownEditor({ content: '<p></p>', contentType: 'html', pasteMode: 'markdown' })
    const editor = session.getEditor()
    editor.commands.focus('end')

    const handled = paste(session, '# Title\n\n- a\n- b')

    expect(handled).toBe(true)
    const types = Array.from({ length: editor.state.doc.content.childCount }, (_, i) => editor.state.doc.child(i).type.name)
    expect(types).toContain('heading')
    expect(types).toContain('bulletList')
    session.destroy()
  })

  it('preserves inline marks when pasting markdown', () => {
    const session = createNexusdownEditor({ content: '<p></p>', contentType: 'html', pasteMode: 'markdown' })
    session.getEditor().commands.focus('end')
    paste(session, '**bold** and `code`')

    expect(session.getHTML()).toContain('<strong>bold</strong>')
    expect(session.getHTML()).toContain('<code>code</code>')
    session.destroy()
  })

  it('falls back to literal text when the markdown has no block content', () => {
    const session = createNexusdownEditor({ content: '<p></p>', contentType: 'html', pasteMode: 'markdown' })
    session.getEditor().commands.focus('end')
    const handled = paste(session, 'just words')

    expect(handled).toBe(true)
    expect(session.getText()).toContain('just words')
    session.destroy()
  })

  it('keeps structured mode unchanged', () => {
    const session = createNexusdownEditor({ content: '<p></p>', contentType: 'html', pasteMode: 'structured' })
    // structured mode defers to Tiptap's default HTML paste handling.
    expect(paste(session, 'text', '<b>html</b>')).toBe(false)
    session.destroy()
  })

  it('exposes insertMarkdown as a public command', () => {
    const session = createNexusdownEditor({ content: '<p></p>', contentType: 'html' })
    const ok = session.commands.insertMarkdown('## Sub\n\n1. one\n2. two')

    expect(ok).toBe(true)
    const types = Array.from(
      { length: session.getEditor().state.doc.content.childCount },
      (_, i) => session.getEditor().state.doc.child(i).type.name,
    )
    expect(types).toContain('heading')
    expect(types).toContain('orderedList')
    session.destroy()
  })

  it('round-trips pasted markdown through getMarkdown', () => {
    const session = createNexusdownEditor({ content: '<p></p>', contentType: 'html', pasteMode: 'markdown' })
    session.getEditor().commands.focus('end')
    paste(session, '## Heading\n\n- item')

    const md = session.getMarkdown()
    expect(md).toContain('## Heading')
    expect(md).toContain('- item')
    session.destroy()
  })
})

describe('getText plain-text export', () => {
  it('returns block-separated plain text', () => {
    const session = createNexusdownEditor({ content: '<h1>Title</h1><p>Body text</p>', contentType: 'html' })
    const text = session.getText()

    expect(text).toContain('Title')
    expect(text).toContain('Body text')
    expect(text).toContain('\n')
    expect(text).not.toContain('<')
    session.destroy()
  })

  it('strips inline formatting', () => {
    const session = createNexusdownEditor({ content: '**bold** and *italic*', contentType: 'markdown' })
    const text = session.getText()

    expect(text).toBe('bold and italic')
    expect(text).not.toContain('*')
    session.destroy()
  })

  it('includes list items as separate lines', () => {
    const session = createNexusdownEditor({ content: '- one\n- two\n- three', contentType: 'markdown' })
    expect(session.getText().split('\n').filter(Boolean)).toEqual(['one', 'two', 'three'])
    session.destroy()
  })

  it('returns image alt text instead of the source', () => {
    const session = createNexusdownEditor({
      content: '<p>before</p><img src="https://example.com/a.png" alt="A picture">',
      contentType: 'html',
    })
    const text = session.getText()

    expect(text).toContain('A picture')
    expect(text).not.toContain('example.com')
    session.destroy()
  })

  it('returns an empty string for an empty document', () => {
    const session = createNexusdownEditor({ content: '<p></p>', contentType: 'html' })
    expect(session.getText()).toBe('')
    session.destroy()
  })

  it('is usable for word counting', () => {
    const session = createNexusdownEditor({ content: '# Title\n\nsome words here', contentType: 'markdown' })
    const words = session.getText().split(/\s+/).filter(Boolean)
    expect(words.length).toBeGreaterThanOrEqual(4)
    session.destroy()
  })
})
