import CharacterCount from '@tiptap/extension-character-count'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Table, TableKit, renderTableToMarkdown } from '@tiptap/extension-table'
import Typography from '@tiptap/extension-typography'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Code from '@tiptap/extension-code'
import Highlight from '@tiptap/extension-highlight'
import { common, createLowlight } from 'lowlight'
import { FindReplace } from './find-replace.js'
import {
  EQUALS_ESCAPE_SENTINEL,
  escapeDestination,
  escapeLabel,
  escapeLineStart,
  escapeLiteralHighlightDelimiters,
  escapeTitle,
  renderCodeFence,
} from './markdown-escape.js'
import type {
  AnyExtension,
  ExtendableConfig,
  JSONContent,
  MarkdownLexerConfiguration,
  MarkdownRendererHelpers,
  MarkdownToken,
} from '@tiptap/core'

/** Highlight.js grammars shared by the code-block lowlight extension. */
const nexusdownLowlight = createLowlight(common)

/**
 * Render a paragraph or heading as plain Markdown.
 *
 * `@tiptap/markdown` resolves render handlers **per node type**, so these two
 * nodes are the only place the escaping below can fire.
 *
 * A paragraph whose literal text starts with `#`, `- `, `1. `, `>` or similar
 * would otherwise be re-read as a block construct, so line starts are escaped.
 * Headings are exempt: their leading `#` is the syntax being emitted.
 *
 * Literal `==` in the inline content is escaped too, so a paragraph that merely
 * *looks* like a highlight does not become one on reload. The escape is written
 * into the child nodes before they are rendered (a `==` inside a real highlight
 * or code span is left alone), and the sentinel standing in for its backslash is
 * resolved on the finished string — see `escapeLiteralHighlightDelimiters`.
 */
function renderProseBlock(
  node: { attrs?: Record<string, unknown>; type?: unknown; content?: unknown[] },
  helpers: MarkdownRendererHelpers,
): string {
  // Always pass the child *array*, not the node: handing back the node makes
  // the manager re-render the same block through this handler and recurse
  // forever. A copy is used so the live document is not mutated by the escape.
  const children = helpers.renderChildren(
    escapeLiteralHighlightDelimiters(node.content ?? []) as unknown[],
  )

  // `type` is a plain string on the JSON nodes the renderer passes in, but a
  // `{ name }` object on ProseMirror nodes; accept both.
  const typeName = typeof node.type === 'string' ? node.type : (node.type as { name?: string } | undefined)?.name
  const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
  const rendered = typeName !== 'heading' ? escapeLineStart(children) : `${'#'.repeat(level)} ${children}`

  // The sentinel survived the manager's own escaping pass untouched; it becomes
  // the real backslash now that the text is final.
  return rendered.split(EQUALS_ESCAPE_SENTINEL).join('\\')
}

/**
 * Render a hard break as two trailing spaces, the CommonMark spelling.
 *
 * The stock renderer emits `<br>`: raw HTML that forces a consumer to either
 * enable HTML (an XSS hole) or show the tag as literal text. Two spaces at the
 * end of a line mean the same thing and read back as a `hardBreak` node.
 */
function renderHardBreak(): string {
  return '  \n'
}

/**
 * Rebuild a StarterKit bundle, replacing the named children with variants that
 * carry the given Markdown hooks.
 *
 * StarterKit is a single extension that injects its children through
 * `addExtensions()`, so the only way to override one child is to re-declare the
 * bundle with that child replaced.
 */
function overrideStarterKitChildren(
  bundle: AnyExtension,
  overrides: Record<string, Partial<ExtendableConfig>>,
): AnyExtension {
  const instance = bundle as unknown as {
    config: { addExtensions?: () => AnyExtension[] }
  }
  return bundle.extend({
    addExtensions() {
      const children = instance.config.addExtensions?.call(this) ?? []
      return children.map((child) => {
        const override = overrides[child.name]
        if (!override) return child
        return child.extend(override) as AnyExtension
      })
    },
  })
}

/**
 * Wrap each cell's rendered Markdown so `|` is escaped once, after the library's
 * own inline escaping has already run.
 *
 * `renderTableToMarkdown` calls `renderChildren(cell.content)` and then pads the
 * result into columns. Pre-escaping the source text does not work because the
 * library's `escapeMarkdownSyntax` escapes backslashes too, doubling the one we
 * add. Wrapping the cell's children in a synthetic text node lets the escape run
 * on the finished string instead.
 */
function escapeCellContentPipes(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  return content.map((row) => {
    if (!row || typeof row !== 'object') return row
    const rowNode = row as { content?: unknown }
    if (!Array.isArray(rowNode.content)) return row
    return {
      ...rowNode,
      content: rowNode.content.map((cell) => {
        if (!cell || typeof cell !== 'object') return cell
        const cellNode = cell as { content?: unknown }
        if (!Array.isArray(cellNode.content)) return cell
        return {
          ...cellNode,
          content: cellNode.content.map((child) => {
            if (!child || typeof child !== 'object') return child
            const childNode = child as { content?: unknown }
            if (!Array.isArray(childNode.content)) return child
            return {
              ...childNode,
              content: escapePipesInNodes(childNode.content),
            }
          }),
        }
      }),
    }
  })
}

/**
 * Mark text nodes so their pipes are escaped once, on the rendered output.
 *
 * A sentinel character stands in for `|` while the library escapes the rest of
 * the text; it is swapped for `\|` afterwards. This keeps our backslash out of
 * the library's own escaping pass.
 */
const PIPE_SENTINEL = '\u0000PIPE\u0000'

function escapePipesInNodes(nodes: unknown): unknown {
  if (!Array.isArray(nodes)) return nodes
  return nodes.map((node) => {
    if (!node || typeof node !== 'object') return node
    const current = node as { type?: string; text?: string; content?: unknown }
    if (current.type === 'text' && typeof current.text === 'string') {
      return { ...current, text: current.text.replace(/\|/g, PIPE_SENTINEL) }
    }
    if (Array.isArray(current.content)) {
      return { ...current, content: escapePipesInNodes(current.content) }
    }
    return node
  })
}

/** The extensions included in every Nexusdown editor by default. */
export function createBuiltInExtensions(): AnyExtension[] {
  // `underline: false` is not just de-duplication: StarterKit's own underline
  // has no Markdown syntax and serialises as `++...++`, which is not Markdown at
  // all. `link`, `code` and `codeBlock` are replaced by the extended copies
  // below.
  const starterKit = StarterKit.configure({ link: false, underline: false, code: false, codeBlock: false })
  return [
    // `paragraph` and `heading` render plain Markdown with line starts escaped;
    // `hardBreak` renders two trailing spaces instead of `<br>`. The Markdown
    // manager resolves render handlers per node type, so the bundle's own
    // instances are the only place those hooks can fire.
    overrideStarterKitChildren(starterKit, {
      paragraph: { renderMarkdown: renderProseBlock },
      heading: { renderMarkdown: renderProseBlock },
      hardBreak: { renderMarkdown: renderHardBreak },
    }),
    // Inline code may be fenced by a run of backticks longer than one when the
    // content itself contains a backtick (``a`b`` must be written `` ``a`b`` ``).
    // The stock tokenizer only understands a single backtick, so the wider fence
    // written by `repairInlineCodeFences` would not read back. CommonMark trims
    // one leading/trailing space when the content begins or ends with a backtick,
    // which is why the writer pads those cases.
    Code.extend({
      markdownTokenizer: {
        name: 'codespan',
        level: 'inline' as const,
        start: (src: string) => src.indexOf('`'),
        tokenize(src: string) {
          const match = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(src)
          if (!match) return undefined
          // A matched code span always includes its second capture.
          let text = match[2]!.replace(/\n/g, ' ')
          if (text.length > 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim().startsWith('`')) {
            text = text.slice(1, -1)
          } else if (text.length > 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim().endsWith('`')) {
            text = text.slice(1, -1)
          }
          return { type: 'codespan', raw: match[0], text, tokens: [] } as unknown as MarkdownToken
        },
      },
    }),
    // Highlight is the **plain-text** spelling `==text==` — the Obsidian /
    // markdown-it-mark syntax — never `<mark>`. `multicolor: false` keeps it a
    // single on/off toggle with no colour attribute, so there is nothing that
    // could only serialise as HTML or a shortcode: the same `==` is read back by
    // the editor and by `renderMarkdown`, which share this extension set.
    //
    // The stock extension already ships a `==...==` renderer and tokenizer, but
    // its tokenizer refuses a `=` inside the content (`[^=]+`), so `==a=b==`
    // would be written by the editor and then *not* read back — a silent
    // round-trip loss. The tokenizer below replaces it with a lazy, non-empty
    // match so an inner `=` survives and `====` stays literal text.
    //
    // A mark's delimiters are derived from a *synthetic* node whose only content
    // is a fixed placeholder, so `renderMarkdown` never sees the real text and
    // cannot escape a literal `==` inside it. That is the one case the writer
    // cannot repair from here; see the note in the delivery report.
    Highlight.extend({
      renderMarkdown: (node, helpers) => `==${helpers.renderChildren(node.content ?? [])}==`,
      parseMarkdown: (token, helpers) =>
        helpers.applyMark('highlight', helpers.parseInline(token.tokens ?? [])),
      markdownTokenizer: {
        name: 'highlight',
        level: 'inline' as const,
        start: (src: string) => src.indexOf('=='),
        tokenize(src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) {
          // Lazy (`+?`) so it closes at the *first* `==`, and non-empty so a
          // lone `====` never matches — an empty highlight cannot exist as a
          // ProseMirror mark anyway, since marks attach to text.
          const match = /^==([\s\S]+?)==/.exec(src)
          if (!match) return undefined
          const content = match[1]!
          return {
            type: 'highlight',
            raw: match[0],
            text: content,
            tokens: helpers.inlineTokens(content),
          } as unknown as MarkdownToken
        },
      },
    }).configure({ multicolor: false }),
    Typography,
    Placeholder.configure({ placeholder: '开始输入…' }),
    CharacterCount,
    // Images: the alt text becomes the Markdown label, so an unmatched `]` in it
    // would terminate the label early and turn the image into plain text.
    Image.extend({
      renderMarkdown: (node, helpers) => {
        const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
        const alt = escapeLabel(typeof node.attrs?.alt === 'string' ? node.attrs.alt : '')
        const title = typeof node.attrs?.title === 'string' ? node.attrs.title : ''
        void helpers
        const titlePart = title ? ` "${escapeTitle(title)}"` : ''
        return `![${alt}](${escapeDestination(src)}${titlePart})`
      },
      // `allowBase64` must be preserved here: `extend()` starts from the
      // extension's own defaults, so omitting this config silently makes the
      // HTML parser drop every `data:` image.
    }).configure({ allowBase64: true }),
    Link.extend({
      renderMarkdown: (node, helpers) => {
        const href = typeof node.attrs?.href === 'string' ? node.attrs.href : ''
        const children = helpers.renderChildren(node.content ?? [])
        // The mark carries a `title` (a hover tooltip) that the stock renderer
        // ignored, so it was lost on every export. It is written with the same
        // quoting and escaping rules as an image title.
        const title = typeof node.attrs?.title === 'string' ? node.attrs.title : ''
        const titlePart = title ? ` "${escapeTitle(title)}"` : ''
        return `[${children}](${escapeDestination(href)}${titlePart})`
      },
    }),
    CodeBlockLowlight.extend({
      renderMarkdown: (node, helpers) => {
        const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
        const content = (node.content ?? [])
          .map((child) => helpers.renderChildren([child]))
          .join('\n')
        return renderCodeFence(content, language)
      },
    }).configure({
      lowlight: nexusdownLowlight,
      defaultLanguage: 'plaintext',
    }),
    TableKit.configure({
      // `table: false` because an extended copy is registered below; including
      // it here as well would add the keyed `selectingCells` plugin twice.
      table: false,
    }),
    // Escape `|` inside cell *content*.
    //
    // The library escapes pipes when parsing Markdown (`preprocessTablePipes`)
    // but not when rendering it, so a cell containing a pipe was written raw and
    // re-read as two columns — shifting every later cell and dropping whatever
    // fell past the last header column.
    //
    // The escape is applied to each cell's *rendered text* before the row is
    // padded into columns, so delimiter pipes (added afterwards) are never
    // touched and a content pipe is still distinguishable.
    //
    // The table is always written as a GFM pipe table. A merged cell
    // (`colspan` / `rowspan`) has no Markdown syntax, so the library flattens it
    // into blank padding cells and the merge itself is lost on export. That is
    // the deliberate trade for keeping the output pure: an HTML `<table>` would
    // preserve the merge but would not be Markdown at all.
    Table.extend({
      renderMarkdown: (node, helpers) => {
        const rendered = renderTableToMarkdown(
          { ...node, content: escapeCellContentPipes(node.content) as JSONContent[] },
          helpers,
        )
        // Swap the sentinels for real escapes now that the library's own
        // escaping pass is done with the text.
        return rendered.split(PIPE_SENTINEL).join('\\|')
      },
    }).configure({ resizable: true, renderWrapper: false }),
    TaskList,
    TaskItem,
    Markdown,
    FindReplace,
  ]
}
