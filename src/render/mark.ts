/**
 * `==text==` → `<mark>text</mark>` — the inline highlight Nexusdown writes.
 *
 * This is **not GFM**: `==` comes from Obsidian / `markdown-it-mark`, and it is
 * the one piece of the dialect no off-the-shelf preset covers. The editor's
 * tokenizer (see `Highlight.extend` in `../core/extensions/builtins.ts`) is the
 * reference implementation, and this plugin mirrors its regex **exactly** rather
 * than using a delimiter-run parser, because the two disagree on real documents:
 *
 * - The editor matches `^==([\s\S]+?)==` — lazy, so the *first* closing `==`
 *   wins, and non-empty, so a lone `====` stays literal text.
 * - A delimiter-run parser (`markdown-it-mark`, and markdown-it's own emphasis)
 *   applies CommonMark flanking rules, so `==a ==` would **not** open a mark:
 *   the character before the closing `==` is a space, which makes the run
 *   non-right-flanking. The editor happily writes `==a ==` when the highlighted
 *   range ends in a space, so a flanking-based parser would render literal `==`
 *   back to the reader — the exact round-trip loss this module exists to stop.
 * - `[^=]+` (what the stock Tiptap extension uses) is wrong in the other
 *   direction: `==a=b==` would be written by the editor and not read back.
 *
 * The inner text is tokenised with the same parser, so `==**bold**==` nests.
 */
import type { MarkdownIt } from 'markdown-it'

/** Lazily closes at the first `==`; needs at least one character inside. */
const HIGHLIGHT = /^==([\s\S]+?)==/

const EQUALS = 0x3d

/**
 * 高亮的**契约类名** —— 和编辑器侧（以后实现时）共用同一个。
 *
 * 为什么渲染侧也要类名：`<mark>` 是浏览器默认的黄底黑字，样式没法跟站点主题走；
 * 而编辑器里高亮迟早要用 `.nd-highlight` 这个类做 mark + 揭示。
 * 两侧共用类名之后，样式只需要在 `src/shared/blocks.css` 写一条
 * `mark, .nd-highlight { … }` —— 渲染侧没有这个类时靠标签选择器兜住，
 * 加上了就自动一致，**不靠人工同步**。
 *
 * ⚠️ 编辑器侧**还没实现**高亮（lezer 不产这个节点，要走行内正则扫描）——
 * 见 `docs/2026-10-19-render-contract.md` 的 phase 2 清单。
 */
const HIGHLIGHT_CLASS = 'nd-highlight'

export function markPlugin(md: MarkdownIt): void {
  // Before `emphasis` so backticks (registered earlier) still win:
  // `` `==x==` `` is a code span, not a highlight.
  md.inline.ruler.before('emphasis', 'nexusdown_mark', (state, silent) => {
    const { src, pos } = state
    if (src.charCodeAt(pos) !== EQUALS || src.charCodeAt(pos + 1) !== EQUALS) return false

    const match = HIGHLIGHT.exec(src.slice(pos))
    if (!match) return false

    const contentStart = pos + 2
    const contentEnd = pos + match[0].length - 2

    if (!silent) {
      // ⚠️ `attrSet()` 在 markdown-it 15 里**不返回 token**（返回 `undefined`）——
      // 不能链式调用，否则报 `Cannot set properties of undefined (setting 'markup')`。
      const open = state.push('mark_open', 'mark', 1)
      open.attrSet('class', HIGHLIGHT_CLASS)
      open.markup = '=='
      // Tokenise the inner range in place, the way markdown-it's own `sub`/`sup`
      // plugins do: `tokenize` only walks `[pos, posMax)`, and the post-process
      // pass (`ruler2`) still runs exactly once, on the outer `parse`.
      const outerPosMax = state.posMax
      state.pos = contentStart
      state.posMax = contentEnd
      state.md.inline.tokenize(state)
      state.posMax = outerPosMax
      state.push('mark_close', 'mark', -1).markup = '=='
    }

    // Must advance: markdown-it throws if an inline rule leaves `pos` in place.
    state.pos = contentEnd + 2
    return true
  })
}
