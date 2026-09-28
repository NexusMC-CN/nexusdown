/**
 * Markdown escaping helpers.
 *
 * `@tiptap/markdown` escapes only a small inline set (`\ ` * _ [ ] ~`) in text
 * nodes. Everything else — block-level line starts, table pipes, and the
 * highlight/underline delimiters — is emitted verbatim, which means content can
 * change meaning when the Markdown is parsed again. These helpers close those
 * gaps so a document survives `getMarkdown()` → `setMarkdown()` unchanged.
 */

/** Characters escaped everywhere in inline prose. */
const INLINE_ESCAPE_PATTERN = /([\\`*_[\]~])/g

/** Ordered-list marker: the digits are not punctuation, so only `.`/`)` can be escaped. */
const ORDERED_LIST_PATTERN = /^(\s*)(\d{1,9})([.)])(\s|$)/

/** Block markers that only matter when they start a line. */
const LINE_START_MARKERS: ReadonlyArray<RegExp> = [
  /^(\s*)(#{1,6})(\s|$)/, // ATX heading
  /^(\s*)([-+*])(\s|$)/, // bullet list
  ORDERED_LIST_PATTERN, // ordered list
  /^(\s*)(>)(\s|$)/, // blockquote
  /^(\s*)(=+|-{2,})(\s*)$/, // setext heading underline
  /^(\s*)(\|)/, // table row
  /^(\s*)(`{3,}|~{3,})/, // fenced code
]

/**
 * Escape text that will be written as a full line of Markdown, so a paragraph
 * whose literal content looks like a heading/list/quote stays a paragraph.
 *
 * Applied per line rather than to the whole block: only the *first* characters
 * of a line can start a block construct, and escaping mid-line would litter
 * ordinary prose with backslashes.
 */
export function escapeLineStart(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!line) return line
      for (const pattern of LINE_START_MARKERS) {
        const match = pattern.exec(line)
        if (match) {
          // Every marker pattern contains a required leading-indent capture.
          const indent = match[1]!.length
          if (pattern === ORDERED_LIST_PATTERN) {
            // `\1. text` is not an escape: CommonMark only allows a backslash
            // before ASCII punctuation, and `1` is not punctuation, so the
            // backslash survives as literal text. Escape the delimiter instead.
            const delimiterIndex = indent + match[2]!.length
            return `${line.slice(0, delimiterIndex)}\\${line.slice(delimiterIndex)}`
          }
          // Insert a backslash before the first marker character.
          return `${line.slice(0, indent)}\\${line.slice(indent)}`
        }
      }
      return line
    })
    .join('\n')
}

/**
 * Escape a table cell's contents.
 *
 * A raw `|` inside a cell is read back as a column separator, which shifts every
 * following cell and silently drops content past the last header column.
 */
export function escapeTableCell(text: string): string {
  return text.replace(INLINE_ESCAPE_PATTERN, '\\$1').replace(/\|/g, '\\|')
}

/**
 * Stands in for the backslash of an escape while `@tiptap/markdown` runs its
 * own inline escaping pass.
 *
 * The manager escapes backslashes in text nodes (`escapeMarkdownSyntax`), so a
 * `\` written into the source JSON before rendering comes back doubled. A
 * character outside that escape set (`\ ` * _ [ ] ~`) survives the pass
 * untouched and is swapped for the real backslash on the finished string. The
 * sentinel itself must avoid every character in that set — an underscore here
 * comes back as `\_` and is then never matched.
 */
export const EQUALS_ESCAPE_SENTINEL = '\u0000NEXUSDOWN-EQUALS\u0000'

/** Escape every `=` of a run of two or more, leaving a lone `=` alone. */
function escapeEqualsRuns(text: string): string {
  return text.replace(/={2,}/g, (run) => run.replace(/=/g, `${EQUALS_ESCAPE_SENTINEL}=`))
}

/** Mark type name, accepting both JSON (`'highlight'`) and ProseMirror (`{ name }`) marks. */
function markName(mark: { type?: unknown }): string {
  return typeof mark.type === 'string' ? mark.type : ((mark.type as { name?: string } | undefined)?.name ?? '')
}

/** Node type name, accepting both JSON (`'text'`) and ProseMirror (`{ name }`) nodes. */
function nodeName(node: { type?: unknown }): string {
  return typeof node.type === 'string' ? node.type : ((node.type as { name?: string } | undefined)?.name ?? '')
}

/**
 * Escape the literal `==` in ordinary prose that would otherwise be re-read as
 * a highlight.
 *
 * `@tiptap/markdown` escapes `\ ` * _ [ ] ~` in text nodes but not `=`, so a
 * paragraph whose literal text is `a ==b== c` is written verbatim and comes
 * back as `<p>a <mark>b</mark> c</p>` — the user's text silently changes meaning
 * on reload. The escape is applied to the child *nodes* rather than to the
 * rendered string, because by the time the string exists it also contains the
 * `==` delimiters the highlight renderer emitted for genuine marks, and those
 * must be left alone.
 *
 * This runs from the `paragraph` / `heading` renderers, which are the only
 * places `@tiptap/markdown` offers a hook that sees a block's real inline
 * content. Text nodes carrying `highlight` or `code` are skipped:
 *
 *   - a highlight's text sits *between* the `==` its own renderer emits, so
 *     escaping it would corrupt the span rather than protect it;
 *   - a code span's text never reaches the manager's inline escaper, so a
 *     sentinel written there would never be swapped back for a backslash.
 *
 * Fenced code is unaffected for a different reason: its content is rendered by
 * the code-block handler, which does not call this.
 *
 * Every `=` of a run of two or more is escaped, not just the pairs: escaping
 * only the pairs of an odd run (`===` -> `\=\==`) leaves two `=` adjacent and
 * the tokenizer matches them again. A lone `=` is left alone — `a = b` holds no
 * delimiter, and escaping it would litter ordinary prose with backslashes.
 *
 * Returns copies throughout; the live document is never mutated.
 */
export function escapeLiteralHighlightDelimiters(nodes: unknown): unknown {
  if (!Array.isArray(nodes)) return nodes
  return nodes.map((child) => {
    if (!child || typeof child !== 'object') return child
    const current = child as {
      type?: unknown
      text?: string
      marks?: ReadonlyArray<{ type?: unknown }>
      content?: unknown
    }
    if (nodeName(current) === 'text' && typeof current.text === 'string') {
      const marks = new Set((current.marks ?? []).map(markName))
      if (marks.has('highlight') || marks.has('code')) return child
      if (!current.text.includes('==')) return child
      return { ...current, text: escapeEqualsRuns(current.text) }
    }
    if (Array.isArray(current.content)) {
      return { ...current, content: escapeLiteralHighlightDelimiters(current.content) }
    }
    return child
  })
}

/**
 * Render a fenced code block with a fence longer than any run inside it.
 *
 * A line of three backticks inside the code would otherwise close the block
 * early, turning the remainder into prose.
 *
 * NOTE: the equivalent fix for *inline* code is not implementable through the
 * public API. `@tiptap/markdown` renders marks by calling `renderMarkdown` with
 * a synthetic node whose only text is a fixed placeholder, and caches the
 * opening/closing delimiter before the real content is known — so a code span's
 * fence cannot be chosen from its content.
 */
export function renderCodeFence(content: string, language: string | undefined): string {
  const longestRun = (content.match(/^`{3,}/gm) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  const info = language ? language : ''
  const body = content.endsWith('\n') ? content.slice(0, -1) : content
  return `${fence}${info}\n${body}\n${fence}`
}

/** Longest run of backticks inside `text`. */
function longestBacktickRun(text: string): number {
  return (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0)
}

/**
 * Widen inline code spans whose content contains a backtick.
 *
 * A code span must be fenced by a run of backticks *longer* than any run inside
 * it, so ``a`b`` has to be written as ` ``a`b`` ` rather than `` `a`b` `` (which
 * re-parses as `<code>a</code>b\``).
 *
 * This cannot be done by the `code` mark's `renderMarkdown`: the manager derives
 * a mark's delimiters by calling the renderer with a synthetic node whose only
 * content is a fixed placeholder, then keeps the text before/after it. The real
 * content never reaches the renderer, so the fence length cannot be chosen there.
 * The document itself does know the real text, so the emitted Markdown is
 * repaired afterwards against the code spans actually present in the document.
 *
 * Only spans that need it are rewritten, so ordinary inline code is untouched.
 */
export function repairInlineCodeFences(markdown: string, doc: ProseMirrorDocumentLike): string {
  const contents = collectCodeSpanContents(doc).filter((text) => text.includes('`'))
  if (contents.length === 0) return markdown

  let output = markdown
  for (const content of contents) {
    const fence = '`'.repeat(longestBacktickRun(content) + 1)
    // The stock renderer wraps the content in single backticks. CommonMark trims
    // one leading/trailing space from a span whose content starts or ends with a
    // backtick, so the padded form is required when the content has such an edge.
    const padded = content.startsWith('`') || content.endsWith('`') ? ` ${content} ` : content
    const replacement = `${fence}${padded}${fence}`
    const broken = `\`${content}\``
    output = output.split(broken).join(replacement)
  }
  return output
}

/** Minimal structural view of a ProseMirror document; avoids importing the type here. */
interface ProseMirrorDocumentLike {
  descendants: (callback: (node: ProseMirrorNodeLike) => boolean | void) => void
}

interface ProseMirrorNodeLike {
  isText?: boolean
  text?: string | null
  marks?: ReadonlyArray<{ type: { name: string } }>
  descendants?: (callback: (node: ProseMirrorNodeLike) => boolean | void) => void
}

/** Text of every `code`-marked span in the document, in document order. */
function collectCodeSpanContents(doc: ProseMirrorDocumentLike): string[] {
  const spans: string[] = []
  doc.descendants((node) => {
    if (!node.isText || typeof node.text !== 'string') return true
    const isCode = (node.marks ?? []).some((mark) => mark.type.name === 'code')
    if (isCode) spans.push(node.text)
    return true
  })
  return spans
}

/** Escape a link/image destination for use inside `(...)`. */
export function escapeDestination(value: string): string {
  // Unbalanced parentheses end the destination early. Angle brackets are the
  // CommonMark way to wrap a destination that contains them.
  if (/[()\s]/.test(value)) {
    return `<${value.replace(/[<>]/g, (char) => (char === '<' ? '%3C' : '%3E'))}>`
  }
  return value
}

/** Escape link/image title text for use inside `"..."`. */
export function escapeTitle(value: string): string {
  return value.replace(/([\\"])/g, '\\$1')
}

/** Escape image alt / link label text so brackets do not terminate it. */
export function escapeLabel(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1')
}
