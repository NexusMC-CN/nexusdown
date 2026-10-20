/**
 * `highlight` —— 行内 `==高亮==`（契约：`docs/dialect-extensions.md` §1.2）。
 *
 * ## 为什么是「扫描」而不是认领 lezer 节点
 *
 * lezer 的 GFM 语法树里**没有**高亮节点 —— `==x==` 只是一个普通 `Paragraph` 的文本。
 * 渲染侧（`src/render/mark.ts`）用的是 markdown-it 行内规则，所以编辑器侧只能
 * 自己扫文本。认领 `Paragraph` 是唯一能拿到整段原文的入口。
 *
 * ⚠️ `Paragraph` 同时被 `math`（`$$` 块）和 `mention`（`@slug`）认领 —— 这是
 * 允许的（见 `feature.ts` 的 `EditorFeature.nodes`）：三个功能各看各的文本判据，
 * 互不干扰。
 *
 * ## 正则必须和渲染侧**逐字一致**
 *
 * `src/render/mark.ts` 的规则是 `^==([\s\S]+?)==`：
 *
 * - **lazy**：第一个闭合 `==` 生效；
 * - **非空**：`====` 保持字面量；
 * - 不做 CommonMark 的 flanking 判定 —— `==a ==`（内容以空格结尾）照样高亮。
 *
 * 这里用同一个正则。**不要**改成 `[^=]+`（`==a=b==` 会读不出来），也不要加
 * flanking 规则（`==a ==` 会读不出来）—— 那正是渲染侧注释里写的两种漂移。
 *
 * ## 跳过行内代码
 *
 * `` `==x==` `` 在渲染侧是代码、不是高亮（markdown-it 的 backticks 规则先吃掉）。
 * 编辑器侧扫描整段文本，必须自己把 `InlineCode` 子树的范围挖掉，否则
 * 「代码里的 == 也被高亮」—— 一个只在编辑器里出现的假阳性。
 *
 * ## 揭示
 *
 * 非揭示态：两个 `==` 定界符 `replace` 掉并登记 atomic；揭示态：保留源码、变淡
 * （`pushRevealableMark` 已经把两种形态封装好）。内容区间始终挂 `.nd-highlight`，
 * 类名和渲染侧 `<mark class="nd-highlight">` 共用（`blocks.css` 一条规则管两侧）。
 *
 * ⚠️ 已知覆盖差异（同 `mention`）：只认 `Paragraph`，**标题 / 表格单元格里的
 * `==` 编辑器侧不渲染**（渲染侧扫全文，会渲染）。表格单元格在编辑器里是
 * `TableWidget`，内部 HTML 来自 `renderMarkdown` —— 所以表格里其实是**渲染侧**
 * 在画，不受影响；真正的缺口只有标题。
 */
import { Decoration } from '@codemirror/view'

import { pushRevealableMark } from '../decorate/shared.js'
import type { EditorFeature } from '../feature.js'
import type { MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'

/** 与 `src/render/mark.ts` 的 `HIGHLIGHT` **逐字一致**（见文件头）。 */
const HIGHLIGHT = /==([\s\S]+?)==/g

/**
 * 模块级单例：RangeSet 的等值比较依赖对象标识，
 * 在 `decorate` 里 `Decoration.mark({...})` 会让 CM6 的 diff 无法复用 DOM。
 */
const MARK = Decoration.mark({ class: 'nd-highlight' })

/** 收集段落里所有 `InlineCode` 的区间（要跳过它们）。 */
function collectInlineCode(node: MarkdownNode, out: Array<[number, number]>): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'InlineCode') out.push([child.from, child.to])
    else collectInlineCode(child, out)
  }
}

export const highlightFeature: EditorFeature = {
  name: 'highlight',
  nodes: ['Paragraph'],

  decorate(ranges, atomicRanges, node, doc, selection) {
    const text = doc.sliceString(node.from, node.to)
    // 廉价前置判断：绝大多数段落没有 `==`，不用建 skip 列表。
    if (!text.includes('==')) return

    const skip: Array<[number, number]> = []
    collectInlineCode(node, skip)

    // 模块级 `g` 正则：每次进来先归零（同步循环内不会被并发打断）。
    HIGHLIGHT.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = HIGHLIGHT.exec(text)) !== null) {
      const start = node.from + match.index
      const end = start + match[0].length

      // 落在行内代码里 → 不是高亮（渲染侧也不会高亮）。
      if (skip.some(([from, to]) => start < to && from < end)) continue

      const contentFrom = start + 2
      const contentTo = end - 2
      if (contentTo <= contentFrom) continue

      const revealed = selectionTouchesLineRange(doc, selection, start, end)
      ranges.push(MARK.range(contentFrom, contentTo))
      pushRevealableMark(ranges, atomicRanges, revealed, start, start + 2)
      pushRevealableMark(ranges, atomicRanges, revealed, end - 2, end)
    }
  },
}
