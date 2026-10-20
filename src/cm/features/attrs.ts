/**
 * `attrs` —— 属性行 `{…}` 在编辑器里显示成**可点的 chip**
 * （契约：`docs/dialect-extensions.md` §0）。
 *
 * ## 为什么需要它
 *
 * `{.steps}` / `{title="a.ts" lines=1-20}` 这类属性行**不产生内容**，只改变
 * 前一个块的渲染形态。以源码形态常驻时，用户：
 *
 * 1. 根本不知道它存在（渲染结果里看不见）；
 * 2. 不知道它对哪个块有效（`.steps` 只对列表、`.fields` 只对表格）；
 * 3. 记不住语法。
 *
 * 所以编辑器里把它换成一个小 chip（「步骤」「代码标题 · 行号」），光标进入
 * 这一行时再露出原文 —— 和行级揭示是同一套心智：**看语义，需要时看源码**。
 *
 * ## 判定
 *
 * 认领 `Paragraph`，满足三条才算属性行：
 *
 * 1. 这一段**只有一行**（`line.from/to` 与节点完全重合）；
 * 2. `parseAttrLine()` 能解析（语法见 `src/shared/attrs.ts`）；
 * 3. **紧贴前一个非空行** —— 属性行是「块的后缀」，前面隔着空行就不是后缀了。
 *
 * 第 3 条同时挡掉了散文里的 `{a b}`：那种行要么被 Markdown 并进上一段
 * （不是独立 `Paragraph`），要么前面是空行（不满足条件）。
 *
 * ## 为什么不用 atomic
 *
 * 隐藏态用 `Decoration.replace` 盖住整行内容。**故意不登记 atomic**：
 * chip 点击后要把光标放到行内（`from + 1`）才会揭示；登记 atomic 的话
 * CM6 会把光标夹到 `from - 1`（上一行行尾），揭示判据不成立，点了没反应。
 *
 * 不登记 atomic 的代价是方向键可以走进隐藏区间 —— 但一进去选区就碰到这一行，
 * 装饰立刻换成源码，不存在「光标停在看不见的地方」。这是单行 chip 和
 * 块级 replace（表格/公式）的区别：后者必须靠 `editingBlock` 意图判据。
 */
import { EditorSelection } from '@codemirror/state'
import { Decoration, WidgetType, type EditorView } from '@codemirror/view'

import { attrLabel, parseAttrLine } from '../../shared/attrs.js'
import type { EditorFeature } from '../feature.js'
import { selectionTouchesLineRange } from '../util/selection.js'

/** 揭示态的行：整行变淡，提示「这是源码，不是正文」。 */
const SOURCE_LINE = Decoration.line({ class: 'nd-attrs-line' })

/**
 * chip widget。
 *
 * `eq` 必须实现（否则每次 rebuild 都重建 DOM，chip 会闪、点击会断）。
 * 比较 `label`（显示）、`raw`（tooltip）、`from`（点击落点）。
 */
export class AttrsChipWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly raw: string,
    /** 属性行行首位置。点击后把光标放到 `from + 1`（行内），触发揭示。 */
    readonly from: number,
  ) {
    super()
  }

  override eq(other: AttrsChipWidget): boolean {
    return other.label === this.label && other.raw === this.raw && other.from === this.from
  }

  override toDOM(view: EditorView): HTMLElement {
    const chip = document.createElement('span')
    chip.className = 'nd-attrs-chip'
    chip.textContent = this.label
    chip.title = this.raw
    chip.setAttribute('role', 'button')
    chip.setAttribute('aria-label', `属性：${this.raw}`)

    chip.addEventListener('mousedown', (event) => {
      // 见文件头「为什么不用 atomic」：必须把光标放进行内。
      event.preventDefault()
      const pos = Math.min(this.from + 1, view.state.doc.length)
      view.dispatch({ selection: EditorSelection.cursor(pos) })
      view.focus()
    })

    return chip
  }
}

/**
 * 能带属性行的**前一个块**。
 *
 * ⚠️ 用语法树的 `prevSibling`，不是「上一行非空」：
 * 列表后**必须空一行**再写属性行（否则 CommonMark 会把它当成最后一个列表项的
 * 续行，见 `dialect-extensions.md` §0.1），所以上一行通常是空行；
 * 而 `prevSibling` 直接给出前一个**块**，跨空行也成立。
 *
 * 先只放「列表 / 表格 / 围栏 / 引用」——段落上的 `.card` / `.gallery`
 * （覆盖自动判定）等 P1 再开；这样散文里的 `{a b}` 不会被误判。
 */
const ATTR_HOSTS: ReadonlySet<string> = new Set([
  'BulletList',
  'OrderedList',
  'Table',
  'FencedCode',
  'Blockquote',
])

export const attrsFeature: EditorFeature = {
  name: 'attrs',
  nodes: ['Paragraph'],

  decorate(ranges, _atomicRanges, node, doc, selection) {
    const line = doc.lineAt(node.from)
    // 条件 1：必须独占一行。
    if (line.from !== node.from || line.to !== node.to) return

    const tokens = parseAttrLine(line.text)
    if (!tokens) return

    // 条件 3：前一个块必须能带属性。
    const prev = node.prevSibling
    if (!prev || !ATTR_HOSTS.has(prev.name)) return

    // 揭示态：露出原文，只加一条「这是源码」的淡化行装饰。
    if (selectionTouchesLineRange(doc, selection, line.from, line.to)) {
      ranges.push(SOURCE_LINE.range(line.from))
      return
    }

    ranges.push(
      Decoration.replace({
        widget: new AttrsChipWidget(attrLabel(tokens, line.text), line.text.trim(), line.from),
      }).range(line.from, line.to),
    )
  },
}
