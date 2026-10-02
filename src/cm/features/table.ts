/**
 * `table` —— GFM 管道表在编辑器里渲染成**真表格**（契约：`docs/dialect-extensions.md` 第 1 节）。
 *
 * 以前这里只做「表头加粗 + 管道淡化」的视觉增强 ✗，理由是「block replace 会让方向键
 * 永远进不去」✗。**现在那个理由不成立了** —— 实测（见下面「紧邻即揭示」）：
 * 光标确实进不去 block replace 区间 ✓，但它**能停在门口** ✓，门口一到就换回源码 ✓，
 * 于是键盘用户照样能编辑 ✓。所以这个功能升级成「整块渲染」✓。
 *
 * ## 认领 lezer 的 `Table` 节点，不手扫 `|` 行
 *
 * 任务书让手扫「连续的、trim 后以 `|` 开头的行，至少 2 行」。实测不需要：
 * `markdownLanguage`（GFM）**已经产出 `Table` 节点** ✓（旧版 `table.ts` 就是认它的 ✓）。
 * 认节点白拿两件事，手扫要自己写、还容易写错：
 *
 * - **围栏代码块里的 `|` 行天然不算** ✓ —— lezer 不把围栏内容当块解析
 *   （实测 ` ```\n| a | b |\n| --- | --- |\n``` ` → `FencedCode > CodeText`，**没有** `Table`）。
 *   手扫就得自己跟踪围栏开关（`math.ts` 的 `FENCE_RE` 那一套）✗。
 * - **「至少 2 行」也是白送的** ✓ —— GFM 要求表头行 + 分隔行，
 *   单行 `| a | b |` 实测只是 `Paragraph`，**没有** `Table`。
 *
 * 这跟 `emoji.ts` 从「行内正则扫描」改成「认 `Emoji` 节点」是同一个判断：
 * 语法树已经算过一遍的东西，别再手算一遍（两边还会漂）。
 *
 * ## ★ 「紧邻即揭示」—— 这个方案能成立的唯一原因
 *
 * `Decoration.replace({ block: true })` 的区间，**光标进不去** ✗ ——
 * 区间还生效时，连程序 `dispatch({ selection: cursor(from) })` 都会被夹到
 * `from - 1`（实测）。方向键就更不用说了，CM6 的垂直移动直接跳过块级 widget。
 * 所以「点一下表格就能编辑」这条路是堵死的 ✗。
 *
 * 但实测发现：光标**可以**停在 `from - 1` / `to + 1`（区间的紧邻两侧）✓。
 * 于是把判据从「光标在不在表格里」改成「**光标在不在表格门口**」✓：
 * 门口一到，就不推装饰、露出源码 ✓，光标随即能正常往下走进去 ✓。
 *
 * - 键盘：在表格上一行行末（= `from - 1`）按 ↓ → 先揭示 → 再按 ↓ 就进了源码 ✓
 * - 鼠标：点 widget → `mousedown` 里把光标**主动**放到 `from - 1` ✓ → 同样揭示 ✓
 *
 * 判据在 `isTableRevealed`：**选区碰到表格任意一行**（`selectionTouchesLineRange`）
 * **或者光标紧邻**（`from - 1` / `to + 1`）。后者是这个方案的关键，不是锦上添花。
 *
 * ## 渲染：直接复用渲染侧，绝不另写一份
 *
 * 这个功能存在的全部意义就是「编辑时看到的 = 发布出来的」。自己写一份 markdown-it
 * 表格渲染，两边迟早漂开 ✗ —— 那正是它要解决的问题 ✓。
 *
 * 所以 widget 里调的是**渲染侧同一个 `renderMarkdown`** ✓。体积代价与取舍见
 * `TableWidget` 的注释。
 *
 * ## 走的是块级通道，不是 ViewPlugin
 *
 * ⚠️ CM6 **禁止 ViewPlugin 提供块级装饰**，实测抛
 * `RangeError: Block decorations may not be specified via plugins` ✗。
 * 块级装饰只能由 `StateField` 提供。所以本功能带 `block: true` 标记，
 * 由骨架（`plugin.ts`）分流到 StateField —— 见 `EditorFeature.block` 的注释。
 */
import { EditorSelection, type Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Decoration, WidgetType } from '@codemirror/view'

import { renderMarkdown } from '../../render/index.js'
import type { EditorFeature } from '../feature.js'
import type { DecorationRanges, MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'

/**
 * 表格 widget（非揭示态）—— 整块 `| a | b |\n| - | - |\n...` 换成一张真 `<table>`。
 *
 * ## DOM 结构与转义
 *
 * ```html
 * <div class="nd-table">
 *   <table><tbody><tr><th><p>a</p></th>…</tr>…</tbody></table>
 * </div>
 * ```
 *
 * 外层 `<div class="nd-table">` 是**块级**的（block replace 的 widget 就该是块级元素，
 * 不像 `math.ts` / `embed.ts` 那种行内替换 —— 那两个必须待在行内流里）。
 *
 * 内层 HTML 直接走 `innerHTML` ✓ —— 和 `math.ts` 的 `MathBlockWidget` 同一决定，
 * 而且是**读过渲染侧代码确认过的**，不是假设 ✓：
 *
 * - `render/index.ts` 的 `createParser` 里 `html: false`（markdown-it 默认也是它）——
 *   输入里的原始 HTML 会被转义成文本，不会变成标签；
 * - 实测 `| <img src=x onerror=alert(1)> | b |` 渲染出 `&lt;img …&gt;` ✓；
 * - 链接由 markdown-it 的 `validateLink` 挡掉 `javascript:` / `vbscript:` / `data:`；
 * - `tests/render/renderMarkdown.test.ts` 里有对应的契约测试。
 *
 * 所以这里不是注入面。**如果哪天渲染侧把 `html: false` 关了，这里必须跟着改成
 * `textContent`** —— 这条依赖写在这里，免得以后被无声破坏。
 *
 * ## 体积取舍（实测，不是估的）
 *
 * 直接 `import { renderMarkdown } from '../../render/index.js'`（方案 A）。
 *
 * | | 之前 | 之后 | 差 |
 * | --- | --- | --- | --- |
 * | `dist/cm/index.js` | 233 335 B | 259 538 B | **+26 203 B（+11.2%）** |
 *
 * ⚠️ 别被「markdown-it 不小」误导：`tsup` 会把 `package.json` 的
 * `dependencies` **外部化**，所以 `markdown-it` 在产物里是
 * `import MarkdownIt from "markdown-it"`，**没有内联** —— `dist/cm` 涨的这 26 KB
 * 是渲染侧自己那点代码（renderer + 规则 + features）。
 *
 * 代价是 `nexusdown/cm` 这个入口**多了一条 `markdown-it` 的运行时 import**
 * （消费方打包时约 40 KB gzip）。它本来就是这个包的**硬依赖**（不是 peer），
 * 所以不算新增依赖，只是 cm-only 的消费方会多载它。
 *
 * 为什么不做成「消费方注入渲染函数」（方案 B，同 math 注入 katex）：
 * B 会让表格**默认不渲染** —— 而 `nexusdown/editor` 这个成品编辑器入口
 * 按约定不碰 `.vue`，注入链根本接不上，「开箱即用」就没了。
 * 表格是这个库的招牌功能（「编辑时看到的 = 发布出来的」），+11% 的产物换它值得。
 * math 之所以走注入，是因为 katex 是 ~4 MB 的 peer（体积差 20 倍，性质不同）。
 */
export class TableWidget extends WidgetType {
  constructor(
    /** 表格源码（`| a | b |\n| - | - |\n…`），也参与 `eq`。 */
    private readonly source: string,
    /** 表格块首行行首的位置。点 widget 时把光标放到 `from - 1`（见文件头「紧邻即揭示」）。 */
    private readonly from: number,
  ) {
    super()
  }

  /**
   * ⚠️ 必须实现，否则每次 rebuild 都重建 DOM（表格会闪）。
   *
   * 比 `source` **和** `from`：`source` 变了表格要重画；`from` 变了
   * `mousedown` 要落到新位置，也必须重建。
   */
  override eq(other: TableWidget): boolean {
    return other.source === this.source && other.from === this.from
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'nd-table'

    try {
      wrap.innerHTML = renderMarkdown(this.source)
    } catch (e) {
      /*
       * 渲染失败**降级成源码**，绝不抛（同 math / embed 的契约）。
       * ⚠️ 必须 `textContent` —— 源码是**用户输入**，这里再走 innerHTML 就是注入面。
       * ⚠️ 但**留一条日志**：静默降级会让「表格不渲染」变得毫无线索。
       */
      console.warn('[nexusdown] 表格渲染失败，已降级成源码：', e)
      wrap.classList.add('nd-table-source')
      wrap.textContent = this.source
    }

    /*
     * 点击揭示。
     *
     * ⚠️ `preventDefault()` 是**必须的**，不是防御性代码：CM6 的
     * `eventBelongsToEditor` 会先看 `event.defaultPrevented`，prevent 过就直接放行、
     * 不再自己处理鼠标（`@codemirror/view` 的 `eventBelongsToEditor`）。
     * 少了它，CM6 会抢走这次点击、把光标放到别处，揭示逻辑等于没写。
     *
     * ⚠️ `Math.max(0, …)`：表格**就在文档开头**时 `from === 0`，
     * `from - 1` 是 `-1` —— 直接 dispatch 会抛 `Selection points outside of
     * document` ✗。夹到 0 就对了：位置 0 是表格首行行首，属于「在表格里」，
     * 一样会揭示（见 `isTableRevealed` 的条件 1）。
     */
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: EditorSelection.cursor(Math.max(0, this.from - 1)) })
    })

    return wrap
  }

  /**
   * 返回 `false` = 事件交给 CM 的默认处理。
   *
   * 真正的「别让 CM 抢点击」靠 `mousedown` 里的 `preventDefault()`（见上）。
   * 这里返回 `false` 而不是 `true`，是为了**不拦掉别的交互**（比如以后想加
   * hover / 复制），只精确地接管那一次 `mousedown`。
   */
  override ignoreEvent(_event: Event): boolean {
    return false
  }
}

export const tableFeature: EditorFeature = {
  name: 'table',
  nodes: ['Table'],
  /*
   * ★ 块级功能：装饰由 StateField 提供，不走 ViewPlugin（CM6 的硬限制，
   * 见文件头「走的是块级通道」）。
   */
  block: true,
  decorate(ranges, _atomicRanges, node, doc, selection) {
    decorateTable(ranges, node, doc, selection)
  },
}

function decorateTable(
  ranges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
): void {
  /*
   * 块级 replace **必须**落在行首/行尾（CM6 要求整行）——
   * `node.from` 理论上就是行首，但 `lineAt().from` 是**结构性**的保证，不依赖那个假设。
   */
  const from = doc.lineAt(node.from).from
  // `node.to` 是**排他**的：正好落在下一行行首时，不减 1 会多算一行（同 fence.ts）。
  const lastPos = node.to > node.from ? node.to - 1 : node.to
  const to = doc.lineAt(lastPos).to
  if (to <= from) return

  // 揭示态 → **什么都不推**，源码原样（用户要能改）。
  if (isTableRevealed(doc, selection, from, to)) return

  ranges.push(
    Decoration.replace({
      block: true,
      widget: new TableWidget(doc.sliceString(from, to), from),
    }).range(from, to),
  )
}

/**
 * 揭示判据 —— **本方案的核心**（见文件头「紧邻即揭示」）。
 *
 * 两个条件任一成立就揭示：
 *
 * 1. **选区碰到表格任意一行** —— 复用 `selectionTouchesLineRange`，和别的功能同一套
 *    多光标安全的判定（遍历 `selection.ranges`，任一命中即真）。
 * 2. **光标紧邻** `from - 1` / `to + 1` —— ⚠️ 这一条**不能省** ✗。
 *    块级区间光标进不去，门口是**唯一**能触达的位置；少了它，键盘用户永远进不了表格
 *    （`selectionTouchesLineRange` 不会把 `from - 1` 算进来 —— 那是**上一行**，
 *    和表格行不相交）。
 *
 * 用 `range.head` 而不是 `range.from` / `range.to`：紧邻描述的是**光标**（移动端），
 * 而选区只要碰到表格行就已被条件 1 覆盖。
 */
function isTableRevealed(
  doc: Text,
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  if (selectionTouchesLineRange(doc, selection, from, to)) return true
  for (const range of selection.ranges) {
    if (range.head === from - 1 || range.head === to + 1) return true
  }
  return false
}
