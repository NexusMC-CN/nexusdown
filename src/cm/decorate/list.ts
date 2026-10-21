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

import { parseAttrLine } from '../../shared/attrs.js'
import { selectionTouchesLineRange } from '../util/selection.js'
import { children, firstChildNamed } from '../util/tree.js'
import { BulletMarkerWidget, OrderedMarkerWidget, StepMarkerWidget } from '../widgets/list.js'
import { TaskCheckboxWidget } from '../widgets/task.js'
import { MUTED_MARK, pushAtomicRange, pushRevealableMark } from './shared.js'

/** 模块级单例（RangeSet 的等值比较依赖对象标识）。 */
const LIST_ITEM_LINE = Decoration.line({ class: 'nd-list-item' })

/** `{.steps}` 的列表项 —— 和 `.nd-list-item` 同时挂，CSS 只做额外调整。 */
const STEP_ITEM_LINE = Decoration.line({ class: 'nd-step-item' })

/** `{.cards}` 的列表项。 */
const CARD_ITEM_LINE = Decoration.line({ class: 'nd-card-item' })

/**
 * 无序列表的圆点。widget 无状态，所以连 `Decoration` 也做成单例 ——
 * 和 `HIDE` / `LIST_ITEM_LINE` 同一个理由。
 */
const BULLET_MARKER = Decoration.replace({ widget: new BulletMarkerWidget() })

/** 无序列表的三种写法。 */
const BULLET_MARKS = new Set(['-', '*', '+'])

/** 有序列表的符号：数字 + 一个 `.` 或 `)`。 */
const ORDERED_MARK = /^(\d+)[.)]$/

/**
 * 这个 ListItem 所在的列表后面是不是跟着 `{.steps}`。
 *
 * 列表 / 段落之间允许空一行（契约 §0.1），所以先跳过空行再解析属性行。
 */
function listHasSteps(doc: Text, node: SyntaxNode): boolean {
  const list = node.parent
  if (!list || (list.name !== 'BulletList' && list.name !== 'OrderedList')) return false
  /*
   * ⚠️ 只认**顶层**列表：属性行是挂在最外层列表上的。嵌套列表的 parent 是
   * `ListItem`，如果也去读下一行，就会把外层列表的 `{.steps}` 继承下来 ——
   * 实测嵌套项会多出一个「1」，和外层序号打架。
   */
  if (list.parent?.name !== 'Document') return false

  const end = doc.lineAt(list.to)
  let probe = end.number + 1
  if (probe <= doc.lines && doc.line(probe).text.trim() === '') probe += 1
  if (probe > doc.lines) return false

  const attrs = parseAttrLine(doc.line(probe).text)
  return Boolean(attrs?.some((attr) => attr.kind === 'class' && attr.name === 'steps'))
}

/** 和 `listHasSteps` 同一条判定，只是类名换成 `cards`。 */
function listHasCards(doc: Text, node: SyntaxNode): boolean {
  const list = node.parent
  if (!list || (list.name !== 'BulletList' && list.name !== 'OrderedList')) return false
  if (list.parent?.name !== 'Document') return false

  const end = doc.lineAt(list.to)
  let probe = end.number + 1
  if (probe <= doc.lines && doc.line(probe).text.trim() === '') probe += 1
  if (probe > doc.lines) return false

  const attrs = parseAttrLine(doc.line(probe).text)
  return Boolean(attrs?.some((attr) => attr.kind === 'class' && attr.name === 'cards'))
}

/** 第几项（按 ListItem 兄弟顺序，从 1 开始）。 */
function stepIndexOf(node: SyntaxNode): number {
  let index = 1
  for (let sibling = node.prevSibling; sibling; sibling = sibling.prevSibling) {
    if (sibling.name === 'ListItem') index += 1
  }
  return index
}

/** Lezer only creates `TaskMarker` for an empty item when whitespace follows `]`. */
function emptyTaskMarker(doc: Text, node: SyntaxNode, listMark: SyntaxNode): { from: number; to: number } | null {
  const line = doc.lineAt(node.from)
  const match = /^([ \t]+)\[([ xX])\]$/.exec(doc.sliceString(listMark.to, line.to))
  if (!match) return null

  const from = listMark.to + match[1]!.length
  return { from, to: from + 3 }
}

export function decorateListItem(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  ranges.push(LIST_ITEM_LINE.range(doc.lineAt(node.from).from))

  const steps = listHasSteps(doc, node)
  const cards = !steps && listHasCards(doc, node)
  if (steps) ranges.push(STEP_ITEM_LINE.range(doc.lineAt(node.from).from))
  if (cards) ranges.push(CARD_ITEM_LINE.range(doc.lineAt(node.from).from))

  // GFM 的树通常是 `ListItem > Task > TaskMarker`。无正文且没有尾随空格时，
  // Lezer 会退化成 Paragraph，此时按首行的完整空任务标记补一个区间。
  const task = children(node).find((child) => child.name === 'Task')
  const listMark = firstChildNamed(node, 'ListMark')
  const marker = (task ? firstChildNamed(task, 'TaskMarker') : null) ??
    (listMark ? emptyTaskMarker(doc, node, listMark) : null)

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

  /*
   * `{.cards}`：卡片不需要符号 —— 把 `- `（含尾随空格）藏掉，整行靠
   * `.nd-card-item` 画卡片。和任务项同一条处理（藏掉、揭示态变淡）。
   */
  if (cards) {
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

  /*
   * `{.steps}`：符号换成序号圆点（**不是**圆点/`1.`）。序号按 ListItem 兄弟顺序算，
   * 和渲染侧 CSS counter 的结果一致；揭示态仍然露出源码（上面那个分支），
   * 用户能改 `-` / 数字。
   */
  if (steps) {
    ranges.push(
      Decoration.replace({ widget: new StepMarkerWidget(stepIndexOf(node)) }).range(listMark.from, listMark.to),
    )
    return
  }

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
