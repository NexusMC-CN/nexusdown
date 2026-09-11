import type { AnyExtension } from '@tiptap/core'
import { createBuiltInExtensions } from './builtins.js'
import type { NexusdownExtensionOptions } from './types.js'

export function createNexusdownExtensions(options: NexusdownExtensionOptions = {}): AnyExtension[] {
  const extensions = [...createBuiltInExtensions(), ...(options.extensions ?? [])]
  const resolved = options.resolve ? options.resolve(extensions) : extensions
  if (!Array.isArray(resolved)) {
    throw new TypeError('Nexusdown extension resolver must return an array')
  }
  return [...resolved]
}
