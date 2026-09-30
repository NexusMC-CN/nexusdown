/**
 * Markdown 快捷键（参考文档第 7 节）。
 *
 * - `Mod-b` / `Mod-i` / `` Mod-` ``：切换粗体 / 斜体 / 行内代码。
 *   无选中时扩展到光标所在词；空白处插入成对定界符并把光标居中。
 * - `Enter`：列表内继续列表标记（`insertNewlineContinueMarkup`）。
 * - 多光标安全：所有改动都走 `state.changeByRange(...)`，
 *   每个选区**各算各的**，绝不用 `view.dispatch({ changes })` 一把梭。
 * - 撤销粒度：dispatch 带 `userEvent: 'format.nexusdown'` —— CM6 的 history
 *   按 `userEvent` **前缀**分组，`format.*` 和 `input.*` 会分成独立 undo step，
 *   所以「加粗 → 打字 → 撤销」只会撤销打字，不会把加粗一起撤掉。
 *
 * ## 怎么判断「已经在节点内」
 *
 * 不做字符串查找（`text.startsWith('**')` 那种），而是问语法树：
 * `syntaxTree(state).resolveInner(from, 1)` 取该位置最内层的节点，再沿 `parent`
 * 往上爬，找到第一个**名字匹配且完整覆盖目标区间**的节点。见 `enclosingNode`。
 *
 * 解包时删的是节点自己的 `EmphasisMark` / `CodeMark` 子节点，而不是「头尾各删
 * N 个字符」—— 这样 `***粗斜体***` 里解掉外层 `*` 之后剩下的 `**粗斜体**`
 * 仍然完整，不会把强定的定界符也削掉一个。
 */
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Extension,
  type SelectionRange,
} from '@codemirror/state'
import { keymap, type Command } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/** 定界符节点名：`*` 和 `**` 都是 `EmphasisMark`，行内代码是 `CodeMark`。 */
const MARKER_NODES: ReadonlySet<string> = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark'])

interface ToggleSpec {
  /** 目标语法节点名。 */
  readonly node: string
  /** 包裹用的定界符。 */
  readonly marker: string
}

const STRONG: ToggleSpec = { node: 'StrongEmphasis', marker: '**' }
const EM: ToggleSpec = { node: 'Emphasis', marker: '*' }
const CODE: ToggleSpec = { node: 'InlineCode', marker: '`' }

/** 一个选区的改动结果：`changes` 用**原文档**坐标，`range` 用**改动后**坐标。 */
interface RangeEdit {
  changes: ChangeSpec
  range: SelectionRange
}

/**
 * 找「已经包住 `[from, to]` 的 `name` 节点」—— 这就是「已在节点内」的判定。
 *
 * `resolveInner(from, 1)`：取 `from` 处**最内层**的节点。`side = 1` 让「正好落在
 * 节点起点」时优先解析进节点内部 —— 否则光标停在 `**` 左边（`from` 等于
 * `StrongEmphasis.from`）时会解析成上一个节点，判不出「已经在粗体里」。
 *
 * 往上爬时必须同时要求 `node.from <= from && node.to >= to`：只认名字的话，
 * 光标在 `**bold**` 之后（同一段落里）也会命中祖先里的 `StrongEmphasis`。
 */
function enclosingNode(
  state: EditorState,
  from: number,
  to: number,
  name: string,
): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    if (node.name === name && node.from <= from && node.to >= to) return node
  }
  return null
}

/** 节点的首尾定界符（`**` / `*` / `` ` ``）。取不到两个就返回 null。 */
function delimiters(node: SyntaxNode): { open: SyntaxNode; close: SyntaxNode } | null {
  let open: SyntaxNode | null = null
  let close: SyntaxNode | null = null
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!MARKER_NODES.has(child.name)) continue
    if (!open) open = child
    close = child
  }
  return open && close && open !== close ? { open, close } : null
}

/** 解包：删掉节点自己的首尾定界符，选区落到剩下的内容上。 */
function unwrap(node: SyntaxNode): RangeEdit | null {
  const marks = delimiters(node)
  if (!marks) return null
  const openLength = marks.open.to - marks.open.from

  return {
    changes: [
      { from: marks.open.from, to: marks.open.to },
      { from: marks.close.from, to: marks.close.to },
    ],
    // 新坐标：开头被删掉 openLength 个字符，内容整体左移同样的距离。
    range: EditorSelection.range(marks.open.from, marks.close.from - openLength),
  }
}

/** 包裹：在 `from` 和 `to` 各插一个定界符，选区跟着右移。 */
function wrap(from: number, to: number, marker: string): RangeEdit {
  return {
    changes: [
      { from, insert: marker },
      { from: to, insert: marker },
    ],
    range: EditorSelection.range(from + marker.length, to + marker.length),
  }
}

function toggle(spec: ToggleSpec): Command {
  return (view) => {
    const { state } = view

    const changes = state.changeByRange((range) => {
      // 光标/选区已经在这个节点里 → 解包。
      const inside = enclosingNode(state, range.from, range.to, spec.node)
      if (inside) return unwrap(inside) ?? { range }

      // 有选区 → 直接包。
      if (!range.empty) return wrap(range.from, range.to, spec.marker)

      // 无选区 → 先试着扩展到光标所在的词。
      const word = state.wordAt(range.head)
      if (word) return wrap(word.from, word.to, spec.marker)

      // 空白处 → 插一对定界符，光标停在正中间，接着打字就是加粗内容。
      return {
        changes: { from: range.head, insert: spec.marker + spec.marker },
        range: EditorSelection.cursor(range.head + spec.marker.length),
      }
    })

    // 一个选区都没改动（比如解包时节点里没有定界符子节点）→ 不产生空事务。
    if (changes.changes.empty) return false

    view.dispatch({ ...changes, userEvent: 'format.nexusdown' })
    return true
  }
}

/**
 * 粗体 / 斜体 / 行内代码 + 列表内回车。
 *
 * ⚠️ `nexusdown()` 给 `markdown()` 传的是 `addKeymap: false` ——
 * lang-markdown 自带的 keymap 被关掉了，列表内回车**只能**由这里提供，
 * 少这一条就会「回车把列表吃掉、不再续 `- `」。
 */
export const markdownKeymap: Extension = keymap.of([
  { key: 'Mod-b', run: toggle(STRONG) },
  { key: 'Mod-i', run: toggle(EM) },
  { key: 'Mod-`', run: toggle(CODE) },
  { key: 'Enter', run: insertNewlineContinueMarkup },
])
