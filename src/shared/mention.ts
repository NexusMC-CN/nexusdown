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
