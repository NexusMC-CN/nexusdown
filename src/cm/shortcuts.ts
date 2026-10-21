/**
 * Markdown 快捷键。
 *
 * - `Mod-b` / `Mod-i` / `` Mod-` ``：切换粗体 / 斜体 / 行内代码。
 * - `Enter`：列表内续标记；空项退出为段落或退回上一层列表。
 *
 * ## 行内格式在这里**只做绑定**，实现全在 `commands.ts`
 *
 * 以前这个文件里有一份**自包含的** `toggle()` 实现（159 行），而工具栏那份
 * （`commands.ts`）里**又抄了一遍** —— 同一套「问语法树、不问字符串」的判定
 * 存在两个副本，改一边另一边不会知道。
 *
 * 现在合成一份：行内格式实现在 `commands.ts`，这里只把它们绑到键上。
 * **判据**：快捷键和工具栏按钮**必须做同一件事** —— 那就不该有两份实现。
 *
 * ## 撤销粒度
 *
 * 命令内部 dispatch 带 `userEvent: 'format.nexusdown'` —— CM6 的 history
 * 按 `userEvent` **前缀**分组，`format.*` 和 `input.*` 会分成独立 undo step，
 * 所以「加粗 → 打字 → 撤销」只会撤销打字，不会把加粗一起撤掉。
 *
 * ⚠️ `nexusdown()` 给 `markdown()` 传的是 `addKeymap: false` ——
 * lang-markdown 自带的 keymap 被关掉了，列表内回车**只能**由这里提供，
 * 少这一条就会「回车把列表吃掉、不再续 `- `」。
 */
import { insertNewlineContinueMarkup, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import type { Extension, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

import { toggleBold, toggleInlineCode, toggleItalic } from './commands.js'

export const markdownKeymap: Extension = keymap.of([
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-`', run: toggleInlineCode },
  { key: 'Enter', run: insertNewlineWithListExit },
])

const exitNestedList = insertNewlineContinueMarkupCommand({ nonTightLists: false })

/**
 * CodeMirror's continuation command can leave an empty list marker or only
 * one newline after exiting. The next typed text is then a list item or its
 * lazy continuation. Empty top-level items need a paragraph separated from
 * both neighboring items. Empty nested items should return to their parent.
 */
function insertNewlineWithListExit(view: EditorView): boolean {
  const { state } = view
  const selection = state.selection
  if (selection.ranges.length === 1 && selection.main.empty) {
    const pos = selection.main.head
    const line = state.doc.lineAt(pos)
    if (pos === line.to) {
      let item = syntaxTree(state).resolveInner(pos, -1)
      while (item && item.name !== 'ListItem') item = item.parent!
      const mark = item?.firstChild
      const list = item?.parent
      const body = mark ? state.doc.sliceString(mark.to, line.to) : ''
      const prefix = mark ? state.doc.sliceString(line.from, mark.from) : ''
      if (
        item?.to === line.to && mark?.name === 'ListMark' &&
        (list?.name === 'BulletList' || list?.name === 'OrderedList') &&
        /^(?:[ \t]*>[ \t]*)*[ \t]*$/.test(prefix) &&
        (!body.trim() || /^\s*\[[ xX]\]\s*$/.test(body))
      ) {
        const previous = line.number > 1 ? state.doc.line(line.number - 1) : null
        const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null

        // Inside a parent list, keep CodeMirror's marker and numbering logic
        // while skipping its extra blank-item step in a tight child list.
        if (list.parent?.name === 'ListItem') {
          if (list.name !== 'OrderedList' || item.nextSibling?.name !== 'ListItem') {
            return exitNestedList(view)
          }

          // A following ordered child marker such as `2. next` is a lazy
          // paragraph continuation unless separated from the new parent item.
          // Capture the stock command's transaction so the spacer and marker
          // changes remain one undo step.
          let planned: Transaction | null = null
          const capture = {
            state,
            dispatch: (transaction: Transaction) => { planned = transaction },
          } as EditorView
          if (!exitNestedList(capture) || !planned) return false

          const transaction: Transaction = planned
          const result = transaction.state
          const current = result.doc.lineAt(result.selection.main.head)
          const following = current.number < result.doc.lines
            ? result.doc.line(current.number + 1)
            : null
          if (!following?.text.trim()) {
            view.dispatch(transaction)
            return true
          }

          const spacer = result.changes({ from: current.to, insert: result.lineBreak })
          view.dispatch(state.update({
            changes: transaction.changes.compose(spacer),
            selection: { anchor: current.to },
            scrollIntoView: true,
            userEvent: 'input',
          }))
          return true
        }

        // A list directly in a quote exits to a quoted paragraph. A bare `> `
        // after the list is still its lazy continuation, so insert blank quote
        // lines around the new paragraph when neighboring lines have content.
        if (list.parent?.name === 'Blockquote') {
          const blankQuote = prefix.trimEnd()
          const hasQuoteContent = (text: string | undefined) =>
            Boolean(text?.replace(/^(?:[ \t]*>[ \t]*)+/, '').trim())
          const before = hasQuoteContent(previous?.text) ? blankQuote + state.lineBreak : ''
          const after = hasQuoteContent(next?.text) ? state.lineBreak + blankQuote : ''
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: before + prefix + after },
            selection: { anchor: line.from + before.length + prefix.length },
            scrollIntoView: true,
            userEvent: 'input',
          })
          return true
        }

        if (list.parent?.name !== 'Document') return exitNestedList(view)

        const before = previous?.text.trim() ? state.lineBreak : ''
        const after = next?.text.trim() ? state.lineBreak : ''
        const insert = before + after
        view.dispatch({
          changes: { from: line.from, to: line.to, insert },
          selection: { anchor: line.from + before.length },
          scrollIntoView: true,
          userEvent: 'input',
        })
        return true
      }
    }
  }
  return insertNewlineContinueMarkup(view)
}
