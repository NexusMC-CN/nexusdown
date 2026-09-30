/**
 * The renderer half of `renderMarkdown`: token stream → HTML string.
 *
 * markdown-it's stock HTML is *close* to what Nexusdown emitted before, but not
 * equal, and the differences are the kind a consumer notices immediately:
 *
 * | | markdown-it | Nexusdown |
 * | --- | --- | --- |
 * | links | `<a href>` | `<a target="_blank" rel="noopener noreferrer nofollow" href>` |
 * | tight list item | `<li>a</li>` | `<li><p>a</p></li>` |
 * | table cell | `<td>a</td>` | `<td><p>a</p></td>` |
 * | `<hr>` / `<img>` / `<br>` | HTML5 void tags | XHTML-style self-closing |
 * | block separation | `\n` after every block | nothing |
 *
 * The last one is the one that bites: markdown-it separates block tags with
 * newlines so the source is readable, but Nexusdown's output is compared
 * byte-for-byte in tests and pasted into `v-html`, so it has to be the compact
 * form. Removing them is done in `renderToken` — the single place markdown-it
 * appends a line feed — and only ever at the ends of the returned string, so an
 * attribute value that legitimately contains a newline is untouched.
 */
import type { MarkdownIt, RendererRule } from 'markdown-it'
import { TASK_ITEM_META } from './task-list.js'

const LF = 0x0a

export function applyNexusdownRenderer(md: MarkdownIt): void {
  const escapeHtml = md.utils.escapeHtml
  const rules = md.renderer.rules

  applyNoBlockSeparators(md)

  /**
   * Links carry the editor's external-link attributes, exactly as
   * `@tiptap/extension-link` renders them. Attribute order is load-bearing for
   * nobody, but it keeps the output diffable against the editor's own HTML.
   */
  rules.link_open = (tokens, idx) => {
    const token = tokens[idx]!
    const href = token.attrGet('href') ?? ''
    const title = token.attrGet('title')
    return (
      `<a target="_blank" rel="noopener noreferrer nofollow" href="${escapeHtml(String(href))}"` +
      `${title ? ` title="${escapeHtml(String(title))}"` : ''}>`
    )
  }

  rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!
    const src = token.attrGet('src') ?? ''
    const title = token.attrGet('title')
    // CommonMark says `alt` is the label with its markup stripped, which is what
    // markdown-it's own rule does — so this cannot just read the `alt` attribute.
    const alt = self.renderInlineAsText(token.children ?? [], options, env)
    return (
      `<img src="${escapeHtml(String(src))}" alt="${escapeHtml(alt)}"` +
      `${title ? ` title="${escapeHtml(String(title))}"` : ''}/>`
    )
  }

  rules.hr = () => '<hr/>'
  rules.hardbreak = () => '<br/>'

  /**
   * Paragraphs are always emitted, including the ones markdown-it marks
   * `hidden` in a tight list: the editor's list item content *is* a paragraph,
   * so `- a` renders as `<li><p>a</p></li>` and the item's spacing is the
   * paragraph's. Without this, tight and loose lists would render differently
   * even though the editor stores them identically.
   */
  rules.paragraph_open = () => '<p>'
  rules.paragraph_close = () => '</p>'

  /**
   * A task item's `<li>` opens with the checkbox and wraps the rest of the item
   * — its paragraph *and* any nested list — in the `<div>` the editor emits. The
   * wrapper belongs here rather than on the paragraph: see `task-list.ts`.
   */
  rules.list_item_open = (tokens, idx, options, env, self) => {
    const checked = tokens[idx]!.meta?.[TASK_ITEM_META]
    const open = self.renderToken(tokens, idx, options)
    if (checked === undefined) return open
    return `${open}<label><input type="checkbox"${checked ? ' checked="checked"' : ''}/><span/></label><div>`
  }
  rules.list_item_close = (tokens, idx, options, env, self) =>
    tokens[idx]!.meta?.[TASK_ITEM_META] === undefined ? self.renderToken(tokens, idx, options) : '</div></li>'

  /**
   * Fenced code carries its language as `language-xxx`, and the trailing newline
   * before the closing fence is dropped — the editor's code block holds the
   * lines, not the terminator.
   */
  rules.fence = (tokens, idx) => {
    const token = tokens[idx]!
    const info = token.info ? md.utils.unescapeAll(token.info).trim() : ''
    // Only the first word is the language; ` ```ts title=x ` has a meta string
    // after it, which is not part of the class name.
    const language = info ? info.split(/\s+/)[0]! : ''
    const className = language ? ` class="language-${escapeHtml(language)}"` : ''
    return `<pre><code${className}>${escapeHtml(withoutTrailingNewline(token.content))}</code></pre>`
  }

  rules.code_block = (tokens, idx) =>
    `<pre><code>${escapeHtml(withoutTrailingNewline(tokens[idx]!.content))}</code></pre>`

  applyTableRules(rules)
}

/**
 * Drop the `\n` markdown-it appends before and after a block-level tag.
 *
 * Only the two ends of the returned string are trimmed: `renderToken` emits a
 * line feed in exactly those positions (a separator before a tag that follows a
 * hidden closing token, and one after a block tag), while anything in between is
 * an attribute value and must survive.
 */
function applyNoBlockSeparators(md: MarkdownIt): void {
  const renderToken = md.renderer.renderToken.bind(md.renderer)
  md.renderer.renderToken = (tokens, idx, options) => {
    let html = renderToken(tokens, idx, options)
    if (html.charCodeAt(0) === LF) html = html.slice(1)
    if (html.charCodeAt(html.length - 1) === LF) html = html.slice(0, -1)
    return html
  }
}

/**
 * The table shape the editor produced: header cells and body cells in the same
 * `<tbody>`, every cell holding a paragraph.
 *
 * markdown-it wraps the header row in `<thead>` — the standard GFM shape — but
 * the editor's table node has no header *section*, just a first row of header
 * cells, so `<thead>` would be new structure for consumer CSS and DOM queries to
 * deal with. The `<thead>` pair is what opens `<tbody>` here, and the real
 * `<tbody>` pair is dropped; a table with no body rows still gets its `<tbody>`
 * because markdown-it always emits the header pair.
 */
function applyTableRules(rules: Record<string, RendererRule>): void {
  rules.table_open = () => '<table>'
  rules.table_close = () => '</table>'
  rules.thead_open = () => '<tbody>'
  rules.thead_close = () => ''
  rules.tbody_open = () => ''
  rules.tbody_close = () => '</tbody>'
  rules.tr_open = () => '<tr>'
  rules.tr_close = () => '</tr>'
  rules.th_open = (tokens, idx, options, env, self) => `<th${self.renderAttrs(tokens[idx]!)}><p>`
  rules.th_close = () => '</p></th>'
  rules.td_open = (tokens, idx, options, env, self) => `<td${self.renderAttrs(tokens[idx]!)}><p>`
  rules.td_close = () => '</p></td>'
}

function withoutTrailingNewline(content: string): string {
  return content.charCodeAt(content.length - 1) === LF ? content.slice(0, -1) : content
}
