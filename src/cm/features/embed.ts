/**
 * `embed` —— 第三方嵌入（B站 / 抖音 / 网易云）。编辑器侧。
 *
 * 契约：`docs/dialect-extensions.md` 第 4 节。
 *
 * ## 认领 `FencedCode` 的代价，以及为什么必须还回去
 *
 * embed 的语法就是**一个围栏**（` ```embed bilibili video BV… `），所以只能认领
 * `FencedCode`。但 `FencedCode` 是**所有代码块**的节点 —— 认领它就等于把普通代码块
 * 也抢过来了。所以本功能的 `decorate` 第一件事就是分流：
 *
 * - `info` 第一段不是 `embed` → **原样交回** `decorateFencedCode`（`decorate/fence.ts`），
 *   普通代码块的行为**一个字节都不变**；
 * - 是 `embed` 但 provider/kind/id 不合法 → **也交回**，让作者在代码窗口里看到
 *   自己写错的源码（而不是显示一张骗人的卡片）。
 *
 * `readFenceInfo` / `isEmbedInfo` 就是为此在 `fence.ts` 里**附加导出**的（本次改动
 * 全部是附加式，原有装饰逻辑没有重写）。
 *
 * ## provider 表不在这里
 *
 * 表（ID 正则 + src 模板 + 展示名）在 `src/render/features/embed.ts` —— **单一来源**。
 * 这里反过来 import 它，原因见那个文件头部（渲染侧不能依赖 CodeMirror，表放那边
 * 两个方向才都安全）。编辑器侧只用得到「展示名 / 图标 / 校验结果」，用不到 src。
 *
 * ## 编辑器里**不加载真实 iframe**
 *
 * 契约要求。第三方播放器会抢焦点、拖慢输入，而且光标一旦落进去就再也出不来。
 * 所以非揭示态只显示一张**占位卡**（图标 + provider/kind/id + 提示），
 * 揭示态显示源码让作者改。
 *
 * ## 两条硬约束
 *
 * - widget **必须实现 `eq`**（默认实现恒 `false`，每次 rebuild 重建 DOM，卡片会闪）；
 * - 隐藏态的 `replace` **必须同时登记进 `atomicRanges`**（用 `pushAtomicRange`），
 *   否则光标会停在隐藏区间中间。
 *
 * ## 折叠：如实说明一个**已知问题**
 *
 * `plugin.ts` 的 feature 分发分支是 `feature.decorate(ranges, atomicRanges, node, doc, selection)`
 * —— **没有第 6 个 `context` 参数**（折叠状态就藏在那个参数里，见 `types.ts` 的
 * `DecorateContext`）。所以本功能认领 `FencedCode` 之后：
 *
 * - 普通围栏虽然被**原样交回** `decorateFencedCode`，但拿到的 `context` 是 `undefined`，
 *   于是 `folded` 恒为 `false` —— **代码块折叠会失效**（点标题栏的箭头没反应）。
 * - 这是分发骨架的限制，不是本文件能修的（`plugin.ts` 本次禁止修改）。
 *
 * 本文件已经**把 `context` 透传下去**（见 `decorate`），所以只要骨架那边把
 * `context` 补上，折叠会立刻恢复，无需再改这里。这条必须报给主 agent。
 */
import type { EditorSelection, Text } from '@codemirror/state'
import { Decoration, WidgetType } from '@codemirror/view'

import { embedGlyph, embedTitle, parseEmbedFence, type EmbedSpec } from '../../render/features/embed.js'
import { decorateFencedCode, isEmbedInfo, readFenceInfo } from '../decorate/fence.js'
import { HIDE, pushAtomicRange } from '../decorate/shared.js'
import type { EditorFeature } from '../feature.js'
import type { DecorateContext, DecorationRanges, MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'
import { firstChildNamed } from '../util/tree.js'

/**
 * 开围栏那一行的行级装饰 —— 只负责给它 `padding-left`。
 *
 * 卡片 widget 用「负 margin + `width: calc(100% + pad)`」通到行左右边缘
 * （和 `.nd-code-header` 同一套账），而负 margin 要抵消的正是行的 `padding-left`。
 */
const LINE_OPEN = Decoration.line({ class: 'nd-embed-open' })

/**
 * 非开围栏的行（闭围栏 + 万一存在的正文）—— 内容藏掉后把**行盒也压成 0 高**。
 *
 * ⚠️ 只 `HIDE` 不够：`Decoration.replace` 藏的是**行内内容**，不含换行符，
 * 空行仍然占一整行高度 —— 卡片下面会多出一条空白。这和 `fence.ts` 折叠态
 * 用 `LINE_FOLDED` 压行高是同一个理由。
 */
const LINE_HIDDEN = Decoration.line({ class: 'nd-embed-hidden' })

/**
 * 占位卡 widget（非揭示态）。
 *
 * ⚠️ DOM 一律用 `createElement` + `textContent` 手工搭，**不用 `innerHTML`**。
 * `title` 里含**作者写的 id** —— `innerHTML` 会让「id 里带 `<` 会怎样」这种问题
 * 真的存在（虽然现在 id 已过正则，但 `textContent` 是**结构性**的安全）。
 * `code-header.ts` 用 `innerHTML` 是因为它要拼多元素结构且内容全来自固定表；
 * 这里没有那个理由。
 */
export class EmbedCardWidget extends WidgetType {
  constructor(private readonly spec: EmbedSpec) {
    super()
  }

  /**
   * ⚠️ 必须实现。三个字段都要比：provider/kind 变了图标和展示名要变，
   * id 变了标题要变。只比 `spec` 对象引用是不够的 —— 每次 rebuild 都会
   * 造一个新的 `EmbedSpec`，引用永远不等，卡片就会闪。
   */
  override eq(other: EmbedCardWidget): boolean {
    return (
      other.spec.provider === this.spec.provider &&
      other.spec.kind === this.spec.kind &&
      other.spec.id === this.spec.id
    )
  }

  override toDOM(): HTMLElement {
    const card = document.createElement('div')
    card.className = `nd-embed-card nd-embed-card--${this.spec.provider}`
    card.setAttribute('data-nd-embed', `${this.spec.provider}:${this.spec.kind}`)

    const icon = document.createElement('span')
    icon.className = 'nd-embed-card__icon'
    // 图标是纯装饰，别让屏幕阅读器念一个看不懂的符号。
    icon.setAttribute('aria-hidden', 'true')
    icon.textContent = embedGlyph(this.spec)

    const label = document.createElement('span')
    label.className = 'nd-embed-card__label'
    label.textContent = embedTitle(this.spec)

    const hint = document.createElement('span')
    hint.className = 'nd-embed-card__hint'
    hint.textContent = '点击编辑源码'

    card.append(icon, label, hint)
    return card
  }

  /** 返回 `false` = 事件交给 CM：点卡片 → 光标落进围栏 → 转揭示态显示源码。 */
  override ignoreEvent(_event: Event): boolean {
    return false
  }
}

export const embedFeature: EditorFeature = {
  name: 'embed',
  /*
   * ⚠️ 认领 `FencedCode` 就抢走了**所有**代码块，所以 `decorate` 里必须分流
   * （见文件头）。这是本功能最容易出的事故点。
   */
  nodes: ['FencedCode'],
  decorate(ranges, atomicRanges, node, doc, selection, context) {
    decorateEmbed(ranges, atomicRanges, node, doc, selection, context)
  },
}

function decorateEmbed(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
  context?: DecorateContext,
): void {
  const info = readFenceInfo(doc, node)

  // 不是 embed → **原样交回**给原来的围栏装饰。普通代码块（```js）走的就是这条。
  if (!isEmbedInfo(info)) {
    decorateFencedCode(ranges, atomicRanges, node, doc, selection, context)
    return
  }

  // 是 embed 但写错了 → 也交回，让作者看到源码去修。渲染侧同样会降级成普通代码块，
  // 两侧行为因此一致（契约最怕的「编辑器写得出、渲染器读不出」在这里被挡住）。
  const spec = parseEmbedFence(info)
  if (!spec) {
    decorateFencedCode(ranges, atomicRanges, node, doc, selection, context)
    return
  }

  // 揭示态（光标/选区碰到这个围栏的任意一行）：保留源码，让作者能改 provider/kind/id。
  // ⚠️ 这一条必须在推任何 replace 之前返回，否则会把光标要编辑的源码藏掉。
  if (selectionTouchesLineRange(doc, selection, node.from, node.to)) return

  const open = firstChildNamed(node, 'CodeMark')
  if (!open) return
  const openLine = doc.lineAt(open.from)

  // `node.to` 是**排他**的：正好落在下一行行首时，不减 1 会多算一行（同 `fence.ts`）。
  const lastPos = node.to > node.from ? node.to - 1 : node.to
  const endLine = doc.lineAt(lastPos)

  // 开围栏行 → 占位卡（整行行内替换；**不是** block widget —— 那会让方向键进不去）。
  ranges.push(LINE_OPEN.range(openLine.from))
  if (openLine.to > openLine.from) {
    pushAtomicRange(
      ranges,
      atomicRanges,
      Decoration.replace({ widget: new EmbedCardWidget(spec) }),
      openLine.from,
      openLine.to,
    )
  }

  // 其余行（闭围栏 + 万一存在的正文）→ 藏内容 + 压行高。
  // 未闭合的围栏只有一行，循环自然不执行。
  for (let n = openLine.number + 1; n <= endLine.number; n++) {
    const line = doc.line(n)
    ranges.push(LINE_HIDDEN.range(line.from))
    if (line.to > line.from) {
      pushAtomicRange(ranges, atomicRanges, HIDE, line.from, line.to)
    }
  }
}
