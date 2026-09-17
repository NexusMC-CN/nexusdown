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
          const indent = match[1].length
          if (pattern === ORDERED_LIST_PATTERN) {
            // `\1. text` is not an escape: CommonMark only allows a backslash
            // before ASCII punctuation, and `1` is not punctuation, so the
            // backslash survives as literal text. Escape the delimiter instead.
            const delimiterIndex = indent + match[2].length
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
