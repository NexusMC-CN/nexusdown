import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * Toggling a mark on a collapsed cursor must refresh the toolbar.
 *
 * With nothing selected, `Mod-b` only sets ProseMirror's `storedMarks`: neither
 * the document nor the selection changes, so no `update` or `selectionUpdate`
 * event fires. The toolbar is driven by the session's selection notifications,
 * so without an explicit announcement the button kept showing the old state
 * while the next typed character would already be bold.
 */
describe('toolbar refresh on stored marks (issue #1 comments)', () => {
  function setup() {
    const editor = createNexusdownEditor({ content: '<p>hello</p>', contentType: 'html' })
    let notices = 0
    editor.onSelectionChange(() => { notices += 1 })
    const instance = editor.getEditor()
    instance.commands.setTextSelection(3)
    return { editor, instance, read: () => notices }
  }

  it('notifies selection listeners when a collapsed-cursor mark toggles on', () => {
    const { editor, instance, read } = setup()
    const before = read()
    instance.commands.toggleBold()
    expect(read()).toBeGreaterThan(before)
    expect(editor.isActive('bold')).toBe(true)
    editor.destroy()
  })

  it('notifies again when the mark toggles back off', () => {
    const { editor, instance, read } = setup()
    instance.commands.toggleBold()
    const afterOn = read()
    instance.commands.toggleBold()
    expect(read()).toBeGreaterThan(afterOn)
    expect(editor.isActive('bold')).toBe(false)
    editor.destroy()
  })

  it('reports the pending format through isActive', () => {
    const { editor, instance } = setup()
    expect(editor.isActive('bold')).toBe(false)
    instance.commands.toggleBold()
    // This is what the toolbar reads to decide the button's active state; it was
    // correct already — it was the notification that was missing.
    expect(editor.isActive('bold')).toBe(true)
    editor.destroy()
  })

  it('does not notify for a transaction that leaves stored marks alone', () => {
    const { editor, instance, read } = setup()
    const before = read()
    // A plain selection move is handled by `selectionUpdate`, not by the
    // stored-mark path, so the count must not grow by more than that one event.
    instance.commands.setTextSelection(1)
    expect(read() - before).toBeLessThanOrEqual(1)
    editor.destroy()
  })
})
