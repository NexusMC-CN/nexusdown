import type { Component } from 'vue'
import type { Command, EditorView } from '@nexusmc-cn/nexusdown/cm'

/** Stable identifiers for every built-in toolbar entry. */
export type ToolbarBuiltinId =
  | 'bold' | 'italic' | 'inlineCode' | 'inlineMath'
  | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'quote' | 'table'
  | 'link' | 'mention' | 'codeBlock' | 'blockMath' | 'embed' | 'undo' | 'redo'
  | 'contentReference' | 'blockVariants'

export interface ToolbarContext {
  view: EditorView
  /** Runs against the live view and restores editor focus; false after abort. */
  runCommand: (command: Command) => boolean
}

export interface ToolbarAction {
  id: string
  label: string
  /** A Vue component, never an HTML or SVG string. */
  icon?: Component
  active?: boolean | ((context: ToolbarContext) => boolean)
  disabled?: boolean | ((context: ToolbarContext) => boolean)
  run: (context: ToolbarContext & { signal: AbortSignal }) => void | boolean | Promise<void | boolean>
}

export interface ToolbarGroup {
  id: string
  label: string
  display?: 'inline' | 'dropdown'
  items: readonly (ToolbarBuiltinId | ToolbarAction)[]
}

export interface ToolbarConfig {
  /** Replaces the entire default layout; an empty array hides all entries. */
  groups?: readonly ToolbarGroup[]
}

export interface ToolbarActionError {
  id: string
  error: unknown
}

/** Shared defaults are frozen down to each item array to isolate consumers. */
export const defaultToolbarGroups: readonly ToolbarGroup[] = Object.freeze([
  { id: 'formatting', label: '文字格式', items: ['bold', 'italic', 'inlineCode'] },
  { id: 'headings', label: '标题', items: ['h1', 'h2', 'h3'] },
  { id: 'lists', label: '列表与引用', items: ['bullet', 'ordered', 'quote'] },
  { id: 'insert', label: '插入', items: ['link', 'table', 'codeBlock'] },
  { id: 'history', label: '历史', items: ['undo', 'redo'] },
  { id: 'extensions', label: '扩展', display: 'dropdown', items: ['inlineMath', 'blockMath', 'mention', 'contentReference', 'embed', 'blockVariants'] },
].map(group => Object.freeze({ ...group, items: Object.freeze(group.items) })) as readonly ToolbarGroup[])
