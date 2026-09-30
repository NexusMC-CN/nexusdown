/**
 * 列表项 + 任务复选框 + 列表符号。
 *
 * 三件事：
 * 1. 给 `ListItem` 的**首行**加一个 class；
 * 2. 把 `TaskMarker`（`[x]` / `[ ]`）替换成可交互复选框；
 * 3. 把 `ListMark` 渲染成**符号**：`-` / `*` / `+` → `•`，`1.` → 淡化的 `1.`。
 *
 * 第 3 件是 silkdown 没做的（参考文档 4.4 节：它只加了一个在 theme 里
 * **根本没定义**的 class，`-` 原样露在正文里）—— 少了它，列表就是
 * 「语法标记会被折叠的代码编辑器」，不是 Typora 式的字处理器。
 *
 * ⚠️ 揭示态（光标落在**符号自己那一行**）符号**原样留在文本流里**（只变淡），
 *    用户才能把 `-` 改成 `*`、把 `1.` 改成 `3.`。
 */
import type { EditorSelection, Range, Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { Decoration } from '@codemirror/view'

import { selectionTouchesLineRange } from '../util/selection.js'
import { children, firstChildNamed } from '../util/tree.js'
import { BulletMarkerWidget, OrderedMarkerWidget } from '../widgets/list.js'
import { TaskCheckboxWidget } from '../widgets/task.js'
import { MUTED_MARK, pushAtomicRange, pushRevealableMark } from './shared.js'

/** 模块级单例（RangeSet 的等值比较依赖对象标识）。 */
const LIST_ITEM_LINE = Decoration.line({ class: 'nd-list-item' })

/**
 * 无序列表的圆点。widget 无状态，所以连 `Decoration` 也做成单例 ——
 * 和 `HIDE` / `LIST_ITEM_LINE` 同一个理由。
 */
const BULLET_MARKER = Decoration.replace({ widget: new BulletMarkerWidget() })

/** 无序列表的三种写法。 */
const BULLET_MARKS = new Set(['-', '*', '+'])

/** 有序列表的符号：数字 + 一个 `.` 或 `)`。 */
const ORDERED_MARK = /^(\d+)[.)]$/

export function decorateListItem(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  ranges.push(LIST_ITEM_LINE.range(doc.lineAt(node.from).from))

  // GFM 的树是 `ListItem > Task > TaskMarker`，所以 TaskMarker 要往下找一层。
  const task = children(node).find((child) => child.name === 'Task')
  const marker = task ? firstChildNamed(task, 'TaskMarker') : null
  const listMark = firstChildNamed(node, 'ListMark')

  if (marker) {
    const text = doc.sliceString(marker.from, marker.to).trim().toLowerCase()
    const widget = new TaskCheckboxWidget(text === '[x]', marker.from, marker.to)

    // ⚠️ 复选框**不检查 revealed**：它本身就是编辑入口，永远渲染。
    //    这是对「标记揭示」规则的**故意背离**。
    pushAtomicRange(ranges, atomicRanges, Decoration.replace({ widget }), marker.from, marker.to)
  }

  if (!listMark) return

  // 揭示判定用**符号自己那一行**，不是整个 ListItem：多行列表项的续行上放光标
  // 不该把第一行的符号也揭示出来。
  const revealed = selectionTouchesLineRange(doc, sel, listMark.from, listMark.to)

  if (marker) {
    // 任务项：复选框已经占住「标记」的位置，再画一个圆点就成了 `• ☐` 双重符号，
    // 所以整段 `- `（含尾随空格）藏掉；揭示态只把它变淡，留出编辑入口。
    const next = doc.sliceString(listMark.to, listMark.to + 1)
    const markTo = next === ' ' ? listMark.to + 1 : listMark.to
    pushRevealableMark(ranges, atomicRanges, revealed, listMark.from, markTo)
    return
  }

  if (revealed) {
    // 揭示态：符号留在文本流里（变淡），光标能一个字符一个字符走进去改。
    ranges.push(MUTED_MARK.range(listMark.from, listMark.to))
    return
  }

  // 非揭示态：换成 widget。区间不登记成 atomic —— 光标能落在这一行时符号已经被
  // 揭示了（上面那个分支），永远不会出现「光标停在被替换区间里」的情况。
  const raw = doc.sliceString(listMark.from, listMark.to)
  const symbol = BULLET_MARKS.has(raw) ? BULLET_MARKER : orderedMarker(raw)
  ranges.push(symbol.range(listMark.from, listMark.to))
}

/**
 * 有序列表符号：数字**从源码的 `ListMark` 区间取**，不硬编码 1。
 *
 * ⚠️ 拿不到 lezer 的 `start`：`@lezer/markdown` 1.7.2 里 `startContext` 的 value
 * 只被用在 `NodeProp.contextHash` 上（`CompositeBlock.toTree` 压根没把它写进树），
 * `SyntaxNode` 上既没有 `value` 也没有对应属性 —— 实测 `3. 项` 的 `OrderedList`
 * 节点读不出 3。而 `ListMark` 的区间文本**就是** `3.`，比任何属性都准：
 * `start` 非 1、嵌套列表、`9.` → `10.` 的宽度变化全都自然成立。
 *
 * 分隔符 `)` 归一化成 `.`（渲染成 `<ol>` 的默认样式），数字一个不改。
 */
function orderedMarker(raw: string): Decoration {
  const match = ORDERED_MARK.exec(raw)
  return Decoration.replace({ widget: new OrderedMarkerWidget(match ? `${match[1]}.` : raw) })
}
