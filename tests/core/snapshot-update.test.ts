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
})
