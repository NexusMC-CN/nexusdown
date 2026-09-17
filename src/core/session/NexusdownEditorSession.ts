import { Editor, type AnyExtension, type JSONContent } from '@tiptap/core'
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

/**
 * Split a Markdown table row into its cells, or return `undefined` when the line
 * is not a table row at all.
 *
 * A `|` preceded by an odd number of backslashes is escaped content, not a cell
 * boundary, so `\|` stays inside its cell.
 */
function splitTableRow(line: string): string[] | undefined {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return undefined
  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const char of trimmed) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  // A leading/trailing pipe produces an empty first/last entry; drop those so
  // `| a | b |` and `a | b` report the same cell count.
  if (cells.length > 0 && cells[0].trim() === '') cells.shift()
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.length > 0 ? cells : undefined
}

/** Whether a line is the `| --- | :-: |` delimiter under a table header. */
function isTableDelimiterRow(line: string): boolean {
  const cells = splitTableRow(line)
  if (!cells || cells.length === 0) return false
  return cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()))
}

export interface NexusdownEditorSnapshot {
  markdown: string
  html: string
  json: JSONContent
  source: SessionSource
}

export type SessionSubscriber = (snapshot: NexusdownEditorSnapshot) => void
/**
 * Whether a transaction comes from ProseMirror's history plugin.
 *
 * The plugin does not expose a public flag, but it marks the transactions it
 * creates with `appendedTransaction` metadata carrying its own plugin key, and
 * sets `history$`/`rebased` on the steps it applies. Checking the plugin key is
 * the stable part of that contract.
 */
function isHistoryTransaction(transaction: Transaction): boolean {
  // ProseMirror's history plugin stamps every transaction it produces with a
  // `history$` meta entry holding its plugin state. That is what makes an
  // undo/redo triggered by a keyboard shortcut distinguishable from an ordinary
  // edit, since such a shortcut never reaches `undo()` / `redo()` below.
  return transaction.getMeta('history$') !== undefined
}

export type SessionErrorSubscriber = (error: Error) => void
export type SessionSelectionSubscriber = () => void

/**
 * Screen a JSON document before it reaches the editor, returning a description
 * of the problem or `null` when it is usable.
 *
 * ProseMirror does not reject a bad document. Given an unknown node type it
 * substitutes a text node containing the raw JSON, so the user is shown the
 * JSON source as document content; given one that violates the content schema it
 * throws later, mid-transaction. Neither is acceptable for an initial value, and
 * neither is detectable from the content alone — hence a structural check before
 * construction. Schema-level validity is left to `validateJsonContent`, which
 * can consult the built schema.
 */
function screenJsonContent(content: string | JSONContent | undefined, knownTypes: Set<string>): string | null {
  // No content at all is not an error: an empty bound value means an empty
  // document, which is exactly what the fallback below produces anyway.
  if (content === undefined || content === null) return null
  if (typeof content === 'string') {
    const trimmed = content.trim()
    if (!trimmed) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return 'Invalid JSON content'
    }
    return screenJsonContent(parsed as JSONContent, knownTypes)
  }
  if (typeof content !== 'object' || content.type !== 'doc') {
    return 'JSON content must have type "doc"'
  }
  return findUnknownType(content, knownTypes)
}

/**
 * Collect the node names an extension list actually produces.
 *
 * Bundles such as `StarterKit` compute their members from their options, and
 * that computation depends on being called with the right receiver, so walking
 * the extension objects by hand is unreliable. Building a throwaway editor lets
 * Tiptap resolve the list exactly as it will for the real editor, and the
 * resulting schema is the authoritative answer.
 */
function collectNodeNames(extensions: AnyExtension[]): Set<string> {
  const probe = new Editor({ element: null, extensions, content: '' })
  try {
    return new Set(Object.keys(probe.schema.nodes))
  } finally {
    probe.destroy()
  }
}

/**
 * Report the first node type in the document that this editor does not register.
 *
 * `doc` itself is excluded because it is the root, which is always present.
 */
function findUnknownType(node: JSONContent, knownTypes: Set<string>): string | null {
  if (typeof node.type === 'string' && node.type !== 'doc' && !knownTypes.has(node.type)) {
    return `Unknown node type "${node.type}"`
  }
  for (const child of node.content ?? []) {
    const found = findUnknownType(child, knownTypes)
    if (found) return found
  }
  return null
}type PendingImageAnchor = { from: number; to: number }

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
  /** True while `notifySubscribers` is draining, so re-entrant calls queue. */
  private notifying = false
  /** Snapshot produced by a re-entrant `notifySubscribers` call, if any. */
  private pendingNotifications: NexusdownEditorSnapshot | undefined
  private snapshot: NexusdownEditorSnapshot
  /** Element the Tiptap view is currently mounted into, if any. */
  private mountedElement: HTMLElement | null = null

  /** Reason the initial JSON document was rejected, reported once listeners can attach. */
  private readonly initialContentError: string | null = null

  constructor(options: NexusdownEditorOptions) {
    this.pasteMode = options.pasteMode ?? 'plain'
    this.imageUpload = options.imageUpload
    this.maxFileSize = normalizeMaxFileSize(options.maxFileSize)
    const extensions = createNexusdownExtensions({
      extensions: options.extensions,
      resolve: options.extensionResolver,
    })
    // An unusable JSON document is not rejected by ProseMirror: it is coerced
    // into a text node holding the raw JSON, which the user then sees as
    // content. Screen it against the node names these extensions provide, and
    // fall back to an empty document so construction still succeeds; the reason
    // is reported below once the error channel exists.
    this.initialContentError =
      options.contentType === 'json'
        ? screenJsonContent(options.content, collectNodeNames(extensions))
        : null
    // A JSON *string* is opaque to the editor, which would treat it as literal
    // document text. Parse it up front so the document is applied structurally,
    // and so the screening above is the only place string handling happens.
    const initialContent =
      options.contentType === 'json' && typeof options.content === 'string'
        ? ((): JSONContent | '' => {
            const trimmed = options.content.trim()
            if (!trimmed) return ''
            try {
              return JSON.parse(trimmed) as JSONContent
            } catch {
              return ''
            }
          })()
        : options.content
    this.editor = new Editor({
      // Mount into a detached element so the session is fully usable in
      // headless contexts (no component, no DOM target). Consumers that have a
      // real host call `mountEditor()`, which tears this view down first rather
      // than leaving a second `EditorView` behind.
      element: typeof document === 'undefined' ? null : document.createElement('div'),
      extensions,
      content: this.initialContentError ? '' : initialContent,
      contentType: this.initialContentError ? 'html' : options.contentType,
      editorProps: {
        handlePaste: (view, event) => this.handlePasteEvent(view, event),
        handleDrop: (view, event, slice, moved) => this.handleDropEvent(view, event, slice, moved),
      },
    })
    // Record the throwaway target so `mountEditor()` knows a view already
    // exists and must be unmounted before moving.
    this.mountedElement = typeof document === 'undefined' ? null : (this.editor.options.element as HTMLElement | null)
    this.commands = {
      undo: () => this.undo(),
      redo: () => this.redo(),
      setHeading: (level = 2) => this.editor.chain().focus().setHeading({ level: normalizeHeadingLevel(level) }).run(),
      toggleBlockquote: () => this.editor.chain().focus().toggleBlockquote().run(),
      toggleBulletList: () => this.editor.chain().focus().toggleBulletList().run(),
      toggleOrderedList: () => this.editor.chain().focus().toggleOrderedList().run(),
      toggleTaskList: () => this.safeCommand((chain) => chain.toggleTaskList()),
      toggleCodeBlock: () => this.editor.chain().focus().toggleCodeBlock().run(),
      setHorizontalRule: () => this.editor.chain().focus().setHorizontalRule().run(),
      toggleBold: () => this.editor.chain().focus().toggleBold().run(),
      toggleItalic: () => this.editor.chain().focus().toggleItalic().run(),
      toggleStrike: () => this.editor.chain().focus().toggleStrike().run(),
      toggleCode: () => this.editor.chain().focus().toggleCode().run(),
      // Routed through `safeCommand`: these extensions are optional, and calling
      // the chained method on an editor that lacks them throws
      // `chain.toggleX is not a function`, which escaped the toolbar click
      // handler. An unavailable command should report that it did nothing.
      toggleUnderline: () => this.safeCommand((chain) => chain.toggleUnderline()),
      toggleSuperscript: () => this.safeCommand((chain) => chain.toggleSuperscript()),
      toggleSubscript: () => this.safeCommand((chain) => chain.toggleSubscript()),
      setColor: (color) => this.safeCommand((chain) => color
        ? chain.setColor(color)
        : chain.unsetColor()),
      setHighlight: (color) => this.safeCommand((chain) => color
        ? chain.setHighlight({ color })
        : chain.unsetHighlight()),
      setLink: (href, text) => {
        // The Link extension is optional, so `unsetLink`/`setLink` may not exist
        // on the chain; report "did nothing" instead of escaping the click handler.
        if (!this.hasMarkType('link')) return false
        const chain = this.editor.chain().focus()
        if (!href) return chain.unsetLink().run()
        if (text !== undefined && text.length > 0) {
          // Replacing the label must target the *whole* existing link when the
          // cursor merely sits inside one. Blindly inserting would leave the
          // surrounding link fragments behind (e.g. "[d]new[ocs]") and leave the
          // user with duplicated text.
          const range = this.currentLinkRange()
          // A replacement text node carries only the marks given to it, so
          // building it with the link alone silently dropped bold/colour/italic
          // from the selection. Collect the marks already present and add the
          // link on top of them.
          const marks = this.selectionMarksFor('link', { href })
          if (range) {
            return this.editor.chain().focus()
              .insertContentAt(range, { type: 'text', text, marks })
              .run()
          }
          return chain.insertContent({ type: 'text', text, marks }).run()
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
      insertTable: (rows = 3, cols = 3) => this.safeCommand((chain) => chain.insertTable({
        rows: normalizeTableSize(rows),
        cols: normalizeTableSize(cols),
        withHeaderRow: true,
      })),
      addTableRow: () => this.safeCommand((chain) => chain.addRowAfter()),
      addTableColumn: () => this.safeCommand((chain) => chain.addColumnAfter()),
      deleteTableRow: () => this.safeCommand((chain) => chain.deleteRow()),
      deleteTableColumn: () => this.safeCommand((chain) => chain.deleteColumn()),
      deleteTable: () => this.safeCommand((chain) => chain.deleteTable()),
      mergeCells: () => this.safeCommand((chain) => chain.mergeCells()),
      splitCell: () => this.safeCommand((chain) => chain.splitCell()),
      setCodeBlockLanguage: (language) => this.safeCommand((chain) => chain.updateAttributes('codeBlock', { language })),
      insertImage: (src, alt = '', title) => {
        // `src` reaches here from an untyped toolbar item that may be rendered
        // without `imageSrc` configured, and `alt` likewise; reading `.trim()`
        // off either threw a TypeError straight out of the toolbar's click
        // handler. An insert with nothing to insert is simply a no-op.
        const value = typeof src === 'string' ? src.trim() : ''
        if (!value || !isSafeImageSource(value)) return false
        const altText = typeof alt === 'string' ? alt.trim() : ''
        const titleText = typeof title === 'string' ? title.trim() : ''
        return this.safeCommand((chain) => chain.setImage({
          src: value,
          alt: altText || undefined,
          title: titleText || undefined,
        }))
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
        this.notifySubscribers({ markdown, html, json: this.editor.getJSON(), source })
        return
      }

      this.notifySubscribers(this.createSnapshot(source, markdown))
    })
    this.editor.on('transaction', ({ transaction, appendedTransactions }) => {
      for (const pendingTransaction of [transaction, ...appendedTransactions]) {
        this.mapPendingImageAnchors(pendingTransaction)
        // Undo/redo driven by a keyboard shortcut never reaches `undo()` /
        // `redo()` below, so the source would be reported as `rich-text` and a
        // consumer keying off the source would treat a history step as an
        // ordinary edit. ProseMirror's history plugin tags its transactions, so
        // read the tag rather than relying on the call path.
        if (isHistoryTransaction(pendingTransaction)) this.pendingSource = 'history'
        // Toggling a mark with a collapsed cursor (`Mod-b` on an empty selection)
        // only sets `storedMarks`: the document and the selection are both
        // unchanged, so no `update` or `selectionUpdate` fires and the toolbar
        // kept showing the previous state even though the next character typed
        // would carry the new format. Announce those transactions explicitly.
        if (this.changesStoredMarks(pendingTransaction)) {
          this.notifySelectionSubscribers()
        }
      }
    })
    this.editor.on('selectionUpdate', () => {
      if (this.destroyed) return
      this.notifySelectionSubscribers()
    })
    // Report a rejected initial document now that `onError` can be subscribed.
    // Deferred through a microtask so a listener registered immediately after
    // construction receives it, matching how component hosts wire things up.
    if (this.initialContentError) {
      const message = this.initialContentError
      queueMicrotask(() => this.emitError(new Error(message)))
    }
  }

  /**
   * Notify every subscriber, isolating failures.
   *
   * A subscriber that throws must not stop the others: they would silently miss
   * the update and keep a stale document. Each error is reported through the
   * error channel instead, and the snapshot is committed before any subscriber
   * runs so a throwing callback cannot leave the session inconsistent.
   */
  private notifySubscribers(next: NexusdownEditorSnapshot): void {
    this.snapshot = next
    // A subscriber may mutate the document from inside its callback. That edit
    // calls back into this method *while the current loop is still running*, so
    // naively continuing the outer loop hands every subscriber positioned after
    // the mutating one a snapshot that is already obsolete — a consumer that
    // persists on each notification would then overwrite the new content with
    // the stale one. Only the newest snapshot may reach subscribers, so a
    // re-entrant call records its snapshot and asks the running loop to abandon
    // the remainder of its pass; the loop then restarts from the top with the
    // newer snapshot (which also updates subscribers that had already seen the
    // older one).
    if (this.notifying) {
      this.pendingNotifications = next
      return
    }
    this.notifying = true
    try {
      let current: NexusdownEditorSnapshot | undefined = next
      while (current) {
        this.pendingNotifications = undefined
        for (const subscriber of [...this.subscribers]) {
          try {
            subscriber(current)
          } catch (error) {
            this.emitError(error instanceof Error ? error : new Error(String(error)))
          }
          // A subscriber produced a newer snapshot: stop this pass so nobody
          // else is told about `current`, and re-broadcast the newer one.
          if (this.pendingNotifications) break
        }
        current = this.pendingNotifications
      }
    } finally {
      this.notifying = false
      this.pendingNotifications = undefined
    }
  }

  getMarkdown(): string { return this.snapshot.markdown }
  getHTML(): string { return this.snapshot.html }
  getJSON(): JSONContent { return this.snapshot.json }
  getSnapshot(): NexusdownEditorSnapshot { return this.snapshot }
  getEditor(): Editor { return this.editor }

  /**
   * Mount the editor's view into `element`, replacing any previous view.
   *
   * Tiptap's `Editor.mount()` installs a *new* `EditorView` without tearing down
   * the existing one, so calling it repeatedly (for example on every layout
   * switch, or once in the constructor plus once from `onMounted`) leaked the
   * old view and re-ran extension `create` hooks. Unmount first so mounting is
   * idempotent.
   */
  mountEditor(element: HTMLElement | null): void {
    if (this.destroyed || !element) return
    // Nothing to do when the view already lives in this element; re-mounting
    // would needlessly rebuild the view and re-run `create`.
    if (this.mountedElement === element) return
    if (this.mountedElement) this.editor.unmount()
    this.editor.mount(element)
    this.mountedElement = element
  }

  /** The element the editor view is currently attached to, if any. */
  getMountedElement(): HTMLElement | null {
    return this.mountedElement
  }

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
    // A link containing styled runs (`<a>ab<strong>cd</strong>ef</a>`) is split
    // into several text nodes, only the last of which sits under the cursor.
    // Reporting just that node's text showed a fragment such as "ef" as the link
    // label, making it look as though the rest had been lost. The dialog needs
    // the link's full text, so gather every fragment in the enclosing run.
    const range = this.currentLinkRange()
    if (!range) return ''
    return this.editor.state.doc.textBetween(range.from, range.to, '\n')
  }
  /**
   * Marks to attach to replacement text: everything already on the selection,
   * plus (or with) the named mark.
   *
   * Replacing a selection with a bare text node drops the marks it used to
   * carry, so adding a link to bold text produced unformatted text. Marks are
   * de-duplicated by type, keeping the caller's values for the mark being set.
   */
  private selectionMarksFor(
    type: string,
    attrs: Record<string, unknown>,
  ): { type: string; attrs?: Record<string, unknown> }[] {
    const { from, to } = this.editor.state.selection
    // `$from.marks()` is empty for a node selection or when the range spans
    // several marked runs, so fall back to the marks common to the whole range.
    const source =
      this.editor.state.storedMarks ??
      this.editor.state.selection.$from.marksAcross(this.editor.state.selection.$to) ??
      this.editor.state.doc.resolve(from).marks()
    const existing = source
      .filter((mark) => mark.type.name !== type)
      .map((mark) => ({ type: mark.type.name, attrs: mark.attrs as Record<string, unknown> }))
    // A multi-node selection may carry marks on only part of the range; collect
    // those too so styling is not silently dropped from the replacement.
    if (from !== to) {
      const seen = new Set(existing.map((mark) => mark.type))
      this.editor.state.doc.nodesBetween(from, to, (node) => {
        if (!node.isText) return
        for (const mark of node.marks) {
          if (mark.type.name === type || seen.has(mark.type.name)) continue
          seen.add(mark.type.name)
          existing.push({ type: mark.type.name, attrs: mark.attrs as Record<string, unknown> })
        }
      })
    }
    return [...existing, { type, attrs }]
  }

  getLinkHref(): string { return this.destroyed ? '' : String(this.editor.getAttributes('link').href ?? '') }

  can(command: EditorCommand): boolean {
    if (this.destroyed) return false
    try {
      return this.canInternal(command)
    } catch {
      // The command belongs to an extension this editor does not have — a
      // consumer may remove optional extensions such as the table, task list or
      // image. An unavailable command is simply not usable; letting the
      // TypeError escape crashed the whole toolbar render.
      return false
    }
  }

  private canInternal(command: EditorCommand): boolean {
    if (this.destroyed) return false
    // `.focus()` is deliberately absent: a `can()` probe must not touch selection,
    // and the dry-run chain does not need focus to report capability.
    //
    // The whole dispatch is guarded because the chained methods come from
    // *optional* extensions. When a consumer removes one (say TaskList or Table),
    // probing its command threw `chain.toggleTaskList is not a function` out of
    // the toolbar's render path. An unavailable command is not an error: the
    // button is simply disabled.
    try {
      return this.resolveCan(command)
    } catch {
      return false
    }
  }

  private resolveCan(command: EditorCommand): boolean {
    const chain = this.editor.can().chain()
    switch (command) {
      case 'undo': return chain.undo().run()
      case 'redo': return chain.redo().run()
      // Testing only level 2 would disable the whole heading menu when a
      // consumer configures heading levels that exclude H2, even though other
      // levels are perfectly usable.
      case 'heading': return this.canSetAnyHeadingLevel()
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
    // An unrecognised command name reaches here from untyped JavaScript or a
    // template ref. Returning `undefined` from a `boolean`-declared method made
    // `can('heading1')` falsy-by-accident and hid the mistake; report `false`.
    return false
  }

  /**
   * Run a chained command, reporting `false` when its extension is absent.
   *
   * Commands belonging to optional extensions (task list, table, image, colour,
   * highlight) do not exist on the chain when a consumer removes those
   * extensions. Calling one threw `TypeError: chain.x is not a function`, which
   * escaped from the toolbar's click handler; an unavailable command should
   * simply report that it did nothing.
   */
  private safeCommand(build: (chain: ReturnType<Editor['chain']>) => { run: () => boolean }): boolean {
    if (this.destroyed) return false
    try {
      return build(this.editor.chain().focus()).run()
    } catch {
      return false
    }
  }

  /**
   * Whether the editor can turn the selection into a heading of any level it
   * actually supports.
   *
   * The set of levels comes from the configured `heading` extension, so a
   * consumer that restricts levels (say `[1, 3]`) still gets a usable heading
   * menu. Returns `false` when no heading node is registered at all.
   */
  private canSetAnyHeadingLevel(): boolean {
    const levels = this.headingLevels()
    for (const level of levels) {
      const valid = level >= 1 && level <= 6
      if (!valid) continue
      if (this.editor.can().chain().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run()) {
        return true
      }
    }
    return false
  }

  /** Heading levels the configured `heading` extension accepts. */
  private headingLevels(): number[] {
    const heading = this.editor.extensionManager.extensions.find((ext) => ext.name === 'heading')
    const configured = heading?.options?.levels
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.filter((level): level is number => typeof level === 'number')
    }
    // Fall back to the levels the schema actually declares.
    const levels: number[] = []
    for (let level = 1; level <= 6; level += 1) {
      if (this.editor.schema.nodes.heading) levels.push(level)
    }
    return levels.length > 0 ? levels : [1, 2, 3, 4, 5, 6]
  }

  isActive(name: string, attributes?: Record<string, unknown>): boolean {
    return !this.destroyed && this.editor.isActive(name, attributes)
  }

  /**
   * Whether the current selection carries a text colour.
   *
   * `textStyle` is shared by several attributes — setting only a font through
   * `FontFamily` also produces a `textStyle` mark — so `isActive('textStyle')`
   * reports true for text that has no colour at all.
   */
  hasTextColor(color?: string): boolean {
    if (this.destroyed) return false
    const mark = this.editor.getAttributes('textStyle') as { color?: unknown }
    const current = typeof mark.color === 'string' ? mark.color : undefined
    if (!current) return false
    return color ? current === color : true
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
    // ProseMirror silently coerces unusable JSON into a text node, so a document
    // containing an unknown node type was inserted as a paragraph of raw JSON
    // text and shown to the user. Validate before handing it over, and parse a
    // JSON *string* so the editor never receives it as literal text.
    let payload: string | JSONContent = content
    if (contentType === 'json') {
      const problem = this.validateJsonContent(content)
      if (problem) {
        this.emitError(new Error(problem))
        return
      }
      if (typeof content === 'string') {
        const trimmed = content.trim()
        payload = trimmed ? (JSON.parse(trimmed) as JSONContent) : ''
      }
    }
    const previous = this.editor.getJSON()
    try {
      this.pendingSource = contentType === 'markdown' ? 'markdown' : 'rich-text'
      const applied = this.editor.commands.setContent(payload, { contentType, emitUpdate: true })
      if (!applied) throw new Error('Unable to set content')
    } catch (error) {
      this.pendingSource = undefined
      this.editor.commands.setContent(previous, { contentType: 'json', emitUpdate: false })
      this.emitError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Check that JSON content can actually be applied.
   *
   * Returns a human-readable problem description, or `null` when the content is
   * usable. ProseMirror does not reject a bad document: an unknown node type is
   * dropped in favour of a text node containing the raw JSON, and a node that
   * violates the content schema throws only once the transaction is applied.
   */
  private validateJsonContent(content: string | JSONContent): string | null {
    let document: JSONContent
    if (typeof content === 'string') {
      const trimmed = content.trim()
      if (!trimmed) return null
      try {
        document = JSON.parse(trimmed) as JSONContent
      } catch {
        return 'Invalid JSON content'
      }
    } else {
      document = content
    }
    if (!document || typeof document !== 'object') return 'JSON content must be an object'
    if (document.type !== 'doc') return 'JSON content must have type "doc"'
    const unknown = this.findUnknownNodeType(document)
    if (unknown) return `Unknown node type "${unknown}"`
    try {
      // `nodeFromJSON` runs the same schema check the editor uses, so a
      // structural violation surfaces here instead of corrupting the document.
      this.editor.schema.nodeFromJSON(document)
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid JSON content'
    }
    return null
  }

  /** Depth-first search for a node type the schema does not know about. */
  private findUnknownNodeType(node: JSONContent): string | null {
    if (typeof node.type === 'string' && !this.editor.schema.nodes[node.type]) return node.type
    for (const child of node.content ?? []) {
      const found = this.findUnknownNodeType(child)
      if (found) return found
    }
    return null
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
      this.reportTableColumnLoss(markdown)
    } catch (error) {
      this.pendingSource = undefined
      this.restoreDocument(previous)
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.emitError(normalized)
    }
  }

  /**
   * Tell selection listeners that toolbar-relevant state may have changed.
   *
   * Routed through one place so the `destroyed` guard cannot be forgotten.
   */
  private notifySelectionSubscribers(): void {
    if (this.destroyed) return
    for (const subscriber of [...this.selectionSubscribers]) {
      try {
        subscriber()
      } catch (error) {
        // A throwing listener must not stop the remaining ones, matching how
        // content subscribers are notified.
        this.emitError(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  /**
   * Whether a transaction changed the marks that will be applied to the next
   * character typed, without changing the document or the selection.
   *
   * `storedMarks` is only ever set as transaction metadata, so its presence on
   * the transaction is the signal; a mark applied to an actual range also
   * changes the document and therefore already notifies through `update`.
   */
  private changesStoredMarks(transaction: Transaction): boolean {
    return transaction.storedMarks !== null && transaction.storedMarks !== undefined
  }

  /**
   * Report Markdown tables whose rows carry more cells than their header.
   *
   * The upstream table tokenizer builds the row from the header's column count
   * and discards any surplus cells, so `| a | b |` followed by `| 1 | 2 | 3 |`
   * silently loses `3`. The parse "succeeds", so nothing else would tell the
   * user their content is gone. Detection lives here rather than in the
   * tokenizer so the error surfaces through the same channel as other parse
   * problems. Rows with *fewer* cells are not reported: the parser pads those
   * with empty cells, which loses nothing.
   */
  private reportTableColumnLoss(markdown: string): void {
    const lines = markdown.split(/\r?\n/)
    for (let index = 0; index < lines.length - 1; index += 1) {
      const header = splitTableRow(lines[index])
      // A table starts with a header row followed by a delimiter row.
      if (!header || !isTableDelimiterRow(lines[index + 1])) continue
      const columns = header.length
      for (let row = index + 2; row < lines.length; row += 1) {
        const cells = splitTableRow(lines[row])
        if (!cells) break
        if (cells.length > columns) {
          this.emitError(new Error(
            `Table row ${row + 1} has ${cells.length} cells but the header defines ${columns}; `
            + `the extra cell(s) were discarded.`,
          ))
        }
      }
    }
  }

  /**
   * Roll the document back to a known-good state without recording history.
   *
   * A plain `setContent` produces an ordinary transaction, which pushes a step
   * onto the undo stack and clears the redo stack. After a rejected edit that
   * destroyed the user's redo history for no reason, and left a no-op entry in
   * the undo stack. Applying the restoration as a transaction explicitly marked
   * `addToHistory: false` keeps the history stack untouched.
   */
  private restoreDocument(previous: JSONContent): void {
    const restored = this.editor.schema.nodeFromJSON(previous)
    const transaction = this.editor.state.tr
      .replaceWith(0, this.editor.state.doc.content.size, restored.content)
      .setMeta('addToHistory', false)
      .setMeta('preventUpdate', true)
    this.editor.view.dispatch(transaction)
  }

  undo(): boolean {
    if (this.destroyed) return false
    // Set the flag only when the command actually applies a step. Setting it up
    // front left it stale when there was nothing to undo: no `update` fires to
    // clear it, so the *next* unrelated edit was reported as coming from
    // history, and a consumer keying off the source would misclassify it.
    if (!this.editor.commands.undo()) return false
    this.pendingSource = 'history'
    return true
  }

  redo(): boolean {
    if (this.destroyed) return false
    if (!this.editor.commands.redo()) return false
    this.pendingSource = 'history'
    return true
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
    // `can().sinkListItem(name)` resolves the node type eagerly and throws when
    // the extension is absent, so an unavailable list type must be skipped
    // rather than probed.
    if (this.hasNodeType('listItem') && this.editor.can().sinkListItem('listItem')) {
      return this.editor.chain().focus().sinkListItem('listItem').run()
    }
    if (this.hasNodeType('taskItem') && this.editor.can().sinkListItem('taskItem')) {
      return this.editor.chain().focus().sinkListItem('taskItem').run()
    }
    const current = this.currentIndent()
    if (current >= MAX_INDENT) return false
    return this.editor.chain().focus().updateAttributes(this.currentBlockName(), { indent: current + 1 }).run()
  }

  /** Outdent the current block, mirroring {@link sinkBlock}. */
  private liftBlock(): boolean {
    if (this.destroyed) return false
    if (this.hasNodeType('listItem') && this.editor.can().liftListItem('listItem')) {
      return this.editor.chain().focus().liftListItem('listItem').run()
    }
    if (this.hasNodeType('taskItem') && this.editor.can().liftListItem('taskItem')) {
      return this.editor.chain().focus().liftListItem('taskItem').run()
    }
    const current = this.currentIndent()
    if (current <= 0) return false
    const chain = this.editor.chain().focus()
    if (current === 1) return chain.updateAttributes(this.currentBlockName(), { indent: null }).run()
    return chain.updateAttributes(this.currentBlockName(), { indent: current - 1 }).run()
  }

  /** Whether a node type is registered in the current schema. */
  private hasNodeType(name: string): boolean {
    return typeof this.editor.schema.nodes[name] !== 'undefined'
  }

  /** Whether a mark type is registered in the current schema. */
  private hasMarkType(name: string): boolean {
    return typeof this.editor.schema.marks[name] !== 'undefined'
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
      // Expand to the whole contiguous run of link-marked siblings, not just the
      // node under the cursor. A link whose label mixes styling is several text
      // nodes (`ab` / bold `cd` / `ef`), and stopping at one of them reported a
      // fragment as the link's text and would have replaced only that fragment.
      const start = $from.start()
      const end = $from.end()
      // Collect every link-marked text node in the block, then keep the maximal
      // run that contains the cursor. Walking adjacent siblings this way is what
      // joins `ab` / bold `cd` / `ef` back into one link; requiring each node to
      // overlap the cursor would stop at the fragment the cursor happens to sit
      // in and report "ef" as the whole label.
      const runs: { from: number; to: number }[] = []
      state.doc.nodesBetween(start, end, (node, pos) => {
        if (!node.isText) return true
        if (!node.marks.some((mark) => mark.type === state.schema.marks.link)) return true
        const nodeFrom = pos
        const nodeTo = pos + node.nodeSize
        const last = runs[runs.length - 1]
        if (last && last.to === nodeFrom) last.to = nodeTo
        else runs.push({ from: nodeFrom, to: nodeTo })
        return true
      })
      const run = runs.find((candidate) => candidate.from <= from && from <= candidate.to)
      if (!run || run.from === run.to) return undefined
      return { from: run.from, to: run.to }
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
