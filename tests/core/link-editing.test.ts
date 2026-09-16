import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'
import type { NexusdownEditorSession } from '../../src/core/session'

/** Build a session from Markdown and return it with a helper to find a link. */
function session(markdown: string): NexusdownEditorSession {
  return createNexusdownEditor({ content: markdown, contentType: 'markdown' })
}

/** Position of the first text character carrying a link mark. */
function firstLinkPos(instance: NexusdownEditorSession): number {
  let found = -1
  instance.getEditor().state.doc.descendants((node, pos) => {
    if (found < 0 && node.marks.some((mark) => mark.type.name === 'link')) found = pos + 1
    return true
  })
  return found
}

describe('editing an existing link', () => {
  it('replaces the whole link when the cursor is inside it', () => {
    const editor = session('[docs](https://example.com) tail')
    editor.getEditor().commands.setTextSelection(firstLinkPos(editor))

    expect(editor.commands.setLink('https://new.example.com', 'brand new')).toBe(true)

    // Regression: this used to produce "[d](old)[brand new](new)[ocs](old) tail",
    // splitting and duplicating the original link text.
    expect(editor.getMarkdown()).toBe('[brand new](https://new.example.com) tail')
    editor.destroy()
  })

  it('retargets the href without touching the label when no text is given', () => {
    const editor = session('[docs](https://example.com) tail')
    editor.getEditor().commands.setTextSelection(firstLinkPos(editor))

    expect(editor.commands.setLink('https://new.example.com')).toBe(true)

    expect(editor.getMarkdown()).toBe('[docs](https://new.example.com) tail')
    editor.destroy()
  })

  it('covers the entire link when only part of it is selected', () => {
    const editor = session('[docs](https://example.com) tail')
    const start = firstLinkPos(editor)
    // Select just "oc" in the middle of the link.
    editor.getEditor().commands.setTextSelection({ from: start + 1, to: start + 3 })

    expect(editor.commands.setLink('https://new.example.com', 'replaced')).toBe(true)

    expect(editor.getMarkdown()).toBe('[replaced](https://new.example.com) tail')
    editor.destroy()
  })

  it('still inserts a fresh link when the cursor is not inside one', () => {
    const editor = session('plain text')
    editor.getEditor().commands.setTextSelection(6)

    expect(editor.commands.setLink('https://example.com', 'link')).toBe(true)

    expect(editor.getMarkdown()).toBe('plain[link](https://example.com) text')
    editor.destroy()
  })

  it('leaves neighbouring links untouched', () => {
    const editor = session('[one](https://one.example.com) and [two](https://two.example.com)')
    editor.getEditor().commands.setTextSelection(firstLinkPos(editor))

    expect(editor.commands.setLink('https://renamed.example.com', 'ONE')).toBe(true)

    expect(editor.getMarkdown()).toBe('[ONE](https://renamed.example.com) and [two](https://two.example.com)')
    editor.destroy()
  })

  it('removes the link when no href is supplied', () => {
    const editor = session('[docs](https://example.com) tail')
    editor.getEditor().commands.setTextSelection(firstLinkPos(editor))

    expect(editor.commands.setLink()).toBe(true)

    expect(editor.getMarkdown()).toBe('docs tail')
    editor.destroy()
  })
})
