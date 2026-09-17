import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

describe('session state consistency (issue #1 comments)', () => {
  it('keeps notifying later subscribers when one throws', () => {
    // Regression: subscriber notification ran in a bare loop, so a throwing
    // callback stopped every subscriber after it. Those subscribers silently
    // missed the update and kept a stale document.
    const editor = createNexusdownEditor({ content: '<p>first</p>', contentType: 'html' })
    const seen: string[] = []
    const errors: string[] = []
    editor.onError((error) => errors.push(error.message))

    editor.subscribe(() => {
      seen.push('throwing')
      throw new Error('subscriber failed')
    })
    editor.subscribe((snapshot) => seen.push(`second:${snapshot.html}`))

    editor.setContent('<p>second</p>', 'html')

    expect(seen[0]).toBe('throwing')
    expect(seen[1]).toBe('second:<p>second</p>')
    expect(errors).toEqual(['subscriber failed'])
    editor.destroy()
  })

  it('commits the snapshot even when a subscriber throws', () => {
    const editor = createNexusdownEditor({ content: '<p>first</p>', contentType: 'html' })
    editor.subscribe(() => {
      throw new Error('boom')
    })
    editor.setContent('<p>second</p>', 'html')
    // The document the session reports must match what the editor holds, or a
    // consumer that saves it would persist stale content.
    expect(editor.getHTML()).toBe('<p>second</p>')
    expect(editor.getSnapshot().html).toBe('<p>second</p>')
    editor.destroy()
  })

  it('rejects a JSON document with an unknown node type instead of showing it as text', async () => {
    // Regression: ProseMirror coerces an unusable document into a text node, so
    // the raw JSON was displayed as the document body with no error reported.
    const json = JSON.stringify({
      type: 'doc',
      content: [{ type: 'unknownNodeType', content: [] }],
    })
    const editor = createNexusdownEditor({ content: json, contentType: 'json' })
    const errors: string[] = []
    editor.onError((error) => errors.push(error.message))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errors.join()).toContain('Unknown node type')
    expect(editor.getHTML()).not.toContain('unknownNodeType')
    expect(editor.getMarkdown()).toBe('')
    editor.destroy()
  })

  it('still accepts a valid initial JSON document', () => {
    const editor = createNexusdownEditor({
      content: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
      }),
      contentType: 'json',
    })
    expect(editor.getMarkdown()).toBe('Hello')
    editor.destroy()
  })

  it('reports an unknown node type through setContent without corrupting the document', () => {
    const editor = createNexusdownEditor({ content: '<p>keep me</p>', contentType: 'html' })
    const errors: string[] = []
    editor.onError((error) => errors.push(error.message))

    editor.setContent(
      JSON.stringify({ type: 'doc', content: [{ type: 'nope', content: [] }] }),
      'json',
    )

    expect(errors.join()).toContain('Unknown node type')
    // The rejected value must not reach the document.
    expect(editor.getHTML()).toBe('<p>keep me</p>')
    editor.destroy()
  })

  it('marks undo and redo as history rather than an ordinary edit', () => {
    // Regression: only the session's own undo()/redo() set the source, so an
    // undo performed through a keyboard shortcut was reported as `rich-text` and
    // consumers keying off the source treated a history step as a real edit.
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    const sources: string[] = []
    editor.subscribe((snapshot) => sources.push(snapshot.source))
    const instance = editor.getEditor()

    instance.chain().focus().insertContent('b').run()
    expect(sources.at(-1)).toBe('rich-text')

    instance.commands.undo()
    expect(sources.at(-1)).toBe('history')

    instance.commands.redo()
    expect(sources.at(-1)).toBe('history')
    editor.destroy()
  })

  it('preserves the redo stack when a rejected edit is rolled back', () => {
    // Regression: the rollback used a plain `setContent`, which is an ordinary
    // transaction. It cleared the redo stack, so one rejected paste silently
    // destroyed everything the user could have redone.
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    const instance = editor.getEditor()
    instance.chain().focus().insertContent('b').run()
    instance.commands.undo()
    expect(editor.canRedo()).toBe(true)

    editor.setMarkdown('bad\u0000value')

    // Content is restored and the redo stack survives.
    expect(editor.getHTML()).toBe('<p>a</p>')
    expect(editor.canRedo()).toBe(true)
    editor.destroy()
  })

  it('does not push a no-op entry onto the undo stack when rolling back', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    const instance = editor.getEditor()
    instance.chain().focus().insertContent('b').run()
    const before = instance.state.doc.toString()

    editor.setMarkdown('bad\u0000value')

    expect(instance.state.doc.toString()).toBe(before)
    editor.destroy()
  })
})
