/**
 * `table` —— GFM 管道表的**编辑器侧视觉增强**（契约：`docs/dialect-extensions.md` 第 1 节）。
 *
 * ## 为什么需要它（这是在补一个「两侧不一致」的 bug）
 *
 * 渲染侧 `renderer.ts` 的 `applyTableRules` 本来就把管道表渲染成真 `<table>`；
 * 但编辑器侧**没有任何装饰器认领 `Table` 节点** —— 于是 `| a | b |` 在编辑器里
 * 原样显示、发出去却变成一张表。这正是本库存在的理由（「编辑器和渲染器是同一套
 * 语法认知」）被打破的地方，这个功能把编辑器侧补上。
 *
 * ## 只做视觉增强
 *
 * 表头行加粗、`|` 与分隔行淡化、数字按位对齐（`tabular-nums`）。
 * **不做单元格编辑**（越界）：真正的「表格控件」（拖动列宽、Tab 跳格、增删行列）
 * 需要另一套交互，不属于 live preview 的装饰层。
 *
 * ## ⚠️ 两条硬约束
 *
 * 一、**不 `Decoration.replace({ block: true })`**（见 `feature.ts` 的长注释）：
 *     block 级替换会让方向键**永远进不去**那一行，表格就再也改不了了。
 *     所以这里只用 `Decoration.line`（行级 class）+ `Decoration.mark`（行内淡化），
 *     一个字符都不藏、也不替换。
 *
 * 二、既然没有隐藏态，就**不往 `atomicRanges` 里推任何东西** —— 表格里每个字符
 *     都得能被光标逐字走进去编辑。
 */
import type { Text } from '@codemirror/state'
import { Decoration } from '@codemirror/view'

import { MUTED_MARK } from '../decorate/shared.js'
import type { EditorFeature } from '../feature.js'
import type { DecorationRanges, MarkdownNode } from '../types.js'
import { children } from '../util/tree.js'

/*
 * 模块级单例（`RangeSet` 的等值比较依赖对象标识，每次 `new` 会让 CM 的 diff
 * 无法复用 DOM）。三个 class 各管一件事，视觉全在 `features/table.css`。
 */
const TABLE_LINE = Decoration.line({ class: 'nd-table' })
const TABLE_HEADER_LINE = Decoration.line({ class: 'nd-table-header' })
const TABLE_DELIMITER_LINE = Decoration.line({ class: 'nd-table-delimiter' })

/**
 * ⚠️ **踩到的坑：分隔行和管道同名。**
 *
 * lezer GFM 产出的树（实测 `@lezer/markdown` 1.7.2）：
 *
 * ```
 * Table            [0,33)  "| a | b |\n| --- | --- |\n| 1 | 2 |"
 *   TableHeader    [0,9)   "| a | b |"
 *     TableDelimiter [0,1) "|"          ← 单元格之间的管道
 *     TableCell      [2,3) "a"
 *     ...
 *   TableDelimiter [10,23) "| --- | --- |"  ← 整条分隔行是**一个**节点
 *   TableRow       [24,33) "| 1 | 2 |"
 *     TableDelimiter [24,25) "|"          ← 又是管道
 * ```
 *
 * 所以 `TableDelimiter` 这个名字**同时**指两样东西：行内的 `|`，以及整条
 * `| --- | --- |` 分隔行。区分只能靠**层级**：分隔行是 `Table` 的**直接子节点**，
 * 而管道是 `TableHeader` / `TableRow` 的子节点。别想着用名字或区间长度去猜。
 */
export const tableFeature: EditorFeature = {
  name: 'table',
  nodes: ['Table'],
  decorate(ranges, _atomicRanges, node, doc) {
    decorateTable(ranges, node, doc)
  },
}

function decorateTable(ranges: DecorationRanges, node: MarkdownNode, doc: Text): void {
  for (const child of children(node)) {
    if (child.name === 'TableHeader') {
      // 表头行加粗。`Decoration.line` 落在 `.cm-line` 上，font-weight 继承给整行文字。
      const lineFrom = doc.lineAt(child.from).from
      ranges.push(TABLE_LINE.range(lineFrom))
      ranges.push(TABLE_HEADER_LINE.range(lineFrom))
      dimPipes(ranges, child)
      continue
    }

    if (child.name === 'TableRow') {
      ranges.push(TABLE_LINE.range(doc.lineAt(child.from).from))
      dimPipes(ranges, child)
      continue
    }

    // 见上面那段「踩到的坑」：直接子节点的 `TableDelimiter` 就是整条分隔行。
    if (child.name === 'TableDelimiter') {
      const lineFrom = doc.lineAt(child.from).from
      ranges.push(TABLE_LINE.range(lineFrom))
      ranges.push(TABLE_DELIMITER_LINE.range(lineFrom))
      // 整条 `| --- | --- |` 淡化。用共享的 `MUTED_MARK`（`.nd-mark`）——
      // 和揭示态标记同一套机制、同一个 `--nd-mark-opacity` 变量，不另造一个 class。
      ranges.push(MUTED_MARK.range(child.from, child.to))
    }
  }
}

/** 把一行里的 `|` 管道逐个淡化（`TableHeader` / `TableRow` 的直接子节点里找）。 */
function dimPipes(ranges: DecorationRanges, row: MarkdownNode): void {
  for (const cell of children(row)) {
    if (cell.name === 'TableDelimiter') {
      ranges.push(MUTED_MARK.range(cell.from, cell.to))
    }
  }
}
