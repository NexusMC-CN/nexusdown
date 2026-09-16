import type { AnyExtension } from '@tiptap/core'
import type { PasteMode, ToolbarItem } from '../core/toolbar.js'
import type { NexusdownEditorLayout } from './layout.js'
import type { NexusdownTheme } from './composables/useNexusdownTheme.js'

/**
 * Props accepted by the `NexusdownEditor` Vue component.
 *
 * Declared separately from the SFC so consumers and the package entry get a
 * stable, documented surface without needing vue-tsc to re-parse `.vue` sources.
 * Keep in sync with the `withDefaults(defineProps<...>())` block in
 * `NexusdownEditor.vue`.
 */
export interface NexusdownEditorProps {
  /** Bound content. Serialised as `contentType` dictates. */
  modelValue?: string
  /** How `modelValue` is encoded. Defaults to `'markdown'`. */
  contentType?: 'json' | 'html' | 'markdown'
  /** Override the default toolbar items. */
  toolbarItems?: ToolbarItem[]
  /** Render the editor read-only. Defaults to `false`. */
  readonly?: boolean
  /** Additional Tiptap extensions for this editor instance. */
  extensions?: AnyExtension[]
  /** Rewrite the final extension list before the editor is created. */
  extensionResolver?: (extensions: AnyExtension[]) => AnyExtension[]
  /** Colour theme. Defaults to `'system'`. */
  theme?: NexusdownTheme
  /** Pane order. Defaults to `'rich-left'`. */
  layout?: NexusdownEditorLayout
  /** Width in px (number) or any CSS length. Defaults to `'100%'`. */
  width?: number | string
  /** Height in px (number) or any CSS length. Defaults to `420`. */
  height?: number | string
  /** Keep both panes scrolled in sync. Defaults to `true`. */
  syncScroll?: boolean
  /** Show the character/line status bar. Defaults to `true`. */
  showStatusBar?: boolean
  /** Resolve an image file to its final URL. Falls back to inline base64. */
  imageUpload?: (file: File) => Promise<string>
  /** Maximum accepted local image size in bytes. Unset means no limit. */
  maxFileSize?: number
  /**
   * Default paste behaviour. Defaults to `'plain'`.
   *
   * - `'plain'`: insert the clipboard's plain text only.
   * - `'structured'`: keep the clipboard's rich HTML structure.
   * - `'markdown'`: parse the clipboard's plain text as Markdown.
   */
  pasteMode?: PasteMode
  /** Extra class on the root node. */
  class?: string
}
