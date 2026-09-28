import type { NexusdownEditorSession } from './session.js'

export type NexusdownCore = NexusdownEditorSession
export {
  createBuiltInExtensions,
  createNexusdownExtensions,
  FindReplace,
  type FindReplaceOptions,
  type FindReplaceStorage,
  type NexusdownExtensionOptions,
  type NexusdownMarkdownExtensionConfig,
} from './extensions/index.js'
export {
  createDefaultToolbarItems,
  type ToolbarCommand,
  type ToolbarContext,
  type ToolbarGroup,
  type ToolbarItem,
  type ToolbarSession,
} from './toolbar/index.js'
export {
  createNexusdownEditor,
  NexusdownEditorSession,
  type ContentType,
  type NexusdownEditorOptions,
  type NexusdownEditorSnapshot,
  type PasteMode,
  type SessionErrorSubscriber,
  type SessionSource,
  type SessionSubscriber,
  type SessionSelectionSubscriber,
  type EditorCommand,
  type NexusdownEditorCommands,
} from './session.js'
