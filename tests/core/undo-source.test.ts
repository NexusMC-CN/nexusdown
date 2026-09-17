import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * `undo()` / `redo()` used to set the `'history'` source *before* running the
 * command. When there was nothing to undo the command returned false and no
 * `update` fired to clear the flag, so the next unrelated edit was reported as
 * coming from history and a consumer keying off the source misclassified it.
 */
describe('undo/redo source hygiene (issue #1 comments)', () => {
  it('a no-op undo does not mislabel the next edit as history', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    expect(editor.canUndo()).toBe(false)
    expect(editor.undo()).toBe(false)

    const sources: string[] = []
    editor.subscribe((snapshot) => sources.push(snapshot.source))
    editor.getEditor().commands.insertContent('b')

    expect(sources).toEqual(['rich-text'])
    expect(sources).not.toContain('history')
    editor.destroy()
  })

  it('a no-op redo does not mislabel the next edit as history', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    expect(editor.canRedo()).toBe(false)
    expect(editor.redo()).toBe(false)

    const sources: string[] = []
    editor.subscribe((snapshot) => sources.push(snapshot.source))
    editor.getEditor().commands.insertContent('b')

    expect(sources).not.toContain('history')
    editor.destroy()
  })

  it('a real undo is still reported as history', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    editor.getEditor().commands.insertContent('b')
    const sources: string[] = []
    editor.subscribe((snapshot) => sources.push(snapshot.source))

    expect(editor.undo()).toBe(true)
    expect(sources).toContain('history')
    editor.destroy()
  })

  it('a real redo is reported as history', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    editor.getEditor().commands.insertContent('b')
    editor.undo()
    const sources: string[] = []
    editor.subscribe((snapshot) => sources.push(snapshot.source))

    expect(editor.redo()).toBe(true)
    expect(sources).toContain('history')
    editor.destroy()
  })
})
