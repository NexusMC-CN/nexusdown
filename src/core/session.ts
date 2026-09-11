import { Editor, type JSONContent } from '@tiptap/core'
import { createNexusdownExtensions } from './extensions.js'

export type ContentType = 'json' | 'html' | 'markdown'
export type SessionSource = ContentType | 'editor' | 'history'

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

export class NexusdownEditorSession {
  private readonly editor: Editor
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
    this.snapshot = this.createSnapshot(options.contentType)
    this.editor.on('update', () => {
      if (this.destroyed) return
      const source = this.pendingSource ?? 'editor'
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
      this.editor.markdown?.parse(markdown)
      this.pendingSource = 'markdown'
      const applied = this.editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: true })
      if (!applied) throw new Error('Unable to set markdown content')
    } catch (error) {
      this.pendingSource = undefined
      this.editor.commands.setContent(previous, { contentType: 'json', emitUpdate: false })
      const normalized = error instanceof Error ? error : new Error(String(error))
      for (const subscriber of this.errorSubscribers) subscriber(normalized)
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
}

export function createNexusdownEditor(options: NexusdownEditorOptions): NexusdownEditorSession {
  return new NexusdownEditorSession(options)
}
