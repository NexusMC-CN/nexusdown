import type { NexusdownEditorSession } from './session.js'

export type NexusdownCore = NexusdownEditorSession
export { createNexusdownExtensions } from './extensions.js'
export {
  createNexusdownEditor,
  NexusdownEditorSession,
  type ContentType,
  type NexusdownEditorOptions,
  type NexusdownEditorSnapshot,
  type SessionErrorSubscriber,
  type SessionSource,
  type SessionSubscriber,
} from './session.js'
