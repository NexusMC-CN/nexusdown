/** Public declarations for the compiled Vue editor components. */
import type { DefineComponent } from 'vue'
import type { ContentReferenceProvider, EditorView, MentionCandidate, MentionResolutions, NexusdownOptions, ResolveLinks } from '@nexusmc-cn/nexusdown/cm'
import type { KatexLike, RenderData } from '@nexusmc-cn/nexusdown/render'

export interface NexusdownEditorProps {
  modelValue: string
  codeLanguages?: NexusdownOptions['codeLanguages']
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
}
export interface NexusdownToolbarProps {
  view: EditorView | null
  mentionCandidates?: () => Promise<MentionCandidate[]>
  resolveLinks?: ResolveLinks
  contentReferenceProvider?: ContentReferenceProvider
}
export declare const NexusdownEditor: DefineComponent<NexusdownEditorProps, { view: EditorView | null }>
export declare const NexusdownToolbar: DefineComponent<NexusdownToolbarProps>
