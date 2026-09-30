/**
 * GFM task lists (`- [ ]` / `- [x]`) rendered as the markup the editor emits.
 *
 * GFM only says a task list item *starts with* `[ ]` or `[x]`; the HTML is
 * unspecified, and every renderer picks its own. Nexusdown's editor picks
 * Tiptap's shape:
 *
 * ```html
 * <ul data-type="taskList">
 *   <li data-checked="false" data-type="taskItem">
 *     <label><input type="checkbox"/><span/></label><div><p>todo</p></div>
 *   </li>
 * </ul>
 * ```
 *
 * That exact shape matters on the display side: `src/style.css` styles
 * `ul[data-type="taskList"]` and `li[data-checked] > label / > div`, so a
 * generic `class="task-list-item"` renderer would come out unstyled.
 *
 * Two details are copied from the editor rather than from a GFM example:
 *
 * - The `<label>` and the `<div>` wrap the item's **whole** content, not just
 *   its first paragraph. A task item with a nested list renders as
 *   `<li><label/><div><p>a</p><ul>…</ul></div></li>`; putting the `<div>` around
 *   the paragraph alone would leave the nested list as a third child of the
 *   flex `<li>`, so it would sit *beside* the text instead of under it.
 * - Only **bullet** lists can hold task items, which is what GFM says ("a task
 *   list item is a list item in a bullet list") and what the editor does: an
 *   ordered list keeps `1. [ ] a` as literal text.
 *
 * The checkbox is not interactive here: this module produces a string for
 * display, and an enabled `<input type="checkbox">` inside a form would still
 * be togglable. The editor renders it the same way.
 */
import type { MarkdownIt, Token } from 'markdown-it'

/** `[ ] ` / `[x] ` / `[X] ` at the very start of the item's first paragraph. */
const CHECKBOX = /^\[([ xX])\]\s+/

/**
 * Meta key set on a task item's `list_item_open` / `list_item_close`, so the
 * renderer knows to emit the label + `<div>` wrapper.
 */
export const TASK_ITEM_META = 'nexusdownTaskItem'

export function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'nexusdown_task_list', (state) => {
    const tokens = state.tokens

    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i]!
      if (inline.type !== 'inline') continue
      if (tokens[i - 1]?.type !== 'paragraph_open') continue

      const itemIndex = i - 2
      if (tokens[itemIndex]?.type !== 'list_item_open') continue

      const listIndex = findEnclosingBulletList(tokens, itemIndex - 1)
      if (listIndex < 0) continue

      // The marker must be the first thing in the item, and it must still be
      // plain text: `- [x] [link](u)` has the marker in the leading text token,
      // but `- [link](u) [x]` does not start with one.
      const first = inline.children?.[0]
      if (!first || first.type !== 'text') continue

      const match = CHECKBOX.exec(first.content)
      if (!match) continue

      const checked = match[1] !== ' '
      first.content = first.content.slice(match[0].length)

      const item = tokens[itemIndex]!
      // Attribute order matches the editor's output; `attrSet` appends.
      item.attrSet('data-checked', checked ? 'true' : 'false')
      item.attrSet('data-type', 'taskItem')
      item.meta = { ...item.meta, [TASK_ITEM_META]: checked }

      tokens[listIndex]!.attrSet('data-type', 'taskList')

      const close = findItemClose(tokens, itemIndex)
      if (close >= 0) tokens[close]!.meta = { ...tokens[close]!.meta, [TASK_ITEM_META]: checked }
    }
  })
}

/** Index of the `list_item_close` that matches the `list_item_open` at `open`. */
function findItemClose(tokens: Token[], open: number): number {
  let depth = 0
  for (let i = open + 1; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.type === 'list_item_open') depth++
    else if (token.type === 'list_item_close') {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

/**
 * Index of the **bullet** list token that directly contains the token at
 * `before`, or `-1` (which also covers an ordered list, where a `[ ]` marker is
 * plain text).
 *
 * Walking *backwards* while counting every nesting level is what makes nested
 * lists work: the tokens between a nested item and its own `<ul>` include the
 * closing tags of the outer item, which a naive "first list token I see" scan
 * would mistake for the enclosing list.
 */
function findEnclosingBulletList(tokens: Token[], before: number): number {
  let depth = 0
  for (let i = before; i >= 0; i--) {
    const token = tokens[i]!
    if (token.nesting === -1) {
      depth++
    } else if (token.nesting === 1) {
      if (depth === 0) return token.type === 'bullet_list_open' ? i : -1
      depth--
    }
  }
  return -1
}
