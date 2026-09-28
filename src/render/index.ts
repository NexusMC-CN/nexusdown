/**
 * Markdown → HTML rendering for the display side of Nexusdown.
 *
 * Why this module exists: Nexusdown is an *editor*. A consumer that stores the
 * Markdown it produces also has to *display* it, and reaching for a second
 * Markdown library (markdown-it, marked, ...) means two parsers that evolve
 * separately — the editor emits syntax the display side cannot read, and the
 * display side accepts syntax the editor cannot. This module closes that gap by
 * reusing the exact same Tiptap extensions as the editor:
 *
 *   1. `MarkdownManager` (from `@tiptap/markdown`) deserialises the Markdown
 *      into a Tiptap/ProseMirror JSON document through the same tokenizers and
 *      `parseMarkdown` handlers the editor registered.
 *   2. `renderToHTMLString` (from `@tiptap/static-renderer`) renders that
 *      document to an HTML string through each extension's `renderHTML`.
 *
 * Both steps are pure JavaScript — no `window`, no `document`, no editor
 * instance. That is what makes the function safe to call during Nuxt/Astro SSR,
 * and why the renderer is `@tiptap/static-renderer` rather than
 * `editor.getHTML()` or `@tiptap/html`: those two go through ProseMirror's
 * `DOMSerializer`, which needs a live DOM and therefore cannot run on a server.
 *
 * ## Dialect contract
 *
 * The renderer reads and writes **standard Markdown plus GFM** (tables, task
 * lists, strikethrough, autolinks). It does **not** understand BBCode, and it
 * does **not** emit HTML as a persistence format. Anything an extension renders
 * as HTML on the way *out* of the editor is still parsed back here, because the
 * parse side is the same extension set — the contract is about the dialect, not
 * about which characters happen to appear in a given document.
 *
 * ## Security — read this before inserting the output
 *
 * **This function does not sanitise its output.** The returned string is meant
 * to be inserted into the page as-is (for example through Vue's `v-html`), so
 * it is only safe for **trusted** input:
 *
 * - Trusted: Markdown produced by Nexusdown's own editor, or content authored
 *   by the same party that operates the site.
 * - Not trusted: arbitrary Markdown or raw HTML pasted by end users. Links keep
 *   whatever `href` they were given (including `javascript:`), and any
 *   extension whose `renderHTML` emits user-controlled values emits them
 *   verbatim.
 *
 * `@tiptap/static-renderer` itself is schema-driven: it only ever emits the
 * tags each extension's `renderHTML` declares, so raw HTML in the input is not
 * passed through by the renderer. What the input *can* still influence is
 * attribute values (URLs, image sources, titles). `@tiptap/markdown` degrades
 * raw HTML in the input to escaped literal text when no `DOMParser` exists
 * (i.e. on the server) and parses it through the schema when one does (i.e. in
 * a browser); neither path is a sanitiser. If you accept untrusted input, run
 * the result through a sanitiser (e.g. DOMPurify) before inserting it.
 */
import type { AnyExtension, JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string'
import { createNexusdownExtensions } from '../core/extensions/index.js'

export interface RenderMarkdownOptions {
  /**
   * Extra Tiptap extensions, appended after the Nexusdown defaults. Same
   * semantics as the editor's `extensions` option, so a syntax registered for
   * the editor is understood here without any further wiring.
   *
   * Pass a stable array reference: the parse/render pipeline is cached per
   * array, and a fresh array on every call rebuilds the Markdown manager.
   */
  extensions?: AnyExtension[]
}

/** The parse + render pair built for one extension set. */
interface RenderPipeline {
  parse: (markdown: string) => JSONContent
  render: (doc: JSONContent) => string
}

/** Pipeline for the default extension set, built once on first use. */
let defaultPipeline: RenderPipeline | undefined

/**
 * Pipelines for custom extension sets, keyed by array identity.
 *
 * The cache is a correctness requirement, not just an optimisation.
 * `MarkdownManager` registers its custom tokenizers on the shared `marked`
 * singleton, and `marked.use()` *appends* every registration to its extension
 * list — so building a manager per call would grow that list without bound,
 * one entry per rendered document. Reusing a manager keeps registration to one
 * per distinct extension set.
 */
const customPipelines = new WeakMap<AnyExtension[], RenderPipeline>()

function createPipeline(extensions?: AnyExtension[]): RenderPipeline {
  const resolved = createNexusdownExtensions({ extensions })
  const manager = new MarkdownManager({ extensions: resolved })
  return {
    parse: (markdown) => manager.parse(markdown),
    render: (doc) => renderToHTMLString({ content: doc, extensions: resolved }),
  }
}

function resolvePipeline(extensions: AnyExtension[] | undefined): RenderPipeline {
  if (!extensions || extensions.length === 0) {
    defaultPipeline ??= createPipeline()
    return defaultPipeline
  }
  let pipeline = customPipelines.get(extensions)
  if (!pipeline) {
    pipeline = createPipeline(extensions)
    customPipelines.set(extensions, pipeline)
  }
  return pipeline
}

/**
 * Render a Markdown string to an HTML string.
 *
 * Synchronous and DOM-free, so it can run inside a server render. An empty or
 * whitespace-only input renders to `''` rather than an empty paragraph.
 *
 * The output is **not** sanitised — see the security note at the top of this
 * file. Only pass it Markdown you trust.
 *
 * ```ts
 * import { renderMarkdown } from 'nexusdown/render'
 *
 * const html = renderMarkdown('# Hello **world**')
 * // => '<h1>Hello <strong>world</strong></h1>'
 * ```
 */
export function renderMarkdown(markdown: string, options?: RenderMarkdownOptions): string {
  if (typeof markdown !== 'string' || markdown.trim() === '') return ''
  const pipeline = resolvePipeline(options?.extensions)
  return pipeline.render(pipeline.parse(markdown))
}
