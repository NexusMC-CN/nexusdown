import { Editor, type JSONContent } from '@tiptap/core'
import { createNexusdownExtensions } from './extensions.js'

export type ContentType = 'json' | 'html' | 'markdown'
export type SessionSource = 'rich-text' | 'markdown' | 'history'

export interface NexusdownEditorOptions {
  content: string | JSONContent
  contentType: ContentType
}

export interface NexusdownEditorSnapshot {
  markdown: string
  html: string
  json: JSONContent
  source: SessionSource
}

export type SessionSubscriber = (snapshot: NexusdownEditorSnapshot) => void
export type SessionErrorSubscriber = (error: Error) => void

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
  | 'link'

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
  setLink: (href?: string) => boolean
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

function normalizeHeadingLevel(level: number): HeadingLevel {
  return Math.min(6, Math.max(1, Math.trunc(level))) as HeadingLevel
}

export class NexusdownEditorSession {
  private readonly editor: Editor
  readonly commands: NexusdownEditorCommands
  private readonly subscribers = new Set<SessionSubscriber>()
  private readonly errorSubscribers = new Set<SessionErrorSubscriber>()
  private destroyed = false
  private pendingSource: SessionSource | undefined
  private snapshot: NexusdownEditorSnapshot

  constructor(options: NexusdownEditorOptions) {
    this.editor = new Editor({
      element: typeof document === 'undefined' ? null : document.createElement('div'),
      extensions: createNexusdownExtensions(),
      content: options.content,
      contentType: options.contentType,
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
      setLink: (href) => href
        ? this.editor.chain().focus().setLink({ href }).run()
        : this.editor.chain().focus().unsetLink().run(),
    }
    this.snapshot = this.createSnapshot(options.contentType === 'markdown' ? 'markdown' : 'rich-text')
    this.editor.on('update', () => {
      if (this.destroyed) return
      const source = this.pendingSource ?? 'rich-text'
      this.pendingSource = undefined
      const next = this.createSnapshot(source)
      if (next.markdown === this.snapshot.markdown) return
      this.snapshot = next
      for (const subscriber of this.subscribers) subscriber(next)
    })
  }

  getMarkdown(): string { return this.snapshot.markdown }
  getHTML(): string { return this.snapshot.html }
  getJSON(): JSONContent { return this.snapshot.json }
  getSnapshot(): NexusdownEditorSnapshot { return this.snapshot }

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
      case 'link': return chain.setLink({ href: 'https://example.com' }).run()
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

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.subscribers.clear()
    this.errorSubscribers.clear()
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

  private emitError(error: Error): void {
    for (const subscriber of this.errorSubscribers) subscriber(error)
  }
}

export function createNexusdownEditor(options: NexusdownEditorOptions): NexusdownEditorSession {
  return new NexusdownEditorSession(options)
}
