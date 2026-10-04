/**
 * `mention` —— 站内实体提及，**编辑器侧**（契约：`docs/dialect-extensions.md` 第 8 节）。
 *
 * 语法：`@slug`（可选 `#fragment`）。
 *
 * ## 为什么认领 `Paragraph`（而不是 `Document`）
 *
 * 契约要求「行内 → 行内 widget；独占一段 → 卡片 widget」。两件事都发生在**段落**里，
 * 所以认领 `Paragraph` 最自然：
 *
 * - 行内提及的胶囊、以及「整段只有一个提及」时的卡片，都在段落范围内判定；
 * - 引用块 / 列表项的内容**也是 `Paragraph`**，天然一起覆盖；
 * - 行内代码（`` `@foo` ``）是段落里的 `InlineCode` 子节点，可以显式跳过。
 *
 * ⚠️ **不能认领 `Document`**：`math` 功能已经占了它（全文扫围栏要用根节点），
 * 而 `indexFeatures` 拒绝「两个功能认领同一节点名」，启动即抛。
 * 也正因如此，本功能**按段落扫描**而不是全文扫描 —— 段落是增量解析出来的，
 * `ViewPlugin` 又只遍历可见区，所以这里**不需要** `math.ts` 那种「按 `Text` 缓存
 * 全文扫描结果」的补偿（那是认领 `Document` 的代价）。
 *
 * ⚠️ **已知边界**：认领 `Paragraph` 覆盖不到**标题**和**表格单元格**里的提及
 * （那些不是 `Paragraph`）。见文件末的说明。
 *
 * ## 两种形态
 *
 * - **行内**：`@slug` 换成行内胶囊 widget，**必须 `pushAtomicRange` 登记 atomic**
 *   （契约硬约束一：隐藏态的 `replace` 不进 `atomicRanges`，光标会停在隐藏区间中间）。
 * - **卡片**：整段只有一个提及、且段落是**顶层**（父节点是 `Document`）时，
 *   把整段换成一个卡片 widget。**同样登记 atomic**（它也是隐藏态 `replace`）。
 * - **揭示态**：选区碰到那一段（`selectionTouchesLineRange`）就露出源码 ——
 *   行内与卡片都用同一套，不需要块级通道（契约：整段是一个 `Paragraph`，
 *   **不跨行**，所以 `EditorFeature.block` **不标**）。
 *
 * ## ⚠️ 扫描逻辑与渲染侧共用 `shared/mention.ts`
 *
 * 认 `@slug`、词边界、fragment 只有那一份实现。这里额外做的是**排除**渲染侧
 * 根本不会当文本处理的位置（行内代码、链接目标、图片 alt…），见 `excludedRanges`。
 */
import type { EditorSelection, Text } from '@codemirror/state'
import { Decoration, WidgetType } from '@codemirror/view'

import { scanMentions } from '../../shared/mention.js'
import { MUTED_MARK, pushAtomicRange } from '../decorate/shared.js'
import type { EditorFeature } from '../feature.js'
import type { DecorationRanges, MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'

/**
 * 行内提及胶囊。
 *
 * ⚠️ 必须实现 `eq()`：默认实现恒 `false`，每次 rebuild 都会 `toDOM()` 重建 DOM ——
 * 表现是光标一动胶囊就闪一下。比 `text` 一个字段即可。
 */
export class MentionWidget extends WidgetType {
  constructor(
    /** 源码原文：`@slug` 或 `@slug#fragment`。 */
    private readonly text: string,
  ) {
    super()
  }

  override eq(other: MentionWidget): boolean {
    return other.text === this.text
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nd-mention'
    /*
     * `textContent` 而不是 `innerHTML`：`text` 来自**用户输入的文档**，
     * 是注入面。`textContent` 是结构性的安全 —— 让「slug 里带 `<` 会怎样」
     * 根本不成立（同 `emoji.ts` / `math.ts` 的取舍）。
     */
    span.textContent = this.text
    return span
  }

  /** 返回 `false` = 事件交给 CM：点胶囊 → 光标定位 → 这一行转揭示态显示源码。 */
  override ignoreEvent(_event: Event): boolean {
    return false
  }
}

/**
 * 「独占一段」的卡片占位。
 *
 * 编辑器**拿不到查库结果**（没有 `RenderData`），所以卡片里只有 slug ——
 * 它的作用是「这段是一个站内引用」的视觉提示，不是渲染侧那种带摘要的真卡片。
 * 真卡片在**发布后**由渲染侧产出（`render/features/mention.ts`）。
 *
 * ⚠️ DOM 用 `<span>` + `inline-flex`（CSS 里设）：`Decoration.replace` 的 widget
 * 前后各有 CM6 插的 `<img class="cm-widgetBuffer">`，widget 一旦是块级就会
 * 垂直堆成三行、把高度表搞坏（见 `theme.css` 的 `.nd-image-widget` 长注释）。
 */
export class MentionCardWidget extends WidgetType {
  constructor(private readonly text: string) {
    super()
  }

  override eq(other: MentionCardWidget): boolean {
    return other.text === this.text
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nd-mention-card'

    const icon = document.createElement('span')
    icon.className = 'nd-mention-card__icon'
    icon.setAttribute('aria-hidden', 'true')

    const body = document.createElement('span')
    body.className = 'nd-mention-card__body'
    body.textContent = this.text

    span.append(icon, body)
    return span
  }

  override ignoreEvent(_event: Event): boolean {
    return false
  }
}

export const mentionFeature: EditorFeature = {
  name: 'mention',
  nodes: ['Paragraph'],
  /*
   * ⚠️ **不标 `block: true`** —— 这是刻意的。卡片虽然「整段」，但整段是一个
   * `Paragraph`、**不跨行**，用行内 `replace` 就够，不需要（也不该用）块级通道。
   * 标了反而会把功能分流进 `StateField`、失去可见区裁剪，并要额外处理
   * 「块级区间光标进不去」那套（`editingBlock`）。能不用块级就不用。
   */
  decorate(ranges, atomicRanges, node, doc, selection) {
    decorateMentions(ranges, atomicRanges, node, doc, selection)
  },
}

function decorateMentions(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
): void {
  const raw = doc.sliceString(node.from, node.to)
  // 快路径：段落里没有 `@` 就什么都不做（绝大多数段落）。
  if (raw.indexOf('@') === -1) return

  const excluded = excludedRanges(node)
  const spans: MentionSpanAt[] = []
  for (const span of scanMentions(raw)) {
    const from = node.from + span.from
    const to = node.from + span.to
    // 落在「渲染侧不当作文本」的区间里 → 跳过（见 excludedRanges）。
    if (isExcluded(from, to, excluded)) continue
    spans.push({ from, to, text: raw.slice(span.from, span.to) })
  }
  if (spans.length === 0) return

  // 独占一段 → 卡片。判据必须和渲染侧一致：顶层段落 + 整段只有一个提及。
  if (spans.length === 1 && isTopLevelParagraph(node) && coversParagraph(spans[0]!, raw, node)) {
    const span = spans[0]!
    if (selectionTouchesLineRange(doc, selection, node.from, node.to)) {
      // 揭示态：源码原样（变淡），让用户能改 slug。
      ranges.push(MUTED_MARK.range(span.from, span.to))
      return
    }
    pushAtomicRange(
      ranges,
      atomicRanges,
      Decoration.replace({ widget: new MentionCardWidget(span.text) }),
      node.from,
      node.to,
    )
    return
  }

  // 行内：逐个胶囊。
  for (const span of spans) {
    if (selectionTouchesLineRange(doc, selection, span.from, span.to)) {
      ranges.push(MUTED_MARK.range(span.from, span.to))
      continue
    }
    pushAtomicRange(
      ranges,
      atomicRanges,
      Decoration.replace({ widget: new MentionWidget(span.text) }),
      span.from,
      span.to,
    )
  }
}

interface MentionSpanAt {
  from: number
  to: number
  text: string
}

/**
 * 卡片只在**顶层**段落判定 —— 对齐渲染侧 core 规则的 `paragraph_open.level === 0`。
 *
 * 少了这条，`> @foo`（引用块里的段落）在编辑器里会变成卡片，而发布出去是行内胶囊
 * （渲染侧 core 规则不认 level ≥ 1 的段落）—— 又是一处两侧不一致。
 */
function isTopLevelParagraph(node: MarkdownNode): boolean {
  return node.parent?.name === 'Document'
}

/**
 * 这个提及是不是**正好覆盖整个段落内容**（去掉首尾空白之后）？
 *
 * `Paragraph` 的范围会带上**尾部空格**（实测：`  @foo  ` 的节点范围是 `@foo  `），
 * 所以不能拿 `node.from` / `node.to` 直接比，要先算出去掉空白的有效区间。
 */
function coversParagraph(span: MentionSpanAt, raw: string, node: MarkdownNode): boolean {
  const lead = raw.length - raw.trimStart().length
  const trail = raw.length - raw.trimEnd().length
  return span.from === node.from + lead && span.to === node.to - trail
}

/**
 * 段落里**不该扫提及**的子区间 —— 这些位置在渲染侧根本不是 `text` token，
 * 渲染器不会把它们变成提及；编辑器不排除的话，就会出现「编辑器有胶囊、
 * 发出来是字面文本」的反向不一致。
 *
 * | 节点 | 为什么排除 |
 * | --- | --- |
 * | `InlineCode` | `` `@foo` `` → 渲染侧是 `code_inline`，不是文本 |
 * | `Image` | `![@foo](a.png)` → 渲染侧 alt 走 `renderInlineAsText`，不调 `rules.text` |
 * | `LinkTitle` | `[x](url "@foo")` → title 是属性，不是文本 |
 * | `LinkLabel` | `[x][@foo]` → label 是引用标识，不是文本 |
 * | `URL`（父节点是 `Link`） | `[x](https://a.com/@b)` → 目标地址是属性，不是文本 |
 *
 * ⚠️ **不排除**顶层 `URL` / `Autolink` 里的 `URL`：`https://x.com/@user` 这种，
 * 渲染侧会把它当**链接文字**（`text` token）扫 —— 排除就反而不一致了。
 */
function excludedRanges(node: MarkdownNode): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const visit = (parent: MarkdownNode): void => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (
        child.name === 'InlineCode' ||
        child.name === 'Image' ||
        child.name === 'LinkTitle' ||
        child.name === 'LinkLabel'
      ) {
        out.push([child.from, child.to])
        // 整棵子树都跳过（图片里不会再嵌可扫描文本）。
        continue
      }
      if (child.name === 'URL' && child.parent?.name === 'Link') {
        out.push([child.from, child.to])
        continue
      }
      visit(child)
    }
  }
  visit(node)
  return out
}

/** 提及区间是否被某个排除区间**完全包含**（跨区间的提及不成立，所以包含判定够用）。 */
function isExcluded(from: number, to: number, excluded: Array<[number, number]>): boolean {
  for (const [ef, et] of excluded) {
    if (ef <= from && to <= et) return true
  }
  return false
}
