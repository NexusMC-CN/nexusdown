import Color from '@tiptap/extension-color'
import CharacterCount from '@tiptap/extension-character-count'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { TextStyle } from '@tiptap/extension-text-style'
import { Table, TableKit, renderTableToMarkdown } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import Typography from '@tiptap/extension-typography'
import Underline from '@tiptap/extension-underline'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Code from '@tiptap/extension-code'
import { common, createLowlight } from 'lowlight'
import { FindReplace } from './find-replace.js'
import {
  escapeDestination,
  escapeLabel,
  escapeLineStart,
  escapeTitle,
  renderCodeFence,
} from './markdown-escape.js'
import type { AnyExtension, JSONContent, MarkdownLexerConfiguration, MarkdownToken } from '@tiptap/core'

/** Highlight.js grammars shared by the code-block lowlight extension. */
const nexusdownLowlight = createLowlight(common)

const markdownColorPattern = /^\[color\s+color\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s\]]+))\]([\s\S]*?)\[\/color\]/i
const simpleMarkdownColorPattern = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z]+)$/i

function safeColorValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[<>"']/g, '') : ''
}

function canUseMarkdownColor(value: string): boolean {
  return simpleMarkdownColorPattern.test(value)
}

const MarkdownTextStyle = TextStyle.extend({
  markdownTokenName: 'color',
  markdownTokenizer: {
    name: 'color',
    level: 'inline' as const,
    start: (src: string) => src.indexOf('[color'),
    tokenize(src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) {
      const match = markdownColorPattern.exec(src)
      if (!match) return undefined
      const color = safeColorValue(match[1] ?? match[2] ?? match[3])
      if (!color) return undefined
      const content = match[4] ?? ''
      return {
        type: 'color',
        raw: match[0],
        color,
        text: content,
        tokens: helpers.inlineTokens(content),
      } as MarkdownToken
    },
  },
  parseMarkdown: (token, helpers) => {
    const color = safeColorValue((token as { color?: unknown }).color)
    if (!color) return helpers.parseInline([])
    return helpers.applyMark('textStyle', helpers.parseInline(token.tokens || []), { color })
  },
  renderMarkdown: (node, helpers) => {
    const color = safeColorValue(node.attrs?.color)
    if (!color) return helpers.renderChildren(node)
    if (canUseMarkdownColor(color)) {
      return `[color color="${color}"]${helpers.renderChildren(node)}[/color]`
    }
    // Markdown has no syntax for an arbitrary colour, so it falls back to inline
    // HTML. Inside an inline tag CommonMark leaves the content alone, so nested
    // formatting written as Markdown survives as literal characters rather than
    // being applied. Making the children HTML instead is not possible from here:
    // a mark renderer receives a synthetic node whose only content is the
    // literal `__TIPTAP_MARKDOWN_PLACEHOLDER__`, and the manager keeps just the
    // text before that placeholder as the opening — it never lets a mark see,
    // let alone rewrite, its own content. The library does read an internal
    // `htmlReopen` hook for this, but it is absent from the published types, so
    // relying on it would mean an untyped cast against a private API.
    return `<span style="color: ${color}">${helpers.renderChildren(node)}</span>`
  },
})

/**
 * Render a node's inline content as HTML.
 *
 * Used by the inline-HTML fallback block: CommonMark does not process Markdown
 * inside an inline HTML tag, so any child mark written as Markdown (`**b**`,
 * `*i*`, `` `c` ``, `==h==`) came back as literal markup and the formatting was
 * lost — the whole point of the fallback is to *preserve* the block, so its
 * children have to be HTML as well.
 *
 * `renderChildren` cannot be asked for this: the markdown manager renders marks
 * through their own Markdown renderers with no way to switch a subtree to HTML,
 * and `htmlReopen` only covers marks that reopen after an overlap boundary.
 *
 * Marks are emitted as the same tags the editor's own HTML serializer produces,
 * so a re-parse through the HTML parser restores them.
 */
function renderInlineHtml(nodes: unknown): string {
  if (!Array.isArray(nodes)) return ''
  return nodes.map((child) => {
    if (!child || typeof child !== 'object') return ''
    const node = child as {
      type?: string
      text?: string
      attrs?: Record<string, unknown>
      marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
      content?: unknown
    }
    const typeName = typeof node.type === 'string' ? node.type : (node.type as { name?: string } | undefined)?.name
    if (typeName === 'text') return applyInlineMarks(escapeHtmlText(node.text ?? ''), node.marks ?? [])
    if (typeName === 'hardBreak') return '<br>'
    if (Array.isArray(node.content)) return renderInlineHtml(node.content)
    return ''
  }).join('')
}

/** Escape the characters that would otherwise be read as HTML. */
function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Wrap `text` in the HTML tags for each mark it carries. */
function applyInlineMarks(text: string, marks: Array<{ type?: string; attrs?: Record<string, unknown> }>): string {
  let output = text
  for (const mark of marks) {
    const name = typeof mark.type === 'string' ? mark.type : (mark.type as { name?: string } | undefined)?.name
    const attrs = mark.attrs ?? {}
    if (name === 'bold') output = `<strong>${output}</strong>`
    else if (name === 'italic') output = `<em>${output}</em>`
    else if (name === 'strike') output = `<s>${output}</s>`
    else if (name === 'underline') output = `<u>${output}</u>`
    else if (name === 'code') output = `<code>${output}</code>`
    else if (name === 'superscript') output = `<sup>${output}</sup>`
    else if (name === 'subscript') output = `<sub>${output}</sub>`
    else if (name === 'highlight') {
      const color = typeof attrs.color === 'string' ? attrs.color : ''
      output = color ? `<mark data-color="${escapeHtmlAttribute(color)}">${output}</mark>` : `<mark>${output}</mark>`
    } else if (name === 'textStyle') {
      const color = safeColorValue(attrs.color)
      if (color) output = `<span style="color: ${escapeHtmlAttribute(color)}">${output}</span>`
    } else if (name === 'link') {
      const href = typeof attrs.href === 'string' ? attrs.href : ''
      const title = typeof attrs.title === 'string' ? ` title="${escapeHtmlAttribute(attrs.title)}"` : ''
      if (href) output = `<a href="${escapeHtmlAttribute(href)}"${title}>${output}</a>`
    }
  }
  return output
}

/** Escape a value destined for a double-quoted HTML attribute. */
function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Whether a table row contains a cell spanning more than one column or row.
 *
 * Markdown cannot express either, so such a table is serialised as HTML.
 */
function rowHasMergedCell(row: unknown): boolean {
  const children = (row as { content?: unknown[] } | null)?.content
  if (!Array.isArray(children)) return false
  return children.some((cell) => {
    const attrs = (cell as { attrs?: Record<string, unknown> } | null)?.attrs ?? {}
    const colspan = typeof attrs.colspan === 'number' ? attrs.colspan : 1
    const rowspan = typeof attrs.rowspan === 'number' ? attrs.rowspan : 1
    return colspan > 1 || rowspan > 1
  })
}

/**
 * Render a table as HTML, preserving `colspan` / `rowspan`.
 *
 * Cell contents go through {@link renderInlineHtml} for the same reason the
 * aligned-block fallback does: CommonMark does not process Markdown inside an
 * inline HTML tag, so Markdown children would come back as literal markup.
 */
function renderTableHtml(rows: JSONContent[]): string {
  const body = rows.map((row) => {
    const cells = (row.content ?? []) as JSONContent[]
    const rendered = cells.map((cell) => {
      const attrs = (cell.attrs ?? {}) as Record<string, unknown>
      const tag = cell.type === 'tableHeader' ? 'th' : 'td'
      const span = [
        typeof attrs.colspan === 'number' && attrs.colspan > 1 ? ` colspan="${attrs.colspan}"` : '',
        typeof attrs.rowspan === 'number' && attrs.rowspan > 1 ? ` rowspan="${attrs.rowspan}"` : '',
      ].join('')
      return `<${tag}${span}>${renderInlineHtml(cell.content ?? [])}</${tag}>`
    }).join('')
    return `<tr>${rendered}</tr>`
  }).join('')
  return `<table>${body}</table>`
}

/**
 * Render a paragraph/heading as Markdown, persisting block alignment and indent.
 *
 * `@tiptap/extension-text-align` ships no Markdown support, so alignment was
 * silently dropped by `getMarkdown()`. The Markdown manager resolves render
 * handlers **per node type**, and both `textAlign` and `indent` are attributes
 * of `paragraph` / `heading` rather than node types of their own — so those
 * nodes are the only place the hook can fire.
 *
 * Markdown has no syntax for either, so both are emitted as an HTML block with
 * an inline style. Blocks with neither stay plain Markdown (a `#`-prefixed
 * heading or bare paragraph text).
 */
function renderAlignedBlock(
  node: { attrs?: Record<string, unknown>; type?: unknown; content?: unknown[] },
  helpers: { renderChildren: (node: unknown) => string },
): string {
  const align = typeof node.attrs?.textAlign === 'string' ? node.attrs.textAlign : ''
  const indent = typeof node.attrs?.indent === 'number' && node.attrs.indent > 0 ? node.attrs.indent : 0
  const aligned = Boolean(align && align !== 'left')

  // `type` is a plain string on the JSON nodes the renderer passes in, but a
  // `{ name }` object on ProseMirror nodes; accept both.
  const typeName = typeof node.type === 'string' ? node.type : (node.type as { name?: string } | undefined)?.name
  const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1

  // Without alignment or indent, emit exactly what the stock renderers would.
  // Delegating to `this.parent()` is not an option: that handler is bound to the
  // manager's own helper set, which is not available here.
  //
  // A paragraph whose literal text starts with `#`, `- `, `1. `, `>` or similar
  // would otherwise be re-read as a block construct, so escape line starts.
  // Headings are exempt: their leading `#` is the syntax being emitted.
  if (!aligned && !indent) {
    // Always pass the child *array*, not the node: handing back the node makes
    // the manager re-render the same block through this handler and recurse
    // forever. A copy is used so the live document is not mutated by the
    // escaping pass.
    const children = helpers.renderChildren(escapeProseDelimitersDeep(node.content ?? []) as unknown[])
    const rendered = typeName === 'heading' ? `${'#'.repeat(level)} ${children}` : escapeLineStart(children)
    return rendered.split(ESCAPE_SENTINEL).join('\\')
  }

  const tag = typeName === 'heading' ? `h${level}` : 'p'
  const style = [aligned ? `text-align: ${align}` : '', indent ? `margin-left: ${indent * 2}em` : '']
    .filter(Boolean)
    .join('; ')
  // CommonMark does not process Markdown inside an inline HTML tag, so the
  // children are rendered as HTML too — otherwise every inline mark in the block
  // (`**b**`, `*i*`, `` `c` ``, `==h==`) came back as literal markup and the
  // formatting was lost. Text is HTML-escaped, so no Markdown escaping applies
  // here and the sentinels injected above are simply dropped.
  return `<${tag} style="${style}">${renderInlineHtml(node.content)}</${tag}>`
}

/** Default `indent` attribute contributed to paragraph and heading nodes. */
const indentAttribute = {
  indent: {
    default: null as number | null,
    parseHTML: (element: HTMLElement) => {
      const margin = element.style.marginLeft
      const match = margin ? /^([\d.]+)em$/.exec(margin) : null
      return match ? Math.round(Number(match[1]) / 2) || null : null
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes.indent
      if (typeof value !== 'number' || value <= 0) return {}
      return { style: `margin-left: ${value * 2}em` }
    },
  },
}

/**
 * Rebuild a StarterKit bundle, swapping the named child nodes for variants that
 * carry the `indent` attribute and render block alignment/indent as Markdown.
 *
 * StarterKit is a single extension that injects its children through
 * `addExtensions()`, so the only way to override one child is to re-declare the
 * bundle with that child replaced.
 */
function replaceStarterKitNodes(bundle: AnyExtension, nodeNames: string[]): AnyExtension {
  const targets = new Set(nodeNames)
  const instance = bundle as unknown as {
    options: Record<string, unknown>
    config: { addExtensions?: () => AnyExtension[] }
  }
  return bundle.extend({
    addExtensions() {
      const children = instance.config.addExtensions?.call(this) ?? []
      return children.map((child) => {
        if (!targets.has(child.name)) return child
        return child.extend({
          addAttributes(this: { parent?: () => Record<string, unknown> | undefined }) {
            const inherited = this.parent?.() ?? {}
            return { ...inherited, ...indentAttribute }
          },
          renderMarkdown: renderAlignedBlock,
        }) as AnyExtension
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

/**
 * Placeholder for a backslash that must survive the markdown manager's own
 * escaping pass, which escapes `\\` and would otherwise double every backslash
 * we add. Swapped for a real `\` on the finished string.
 */
const ESCAPE_SENTINEL = '\u0000ESC\u0000'

/**
 * Return a copy of `nodes` with the `=` / `+` delimiters escaped so the rendered
 * Markdown means the same thing when it is parsed again.
 *
 * Two distinct cases, both handled here because this is the only place the *real*
 * text content is visible:
 *
 * 1. Text that does **not** carry the mark must escape a literal `==` / `++`, or
 *    prose such as `==text==` silently becomes a highlight on reload.
 * 2. Text that **does** carry the mark must escape any `=` / `+` it contains, or
 *    a single `=` inside the content breaks the emitted delimiter — `<mark>a=b</mark>`
 *    rendered as `==a=b==` re-parses as `<mark>a</mark>b==`. This cannot be done
 *    in the mark's own `renderMarkdown`, because a mark renderer receives a
 *    synthetic node whose only content is `__TIPTAP_MARKDOWN_PLACEHOLDER__`; the
 *    real text never reaches it (which is why the escape there was a no-op).
 *
 * The markdown manager's inline escaper covers `\ ` * _ [ ] ~` but not `=` or
 * `+`, so the escape cannot simply be post-processed onto the rendered string
 * either: by then it also contains the delimiters emitted by the highlight and
 * underline renderers, and escaping those would break genuine marks.
 *
 * Returns copies throughout so the live ProseMirror document is never mutated.
 */
function escapeProseDelimitersDeep(nodes: unknown): unknown {
  if (!Array.isArray(nodes)) return nodes
  return nodes.map((child) => {
    if (!child || typeof child !== 'object') return child
    const current = child as {
      type?: string
      text?: string
      marks?: { type?: string }[]
      content?: unknown
    }
    if (current.type === 'text' && typeof current.text === 'string') {
      const marks = new Set((current.marks ?? []).map((mark) => mark.type))
      let text = current.text
      // A sentinel stands in for the leading backslash while the manager runs
      // its own escaping pass; `escapeMarkdownSyntax` escapes `\\`, so a real
      // backslash written here would come back doubled. The sentinel is swapped
      // for `\` on the finished string.
      if (marks.has('highlight')) {
        // Inside `==...==` every `=` needs escaping, including a `==` pair.
        text = text.replace(/=/g, `${ESCAPE_SENTINEL}=`)
      } else {
        text = text.replace(/==/g, `${ESCAPE_SENTINEL}=${ESCAPE_SENTINEL}=`)
      }
      if (marks.has('underline')) {
        text = text.replace(/\+/g, `${ESCAPE_SENTINEL}+`)
      } else {
        text = text.replace(/\+\+/g, `${ESCAPE_SENTINEL}+${ESCAPE_SENTINEL}+`)
      }
      return text === current.text ? child : { ...current, text }
    }
    if (Array.isArray(current.content)) {
      return { ...current, content: escapeProseDelimitersDeep(current.content) }
    }
    return child
  })
}

/**
 * Escape a literal `=` or `+` inside highlighted/underlined text.
 *
 * The stock renderers wrap content in `==...==` / `++...++` regardless of what
 * it contains, so a single `=` breaks the delimiter and the mark is lost on
 * re-parse.
 */
function escapeMarkContent(text: string): string {
  return text.replace(/=/g, '\\=').replace(/\+/g, '\\+')
}

/** The extensions included in every Nexusdown editor by default. */
export function createBuiltInExtensions(): AnyExtension[] {
  const starterKit = StarterKit.configure({ link: false, underline: false, codeBlock: false })
  return [
    // StarterKit's `paragraph` and `heading` carry the `textAlign` attribute
    // (contributed by TextAlign below). Because the Markdown manager resolves
    // render handlers per node type, those two nodes are where alignment and
    // indent must be emitted — so replace the bundle's own instances.
    replaceStarterKitNodes(starterKit, ['paragraph', 'heading']),
    MarkdownTextStyle,
    Color.configure({ types: ['textStyle'] }),
    Highlight.extend({
      // The stock renderer wraps content in `==...==` unconditionally and drops
      // the `color` attribute, so a custom highlight colour reverted to the
      // default after a Markdown round trip. Emit the colour as `=={colour}text==`
      // and read it back in the tokenizer.
      //
      // Its tokenizer also matches `[^=]+` between the delimiters, which makes
      // `==a=b==` impossible to read back — the mark is lost and the raw
      // delimiters show through. The replacement accepts a single `=` inside the
      // content and consumes backslash escapes as a unit.
      renderMarkdown: (node, helpers) => {
        const content = escapeMarkContent(helpers.renderChildren(node.content ?? []))
        const color = typeof node.attrs?.color === 'string' ? node.attrs.color : ''
        return color ? `=={${color}}${content}==` : `==${content}==`
      },
      markdownTokenizer: {
        name: 'highlight',
        level: 'inline' as const,
        start: (src: string) => src.indexOf('=='),
        tokenize(src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) {
          const match = /^(==)(\{([^}]*)\})?((?:\\.|(?!==)[\s\S])+)(==)/.exec(src)
          if (!match) return undefined
          const content = match[4].replace(/\\(.)/g, '$1')
          return {
            type: 'highlight',
            raw: match[0],
            text: content,
            // `{colour}` is optional so documents written before colours were
            // emitted still parse, and a plain `==text==` keeps the default.
            color: match[3] || undefined,
            // The content was escaped on the way out precisely because it
            // contains `=` characters. Re-tokenising the unescaped text would
            // read those very characters as a nested highlight
            // (`<mark>x==y==z</mark>` came back as `x<mark>y</mark>z`), so
            // escaped content is taken literally instead.
            tokens: /\\./.test(match[4]) ? [{ type: 'text', raw: content, text: content }] : helpers.inlineTokens(content),
          } as MarkdownToken
        },
      },
      parseMarkdown: (token, helpers) => {
        const color = (token as { color?: string }).color
        return helpers.applyMark(
          'highlight',
          helpers.parseInline(token.tokens || []),
          color ? { color } : undefined,
        )
      },
    }).configure({ multicolor: true }),
    Underline.extend({
      renderMarkdown: (node, helpers) =>
        `++${escapeMarkContent(helpers.renderChildren(node.content ?? []))}++`,
      // The stock underline tokenizer does not consume backslash escapes, so the
      // `\+` written by the renderer above came back as a literal `\+` instead of
      // `+`. Mirror the highlight tokenizer: accept `\\.` as a unit and unescape.
      markdownTokenizer: {
        name: 'underline',
        level: 'inline' as const,
        start: (src: string) => src.indexOf('++'),
        tokenize(src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) {
          const match = /^(\+\+)((?:\\.|(?!\+\+)[\s\S])+)(\+\+)/.exec(src)
          if (!match) return undefined
          const content = match[2].replace(/\\(.)/g, '$1')
          return {
            type: 'underline',
            raw: match[0],
            text: content,
            // See the highlight comment: escaped content must stay literal or it
            // re-parses as a nested underline.
            tokens: /\\./.test(match[2]) ? [{ type: 'text', raw: content, text: content }] : helpers.inlineTokens(content),
          } as MarkdownToken
        },
      },
      parseMarkdown: (token, helpers) =>
        helpers.applyMark('underline', helpers.parseInline(token.tokens || [])),
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
          let text = match[2].replace(/\n/g, ' ')
          if (text.length > 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim().startsWith('`')) {
            text = text.slice(1, -1)
          } else if (text.length > 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim().endsWith('`')) {
            text = text.slice(1, -1)
          }
          return { type: 'codespan', raw: match[0], text, tokens: [] } as unknown as MarkdownToken
        },
      },
    }),
    Superscript,
    Subscript,
    Typography,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
    }),
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
    Table.extend({
      renderMarkdown: (node, helpers) => {
        // Markdown has no syntax for a merged cell, and the library flattens
        // `colspan` / `rowspan` into blank padding cells — so a merged table lost
        // its structure on export while the HTML side kept it. Emit such a table
        // as HTML, where the span attributes survive the round trip intact.
        const content = (node.content ?? []) as JSONContent[]
        if (content.some(rowHasMergedCell)) return renderTableHtml(content)
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
