import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * Issue #1 comment round 11: initialising in an SSR / DOM-less environment threw
 * from the very first snapshot, because `editor.getHTML()` goes through
 * ProseMirror's DOMSerializer, which needs a `document` to build the fragment.
 * The error (`Cannot read properties of undefined (reading
 * 'createDocumentFragment')`) aborted the server render.
 *
 * HTML is inherently a DOM-only format, so the contract is: constructing works,
 * Markdown and JSON are available, HTML is empty until a DOM exists.
 */
function withoutDocument<T>(run: () => T): T {
  const original = globalThis.document
  // @ts-expect-error deliberately removing the DOM for this test
  delete globalThis.document
  try {
    return run()
  } finally {
    globalThis.document = original
  }
}

describe('SSR / DOM-less construction', () => {
  it('constructs without throwing', () => {
    withoutDocument(() => {
      const editor = createNexusdownEditor({ content: '# hi', contentType: 'markdown' })
      editor.destroy()
    })
  })

  it('still parses and reads Markdown', () => {
    withoutDocument(() => {
      const editor = createNexusdownEditor({ content: '# hi', contentType: 'markdown' })
      expect(editor.getMarkdown()).toBe('# hi')
      editor.destroy()
    })
  })

  it('still exposes JSON', () => {
    withoutDocument(() => {
      const editor = createNexusdownEditor({ content: '# hi', contentType: 'markdown' })
      expect(editor.getJSON().type).toBe('doc')
      editor.destroy()
    })
  })

  it('returns an empty HTML snapshot rather than throwing', () => {
    withoutDocument(() => {
      const editor = createNexusdownEditor({ content: '# hi', contentType: 'markdown' })
      expect(editor.getHTML()).toBe('')
      editor.destroy()
    })
  })

  it('notifies subscribers without touching the DOM', () => {
    withoutDocument(() => {
      const editor = createNexusdownEditor({ content: 'a', contentType: 'markdown' })
      const seen: string[] = []
      editor.subscribe((snapshot) => seen.push(snapshot.markdown))
      editor.setMarkdown('b')
      expect(seen).toContain('b')
      editor.destroy()
    })
  })

  it('still reports HTML normally when a DOM is present', () => {
    const editor = createNexusdownEditor({ content: '# hi', contentType: 'markdown' })
    expect(editor.getHTML()).toContain('<h1>')
    editor.destroy()
  })
})
