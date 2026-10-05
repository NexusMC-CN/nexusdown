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
 * ## ★ 卡片的样子**由注入的解析结果决定**（和渲染侧同构）
 *
 * 编辑器**不查库**（同 `mathRenderer` / 渲染侧的 `RenderData`）。要让卡片显示
 * 「标题 / 图标 / 角标 / 缩略图」，消费方得把 `slug → MentionResolution` 的
 * **同一份数据**也喂给编辑器 —— 走 `nexusdown({ mentions })` /
 * `mountEditor({ mentions })` / `<NexusdownEditor :mentions="…">`。
 *
 * - **注入了**：卡片 DOM 逐节点对齐渲染侧 `render/features/mention.ts` 的
 *   `renderCard()` —— 同一个类名、同一个顺序，所以两侧的样式（`src/shared/dialect.css`）
 *   一吃就是同一个样子。
 * - **没注入**：**不画 `__icon`** —— 一个空的方块看起来就是"图标加载坏了"。
 *   只显示源码 slug，作为「这段是一个站内引用」的提示。
 *
 * ⚠️ `image` **必须过 URL 白名单**（同 `render/features/mention.ts` 的
 * `renderCard()` / `link-card` 的缩略图）：解析结果来自消费方查库，
 * 是**第三方可控内容**，不能直接塞进 `<img src>`。
 *
 * ## ⚠️ 扫描逻辑与渲染侧共用 `shared/mention.ts`
 *
 * 认 `@slug`、词边界、fragment 只有那一份实现。这里额外做的是**排除**渲染侧
 * 根本不会当文本处理的位置（行内代码、链接目标、图片 alt…），见 `excludedRanges`。
 */
import type { EditorSelection, Text } from '@codemirror/state'
import { Decoration, WidgetType } from '@codemirror/view'

import type { MentionResolution } from '../../render/feature.js'
import { scanMentions } from '../../shared/mention.js'
import { MUTED_MARK, pushAtomicRange } from '../decorate/shared.js'
import type { EditorFeature } from '../feature.js'
import type { DecorationRanges, MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'

/**
 * `slug → 解析结果`。**和渲染侧 `RenderData.mentions` 是同一个形状**
 * （`ReadonlyMap<string, MentionResolution>`）—— 消费方已经把那份数据算出来了，
 * 直接原样传进来即可，不要再建第二套。
 */
export type MentionResolutions = ReadonlyMap<string, MentionResolution>

/**
 * 行内提及胶囊。
 *
 * ⚠️ 必须实现 `eq()`：默认实现恒 `false`，每次 rebuild 都会 `toDOM()` 重建 DOM ——
 * 表现是光标一动胶囊就闪一下。比 `text`（+ `missing`）即可。
 *
 * ⚠️ **只显示源码 `@slug`，不显示查库得到的显示名** —— 这是刻意的：
 * 编辑器里它是「你写的那个语法」的提示，光标进这一行就变回源码；
 * 渲染侧才把它换成 `<a href>显示名</a>`。两侧**共用同一套颜色**（`dialect.css`），
 * 所以"同一个胶囊"的观感是一致的。
 */
export class MentionWidget extends WidgetType {
  constructor(
    /** 源码原文：`@slug` 或 `@slug#fragment`。 */
    private readonly text: string,
    /**
     * 目标已删（注入了 `missing: true` 的解析结果）。
     *
     * 渲染侧这时出的是「已失效」墓碑（**不是链接**）。编辑器仍然显示源码 slug
     * （作者要能看见自己写了什么），但套上同一个 `--missing` 类 —— 灰掉 + 删除线，
     * 和渲染侧同一个观感。没注入数据时永远 `false`（编辑器不知道目标在不在）。
     */
    private readonly missing = false,
  ) {
    super()
  }

  override eq(other: MentionWidget): boolean {
    return other.text === this.text && other.missing === this.missing
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = this.missing ? 'nd-mention nd-mention--missing' : 'nd-mention'
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
 * 「独占一段」的卡片。
 *
 * ## 结构**逐节点对齐渲染侧** `render/features/mention.ts` 的 `renderCard()`
 *
 * ```
 * <span class="nd-mention-card">              ← 渲染侧是 <a href>（站内链接）
 *   <span class="nd-mention-card__icon" data-kind="…">
 *   <span class="nd-mention-card__body">
 *     <span class="nd-mention-card__title">…
 *     <span class="nd-mention-card__summary">…     （可选）
 *     <span class="nd-mention-card__byline">…      （可选）
 *   </span>
 *   <span class="nd-mention-card__badges">…        （可选）
 *   <img class="nd-mention-card__image">…          （可选）
 * </span>
 * ```
 *
 * 唯一的差异是根标签：渲染侧是 `<a>`（点它跳转），编辑器是 `<span>`
 * （点它是定位光标、露出源码，同 `MentionWidget`）。类名与子节点顺序完全一致，
 * 所以 `src/shared/dialect.css` 一份样式管两侧。
 *
 * ⚠️ DOM 用 `<span>` + `inline-flex`（`dialect.css` 里设）：`Decoration.replace`
 * 的 widget 前后各有 CM6 插的 `<img class="cm-widgetBuffer">`，widget 一旦是块级
 * 就会垂直堆成三行、把高度表搞坏（见 `theme.css` 的 `.nd-image-widget` 长注释）。
 */
export class MentionCardWidget extends WidgetType {
  constructor(
    /** 源码原文（没注入解析结果时直接显示它）。 */
    private readonly text: string,
    /** 查库得到的解析结果。**没注入时为 `undefined`**（见文件头）。 */
    private readonly res?: MentionResolution,
  ) {
    super()
  }

  /**
   * ⚠️ 除了 `text`，还要比**解析结果的内容** —— 数据变了（比如消费方换了 slug
   * 的解析结果）DOM 就得重建。比"字段指纹"而不是对象引用：消费方每次重新
   * 查库都会造新对象，按引用比会让卡片**每次 rebuild 都重建**。
   */
  override eq(other: MentionCardWidget): boolean {
    return other.text === this.text && resKey(other.res) === resKey(this.res)
  }

  override toDOM(): HTMLElement {
    /*
     * ⚠️⚠️ **widget 绝不能抛** —— 一抛，**整个装饰构建就挂** ✗，
     * 编辑器里**同一批的其它 widget 也一起失效** ✓
     * （实测症状：提及的候选列表没了 ✓ + 表格也打不出来 ✓ —— 看起来像"编辑器坏了" ✗，
     * 实际只是**一张卡片**的 DOM 构造出了问题 ✓）。
     *
     * 所以整个构造包一层 try ✓：失败就**降级成源码胶囊** ✓ ——
     * 一张卡片不好看，好过整个编辑器不能用 ✓。
     */
    try {
      return this.buildCard()
    } catch (e) {
      console.warn('[nexusdown] 提及卡片渲染失败，已降级成源码：', e)
      const span = document.createElement('span')
      span.className = 'nd-mention'
      span.textContent = this.text
      return span
    }
  }

  private buildCard(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nd-mention-card'

    const res = this.res
    if (!res) {
      /*
       * 没注入解析结果：**不画 `__icon`**。
       *
       * 一个空的方块在用户眼里就是"图标没加载出来"，比没有图标更糟。
       * 只把源码 slug 放进标题位，说明"这段是个站内引用"。
       */
      span.append(cardBody(this.text, undefined, undefined))
      return span
    }

    span.setAttribute('data-kind', res.kind)

    const icon = document.createElement('span')
    icon.className = 'nd-mention-card__icon'
    icon.setAttribute('data-kind', res.kind)
    icon.setAttribute('aria-hidden', 'true')
    span.append(icon)

    span.append(cardBody(res.title, res.summary, res.byline))

    if (res.badges && res.badges.length > 0) {
      const badges = document.createElement('span')
      badges.className = 'nd-mention-card__badges'
      for (const badge of res.badges) {
        const el = document.createElement('span')
        el.className = 'nd-mention-card__badge'
        el.textContent = badge
        badges.append(el)
      }
      span.append(badges)
    }

    const image = safeImage(res.image)
    if (image) {
      const img = document.createElement('img')
      img.className = 'nd-mention-card__image'
      img.src = image
      // 装饰图：alt 留空，屏幕阅读器跳过（标题已经在正文里念过一遍）。
      img.alt = ''
      img.loading = 'lazy'
      img.decoding = 'async'
      span.append(img)
    }

    return span
  }

  override ignoreEvent(_event: Event): boolean {
    return false
  }
}

/**
 * 卡片正文区（标题 / 摘要 / 署名）。
 *
 * 三处都用 `textContent` —— 这些字段全部来自消费方查库，是**第三方可控内容**，
 * 和渲染侧的 `esc()` 是同一道防线（那边转义，这边压根不解析 HTML）。
 */
function cardBody(title: string, summary?: string, byline?: string): HTMLElement {
  const body = document.createElement('span')
  body.className = 'nd-mention-card__body'

  const titleEl = document.createElement('span')
  titleEl.className = 'nd-mention-card__title'
  titleEl.textContent = title
  body.append(titleEl)

  if (summary) {
    const el = document.createElement('span')
    el.className = 'nd-mention-card__summary'
    el.textContent = summary
    body.append(el)
  }
  if (byline) {
    const el = document.createElement('span')
    el.className = 'nd-mention-card__byline'
    el.textContent = byline
    body.append(el)
  }
  return body
}

/**
 * 缩略图 URL 白名单 —— **只放行 http(s) 与 `data:image/`**。
 *
 * 和 `render/features/mention.ts` 的 `renderCard()`、`link-card` 的缩略图
 * 用的是**同一条正则**。库不做 HTML 消毒，安全性靠"只往文本位置插 + 转义/白名单"，
 * 所以这里是必须的一道。
 */
function safeImage(url: string | undefined): string | undefined {
  if (!url) return undefined
  return /^(https?:|data:image\/)/i.test(url) ? url : undefined
}

/** 解析结果的"指纹" —— 只比 `eq()` 需要区分的字段，不引入 JSON 序列化的开销。 */
function resKey(res: MentionResolution | undefined): string {
  if (!res) return ''
  return [
    res.title,
    res.href,
    res.kind,
    res.summary ?? '',
    res.byline ?? '',
    (res.badges ?? []).join('\u0001'),
    res.image ?? '',
  ].join('\u0000')
}

/**
 * 造一个 mention 功能实例。
 *
 * 为什么做成工厂（而不是模块级常量）：解析结果是**每个编辑器一份的装配期配置**
 * （同 `createMathFeature(mathRenderer)`）—— 烤进模块级单例的话，
 * 同一进程里两个消费方会互相串，测试也没法并行。
 *
 * **不传**就是原来的纯语法形态：卡片只有 slug、没有图标。
 */
export function createMentionFeature(mentions?: MentionResolutions): EditorFeature {
  return {
    name: 'mention',
    nodes: ['Paragraph'],
    /*
     * ⚠️ **不标 `block: true`** —— 这是刻意的。卡片虽然「整段」，但整段是一个
     * `Paragraph`、**不跨行**，用行内 `replace` 就够，不需要（也不该用）块级通道。
     * 标了反而会把功能分流进 `StateField`、失去可见区裁剪，并要额外处理
     * 「块级区间光标进不去」那套（`editingBlock`）。能不用块级就不用。
     */
    decorate(ranges, atomicRanges, node, doc, selection) {
      decorateMentions(ranges, atomicRanges, node, doc, selection, mentions)
    },
  }
}

/** 默认实例（**没有**注入解析结果）—— 卡片只显示 slug。 */
export const mentionFeature: EditorFeature = createMentionFeature()

function decorateMentions(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
  mentions: MentionResolutions | undefined,
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
    spans.push({ from, to, text: raw.slice(span.from, span.to), slug: span.slug })
  }
  if (spans.length === 0) return

  // 独占一段 → 卡片。判据必须和渲染侧一致：顶层段落 + 整段只有一个提及。
  if (spans.length === 1 && isTopLevelParagraph(node) && coversParagraph(spans[0]!, raw, node)) {
    const span = spans[0]!
    const res = mentions?.get(span.slug)
    /*
     * ⚠️ **只有"目标已删"才不做卡片** —— 和渲染侧 core 规则同一条判据
     * （那边是 `if (!res || res.missing) continue`）。
     *
     * 但编辑器**不能照抄"没有 res 就不做卡片"**：编辑器是**纯语法**的，
     * 没注入数据时它照样得把「独占一段的提及」画成卡片（只是没有图标/标题，
     * 见文件头）。所以这里是「`missing` 才退回行内」，不是「没数据就退回行内」。
     * 少了 `missing` 这一条，编辑器会把一个已失效的提及画成卡片，
     * 而发出来是行内墓碑 —— 又一处两侧不一致。
     */
    if (!res?.missing) {
      if (selectionTouchesLineRange(doc, selection, node.from, node.to)) {
        // 揭示态：源码原样（变淡），让用户能改 slug。
        ranges.push(MUTED_MARK.range(span.from, span.to))
        return
      }
      /*
       * ★ **替换区间从"行首"开始，不是 `node.from`。**
       *
       * `Paragraph` 的节点范围**不含前导空白**（实测：`  @foo  ` 的节点范围是
       * `@foo  `）。那些空白会原样留在行里，而卡片是 `width: 100%` ——
       * 空白 + 100% 撑不下，卡片被挤到**第二个视觉行**，行高凭空多一整行
       * （就是用户截图里那个"多出来的空盒子"，而且是**零报错**的）。
       *
       * 顶层段落独占整行，所以"行首 → node.from"之间一定是空白，吞掉是安全的，
       * 也顺带和渲染侧对齐（markdown-it 会把段落的前导空白去掉）。
       */
      const lineFrom = doc.lineAt(node.from).from
      pushAtomicRange(
        ranges,
        atomicRanges,
        Decoration.replace({ widget: new MentionCardWidget(span.text, res) }),
        lineFrom,
        node.to,
      )
      return
    }
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
      Decoration.replace({
        widget: new MentionWidget(span.text, mentions?.get(span.slug)?.missing === true),
      }),
      span.from,
      span.to,
    )
  }
}

interface MentionSpanAt {
  from: number
  to: number
  text: string
  /** `@` 与 `#` 之间那串 —— 查 `mentions` 用的 key。 */
  slug: string
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
