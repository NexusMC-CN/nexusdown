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

  it('exposes framework-agnostic formatting commands and state queries', () => {
    const session = createNexusdownEditor({ content: '<p>Hello</p>', contentType: 'html' })

    expect(session.can('bold')).toBe(true)
    expect(session.commands.toggleBold()).toBe(true)
    expect(session.isActive('bold')).toBe(true)
    expect(session.commands.setHeading(2)).toBe(true)
    expect(session.isActive('heading', { level: 2 })).toBe(true)
    expect(session.commands.setLink('https://example.com')).toBe(true)
    expect(session.isActive('link')).toBe(true)

    session.destroy()
    expect(session.can('bold')).toBe(false)
    expect(session.isActive('bold')).toBe(false)
    expect(session.commands.undo()).toBe(false)
  })

  it('supports built-in mark, color, and highlight commands', () => {
    const session = createNexusdownEditor({ content: '<p>Hello</p>', contentType: 'html' })
    session.getEditor().commands.selectAll()

    expect(session.commands.toggleUnderline()).toBe(true)
    expect(session.commands.toggleSuperscript()).toBe(true)
    expect(session.commands.setColor('#ff0000')).toBe(true)
    expect(session.commands.setHighlight('#ffff00')).toBe(true)
    expect(session.isActive('textStyle')).toBe(true)
    expect(session.isActive('highlight')).toBe(true)

    expect(session.getHTML()).toContain('<u>')
    expect(session.getHTML()).toContain('color: rgb(255, 0, 0)')
    expect(session.getHTML()).toContain('background-color: rgb(255, 255, 0)')
    expect(session.getMarkdown()).toContain('Hello')
    session.destroy()
  })

  it('keeps color and highlight commands available on an empty paragraph', () => {
    const session = createNexusdownEditor({ content: '<p></p>', contentType: 'html' })

    expect(session.can('color')).toBe(true)
    expect(session.can('highlight')).toBe(true)
    expect(session.commands.setColor('#2563eb')).toBe(true)
    expect(session.commands.setHighlight('#fef08a')).toBe(true)
    session.getEditor().commands.insertContent('Styled')

    expect(session.getHTML()).toContain('color: rgb(37, 99, 235)')
    expect(session.getHTML()).toContain('background-color: rgb(254, 240, 138)')
    session.destroy()
  })

  it('inserts editable tables and images with Markdown output', () => {
    const session = createNexusdownEditor({ content: '<p>Before</p>', contentType: 'html' })

    expect(session.can('table')).toBe(true)
    expect(session.commands.insertTable(2, 3)).toBe(true)
    expect(session.getHTML()).toContain('<table')
    expect(session.getHTML()).toContain('<td')
    expect(session.getMarkdown()).toContain('|')

    expect(session.can('image')).toBe(true)
    expect(session.commands.insertImage('https://example.com/image.png', 'Example')).toBe(true)
    expect(session.getHTML()).toContain('src="https://example.com/image.png"')
    expect(session.getMarkdown()).toContain('![Example](https://example.com/image.png)')
    session.destroy()
  })

  it('adds rows and columns after the active table cell', () => {
    const session = createNexusdownEditor({
      content: '| A | B |\n| --- | --- |\n| C | D |',
      contentType: 'markdown',
    })
    let textPosition = 0
    session.getEditor().state.doc.descendants((node, position) => {
      if (!textPosition && node.isText) textPosition = position
    })
    session.getEditor().commands.setTextSelection({ from: textPosition, to: textPosition })

    const table = () => session.getEditor().state.doc.firstChild
    expect(table()?.childCount).toBe(2)
    expect(session.commands.addTableRow()).toBe(true)
    expect(table()?.childCount).toBe(3)
    expect(session.commands.addTableColumn()).toBe(true)
    expect(table()?.firstChild?.childCount).toBe(3)
    session.destroy()
  })

  it('preserves text color with a shortcode Markdown syntax', () => {
    const session = createNexusdownEditor({ content: '<p>Hello</p>', contentType: 'html' })
    session.getEditor().commands.selectAll()

    expect(session.commands.setColor('#ff0000')).toBe(true)
    expect(session.getMarkdown()).toContain('[color color="#ff0000"]Hello[/color]')

    const parsed = createNexusdownEditor({ content: session.getMarkdown(), contentType: 'markdown' })
    expect(parsed.getHTML()).toContain('color: rgb(255, 0, 0)')
    parsed.destroy()
    session.destroy()
  })

  it('accepts legacy inline HTML when a color value cannot use the shortcode syntax', () => {
    const session = createNexusdownEditor({
      content: '<span style="color: var(--brand-color)">Hello</span>',
      contentType: 'html',
    })

    expect(session.getMarkdown()).toContain('<span style="color: var(--brand-color)">Hello</span>')
    session.destroy()
  })

  it('inserts a linked label when the link command receives text', () => {
    const session = createNexusdownEditor({ content: '', contentType: 'markdown' })

    expect(session.getSelectedText()).toBe('')
    expect(session.getLinkHref()).toBe('')
    expect(session.commands.setLink('https://example.com', 'Docs')).toBe(true)
    expect(session.getMarkdown()).toContain('[Docs](https://example.com)')

    session.destroy()
  })

  it('updates the whole active link when its label is edited from a caret', () => {
    const session = createNexusdownEditor({
      content: '[Docs](https://old.example.com)',
      contentType: 'markdown',
    })
    session.getEditor().commands.setTextSelection({ from: 2, to: 2 })

    expect(session.getSelectedText()).toBe('Docs')
    expect(session.getLinkHref()).toBe('https://old.example.com')
    expect(session.commands.setLink('https://new.example.com', 'Guide')).toBe(true)
    expect(session.getMarkdown()).toContain('[Guide](https://new.example.com)')
    expect(session.getMarkdown()).not.toContain('Docs')

    session.destroy()
  })

  it('renders task items with a checkbox and an editable content column', () => {
    const session = createNexusdownEditor({
      content: '- [ ] First task',
      contentType: 'markdown',
    })

    const item = session.getEditor().view.dom.querySelector('[data-type="taskList"] li')
    expect(item?.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(item?.querySelector('div p')?.textContent).toBe('First task')

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

  it('notifies selection subscribers when the active line changes', () => {
    const session = createNexusdownEditor({ content: '> Quote\n\nPlain', contentType: 'markdown' })
    let changes = 0
    const unsubscribe = session.onSelectionChange(() => { changes++ })

    session.getEditor().commands.setTextSelection({ from: 1, to: 1 })
    session.getEditor().commands.setTextSelection({ from: 10, to: 10 })

    expect(changes).toBeGreaterThanOrEqual(1)
    unsubscribe()
    session.destroy()
  })
})
