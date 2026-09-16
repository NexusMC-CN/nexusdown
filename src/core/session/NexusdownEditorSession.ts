import { Editor, type JSONContent } from '@tiptap/core'
import { Selection, type Transaction } from '@tiptap/pm/state'
import { createNexusdownExtensions } from '../extensions/index.js'
import type { NexusdownExtensionOptions } from '../extensions/types.js'

export type ContentType = 'json' | 'html' | 'markdown'
export type SessionSource = 'rich-text' | 'markdown' | 'history'
/**
 * How pasted clipboard content is interpreted.
 *
 * - `plain`: keep only the clipboard's plain text (default).
 * - `structured`: keep the clipboard's rich HTML structure.
 * - `markdown`: treat the clipboard's plain text as Markdown source and parse it
 *   into rich nodes (headings, lists, tables, ...) instead of inserting it
 *   literally.
 */
export type PasteMode = 'plain' | 'structured' | 'markdown'
/** Horizontal alignment of a block. */
export type TextAlignment = 'left' | 'center' | 'right' | 'justify'

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
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'indent'
  | 'outdent'

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
  /** Parse Markdown and insert it at the current selection as rich content. */
  insertMarkdown: (markdown: string) => boolean
  /** Align the selected block(s). Omit `alignment` to clear back to default. */
  setTextAlign: (alignment?: TextAlignment) => boolean
  /** Increase list/paragraph nesting by one level. */
  indent: () => boolean
  /** Decrease list/paragraph nesting by one level. */
  outdent: () => boolean
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/** Maximum nesting level reachable with the `indent` command outside lists. */
const MAX_INDENT = 8

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
          // Replacing the label must target the *whole* existing link when the
          // cursor merely sits inside one. Blindly inserting would leave the
          // surrounding link fragments behind (e.g. "[d]new[ocs]") and leave the
          // user with duplicated text.
          const range = this.currentLinkRange()
          if (range) {
            return this.editor.chain().focus()
              .insertContentAt(range, { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
              .run()
          }
          return chain.insertContent({
            type: 'text',
            text,
            marks: [{ type: 'link', attrs: { href } }],
          }).run()
        }
        // No explicit label: retarget every link touched by the selection, or the
        // one the cursor is inside.
        const range = this.currentLinkRange()
        if (range) {
          const mark = this.editor.schema.marks.link.create({ href })
          return this.editor.chain().focus().setTextSelection(range).setMark('link', mark.attrs).run()
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
      insertMarkdown: (markdown) => {
        if (this.destroyed || !markdown) return false
        const parsed = this.parseMarkdown(markdown)
        if (!parsed) return false
        return this.editor.chain().focus().insertContent(parsed).run()
      },
      setTextAlign: (alignment) => {
        const chain = this.editor.chain().focus()
        if (!alignment || alignment === 'left') return chain.unsetTextAlign().run()
        return chain.setTextAlign(alignment).run()
      },
      indent: () => this.sinkBlock(),
      outdent: () => this.liftBlock(),
    }
    this.snapshot = this.createSnapshot(options.contentType === 'markdown' ? 'markdown' : 'rich-text')
    this.editor.on('update', () => {
      if (this.destroyed) return
      const source = this.pendingSource ?? 'rich-text'
      this.pendingSource = undefined

      // Serialising Markdown/HTML/JSON for a large document on every keystroke is
      // the dominant per-edit cost, so compute the cheap Markdown form first and
      // bail out before paying for HTML + JSON when nothing changed.
      const markdown = this.serializeMarkdown()
      if (markdown === this.snapshot.markdown) {
        // Markdown is unchanged. HTML/JSON can still differ (e.g. a mark change
        // with no Markdown representation), so fall back to the full comparison.
        const html = this.editor.getHTML()
        if (html === this.snapshot.html) return
        const next = { markdown, html, json: this.editor.getJSON(), source }
        this.snapshot = next
        for (const subscriber of this.subscribers) subscriber(next)
        return
      }

      const next = this.createSnapshot(source, markdown)
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

  /**
   * Plain-text rendering of the document.
   *
   * Block-level nodes are separated by newlines, so this round-trips the visual
   * line structure closely enough for word counts, search excerpts, list
   * previews and "copy as plain text". Inline formatting is intentionally
   * dropped, and images contribute their `alt` text instead of their source.
   */
  getText(): string {
    if (this.destroyed) return ''
    return this.serializeText()
  }
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
    // `.focus()` is deliberately absent: a `can()` probe must not touch selection,
    // and the dry-run chain does not need focus to report capability.
    const chain = this.editor.can().chain()
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
      case 'align-left': return chain.setTextAlign('left').run()
      case 'align-center': return chain.setTextAlign('center').run()
      case 'align-right': return chain.setTextAlign('right').run()
      case 'align-justify': return chain.setTextAlign('justify').run()
      // Indent/outdent legality depends on the block, not on a ProseMirror
      // command, so they are probed by dry-running the same logic the commands
      // use rather than through `chain`.
      case 'indent': return !this.destroyed && this.currentIndent() < MAX_INDENT
      case 'outdent': return !this.destroyed && this.currentIndent() > 0
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
    if (this.pasteMode === 'markdown') {
      if (!event.clipboardData) return false
      // Prefer the clipboard's plain text: even when the source app also
      // supplied HTML we still want the Markdown interpretation, which is the
      // entire point of this mode.
      const text = event.clipboardData.getData('text/plain')
      event.preventDefault()
      if (!text) return true
      const parsed = this.parseMarkdown(text)
      if (!parsed) {
        // Unparseable Markdown must not silently drop the paste: fall back to
        // inserting the literal text so nothing is lost.
        view.pasteText(text)
        return true
      }
      const { from, to } = view.state.selection
      this.editor.chain().focus().insertContentAt({ from, to }, parsed).run()
      return true
    }
    return false
  }

  /**
   * Parse Markdown source into Tiptap JSON using the registered Markdown
   * manager. Returns `undefined` when parsing fails or yields nothing usable, so
   * callers can fall back to plain-text insertion.
   */
  private parseMarkdown(markdown: string): JSONContent | undefined {
    if (!markdown.trim()) return undefined
    try {
      const storage = this.editor.storage as { markdown?: { manager?: { parse?: (value: string) => JSONContent } } }
      const parsed = storage.markdown?.manager?.parse?.(markdown)
      if (!parsed || typeof parsed !== 'object') return undefined
      const content = (parsed as { content?: unknown[] }).content
      if (!Array.isArray(content) || content.length === 0) return undefined
      return parsed
    } catch (error) {
      // A malformed paste should degrade to plain text, not surface an error.
      this.emitError(error instanceof Error ? error : new Error(String(error)))
      return undefined
    }
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

  /**
   * Indent the current block.
   *
   * Inside a list this sinks the item one level (Tiptap's own command). Outside
   * a list there is no standard indent command, so the block's `indent`
   * attribute is raised instead (capped at {@link MAX_INDENT}) and rendered back
   * through Markdown as an inline style by the paragraph/heading extensions.
   */
  private sinkBlock(): boolean {
    if (this.destroyed) return false
    if (this.editor.can().sinkListItem('listItem')) {
      return this.editor.chain().focus().sinkListItem('listItem').run()
    }
    if (this.editor.can().sinkListItem('taskItem')) {
      return this.editor.chain().focus().sinkListItem('taskItem').run()
    }
    const current = this.currentIndent()
    if (current >= MAX_INDENT) return false
    return this.editor.chain().focus().updateAttributes(this.currentBlockName(), { indent: current + 1 }).run()
  }

  /** Outdent the current block, mirroring {@link sinkBlock}. */
  private liftBlock(): boolean {
    if (this.destroyed) return false
    if (this.editor.can().liftListItem('listItem')) {
      return this.editor.chain().focus().liftListItem('listItem').run()
    }
    if (this.editor.can().liftListItem('taskItem')) {
      return this.editor.chain().focus().liftListItem('taskItem').run()
    }
    const current = this.currentIndent()
    if (current <= 0) return false
    const chain = this.editor.chain().focus()
    if (current === 1) return chain.updateAttributes(this.currentBlockName(), { indent: null }).run()
    return chain.updateAttributes(this.currentBlockName(), { indent: current - 1 }).run()
  }

  /** Current indentation level of the selected block (0 when unset). */
  private currentIndent(): number {
    const { $from } = this.editor.state.selection
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth)
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        const value = node.attrs?.indent
        return typeof value === 'number' && value > 0 ? value : 0
      }
    }
    return 0
  }

  /** Name of the block node containing the selection. */
  private currentBlockName(): string {
    const { $from } = this.editor.state.selection
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const name = $from.node(depth).type.name
      if (name === 'heading') return 'heading'
    }
    return 'paragraph'
  }

  /**
   * The contiguous range of link-marked text the selection touches, or
   * `undefined` when the selection is not in a link.
   *
   * When text is selected, the range is expanded to cover every link the
   * selection overlaps, so editing a partially selected link does not leave
   * orphaned fragments behind. When the selection is a bare cursor, the
   * enclosing link is returned if one exists.
   */
  private currentLinkRange(): { from: number; to: number } | undefined {
    const { state } = this.editor
    const { from, to, empty } = state.selection
    if (!state.schema.marks.link) return undefined

    if (empty) {
      const $from = state.selection.$from
      const marks = $from.marks()
      if (!marks.some((mark) => mark.type === state.schema.marks.link)) return undefined
      // Walk outwards from the cursor to the edges of the link-marked run.
      const start = $from.start()
      const end = $from.end()
      let rangeFrom = from
      let rangeTo = to
      state.doc.nodesBetween(start, end, (node, pos) => {
        if (!node.isText || !node.marks.some((mark) => mark.type === state.schema.marks.link)) return true
        const nodeFrom = pos
        const nodeTo = pos + node.nodeSize
        if (nodeFrom <= from && from <= nodeTo) {
          rangeFrom = Math.min(rangeFrom, nodeFrom)
          rangeTo = Math.max(rangeTo, nodeTo)
        }
        return true
      })
      return rangeFrom === rangeTo ? undefined : { from: rangeFrom, to: rangeTo }
    }

    let rangeFrom: number | undefined
    let rangeTo: number | undefined
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText || !node.marks.some((mark) => mark.type === state.schema.marks.link)) return true
      const nodeFrom = pos
      const nodeTo = pos + node.nodeSize
      rangeFrom = rangeFrom === undefined ? nodeFrom : Math.min(rangeFrom, nodeFrom)
      rangeTo = rangeTo === undefined ? nodeTo : Math.max(rangeTo, nodeTo)
      return true
    })
    if (rangeFrom === undefined || rangeTo === undefined) return undefined
    return { from: rangeFrom, to: rangeTo }
  }

  /** Serialise the document to Markdown, normalised exactly as snapshots store it. */
  private serializeMarkdown(): string {
    return this.editor.getMarkdown().replace(/\n+$/, '')
  }

  /**
   * Flatten the document to plain text.
   *
   * `textBetween` with `blockSeparator` already inserts the separator between
   * block nodes (including list items and table cells), so this stays correct
   * for nested structures without walking the tree manually. Image nodes carry
   * no text, so their `alt` attribute is substituted to keep the text meaningful.
   */
  private serializeText(): string {
    const doc = this.editor.state.doc
    const parts: string[] = []
    doc.descendants((node) => {
      if (node.type.name === 'image' && node.attrs?.alt) {
        parts.push(String(node.attrs.alt))
      }
      return true
    })
    const body = doc.textBetween(0, doc.content.size, '\n', '\n')
    // Image alts are appended only when the document actually has images, to
    // avoid altering the common case.
    if (parts.length === 0) return body.trim()
    return `${body}${body ? '\n' : ''}${parts.join('\n')}`.trim()
  }

  private createSnapshot(source: SessionSource, markdown = this.serializeMarkdown()): NexusdownEditorSnapshot {
    return {
      markdown,
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
