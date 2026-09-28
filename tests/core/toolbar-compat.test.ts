import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'
import { createDefaultToolbarItems } from '../../src/core/toolbar'
import type { ToolbarItem } from '../../src/core/toolbar'

/** Build a ToolbarItem with an id outside the built-in set, checking the type allows it. */
const customItem: ToolbarItem = {
  id: 'badge',
  group: 'custom-group',
  icon: 'lucide:award',
  label: '徽章',
  execute: () => true,
}

describe('toolbar and extension compatibility (issue #1 comments)', () => {
  it('accepts a custom button id and group', () => {
    // Regression: `ToolbarItem.id` was a closed union of built-in command names,
    // so registering a button for a custom extension was a compile error
    // (TS2322) even though the runtime supports it.
    expect(customItem.id).toBe('badge')
    expect(customItem.group).toBe('custom-group')
  })

  it('does not offer the formats that can only serialise as HTML', () => {
    // Colour, underline, superscript, subscript and alignment were removed:
    // Markdown has no syntax for them, so the only serialisations were a BBCode
    // shortcode or raw HTML. The toolbar must not render an entry point for a
    // format the editor cannot write.
    //
    // Highlight is deliberately NOT in this list. It was removed alongside them,
    // then brought back on the plain-text `==text==` syntax (the Obsidian /
    // Typora / markdown-it-mark convention), which keeps the dialect free of
    // HTML — see the purity tests.
    const ids = new Set(createDefaultToolbarItems().map((item) => item.id))
    for (const removed of ['color', 'underline', 'superscript', 'subscript']) {
      expect(ids.has(removed), `toolbar must not offer ${removed}`).toBe(false)
    }
    expect(ids.has('highlight'), 'toolbar must offer highlight').toBe(true)

    const editor = createNexusdownEditor({ content: '<p>hello</p>', contentType: 'html' })
    // The session no longer exposes the colour command at all.
    expect('setColor' in editor.commands).toBe(false)
    expect('hasTextColor' in editor).toBe(false)
    editor.destroy()
  })

  it('keeps the toolbar usable when optional extensions are removed', async () => {
    // Regression: `can()` and the commands called chain methods contributed by
    // optional extensions. Removing the table, task list or image extensions
    // made those methods absent, so probing or clicking the corresponding
    // toolbar button threw `TypeError: chain.toggleTaskList is not a function`
    // and broke the render.
    const removed = ['tableKit', 'table', 'image', 'taskList', 'taskItem']
    const editor = createNexusdownEditor({
      content: '<p>hello</p>',
      contentType: 'html',
      extensionResolver: (extensions) =>
        extensions.filter((extension) => !removed.includes(extension.name ?? '')),
    })

    for (const name of removed) {
      expect(editor.getEditor().extensionManager.extensions.some((ext) => ext.name === name)).toBe(false)
    }

    // Probing must report "unavailable" rather than throwing.
    expect(() => editor.can('task-list')).not.toThrow()
    expect(editor.can('task-list')).toBe(false)
    expect(editor.can('table')).toBe(false)
    expect(editor.can('image')).toBe(false)

    // Invoking them must report failure rather than throwing.
    expect(() => editor.commands.toggleTaskList()).not.toThrow()
    expect(editor.commands.toggleTaskList()).toBe(false)
    expect(editor.commands.insertTable()).toBe(false)
    expect(editor.commands.insertImage('https://example.com/a.png')).toBe(false)

    // Commands that are still present keep working.
    expect(editor.commands.toggleBold()).toBe(true)
    editor.destroy()
  })

  it('keeps the heading command available when H2 is not an allowed level', async () => {
    // Regression: `can('heading')` probed level 2 only, so configuring heading
    // levels without H2 (here H1/H3) reported the command as unavailable and the
    // entire heading menu was disabled even though those levels worked.
    //
    // Levels are configured through `StarterKit`, which is where the heading
    // extension actually lives — resolving `heading` by name does not match it.
    const { StarterKit } = await import('@tiptap/starter-kit')
    const editor = createNexusdownEditor({
      content: '<p>hello</p>',
      contentType: 'html',
      extensionResolver: (extensions) =>
        extensions.map((extension) =>
          extension.name === 'starterKit'
            ? StarterKit.configure({ heading: { levels: [1, 3] } })
            : extension,
        ),
    })

    const instance = editor.getEditor()
    const heading = instance.extensionManager.extensions.find((ext) => ext.name === 'heading')
    expect((heading?.options as { levels?: number[] }).levels).toEqual([1, 3])
    // H2 really is unavailable, so the old level-2 probe reported `false`.
    expect(instance.can().setHeading({ level: 2 })).toBe(false)
    expect(instance.can().setHeading({ level: 1 })).toBe(true)
    // The menu must stay usable anyway.
    expect(editor.can('heading')).toBe(true)
    editor.destroy()
  })
})
