import { describe, expect, it } from 'vitest'
import type { AnyExtension } from '@tiptap/core'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * Toolbar commands must degrade to a no-op, never throw.
 *
 * A consumer can remove optional extensions, and can also render a toolbar item
 * without configuring its options (`imageSrc` for the image item). Both paths
 * reach the command with missing data, and anything that escaped as a TypeError
 * propagated out of the toolbar's click handler and broke the whole render.
 */
function withoutOptionalExtensions(names: string[]) {
  return (extensions: AnyExtension[]): AnyExtension[] =>
    extensions.filter((extension) => !names.includes(extension.name))
}

describe('commands tolerate missing extensions and arguments (issue #1 comments)', () => {
  it('reports optional commands as unusable when their extension is removed', () => {
    const editor = createNexusdownEditor({
      content: '<p>x</p>',
      contentType: 'html',
      extensionResolver: withoutOptionalExtensions(['table', 'taskList', 'taskItem', 'image']),
    })
    expect(editor.can('table')).toBe(false)
    expect(editor.can('task-list')).toBe(false)
    expect(editor.can('image')).toBe(false)
    // Extensions that are still present keep working.
    expect(editor.can('bold')).toBe(true)
    expect(editor.can('heading')).toBe(true)
    editor.destroy()
  })

  it('does not throw when a command whose extension is gone is executed', () => {
    const editor = createNexusdownEditor({
      content: '<p>x</p>',
      contentType: 'html',
      extensionResolver: withoutOptionalExtensions(['table', 'taskList', 'taskItem', 'image']),
    })
    expect(() => editor.commands.insertTable()).not.toThrow()
    expect(() => editor.commands.toggleTaskList()).not.toThrow()
    expect(() => editor.commands.insertImage('https://x.com/a.png')).not.toThrow()
    expect(editor.commands.insertTable()).toBe(false)
    expect(editor.commands.toggleTaskList()).toBe(false)
    editor.destroy()
  })

  it('does not throw when insertImage is called without a source', () => {
    // Regression: `src.trim()` on `undefined` threw
    // `TypeError: Cannot read properties of undefined (reading 'trim')`, which
    // escaped the toolbar's click handler when the image item was rendered
    // without `imageSrc`.
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    const call = editor.commands.insertImage as unknown as () => boolean
    expect(() => call()).not.toThrow()
    expect(call()).toBe(false)
    editor.destroy()
  })

  it('does not throw for non-string alt or title', () => {
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    const call = editor.commands.insertImage as unknown as (
      src: unknown,
      alt?: unknown,
      title?: unknown,
    ) => boolean
    expect(() => call('https://x.com/a.png', 42, {})).not.toThrow()
    expect(() => call(null, null)).not.toThrow()
    expect(call('', 'alt')).toBe(false)
    expect(call('javascript:alert(1)')).toBe(false)
    editor.destroy()
  })

  it('still inserts a valid image', () => {
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    expect(editor.commands.insertImage('https://x.com/a.png', 'alt')).toBe(true)
    const html = editor.getHTML()
    expect(html).toContain('https://x.com/a.png')
    expect(html).toContain('alt="alt"')
    editor.destroy()
  })
})
