/** Public declarations for the compiled Vue editor components. */
import type { DefineComponent } from 'vue'
import type { EditorView, MentionCandidate, MentionResolutions } from '@nexusmc-cn/nexusdown/cm'
import type { KatexLike } from '@nexusmc-cn/nexusdown/render'

export interface NexusdownEditorProps {
  modelValue: string
  mathRenderer?: KatexLike
  mentionCandidates?: () => Promise<MentionCandidate[]>
  mentions?: MentionResolutions
  'onUpdate:modelValue'?: (value: string) => void
}

export interface NexusdownToolbarProps {
  view: EditorView | null
  mentionCandidates?: () => Promise<MentionCandidate[]>
}

/** 成品编辑器：CM6 宿主 + 工具栏 + 正文排版。 */
export declare const NexusdownEditor: DefineComponent<NexusdownEditorProps, { view: EditorView | null }>

/** 只要工具栏（想自己管编辑器时用）。 */
export declare const NexusdownToolbar: DefineComponent<NexusdownToolbarProps>
