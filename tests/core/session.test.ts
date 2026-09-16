import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { describe, expect, it, vi } from 'vitest'
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

  it('deletes table rows and columns from the active cell', () => {
    const session = createNexusdownEditor({
      content: '| A | B | C |\n| --- | --- | --- |\n| D | E | F |\n| G | H | I |',
      contentType: 'markdown',
    })
    let textPosition = 0
    session.getEditor().state.doc.descendants((node, position) => {
      if (!textPosition && node.isText) textPosition = position
    })
    session.getEditor().commands.setTextSelection({ from: textPosition, to: textPosition })

    const table = () => session.getEditor().state.doc.firstChild
    expect(table()?.childCount).toBe(3)
    expect(session.commands.deleteTableRow()).toBe(true)
    expect(table()?.childCount).toBe(2)
    expect(table()?.firstChild?.childCount).toBe(3)
    expect(session.commands.deleteTableColumn()).toBe(true)
    expect(table()?.firstChild?.childCount).toBe(2)
    session.destroy()
  })

  it('merges and splits cells inside an active table', () => {
    const session = createNexusdownEditor({
      content: '| A | B |\n| --- | --- |\n| C | D |',
      contentType: 'markdown',
    })
    const editor = session.getEditor()
    const cellPositions: number[] = []
    editor.state.doc.descendants((node, position) => {
      if (cellPositions.length >= 2) return false
      if (node.type.name === 'tableCell') cellPositions.push(position)
      return true
    })

    expect(cellPositions.length).toBeGreaterThanOrEqual(2)
    editor.commands.setCellSelection({ anchorCell: cellPositions[0], headCell: cellPositions[1] })
    expect(session.commands.mergeCells()).toBe(true)
    editor.commands.setCellSelection({ anchorCell: cellPositions[0], headCell: cellPositions[0] })
    expect(session.commands.splitCell()).toBe(true)
    session.destroy()
  })

  it('deletes the whole active table', () => {
    const session = createNexusdownEditor({
      content: '| A | B |\n| --- | --- |\n| C | D |',
      contentType: 'markdown',
    })
    let textPosition = 0
    session.getEditor().state.doc.descendants((node, position) => {
      if (!textPosition && node.isText) textPosition = position
    })
    session.getEditor().commands.setTextSelection({ from: textPosition, to: textPosition })

    expect(session.commands.deleteTable()).toBe(true)
    const doc = session.getEditor().state.doc
    expect(doc.childCount).toBe(1)
    expect(doc.firstChild?.type.name).not.toBe('table')
    session.destroy()
  })

  it('uploads images through an injected imageUpload callback', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/uploaded.png')
    const session = createNexusdownEditor({
      content: '<p>Before</p>',
      contentType: 'html',
      imageUpload: upload,
    })
    const file = new File(['fake'], 'avatar.png', { type: 'image/png' })

    const ok = await session.insertImageFromFile(file)
    expect(ok).toBe(true)
    expect(upload).toHaveBeenCalledWith(file)
    expect(session.getHTML()).toContain('https://cdn.example.com/uploaded.png')
    session.destroy()
  })

  it('refreshes HTML and JSON snapshots when table column width changes without changing Markdown', () => {
    const session = createNexusdownEditor({
      content: '| A | B |\n| --- | --- |\n| C | D |',
      contentType: 'markdown',
    })
    const editor = session.getEditor()
    let textPosition = 0
    editor.state.doc.descendants((node, position) => {
      if (!textPosition && node.isText) textPosition = position
    })
    editor.commands.setTextSelection(textPosition)
    const snapshots: string[] = []
    session.subscribe((snapshot) => snapshots.push(JSON.stringify(snapshot.json)))

    expect(editor.commands.setCellAttribute('colwidth', [180])).toBe(true)

    expect(session.getJSON()).toEqual(editor.getJSON())
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toContain('180')
    session.destroy()
  })

  it('keeps base64 image fallback content when HTML is parsed again', async () => {
    const originalFileReader = globalThis.FileReader
    class DataUrlFileReader {
      result: string | ArrayBuffer | null = null
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null

      readAsDataURL() {
        this.result = 'data:image/png;base64,aGVsbG8='
        this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
      }
    }
    globalThis.FileReader = DataUrlFileReader as unknown as typeof FileReader

    try {
      const session = createNexusdownEditor({ content: '<p>Before</p>', contentType: 'html' })
      const file = new File(['hello'], 'inline.png', { type: 'image/png' })

      await expect(session.insertImageFromFile(file)).resolves.toBe(true)
      const reparsed = createNexusdownEditor({ content: session.getHTML(), contentType: 'html' })

      expect(reparsed.getHTML()).toContain('data:image/png;base64,aGVsbG8=')
      reparsed.destroy()
      session.destroy()
    } finally {
      globalThis.FileReader = originalFileReader
    }
  })

  it('rejects unsafe and blank image upload results', async () => {
    for (const source of ['javascript:alert(1)', '   ']) {
      const session = createNexusdownEditor({
        content: '<p>Before</p>',
        contentType: 'html',
        imageUpload: async () => source,
      })
      const errors: Error[] = []
      session.onError((error) => errors.push(error))

      await expect(session.insertImageFromFile(new File(['x'], 'unsafe.png', { type: 'image/png' }))).resolves.toBe(false)
      expect(session.getHTML()).not.toContain('<img')
      expect(errors).toHaveLength(1)
      session.destroy()
    }
  })

  it('turns synchronous image upload failures into session errors', async () => {
    const session = createNexusdownEditor({
      content: '',
      contentType: 'markdown',
      imageUpload: () => { throw new Error('upload unavailable') },
    })
    const errors: Error[] = []
    session.onError((error) => errors.push(error))

    await expect(session.insertImageFromFile(new File(['x'], 'broken.png', { type: 'image/png' }))).resolves.toBe(false)
    expect(errors.map((error) => error.message)).toEqual(['upload unavailable'])
    session.destroy()
  })

  it('ignores non-image files during image upload', async () => {
    const session = createNexusdownEditor({ content: '', contentType: 'markdown' })
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    await expect(session.insertImageFromFile(file)).resolves.toBe(false)
    session.destroy()
  })

  it('switches paste mode and reports the stored value', () => {
    const session = createNexusdownEditor({ content: '', contentType: 'markdown' })
    expect(session.getPasteMode()).toBe('plain')
    session.setPasteMode('structured')
    expect(session.getPasteMode()).toBe('structured')
    session.setPasteMode('plain')
    expect(session.getPasteMode()).toBe('plain')
    session.destroy()
  })

  it('finds, replaces, and clears matches through the FindReplace extension', () => {
    const session = createNexusdownEditor({ content: 'foo bar foo', contentType: 'markdown' })
    const editor = session.getEditor()

    expect(editor.commands.find('foo')).toBe(true)
    let storage = editor.storage.findReplace
    expect(storage.matches).toHaveLength(2)

    expect(editor.commands.findNext()).toBe(true)
    expect(editor.storage.findReplace.currentIndex).toBe(1)

    expect(editor.commands.findPrev()).toBe(true)
    expect(editor.storage.findReplace.currentIndex).toBe(0)

    expect(editor.commands.replaceCurrent('baz')).toBe(true)
    expect(session.getMarkdown()).toContain('baz bar foo')

    expect(editor.commands.replaceAll('qux')).toBe(true)
    expect(session.getMarkdown()).toContain('baz bar qux')
    expect(editor.storage.findReplace.matches).toHaveLength(0)

    editor.commands.clearFind()
    storage = editor.storage.findReplace
    expect(storage.matches).toHaveLength(0)
    session.destroy()
  })

  it('supports case-sensitive find via the FindReplace storage', () => {
    const session = createNexusdownEditor({ content: 'Foo foo FOO', contentType: 'markdown' })
    const editor = session.getEditor()
    editor.storage.findReplace.caseSensitive = true
    editor.commands.find('foo')
    expect(editor.storage.findReplace.matches).toHaveLength(1)
    session.destroy()
  })

  it('rejects images larger than the configured maxFileSize', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/large.png')
    const session = createNexusdownEditor({
      content: '',
      contentType: 'markdown',
      imageUpload: upload,
      maxFileSize: 3,
    })
    const errors: Error[] = []
    session.onError((error) => errors.push(error))

    await expect(session.insertImageFromFile(new File(['large'], 'large.png', { type: 'image/png' }))).resolves.toBe(false)
    expect(upload).not.toHaveBeenCalled()
    expect(errors[0]?.message).toContain('3 bytes')
    session.destroy()
  })

  it('finds text that spans adjacent inline marks', () => {
    const session = createNexusdownEditor({
      content: '<p>f<strong>o</strong>o and foo</p>',
      contentType: 'html',
    })
    const editor = session.getEditor()

    expect(editor.commands.find('foo')).toBe(true)
    expect(editor.storage.findReplace.matches).toHaveLength(2)
    session.destroy()
  })

  it('advances past replacement text that still contains the search term', () => {
    const session = createNexusdownEditor({ content: 'foo foo', contentType: 'markdown' })
    const editor = session.getEditor()

    editor.commands.find('foo')
    expect(editor.commands.replaceCurrent('foobar')).toBe(true)
    expect(editor.storage.findReplace.currentIndex).toBe(1)
    expect(editor.commands.replaceCurrent('done')).toBe(true)
    expect(session.getMarkdown()).toBe('foobar done')
    session.destroy()
  })

  it('pastes only clipboard plain text in plain mode', () => {
    const OriginalClipboardEvent = globalThis.ClipboardEvent
    globalThis.ClipboardEvent = Event as unknown as typeof ClipboardEvent
    const session = createNexusdownEditor({ content: 'Before', contentType: 'markdown' })
    const editor = session.getEditor()
    editor.commands.selectAll()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [],
        getData: (type: string) => type === 'text/plain' ? 'Pasted' : type === 'text/html' ? '<strong>Pasted</strong>' : '',
      },
    })

    editor.view.dom.dispatchEvent(event)

    expect(session.getMarkdown()).toBe('Pasted')
    expect(session.getHTML()).not.toContain('<strong>')
    session.destroy()
    globalThis.ClipboardEvent = OriginalClipboardEvent
  })

  it('lets Tiptap preserve clipboard HTML in structured mode', () => {
    const OriginalClipboardEvent = globalThis.ClipboardEvent
    globalThis.ClipboardEvent = Event as unknown as typeof ClipboardEvent
    const session = createNexusdownEditor({
      content: 'Before',
      contentType: 'markdown',
      pasteMode: 'structured',
    })
    const editor = session.getEditor()
    editor.commands.selectAll()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [],
        getData: (type: string) => type === 'text/html' ? '<strong>Pasted</strong>' : type === 'text/plain' ? 'Pasted' : '',
      },
    })

    editor.view.dom.dispatchEvent(event)

    expect(session.getHTML()).toContain('<strong>Pasted</strong>')
    session.destroy()
    globalThis.ClipboardEvent = OriginalClipboardEvent
  })

  it('uploads and inserts an image dropped at the captured document position', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/dropped.png')
    const session = createNexusdownEditor({
      content: 'Drop here',
      contentType: 'markdown',
      imageUpload: upload,
    })
    const editor = session.getEditor()
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 })
    const file = new File(['image'], 'dropped.png', { type: 'image/png' })
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      dataTransfer: { value: { files: [file], getData: () => '' } },
      clientX: { value: 0 },
      clientY: { value: 0 },
    })

    editor.view.dom.dispatchEvent(event)
    await vi.waitFor(() => expect(session.getHTML()).toContain('https://cdn.example.com/dropped.png'))

    expect(upload).toHaveBeenCalledWith(file)
    expect(event.defaultPrevented).toBe(true)
    session.destroy()
  })

  it('keeps the original paste position while an image upload is pending', async () => {
    let finishUpload: (value: string) => void = () => undefined
    const session = createNexusdownEditor({
      content: 'Start End',
      contentType: 'markdown',
      imageUpload: () => new Promise((resolve) => { finishUpload = resolve }),
    })
    const editor = session.getEditor()
    editor.commands.setTextSelection(1)
    const file = new File(['image'], 'pasted.png', { type: 'image/png' })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [file], getData: () => '' },
    })

    editor.view.dom.dispatchEvent(event)
    editor.commands.setTextSelection(editor.state.doc.content.size)
    finishUpload('https://cdn.example.com/pasted.png')
    await vi.waitFor(() => expect(session.getHTML()).toContain('pasted.png'))

    expect(session.getHTML().indexOf('pasted.png')).toBeLessThan(session.getHTML().indexOf('Start End'))
    session.destroy()
  })

  it('maps a pending drop position through intervening document changes', async () => {
    let finishUpload: (value: string) => void = () => undefined
    const session = createNexusdownEditor({
      content: 'Start End',
      contentType: 'markdown',
      imageUpload: () => new Promise((resolve) => { finishUpload = resolve }),
    })
    const editor = session.getEditor()
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 6, inside: 0 })
    const file = new File(['image'], 'mapped.png', { type: 'image/png' })
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      dataTransfer: { value: { files: [file], getData: () => '' } },
      clientX: { value: 0 },
      clientY: { value: 0 },
    })

    editor.view.dom.dispatchEvent(event)
    editor.commands.insertContentAt(1, 'Before ')
    finishUpload('https://cdn.example.com/mapped.png')
    await vi.waitFor(() => expect(session.getHTML()).toContain('mapped.png'))

    const html = session.getHTML()
    expect(html.indexOf('Before Start')).toBeLessThan(html.indexOf('mapped.png'))
    expect(html.indexOf('mapped.png')).toBeLessThan(html.indexOf('End'))
    session.destroy()
  })

  it('maps a pending image position through appended transactions', async () => {
    let finishUpload: (value: string) => void = () => undefined
    const PrefixAppender = Extension.create({
      name: 'prefixAppender',
      addProseMirrorPlugins() {
        return [new Plugin({
          appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((transaction) => transaction.docChanged)) return null
            if (transactions.some((transaction) => transaction.getMeta('prefixAppender'))) return null
            return newState.tr.insertText('PREFIX ', 1).setMeta('prefixAppender', true)
          },
        })]
      },
    })
    const session = createNexusdownEditor({
      content: 'Start End',
      contentType: 'markdown',
      extensions: [PrefixAppender],
      imageUpload: () => new Promise((resolve) => { finishUpload = resolve }),
    })
    const editor = session.getEditor()
    editor.commands.setTextSelection(7)
    const file = new File(['image'], 'appended.png', { type: 'image/png' })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [file], getData: () => '' },
    })

    editor.view.dom.dispatchEvent(event)
    editor.commands.insertContentAt(editor.state.doc.content.size, '!')
    finishUpload('https://cdn.example.com/appended.png')
    await vi.waitFor(() => expect(session.getHTML()).toContain('appended.png'))

    const html = session.getHTML()
    expect(html.indexOf('PREFIX Start')).toBeLessThan(html.indexOf('appended.png'))
    expect(html.indexOf('appended.png')).toBeLessThan(html.indexOf('End'))
    session.destroy()
  })

  it('replaces a pending pasted text selection with the uploaded image', async () => {
    let finishUpload: (value: string) => void = () => undefined
    const session = createNexusdownEditor({
      content: 'Before selected After',
      contentType: 'markdown',
      imageUpload: () => new Promise((resolve) => { finishUpload = resolve }),
    })
    const editor = session.getEditor()
    editor.commands.setTextSelection({ from: 8, to: 16 })
    const file = new File(['image'], 'selection.png', { type: 'image/png' })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [file], getData: () => '' },
    })

    editor.view.dom.dispatchEvent(event)
    finishUpload('https://cdn.example.com/selection.png')
    await vi.waitFor(() => expect(session.getHTML()).toContain('selection.png'))

    const html = session.getHTML()
    expect(html).not.toContain('selected')
    expect(html.indexOf('Before')).toBeLessThan(html.indexOf('selection.png'))
    expect(html.indexOf('selection.png')).toBeLessThan(html.indexOf('After'))
    session.destroy()
  })

  it('keeps the invocation selection for a pending public image upload', async () => {
    let finishUpload: (value: string) => void = () => undefined
    const session = createNexusdownEditor({
      content: 'Start End',
      contentType: 'markdown',
      imageUpload: () => new Promise((resolve) => { finishUpload = resolve }),
    })
    const editor = session.getEditor()
    editor.commands.setTextSelection(1)

    const pending = session.insertImageFromFile(new File(['image'], 'public.png', { type: 'image/png' }))
    editor.commands.setTextSelection(editor.state.doc.content.size)
    finishUpload('https://cdn.example.com/public.png')
    await expect(pending).resolves.toBe(true)

    expect(session.getHTML().indexOf('public.png')).toBeLessThan(session.getHTML().indexOf('Start End'))
    session.destroy()
  })

  it('preserves new text when a pending pasted range is replaced during upload', async () => {
    let finishUpload: (value: string) => void = () => undefined
    const session = createNexusdownEditor({
      content: 'Hello',
      contentType: 'markdown',
      imageUpload: () => new Promise((resolve) => { finishUpload = resolve }),
    })
    const editor = session.getEditor()
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { files: [new File(['image'], 'replacement.png', { type: 'image/png' })], getData: () => '' },
    })

    editor.view.dom.dispatchEvent(event)
    editor.view.dispatch(editor.state.tr.delete(1, 6).insertText('NEW', 1))
    finishUpload('https://cdn.example.com/replacement.png')
    await vi.waitFor(() => expect(session.getHTML()).toContain('replacement.png'))

    const html = session.getHTML()
    expect(html).toContain('NEW')
    expect(html.indexOf('NEW')).toBeLessThan(html.indexOf('replacement.png'))
    session.destroy()
  })

  it('scrolls selected find and replace matches into view', () => {
    const session = createNexusdownEditor({ content: 'foo bar foo', contentType: 'markdown' })
    const editor = session.getEditor()
    const scrolled: boolean[] = []
    editor.on('transaction', ({ transaction }) => {
      if (transaction.getMeta('findReplace:refresh')) scrolled.push(transaction.scrolledIntoView)
    })

    editor.commands.find('foo')
    editor.commands.findNext()
    editor.commands.findPrev()
    editor.commands.replaceCurrent('foo')

    expect(scrolled).toEqual([true, true, true, true])
    session.destroy()
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
