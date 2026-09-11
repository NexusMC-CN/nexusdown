import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

describe('NexusdownEditorSession', () => {
  it('parses initial markdown and serializes the same writing structure', () => {
    const session = createNexusdownEditor({
      content: '# Hello\n\nThis is **bold**.',
      contentType: 'markdown',
    })

    expect(session.getMarkdown()).toBe('# Hello\n\nThis is **bold**.')
    expect(session.getHTML()).toContain('<h1>Hello</h1>')
    expect(session.getHTML()).toContain('<strong>bold</strong>')
    session.destroy()
  })

  it('updates markdown once when rich text content changes', () => {
    const session = createNexusdownEditor({ content: '<p>Hello</p>', contentType: 'html' })
    const updates: string[] = []
    const unsubscribe = session.subscribe((snapshot) => updates.push(snapshot.markdown))

    session.setMarkdown('# Updated')

    expect(session.getMarkdown()).toBe('# Updated')
    expect(updates).toEqual(['# Updated'])
    unsubscribe()
    session.destroy()
  })

  it('keeps the previous document and reports parse errors', () => {
    const session = createNexusdownEditor({ content: '# Good', contentType: 'markdown' })
    const errors: string[] = []
    session.onError((error) => errors.push(error.message))

    session.setMarkdown('\u0000')

    expect(session.getMarkdown()).toBe('# Good')
    expect(errors).toHaveLength(1)
    session.destroy()
  })

  it('supports undo and redo history checks', () => {
    const session = createNexusdownEditor({ content: '# Initial', contentType: 'markdown' })

    expect(session.canUndo()).toBe(false)
    expect(session.canRedo()).toBe(false)
    session.setMarkdown('# Updated')
    expect(session.canUndo()).toBe(true)
    expect(session.canRedo()).toBe(false)
    expect(session.undo()).toBe(true)
    expect(session.getMarkdown()).toBe('# Initial')
    expect(session.canRedo()).toBe(true)
    expect(session.redo()).toBe(true)
    expect(session.getMarkdown()).toBe('# Updated')
    session.destroy()
  })

  it('does not notify for an identical markdown snapshot', () => {
    const session = createNexusdownEditor({ content: '# Same', contentType: 'markdown' })
    const updates: string[] = []
    session.subscribe((snapshot) => updates.push(snapshot.markdown))

    session.setMarkdown('# Same')

    expect(updates).toEqual([])
    session.destroy()
  })

  it('allows safe subscription after destroy without future updates', () => {
    const session = createNexusdownEditor({ content: '# Initial', contentType: 'markdown' })
    session.destroy()

    const unsubscribe = session.subscribe(() => {
      throw new Error('destroyed session emitted an update')
    })

    expect(() => unsubscribe()).not.toThrow()
    expect(() => session.setMarkdown('# Updated')).not.toThrow()
  })
})
