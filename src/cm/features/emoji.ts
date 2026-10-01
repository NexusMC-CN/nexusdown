/**
 * `emoji` —— `:smile:` 短代码（契约：`docs/dialect-extensions.md` 第 3 节）。
 *
 * ## 认领的是 **lezer 的 `Emoji` 节点**，不是「行内正则扫描」
 *
 * 任务书让我按 `decorate/link.ts` 的扫法做行内正则扫描。实际动手前先探了语法树，
 * 发现**根本不需要扫** —— `@lezer/markdown` 1.7.2 自带一个 `Emoji` 内联扩展
 * （源码：`/^[a-zA-Z_0-9]+:/`），而 `@codemirror/lang-markdown` 的
 * `markdownLanguage` 默认就把它打开了（`commonmark.configure([GFM, Subscript,
 * Superscript, Emoji, …])`）。实测：
 *
 *     'a :smile: b'      → Paragraph > Emoji [2,9) ":smile:"
 *     '`code :smile:`'   → InlineCode [0,14)（**没有** Emoji）
 *     '```\n:smile:\n```' → FencedCode > CodeText（**没有** Emoji）
 *
 * 这带来两个正则扫描给不了的好处：
 *
 * 1. **「跳过代码块和行内代码」是白送的**。契约明确要求「必须跳过代码块和行内
 *    代码」，而 `EditorFeature.decorate` 的签名里**只有 `doc`、没有语法树**
 *    （见 `types.ts`：这是为了让它保持纯函数可单测）。所以纯正则扫描**无法**
 *    可靠判断 `:smile:` 是不是落在 `` ` `` 里 —— 反引号可以是 1~N 个、可以嵌套，
 *    行级正则做不到。认领节点则天然正确。
 * 2. 少一整类解析工作，且与「编辑器/渲染器同一套语法认知」的初衷一致。
 *
 * ⚠️ 代价（如实记录）：lezer 的字符集是 `[a-zA-Z_0-9]`，**不含 `+` / `-`**，
 * 所以 `:+1:` 不会被认成 `Emoji` 节点。为了两侧一致，`shared/emoji-data.ts`
 * 也**故意不收** `+1` / `-1`（见那里的注释）。
 *
 * ## 只有「表里有的」才替换
 *
 * lezer 的 `Emoji` 节点认的是**任意** `:word:`，不查表 —— 实测 `:not_real_thing:`
 * 也会产出节点。所以这里必须 `EMOJI_SHORTCODES.get(name)`，查不到就**什么都不做**
 * （源码原样显示），避免把普通文本里的 `:foo:` 误变成占位。
 */
import type { EditorSelection, Text } from '@codemirror/state'
import { Decoration, WidgetType } from '@codemirror/view'

import { EMOJI_SHORTCODES } from '../../shared/emoji-data.js'
import { MUTED_MARK, pushAtomicRange } from '../decorate/shared.js'
import type { EditorFeature } from '../feature.js'
import type { DecorationRanges, MarkdownNode } from '../types.js'
import { selectionTouchesLineRange } from '../util/selection.js'

/**
 * 字形 widget。
 *
 * ⚠️ 必须实现 `eq()`：默认实现恒 `false`，每次 rebuild 都会 `toDOM()` 重建 DOM ——
 * 表现是光标一动 emoji 就闪一下。比较 `glyph` 与 `name` 两个字段即可
 * （`name` 变了无障碍名也要变）。
 */
export class EmojiWidget extends WidgetType {
  constructor(
    private readonly glyph: string,
    /** 原始 shortcode（不含冒号），只用来拼 `aria-label`。 */
    private readonly name: string,
  ) {
    super()
  }

  override eq(other: EmojiWidget): boolean {
    return other.glyph === this.glyph && other.name === this.name
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nd-emoji'
    // 字形是图片性内容：给屏幕阅读器一个可读名，否则它只会念出一个看不懂的字符。
    span.setAttribute('role', 'img')
    span.setAttribute('aria-label', `:${this.name}:`)
    /*
     * ⚠️ 用 `textContent` 而不是 `innerHTML`。
     *
     * `glyph` 来自**我们自己写死的表**（`shared/emoji-data.ts`），不是用户输入，
     * 所以这里其实不存在注入面 —— 但 `textContent` 是**结构性**的安全：
     * 它让「字形里带 `<` 会怎样」这种问题根本不成立。`code-header.ts` 用
     * `innerHTML` 是因为那里拼的是多元素结构，不得不如此；这里一个字符就够，
     * 没有理由退而求其次。
     */
    span.textContent = this.glyph
    return span
  }

  /** 返回 `false` = 事件交给 CM：点 emoji 落在光标定位上，随后这一行转揭示态显示源码。 */
  override ignoreEvent(_event: Event): boolean {
    return false
  }
}

export const emojiFeature: EditorFeature = {
  name: 'emoji',
  nodes: ['Emoji'],
  decorate(ranges, atomicRanges, node, doc, selection) {
    decorateEmoji(ranges, atomicRanges, node, doc, selection)
  },
}

function decorateEmoji(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
): void {
  // `node` 的形状是 `:name:`，两端各一个冒号。
  const raw = doc.sliceString(node.from, node.to)
  if (raw.length < 3 || raw.charCodeAt(0) !== 0x3a || raw.charCodeAt(raw.length - 1) !== 0x3a) {
    return
  }
  const name = raw.slice(1, -1)

  const glyph = EMOJI_SHORTCODES.get(name)
  // 表里没有 → 什么都不做。见文件头「只有表里有的才替换」。
  if (!glyph) return

  // 揭示态（光标/选区碰到这一行）：保留源码，让用户能改短代码。
  if (selectionTouchesLineRange(doc, selection, node.from, node.to)) {
    // 变淡而不是藏掉 —— 和 link.ts 的揭示态同一套 `.nd-mark`。
    ranges.push(MUTED_MARK.range(node.from, node.to))
    return
  }

  // 非揭示态：整段 `:smile:` 换成一个字形 widget，并**登记为原子区间**
  // （契约硬约束二：隐藏态的 replace 不进 atomicRanges，光标会停在隐藏区间中间）。
  pushAtomicRange(
    ranges,
    atomicRanges,
    Decoration.replace({ widget: new EmojiWidget(glyph, name) }),
    node.from,
    node.to,
  )
}
