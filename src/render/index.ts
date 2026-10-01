/**
 * Markdown → HTML rendering for the display side of Nexusdown.
 *
 * Why this module exists: Nexusdown is an *editor*. A consumer that stores the
 * Markdown it produces also has to *display* it, and reaching for a second
 * Markdown library means two parsers that evolve separately — the editor emits
 * syntax the display side cannot read, and the display side accepts syntax the
 * editor cannot. This module closes that gap by implementing the dialect once,
 * explicitly, on top of `markdown-it`.
 *
 * ## Why markdown-it, and not the editor's own parser
 *
 * This module used to reuse the editor's Tiptap extensions: parse with
 * `@tiptap/markdown`, render with `@tiptap/static-renderer`. That kept the two
 * sides in lockstep for free, but it tied the display side to the editor's
 * document model — and the editor's model is a ProseMirror node tree, not text.
 * Since the editor moved to CodeMirror 6 (text is the source of truth), a
 * renderer built on Tiptap nodes would have to keep a whole second schema alive
 * just to display stored Markdown.
 *
 * `markdown-it` was chosen over `unified`/`remark` because:
 *
 * - It is **synchronous and DOM-free** — one `md.render()` call, no async plugin
 *   chain and no `vfile`, so it drops straight into a Nitro/Astro server render.
 * - `html: false` is the **default**, and stays on here: raw HTML in the input is
 *   escaped, never passed through.
 * - The renderer is a plain `Record<tokenType, (tokens, idx) => string>`, which
 *   is what makes it possible to reproduce the exact tag shape the editor emits
 *   (see `renderer.ts`) instead of accepting a different HTML dialect.
 *
 * ## Dialect contract
 *
 * Standard Markdown plus GFM (tables, task lists, strikethrough, autolinks) plus
 * **`==highlight==`**, which is Nexusdown's own inline syntax — see `mark.ts` for
 * why it needs a hand-written rule rather than a preset. The output matches the
 * editor's own HTML for every construct it can produce, so a consumer can style
 * both with one stylesheet (`src/style.css`).
 *
 * ## Security — read this before inserting the output
 *
 * **This function does not sanitise its output.** The returned string is meant
 * to be inserted into the page as-is (for example through Vue's `v-html`), so it
 * is only safe for **trusted** input:
 *
 * - Trusted: Markdown produced by Nexusdown's own editor, or content authored
 *   by the same party that operates the site.
 * - Not trusted: arbitrary Markdown or raw HTML pasted by end users.
 *
 * Two properties keep the blast radius small, and both are covered by tests:
 *
 * 1. `html: false` — raw HTML in the input is escaped to text, not passed
 *    through. `<script>alert(1)</script>` comes out as
 *    `&lt;script&gt;alert(1)&lt;/script&gt;`.
 * 2. Links are validated by markdown-it's own `validateLink`, which rejects
 *    `javascript:`, `vbscript:` and `data:`. A rejected link degrades to its
 *    literal source text rather than to an anchor. (The Tiptap renderer this
 *    replaced emitted `<a href="">` instead — no link either way, but the
 *    literal form is the stricter of the two.)
 *
 * Attribute values are still escaped, not sanitised: a `title` or an image
 * `src` is emitted with whatever it contained. If you accept untrusted input,
 * run the result through a sanitiser (e.g. DOMPurify) before inserting it.
 */
import MarkdownIt from 'markdown-it'
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it'
import { wwwOnlyAutolinkPlugin } from './autolink.js'
import { markPlugin } from './mark.js'
import { applyNexusdownRenderer } from './renderer.js'
import { taskListPlugin } from './task-list.js'

/**
 * A markdown-it plugin: a function that configures a parser instance.
 *
 * markdown-it's own `PluginSimple` type is not re-exported from the package
 * root, so this is the structural equivalent.
 */
export type MarkdownItPlugin = (md: MarkdownItInstance) => void

export interface RenderMarkdownOptions {
  /**
   * Extra markdown-it plugins, applied **after** the Nexusdown defaults, so a
   * plugin can replace any rule this module installed.
   *
   * This replaces the old Tiptap `extensions` option: the editor and the
   * renderer no longer share an extension set, so a consumer syntax now has to
   * be described twice — once for the editor, once as a markdown-it plugin.
   *
   * Pass a stable array reference: parsers are cached per array, and a fresh
   * array on every call rebuilds one. (Unlike the Tiptap manager this replaced,
   * a `MarkdownIt` instance keeps no global state, so the cache is a pure
   * optimisation — rebuilding is correct, just wasteful.)
   */
  plugins?: MarkdownItPlugin[]
}

/** Parser for the default syntax set, built once on first use. */
let defaultParser: MarkdownItInstance | undefined

/** Parsers for custom plugin sets, keyed by array identity. */
const customParsers = new WeakMap<MarkdownItPlugin[], MarkdownItInstance>()

function createParser(plugins?: MarkdownItPlugin[]): MarkdownItInstance {
  const md = new MarkdownIt({
    // Never pass raw HTML through — this is the XSS line.
    html: false,
    // Turn URLs in the text into links (see `fuzzyLink` below).
    linkify: true,
    // A single newline is a soft break: the editor writes a hard break as two
    // trailing spaces, and this keeps the two spellings distinguishable.
    breaks: false,
    // The editor's Typography extension only rewrites input as you type; it
    // never touched the stored Markdown, so the renderer must not either.
    typographer: false,
    xhtmlOut: false,
  })

  // Bare domains (`www.example.com`) become links, the way the editor's
  // autolink does. `linkify-it` 6 turned `fuzzyLink` off by default, so
  // markdown-it 15 only linkifies a URL that carries a scheme or a leading
  // `//` — without this, every `www.` URL in existing content would go back to
  // being plain text. `wwwOnlyAutolinkPlugin` then narrows the fuzzy pass back
  // to `www.`, so `README.md` stays a filename.
  md.linkify.set({ fuzzyLink: true })

  md.use(markPlugin).use(taskListPlugin).use(wwwOnlyAutolinkPlugin)
  applyNexusdownRenderer(md)
  for (const plugin of plugins ?? []) md.use(plugin)

  return md
}

function resolveParser(plugins: MarkdownItPlugin[] | undefined): MarkdownItInstance {
  if (!plugins || plugins.length === 0) {
    defaultParser ??= createParser()
    return defaultParser
  }
  let parser = customParsers.get(plugins)
  if (!parser) {
    parser = createParser(plugins)
    customParsers.set(plugins, parser)
  }
  return parser
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
  return resolveParser(options?.plugins).render(markdown)
}

/*
 * 代码块标题栏的 HTML —— **和编辑器 widget 用的是同一个函数**。
 *
 * `renderMarkdown` 产出的围栏代码块里已经带了这个标题栏（见 `renderer.ts` 的
 * `rules.fence`）。单独导出是给**自己渲染容器**的消费方用的 —— 比如要套一层
 * 自己的卡片、或者做演示/预览，直接调它就能拿到和编辑器逐字一致的结构。
 */
export { renderCodeHeaderHtml, type CodeHeaderRenderOptions } from '../cm/widgets/code-header-parts.js'
