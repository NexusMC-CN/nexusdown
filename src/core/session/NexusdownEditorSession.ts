import { Editor, type JSONContent } from '@tiptap/core'
import { Selection, type Transaction } from '@tiptap/pm/state'
import { createNexusdownExtensions } from '../extensions/index.js'
import type { NexusdownExtensionOptions } from '../extensions/types.js'

export type ContentType = 'json' | 'html' | 'markdown'
export type SessionSource = 'rich-text' | 'markdown' | 'history'
export type PasteMode = 'plain' | 'structured'

export interface NexusdownEditorOptions {
  content: string | JSONContent
  contentType: ContentType
  /** Additional Tiptap extensions enabled for this session. */
  extensions?: NexusdownExtensionOptions['extensions']
  /** Customize the final extension list before creating the editor. */
  extensionResolver?: NexusdownExtensionOptions['resolve']
  /**
   * Resolve an image file to its final source. When omitted the file is read
   * as a base64 data URL. When provided, its resolved value is used instead.
   */
  imageUpload?: (file: File) => Promise<string>
  /** Maximum accepted local image size in bytes. Omit to allow any size. */
  maxFileSize?: number
  /**
   * Default paste behavior. `plain` keeps only the clipboard text while
   * `structured` keeps rich HTML. Defaults to `plain`.
   */
  pasteMode?: PasteMode
}

export interface NexusdownEditorSnapshot {
  markdown: string
  html: string
  json: JSONContent
  source: SessionSource
}

export type SessionSubscriber = (snapshot: NexusdownEditorSnapshot) => void
export type SessionErrorSubscriber = (error: Error) => void
export type SessionSelectionSubscriber = () => void
type PendingImageAnchor = { from: number; to: number }

export type EditorCommand =
  | 'undo'
  | 'redo'
  | 'heading'
  | 'blockquote'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'code-block'
  | 'horizontal-rule'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'underline'
  | 'superscript'
  | 'subscript'
  | 'color'
  | 'highlight'
  | 'link'
  | 'table'
  | 'image'

export interface NexusdownEditorCommands {
  undo: () => boolean
  redo: () => boolean
  setHeading: (level?: number) => boolean
  toggleBlockquote: () => boolean
  toggleBulletList: () => boolean
  toggleOrderedList: () => boolean
  toggleTaskList: () => boolean
  toggleCodeBlock: () => boolean
  setHorizontalRule: () => boolean
  toggleBold: () => boolean
  toggleItalic: () => boolean
  toggleStrike: () => boolean
  toggleCode: () => boolean
  toggleUnderline: () => boolean
  toggleSuperscript: () => boolean
  toggleSubscript: () => boolean
  setColor: (color?: string) => boolean
  setHighlight: (color?: string) => boolean
  setLink: (href?: string, text?: string) => boolean
  insertTable: (rows?: number, cols?: number) => boolean
  addTableRow: () => boolean
  addTableColumn: () => boolean
  deleteTableRow: () => boolean
  deleteTableColumn: () => boolean
  deleteTable: () => boolean
  mergeCells: () => boolean
  splitCell: () => boolean
  setCodeBlockLanguage: (language: string) => boolean
  insertImage: (src: string, alt?: string, title?: string) => boolean
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

function normalizeHeadingLevel(level: number): HeadingLevel {
  return Math.min(6, Math.max(1, Math.trunc(level))) as HeadingLevel
}

function normalizeTableSize(size: number | undefined): number {
  return Math.min(10, Math.max(1, Math.trunc(size ?? 3)))
}

function normalizeMaxFileSize(size: number | undefined): number | undefined {
  return typeof size === 'number' && Number.isFinite(size) && size >= 0
    ? Math.trunc(size)
    : undefined
}

function isSafeImageSource(src: string): boolean {
  return !/^javascript:/i.test(src.trim())
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Unable to read image file'))
    reader.readAsDataURL(file)
  })
}

export class NexusdownEditorSession {
  private readonly editor: Editor
  private pasteMode: PasteMode
  private imageUpload: ((file: File) => Promise<string>) | undefined
  private maxFileSize: number | undefined
  readonly commands: NexusdownEditorCommands
  private readonly subscribers = new Set<SessionSubscriber>()
  private readonly errorSubscribers = new Set<SessionErrorSubscriber>()
  private readonly selectionSubscribers = new Set<SessionSelectionSubscriber>()
  private readonly pasteModeSubscribers = new Set<(mode: PasteMode) => void>()
  private readonly pendingImageAnchors = new Set<PendingImageAnchor>()
  private destroyed = false
  private pendingSource: SessionSource | undefined
  private snapshot: NexusdownEditorSnapshot

  constructor(options: NexusdownEditorOptions) {
    this.pasteMode = options.pasteMode ?? 'plain'
    this.imageUpload = options.imageUpload
    this.maxFileSize = normalizeMaxFileSize(options.maxFileSize)
    this.editor = new Editor({
      element: typeof document === 'undefined' ? null : document.createElement('div'),
      extensions: createNexusdownExtensions({
        extensions: options.extensions,
        resolve: options.extensionResolver,
      }),
      content: options.content,
      contentType: options.contentType,
      editorProps: {
        handlePaste: (view, event) => this.handlePasteEvent(view, event),
        handleDrop: (view, event, slice, moved) => this.handleDropEvent(view, event, slice, moved),
      },
    })
    this.commands = {
      undo: () => this.undo(),
      redo: () => this.redo(),
      setHeading: (level = 2) => this.editor.chain().focus().setHeading({ level: normalizeHeadingLevel(level) }).run(),
      toggleBlockquote: () => this.editor.chain().focus().toggleBlockquote().run(),
      toggleBulletList: () => this.editor.chain().focus().toggleBulletList().run(),
      toggleOrderedList: () => this.editor.chain().focus().toggleOrderedList().run(),
      toggleTaskList: () => this.editor.chain().focus().toggleTaskList().run(),
      toggleCodeBlock: () => this.editor.chain().focus().toggleCodeBlock().run(),
      setHorizontalRule: () => this.editor.chain().focus().setHorizontalRule().run(),
      toggleBold: () => this.editor.chain().focus().toggleBold().run(),
      toggleItalic: () => this.editor.chain().focus().toggleItalic().run(),
      toggleStrike: () => this.editor.chain().focus().toggleStrike().run(),
      toggleCode: () => this.editor.chain().focus().toggleCode().run(),
      toggleUnderline: () => this.editor.chain().focus().toggleUnderline().run(),
      toggleSuperscript: () => this.editor.chain().focus().toggleSuperscript().run(),
      toggleSubscript: () => this.editor.chain().focus().toggleSubscript().run(),
      setColor: (color) => color
        ? this.editor.chain().focus().setColor(color).run()
        : this.editor.chain().focus().unsetColor().run(),
      setHighlight: (color) => color
        ? this.editor.chain().focus().setHighlight({ color }).run()
        : this.editor.chain().focus().unsetHighlight().run(),
      setLink: (href, text) => {
        const chain = this.editor.chain().focus()
        if (!href) return chain.unsetLink().run()
        if (text !== undefined && text.length > 0) {
          return chain.insertContent({
            type: 'text',
            text,
            marks: [{ type: 'link', attrs: { href } }],
          }).run()
        }
        return chain.setLink({ href }).run()
      },
      insertTable: (rows = 3, cols = 3) => this.editor.chain().focus().insertTable({
        rows: normalizeTableSize(rows),
        cols: normalizeTableSize(cols),
        withHeaderRow: true,
      }).run(),
      addTableRow: () => this.editor.chain().focus().addRowAfter().run(),
      addTableColumn: () => this.editor.chain().focus().addColumnAfter().run(),
      deleteTableRow: () => this.editor.chain().focus().deleteRow().run(),
      deleteTableColumn: () => this.editor.chain().focus().deleteColumn().run(),
      deleteTable: () => this.editor.chain().focus().deleteTable().run(),
      mergeCells: () => this.editor.chain().focus().mergeCells().run(),
      splitCell: () => this.editor.chain().focus().splitCell().run(),
      setCodeBlockLanguage: (language) => this.editor.chain().focus().updateAttributes('codeBlock', { language }).run(),
      insertImage: (src, alt = '', title) => {
        const value = src.trim()
        if (!value || !isSafeImageSource(value)) return false
        return this.editor.chain().focus().setImage({
          src: value,
          alt: alt.trim() || undefined,
          title: title?.trim() || undefined,
        }).run()
      },
    }
    this.snapshot = this.createSnapshot(options.contentType === 'markdown' ? 'markdown' : 'rich-text')
    this.editor.on('update', () => {
      if (this.destroyed) return
      const source = this.pendingSource ?? 'rich-text'
      this.pendingSource = undefined
      const next = this.createSnapshot(source)
      if (
        next.markdown === this.snapshot.markdown &&
        next.html === this.snapshot.html &&
        JSON.stringify(next.json) === JSON.stringify(this.snapshot.json)
      ) return
      this.snapshot = next
      for (const subscriber of this.subscribers) subscriber(next)
    })
    this.editor.on('transaction', ({ transaction, appendedTransactions }) => {
      for (const pendingTransaction of [transaction, ...appendedTransactions]) {
        this.mapPendingImageAnchors(pendingTransaction)
      }
    })
    this.editor.on('selectionUpdate', () => {
      if (this.destroyed) return
      for (const subscriber of this.selectionSubscribers) subscriber()
    })
  }

  getMarkdown(): string { return this.snapshot.markdown }
  getHTML(): string { return this.snapshot.html }
  getJSON(): JSONContent { return this.snapshot.json }
  getSnapshot(): NexusdownEditorSnapshot { return this.snapshot }
  getEditor(): Editor { return this.editor }
  getSelectedText(): string {
    if (this.destroyed) return ''
    const { from, to } = this.editor.state.selection
    if (from !== to) return this.editor.state.doc.textBetween(from, to, '\n')
    const href = this.getLinkHref()
    if (!href) return ''
    const parent = this.editor.state.selection.$from.parent
    const offset = this.editor.state.selection.$from.parentOffset
    let cursor = 0
    let activeText = ''
    parent.forEach((node) => {
      if (!node.isText) {
        cursor += node.nodeSize
        return
      }
      const end = cursor + node.nodeSize
      const isLink = node.marks.some((mark) => mark.type.name === 'link' && mark.attrs.href === href)
      if (isLink && offset >= cursor && offset <= end) activeText = node.text ?? ''
      cursor = end
    })
    return activeText
  }
  getLinkHref(): string { return this.destroyed ? '' : String(this.editor.getAttributes('link').href ?? '') }

  can(command: EditorCommand): boolean {
    if (this.destroyed) return false
    const chain = this.editor.can().chain().focus()
    switch (command) {
      case 'undo': return chain.undo().run()
      case 'redo': return chain.redo().run()
      case 'heading': return chain.setHeading({ level: 2 }).run()
      case 'blockquote': return chain.toggleBlockquote().run()
      case 'bullet-list': return chain.toggleBulletList().run()
      case 'ordered-list': return chain.toggleOrderedList().run()
      case 'task-list': return chain.toggleTaskList().run()
      case 'code-block': return chain.toggleCodeBlock().run()
      case 'horizontal-rule': return chain.setHorizontalRule().run()
      case 'bold': return chain.toggleBold().run()
      case 'italic': return chain.toggleItalic().run()
      case 'strike': return chain.toggleStrike().run()
      case 'code': return chain.toggleCode().run()
      case 'underline': return chain.toggleUnderline().run()
      case 'superscript': return chain.toggleSuperscript().run()
      case 'subscript': return chain.toggleSubscript().run()
      case 'color': return chain.setColor('#2563eb').run()
      case 'highlight': return chain.setHighlight({ color: '#fef08a' }).run()
      case 'link': return chain.setLink({ href: 'https://example.com' }).run()
      case 'table': return chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      case 'image': return chain.setImage({ src: 'https://example.com/image.png' }).run()
    }
  }

  isActive(name: string, attributes?: Record<string, unknown>): boolean {
    return !this.destroyed && this.editor.isActive(name, attributes)
  }

  focus(): void {
    if (!this.destroyed) this.editor.commands.focus()
  }

  setContent(content: string | JSONContent, contentType: ContentType = 'html'): void {
    if (this.destroyed) return
    if (contentType === 'markdown' && typeof content !== 'string') {
      this.emitError(new Error('Markdown content must be a string'))
      return
    }
    const previous = this.editor.getJSON()
    try {
      this.pendingSource = contentType === 'markdown' ? 'markdown' : 'rich-text'
      const applied = this.editor.commands.setContent(content, { contentType, emitUpdate: true })
      if (!applied) throw new Error('Unable to set content')
    } catch (error) {
      this.pendingSource = undefined
      this.editor.commands.setContent(previous, { contentType: 'json', emitUpdate: false })
      this.emitError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  subscribe(subscriber: SessionSubscriber): () => void {
    if (this.destroyed) return () => undefined
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  onError(subscriber: SessionErrorSubscriber): () => void {
    if (this.destroyed) return () => undefined
    this.errorSubscribers.add(subscriber)
    return () => this.errorSubscribers.delete(subscriber)
  }

  onSelectionChange(subscriber: SessionSelectionSubscriber): () => void {
    if (this.destroyed) return () => undefined
    this.selectionSubscribers.add(subscriber)
    return () => this.selectionSubscribers.delete(subscriber)
  }

  setMarkdown(markdown: string): void {
    if (this.destroyed || markdown === this.snapshot.markdown) return
    const previous = this.editor.getJSON()
    try {
      if (markdown.includes('\0')) throw new Error('Invalid markdown content')
      this.pendingSource = 'markdown'
      const applied = this.editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: true })
      if (!applied) throw new Error('Unable to set markdown content')
    } catch (error) {
      this.pendingSource = undefined
      this.editor.commands.setContent(previous, { contentType: 'json', emitUpdate: false })
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.emitError(normalized)
    }
  }

  undo(): boolean {
    if (this.destroyed) return false
    this.pendingSource = 'history'
    return this.editor.commands.undo()
  }

  redo(): boolean {
    if (this.destroyed) return false
    this.pendingSource = 'history'
    return this.editor.commands.redo()
  }

  canUndo(): boolean { return !this.destroyed && this.editor.can().undo() }
  canRedo(): boolean { return !this.destroyed && this.editor.can().redo() }

  getPasteMode(): PasteMode {
    return this.pasteMode
  }

  setPasteMode(mode: PasteMode): void {
    if (this.destroyed || mode === this.pasteMode) return
    this.pasteMode = mode
    for (const subscriber of this.pasteModeSubscribers) subscriber(mode)
  }

  onPasteModeChange(subscriber: (mode: PasteMode) => void): () => void {
    if (this.destroyed) return () => undefined
    this.pasteModeSubscribers.add(subscriber)
    return () => this.pasteModeSubscribers.delete(subscriber)
  }

  setImageUpload(imageUpload: ((file: File) => Promise<string>) | undefined): void {
    if (!this.destroyed) this.imageUpload = imageUpload
  }

  setMaxFileSize(maxFileSize: number | undefined): void {
    if (!this.destroyed) this.maxFileSize = normalizeMaxFileSize(maxFileSize)
  }

  insertImageFromFile(file: File, position?: number): Promise<boolean> {
    if (this.destroyed) return Promise.resolve(false)
    if (typeof position === 'number' && Number.isFinite(position)) {
      return this.insertImageFromFileAtRange(file, position, position)
    }
    const { from, to } = this.editor.state.selection
    return this.insertImageFromFileAtRange(file, from, to)
  }

  private insertImageFromFileAtRange(file: File, from?: number, to?: number): Promise<boolean> {
    if (this.destroyed || !this.editor.isEditable) return Promise.resolve(false)
    if (!file.type.startsWith('image/')) return Promise.resolve(false)
    if (this.maxFileSize !== undefined && file.size > this.maxFileSize) {
      this.emitError(new Error(`Image file exceeds the ${this.maxFileSize} bytes limit`))
      return Promise.resolve(false)
    }
    const anchor = typeof from === 'number' && Number.isFinite(from)
      ? this.createPendingImageAnchor(from, to)
      : undefined
    if (anchor) this.pendingImageAnchors.add(anchor)
    let sourcePromise: Promise<string>
    try {
      sourcePromise = this.imageUpload
        ? Promise.resolve(this.imageUpload(file))
        : readFileAsDataURL(file)
    } catch (error) {
      sourcePromise = Promise.reject(error)
    }
    return sourcePromise.then((src) => {
      if (this.destroyed || !this.editor.isEditable) return false
      const value = src.trim()
      if (!value || !isSafeImageSource(value)) {
        throw new Error('Image upload returned an invalid source')
      }
      if (!anchor) {
        return this.editor.chain().focus().setImage({ src: value, alt: file.name }).run()
      }
      const range = this.createPendingImageAnchor(anchor.from, anchor.to)
      return this.editor.chain().focus().insertContentAt(range, {
        type: 'image',
        attrs: { src: value, alt: file.name },
      }).run()
    }).catch((error) => {
      this.emitError(error instanceof Error ? error : new Error(String(error)))
      return false
    }).finally(() => {
      if (anchor) this.pendingImageAnchors.delete(anchor)
    })
  }

  private handlePasteEvent(view: import('@tiptap/pm/view').EditorView, event: ClipboardEvent): boolean {
    if (this.destroyed || !this.editor.isEditable) return false
    const files = Array.from(event.clipboardData?.files ?? [])
    const image = files.find((file) => file.type.startsWith('image/'))
    if (image) {
      event.preventDefault()
      void this.insertImageFromFileAtRange(image, view.state.selection.from, view.state.selection.to)
      return true
    }
    if (this.pasteMode === 'plain') {
      if (!event.clipboardData) return false
      const text = event.clipboardData.getData('text/plain')
      event.preventDefault()
      if (text) view.pasteText(text)
      return true
    }
    return false
  }

  private handleDropEvent(
    view: import('@tiptap/pm/view').EditorView,
    event: DragEvent,
    _slice: unknown,
    _moved: boolean,
  ): boolean {
    if (this.destroyed || !this.editor.isEditable) return false
    const files = Array.from(event.dataTransfer?.files ?? [])
    const image = files.find((file) => file.type.startsWith('image/'))
    if (!image) return false
    event.preventDefault()
    const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY })
    const position = coordinates
      ? Selection.near(view.state.doc.resolve(coordinates.pos)).from
      : view.state.selection.from
    void this.insertImageFromFile(image, position)
    return true
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.subscribers.clear()
    this.errorSubscribers.clear()
    this.selectionSubscribers.clear()
    this.pasteModeSubscribers.clear()
    this.pendingImageAnchors.clear()
    this.editor.destroy()
  }

  private createSnapshot(source: SessionSource): NexusdownEditorSnapshot {
    return {
      markdown: this.editor.getMarkdown().replace(/\n+$/, ''),
      html: this.editor.getHTML(),
      json: this.editor.getJSON(),
      source,
    }
  }

  private createPendingImageAnchor(from: number, to = from): PendingImageAnchor {
    const maxPosition = this.editor.state.doc.content.size
    const safeFrom = Math.min(Math.max(0, Math.trunc(from)), maxPosition)
    const safeTo = Math.min(Math.max(0, Math.trunc(to)), maxPosition)
    return { from: Math.min(safeFrom, safeTo), to: Math.max(safeFrom, safeTo) }
  }

  private mapPendingImageAnchors(transaction: Transaction): void {
    for (const anchor of this.pendingImageAnchors) {
      if (anchor.from === anchor.to) {
        const position = transaction.mapping.map(anchor.from, 1)
        anchor.from = position
        anchor.to = position
        continue
      }
      const from = transaction.mapping.map(anchor.from, 1)
      const to = transaction.mapping.map(anchor.to, -1)
      if (from > to) {
        anchor.from = from
        anchor.to = from
        continue
      }
      anchor.from = from
      anchor.to = to
    }
  }

  private emitError(error: Error): void {
    for (const subscriber of this.errorSubscribers) subscriber(error)
  }
}

export function createNexusdownEditor(options: NexusdownEditorOptions): NexusdownEditorSession {
  return new NexusdownEditorSession(options)
}
