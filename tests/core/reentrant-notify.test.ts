import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * Re-entrant notification ordering (issue #1 comment 7).
 *
 * A subscriber is allowed to mutate the document from inside its callback. That
 * edit re-enters the notification loop while the current pass is still running,
 * so a naive implementation hands the subscribers positioned *after* the
 * mutating one a snapshot that is already obsolete — a consumer that persists on
 * every notification would then overwrite the new content with the stale one.
 * Only the newest snapshot may reach subscribers.
 */
describe('re-entrant subscriber notifications (issue #1 comments)', () => {
  it('never delivers a superseded snapshot to later subscribers', () => {
    const editor = createNexusdownEditor({ content: '<p>start</p>', contentType: 'html' })
    const seenByLate: string[] = []
    let mutated = false

    editor.subscribe(() => {
      if (mutated) return
      mutated = true
      // Re-entrant mutation from inside a subscriber callback.
      editor.setMarkdown('second')
    })
    editor.subscribe((snapshot) => { seenByLate.push(snapshot.markdown) })

    editor.setMarkdown('first')

    // The late subscriber must see the final content, never the superseded value.
    expect(seenByLate).toEqual(['second'])
    expect(seenByLate).not.toContain('first')
    editor.destroy()
  })

  it('leaves the snapshot agreeing with the editor after a re-entrant edit', () => {
    const editor = createNexusdownEditor({ content: '<p>start</p>', contentType: 'html' })
    let mutated = false
    editor.subscribe(() => {
      if (mutated) return
      mutated = true
      editor.setMarkdown('final')
    })
    editor.setMarkdown('first')
    expect(editor.getSnapshot().markdown).toBe('final')
    expect(editor.getMarkdown()).toBe('final')
    editor.destroy()
  })

  it('still isolates a throwing subscriber and keeps notifying the rest', () => {
    const editor = createNexusdownEditor({ content: '<p>a</p>', contentType: 'html' })
    const errors: string[] = []
    let reachedLate = 0
    editor.onError((error) => errors.push(error.message))
    editor.subscribe(() => { throw new Error('subscriber boom') })
    editor.subscribe(() => { reachedLate += 1 })

    editor.setMarkdown('changed')

    expect(reachedLate).toBeGreaterThan(0)
    expect(errors.join()).toContain('subscriber boom')
    // A throwing callback must not leave the snapshot behind the document.
    expect(editor.getSnapshot().markdown).toBe(editor.getMarkdown())
    editor.destroy()
  })
})
