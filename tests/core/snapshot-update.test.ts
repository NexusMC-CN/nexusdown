import { Node } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

describe('snapshot updates when only HTML/JSON change', () => {
  it('notifies subscribers when a mark has no Markdown representation', () => {
    const editor = createNexusdownEditor({ content: '<p>hello</p>', contentType: 'html' })
    const seen: string[] = []
    editor.subscribe((snapshot) => seen.push(snapshot.html))

    // Subscript has no Markdown syntax, so `markdown` stays "hello" while the
    // HTML changes. The Markdown fast-path must not swallow this update.
    editor.getEditor().chain().selectAll().toggleSubscript().run()

    expect(editor.getSnapshot().markdown).toBe('hello')
    expect(editor.getSnapshot().html).toContain('<sub>')
    expect(seen.length, 'subscriber must be notified').toBeGreaterThan(0)
    editor.destroy()
  })

  it('replaces the snapshot object identity on such an update', () => {
    const editor = createNexusdownEditor({ content: '<p>hello</p>', contentType: 'html' })
    const before = editor.getSnapshot()
    editor.getEditor().chain().selectAll().toggleSubscript().run()
    expect(editor.getSnapshot()).not.toBe(before)
    editor.destroy()
  })

  it('still skips notification when nothing at all changed', () => {
    const editor = createNexusdownEditor({ content: '<p>hello</p>', contentType: 'html' })
    let calls = 0
    editor.subscribe(() => { calls++ })
    // A no-op transaction must not produce a snapshot update.
    editor.getEditor().chain().run()
    expect(calls).toBe(0)
    editor.destroy()
  })

  it('notifies and refreshes JSON when only a node attribute changes', () => {
    const JsonOnlyParagraph = Node.create({
      name: 'paragraph',
      group: 'block',
      content: 'inline*',
      addAttributes: () => ({ revision: { default: 1 } }),
      parseHTML: () => [{ tag: 'p' }],
      renderHTML: () => ['p', 0],
    })
    const editor = createNexusdownEditor({
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: { revision: 1 }, content: [{ type: 'text', text: 'hello' }] }] },
      contentType: 'json',
      extensionResolver: (extensions) => [
        ...extensions.filter((extension) => extension.name !== 'paragraph'),
        JsonOnlyParagraph,
      ],
    })
    const seen: number[] = []
    editor.subscribe((snapshot) => seen.push(Number(snapshot.json.content?.[0]?.attrs?.revision)))

    const { state, view } = editor.getEditor()
    view.dispatch(state.tr.setNodeMarkup(0, state.schema.nodes.paragraph, { revision: 2 }))

    expect(editor.getMarkdown()).toBe('hello')
    expect(editor.getHTML()).toBe('<p>hello</p>')
    expect(editor.getJSON().content?.[0]?.attrs?.revision).toBe(2)
    expect(seen).toEqual([2])
    editor.destroy()
  })
})
