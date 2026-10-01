/**
 * Markdown 快捷键。
 *
 * - `Mod-b` / `Mod-i` / `` Mod-` ``：切换粗体 / 斜体 / 行内代码。
 * - `Enter`：列表内继续列表标记（`insertNewlineContinueMarkup`）。
 *
 * ## ⚠️ 这里**只做绑定**，实现全在 `commands.ts`
 *
 * 以前这个文件里有一份**自包含的** `toggle()` 实现（159 行），而工具栏那份
 * （`commands.ts`）里**又抄了一遍** —— 同一套「问语法树、不问字符串」的判定
 * 存在两个副本，改一边另一边不会知道。
 *
 * 现在合成一份：实现在 `commands.ts`，这里只把命令绑到键上。
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
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'

import { toggleBold, toggleInlineCode, toggleItalic } from './commands.js'

export const markdownKeymap: Extension = keymap.of([
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-`', run: toggleInlineCode },
  { key: 'Enter', run: insertNewlineContinueMarkup },
])
