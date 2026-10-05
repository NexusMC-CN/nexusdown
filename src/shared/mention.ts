/**
 * `mention` 的**扫描器** —— 编辑器侧（`src/cm/features/mention.ts`）与渲染侧
 * （`src/render/features/mention.ts`）**唯一共用的一份**。
 *
 * ## 为什么必须共用
 *
 * 契约（`docs/dialect-extensions.md` 第 8 节）把「认 `@slug` 的扫描逻辑要和渲染侧一致」
 * 点出来了。两侧各写一遍正则，迟早会漂：一边认了 `@foo_bar`、另一边不认，
 * 就会出现「编辑器里是胶囊、发出来是字面 `@foo_bar`」—— 正是本库要消灭的那类不一致。
 * 所以边界判定、字符集、fragment 规则**只有这里一份**。
 *
 * ## 语法
 *
 * ```
 * @slug            slug = [a-z0-9][a-z0-9-]*
 * @slug#fragment   fragment = [a-z0-9][a-z0-9-]*（可选，站内子定位）
 * ```
 *
 * ## ⚠️ 三条判定，每条都有实测理由
 *
 * 1. **`@` 必须在词边界**（串首，或前一个字符不是 `[A-Za-z0-9_]`）。
 *    否则 `a@b.com` 会被认成「提及 `b`」—— 实测 lezer 会把 `a@b.com` 解析成一个
 *    `URL` 节点、markdown-it 也会把它包进 `<a href="mailto:…">`，
 *    两种情况下 `@b` 都真实存在，只有词边界能挡住。
 *    这里用 `\w` 的字符集（字母/数字/下划线），**不含 `-`**：
 *    邮箱 local part 以 `-` 结尾再跟 `@` 不是合法邮箱，不必为它让步。
 *
 * 2. **slug 只收小写**（`[a-z0-9]` 起头）。契约写死了这个正则；
 *    `@Nexus` 两边都**不认**，宁可漏也不制造两侧不一致。
 *
 * 3. **`#` 后面没有合法 fragment 字符时，`#` 不算进提及** ——
 *    这样 `@foo#` 里的 `#` 留给正文，不会被吞掉。
 *
 * ## 为什么手写字符码扫描，不用全局正则
 *
 * 全局正则（`/g`）带 `lastIndex` 状态：同一个正则被两侧/多次调用复用时，
 * 一次忘了重置就会**从上次的位置继续**，症状是「有时认有时不认」。
 * 手写扫描没有共享状态，边界判定也能写在匹配的同一处，读起来是一条线。
 */
export interface MentionSpan {
  /** `@` 的位置（含）。 */
  from: number
  /** 结尾（排他）。含 fragment。 */
  to: number
  /** `@` 与 `#` 之间那串（查 `RenderData.mentions` 用的 key）。 */
  slug: string
  /** `#` 后面那串，没有则省略。 */
  fragment?: string
}

const AT = 0x40 // @
const HASH = 0x23 // #
const DASH = 0x2d // -
const UNDERSCORE = 0x5f // _

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}
function isLower(code: number): boolean {
  return code >= 0x61 && code <= 0x7a
}
function isUpper(code: number): boolean {
  return code >= 0x41 && code <= 0x5a
}
/** 词边界用的「词字符」：字母 / 数字 / 下划线（等价 `\w`）。 */
function isWordCode(code: number): boolean {
  return isDigit(code) || isLower(code) || isUpper(code) || code === UNDERSCORE
}
/** slug 首字符：`[a-z0-9]`。 */
function isSlugStart(code: number): boolean {
  return isDigit(code) || isLower(code)
}
/** slug 后续字符：`[a-z0-9-]`。 */
function isSlugCode(code: number): boolean {
  return isDigit(code) || isLower(code) || code === DASH
}

/**
 * **光标处正在输入的提及前缀** —— 自动补全（`src/cm/mention-complete.ts`）用它
 * 判断「要不要弹候选、拿什么当查询串」。
 *
 * ## 为什么它和 `scanMentions` 必须共用判定
 *
 * 补全的触发条件**就是**扫描器的成立条件：扫描器不认的东西（`a@b.com` 的 `@b`、
 * `@-foo`、`@foo#bar` 里的 `#bar`）补全也不该弹。两处各写一遍正则，
 * 迟早漂成「扫描器不认、补全却弹」或者反过来 —— 而这正是本库要消灭的那类不一致。
 * 所以字符类（`isSlugCode` / `isSlugStart`）和词边界（`isWordCode`）**只有这里一份**，
 * `mentionPrefixAt` 直接复用它们。
 *
 * ## 与 `scanMentions` 的唯一差别：**允许空 slug**
 *
 * 扫描器要求 `@` 后面**已经**有一个合法 slug 首字符才算提及 —— 那是"写完了"。
 * 这里允许 `slug === ''`（光标刚好落在 `@` 后面）—— 那是"正在写"，
 * 用户刚打完 `@` 就该看到全部候选。除此之外两者的判定逐字一致。
 *
 * @param text 要扫的文本（调用方一般只给**光标所在行**的 `行首 → 光标` 片段，
 *   slug 不含换行，所以前缀一定落在这一行里）。
 * @param end 光标的偏移（相对 `text`）。
 * @returns `from` = `@` 的位置；`slug` = `@` 与光标之间那串（可能为空）。
 *   不构成提及前缀时返回 `null`。
 */
export function mentionPrefixAt(text: string, end: number): { from: number; slug: string } | null {
  // 往回扫 slug 字符（`-` 也算 —— 它出现在 slug 中间是合法的）。
  let start = end
  while (start > 0 && isSlugCode(text.charCodeAt(start - 1))) start--

  const at = start - 1
  if (text.charCodeAt(at) !== AT) return null
  // 词边界：`@` 前必须是串首或非词字符。`a@b.com` 在这里被挡下（同扫描器）。
  if (at > 0 && isWordCode(text.charCodeAt(at - 1))) return null

  const slug = text.slice(start, end)
  // 有内容时要符合 slug 首字符规则（`@-foo` 不算）；空 slug 放行（刚打完 `@`）。
  if (slug.length > 0 && !isSlugStart(slug.charCodeAt(0))) return null

  return { from: at, slug }
}

/**
 * 扫出 `text` 里所有提及，按出现顺序返回。**不做任何解析 / 查表** ——
 * 拿到结果之后怎么办（渲染胶囊、查库、降级）由调用方决定。
 *
 * `text.charCodeAt(越界)` 返回 `NaN`，所有比较都是 `false`，所以无需显式的
 * 长度检查 —— 扫描循环天然在串尾停下。
 */
export function scanMentions(text: string): MentionSpan[] {
  const out: MentionSpan[] = []
  let i = 0

  while (i < text.length) {
    if (text.charCodeAt(i) !== AT) {
      i++
      continue
    }

    // 词边界：`@` 前必须是串首，或非词字符。
    if (i > 0 && isWordCode(text.charCodeAt(i - 1))) {
      i++
      continue
    }

    const slugFrom = i + 1
    if (!isSlugStart(text.charCodeAt(slugFrom))) {
      i++
      continue
    }

    let end = slugFrom + 1
    while (end < text.length && isSlugCode(text.charCodeAt(end))) end++
    const slug = text.slice(slugFrom, end)

    // 可选 fragment：`#` 后必须紧跟合法首字符，否则 `#` 不归提及。
    let fragment: string | undefined
    if (text.charCodeAt(end) === HASH && isSlugStart(text.charCodeAt(end + 1))) {
      let fragEnd = end + 2
      while (fragEnd < text.length && isSlugCode(text.charCodeAt(fragEnd))) fragEnd++
      fragment = text.slice(end + 1, fragEnd)
      end = fragEnd
    }

    out.push(fragment === undefined ? { from: i, to: end, slug } : { from: i, to: end, slug, fragment })
    i = end
  }

  return out
}
