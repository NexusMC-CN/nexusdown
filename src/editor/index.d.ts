/** Public declarations for the compiled Vue editor components. */
import type { DefineComponent } from 'vue'
import type { Extension } from '@codemirror/state'
import type { ContentReferenceProvider, EditorView, MentionCandidate, MentionResolutions, NexusdownOptions, ResolveLinks } from '@nexusmc-cn/nexusdown/cm'
import type { KatexLike, MarkdownItPlugin, RenderData } from '@nexusmc-cn/nexusdown/render'
import type { ToolbarActionError, ToolbarConfig } from './toolbar.js'
export { defaultToolbarGroups } from './toolbar.js'
export type { ToolbarAction, ToolbarActionError, ToolbarBuiltinId, ToolbarConfig, ToolbarContext, ToolbarGroup } from './toolbar.js'

export interface NexusdownEditorProps {
  modelValue: string
  codeLanguages?: NexusdownOptions['codeLanguages']
  /** Complete toolbar layout; omitted configuration uses the built-in groups. */
  toolbar?: ToolbarConfig
  /** Additional CM extensions, read once when mounting. */
  extensions?: Extension
  /** Preview syntax plugins; pass the same plugins to the publishing renderer. */
  previewPlugins?: MarkdownItPlugin[]
  /** Fixed-height internal scrolling by default; page grows with the document. */
  scrollMode?: 'container' | 'page'
  /** Stick the editor header within this editor's bounds. Defaults to true. */
  stickyToolbar?: boolean
  /** Sticky top offset. Numbers are pixels; CSS strings are also accepted. */
  toolbarOffset?: number | string
  mathRenderer?: KatexLike
  mentionCandidates?: () => Promise<MentionCandidate[]>
  mentions?: MentionResolutions
  resolveLinks?: ResolveLinks
  contentReferenceProvider?: ContentReferenceProvider
  /** Current resolutions; replacing this map never replaces editor text. */
  contentReferences?: RenderData['contentReferences']
  /** Stable namespace for preview anchors; generated after mount when omitted. */
  idPrefix?: string
  /** Display heading numbers in preview. Defaults to false. */
  headingNumbers?: boolean
  /** Pre-resolved renderer data. No URL fetch occurs during preview. */
  renderData?: RenderData
  'onUpdate:modelValue'?: (value: string) => void
  'onAction-error'?: (failure: ToolbarActionError) => void
  onActionError?: (failure: ToolbarActionError) => void
}
export interface NexusdownToolbarProps {
  view: EditorView | null
  config?: ToolbarConfig
  'onAction-error'?: (failure: ToolbarActionError) => void
  onActionError?: (failure: ToolbarActionError) => void
  mentionCandidates?: () => Promise<MentionCandidate[]>
  resolveLinks?: ResolveLinks
  contentReferenceProvider?: ContentReferenceProvider
}
export declare const NexusdownEditor: DefineComponent<NexusdownEditorProps, { view: EditorView | null }>
export declare const NexusdownToolbar: DefineComponent<NexusdownToolbarProps>
