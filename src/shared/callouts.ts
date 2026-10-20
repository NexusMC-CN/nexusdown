/**
 * Callouts（`> [!NOTE]`）—— **两侧共用的类型表与标记解析**
 * （契约：`docs/dialect-extensions.md` 第 9 节）。
 *
 * ## 为什么表放在 `shared/`
 *
 * 和 `emoji-data.ts` / `mention.ts` 同一条纪律：**编辑器与渲染器只认一份数据**。
 * 类型名、显示名、图标三样东西，两侧各抄一份的话，加一个类型就要改两处，
 * 漏一处就是「编辑器里有徽章、发出来是普通引用」—— 而且**零报错**。
 *
 * ## 为什么图标用字符，不引入图标库
 *
 * 同 `render/features/embed.ts` 的取舍：`iconify-icon` 这类要从 CDN 拉数据，
 * **离线会静默变成空标签**。字符是同步的、可复制的、SSR 安全的。
 *
 * ## 未知类型：降级成普通引用块
 *
 * 契约要求「未知类型 → 退回普通 `<blockquote>`（不报错、不吞内容）」。
 * 所以 `parseCallOutMarker` 对未知类型返回 `null` —— 调用方**什么都不做**，
 * 引用块按原样渲染，`[!FOO]` 作为正文留在那里，作者一眼能看见自己写错了。
 */
/** 一种 callout 的静态定义。 */
export interface CallOutType {
  /** 作者写在 `[!TYPE]` 里的词（小写规范形式）。 */
  type: string
  /** 徽章 / 标题上显示的文字。 */
  label: string
  /** 图标字符。 */
  glyph: string
}

/**
 * 10 种类型。**顺序即文档顺序**（契约 §9 的表格照这个排）。
 *
 * `type` 是作者写在 `[!TYPE]` 里的词（小写规范形式），`label` 是徽章/标题上显示的
 * 文字，`glyph` 是图标字符。三者都进输出，所以都当**常量**对待 —— 不拼用户输入。
 */
export const CALL_OUT_TYPES: readonly CallOutType[] = [
  { type: 'note', label: '注意', glyph: 'ℹ' },
  { type: 'tip', label: '提示', glyph: '✦' },
  { type: 'important', label: '重要', glyph: '❗' },
  { type: 'warning', label: '警告', glyph: '⚠' },
  { type: 'caution', label: '小心', glyph: '⊘' },
  { type: 'danger', label: '危险', glyph: '⛔' },
  { type: 'info', label: '信息', glyph: 'ⓘ' },
  { type: 'success', label: '成功', glyph: '✓' },
  { type: 'question', label: '疑问', glyph: '?' },
  { type: 'example', label: '示例', glyph: '≡' },
]

/** `type → 定义`。查表用；`CALL_OUT_TYPES` 仍然是唯一的定义处。 */
export const CALL_OUT_BY_TYPE: ReadonlyMap<string, CallOutType> = new Map(
  CALL_OUT_TYPES.map((def) => [def.type, def]),
)

/** 一次成功的标记解析：命中的类型 + 标记本身的长度（`[!NOTE]` = 8）。 */
export interface CallOutMarker {
  def: CallOutType
  /** 标记在原文里的长度（含 `[` `!` `]`），调用方据此切掉源码。 */
  length: number
}

/**
 * 匹配引用块**第一行开头**的 `[!TYPE]`。
 *
 * 三条刻意的放宽/收紧：
 *
 * - **必须从行首开始**：`> 正文 [!NOTE]` 不是 callout（作者在写正文，不是声明）。
 * - **大小写不敏感**：GitHub 的写法是全大写，但 `[!note]` 也该认 —— 作者不会
 *   因为少按了 Shift 就得到一段普通引用。命中后统一归一成小写去查表。
 * - **`]` 之后必须紧跟空白或行尾**：`[!NOTE]x` 不认 —— 那是「一个链接后面接了字」，
 *   不是声明；硬认的话会把 `x` 前面那个字符吞掉。
 *
 * 未知类型（`[!FOO]`）返回 `null`，调用方降级成普通引用块。
 */
export function parseCallOutMarker(line: string): CallOutMarker | null {
  const match = /^\[!([A-Za-z][A-Za-z0-9_-]*)\](?=\s|$)/.exec(line)
  if (!match) return null

  const def = CALL_OUT_BY_TYPE.get(match[1]!.toLowerCase())
  if (!def) return null
  return { def, length: match[0].length }
}
