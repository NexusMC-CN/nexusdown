// Compatibility entry point. New code can import from `nexusdown/core`.
export {
  createNexusdownEditor,
  NexusdownEditorSession,
} from './session/index.js'
export type {
  ContentType,
  EditorCommand,
  NexusdownEditorCommands,
  NexusdownEditorOptions,
  NexusdownEditorSnapshot,
  PasteMode,
  TextAlignment,
  SessionErrorSubscriber,
  SessionSelectionSubscriber,
  SessionSource,
  SessionSubscriber,
} from './session/index.js'
