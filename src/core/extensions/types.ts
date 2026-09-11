import type { AnyExtension, ExtendableConfig } from '@tiptap/core'

/**
 * Markdown hooks supported by a Tiptap extension passed to Nexusdown.
 * Extensions can use these fields to provide a native Markdown syntax;
 * Tiptap's HTML fallback remains available when a syntax cannot represent it.
 */
export type NexusdownMarkdownExtensionConfig = Pick<
  ExtendableConfig,
  'markdownTokenName' | 'parseMarkdown' | 'renderMarkdown' | 'markdownTokenizer' | 'markdownOptions'
>

export interface NexusdownExtensionOptions {
  /** Extensions appended after the Nexusdown defaults. Markdown hooks on these extensions are registered automatically. */
  extensions?: AnyExtension[]
  /** Receives a fresh list and may filter, reorder, or replace extensions. */
  resolve?: (extensions: AnyExtension[]) => AnyExtension[]
}
