/**
 * `$$` 块级数学 —— **两侧共用的行级判定**（契约：`docs/dialect-extensions.md` 第 2 节）。
 *
 * ## 为什么单独一个 `shared/` 文件
 *
 * `$$` 是**两侧各写一个解析器**的语法：渲染侧是 markdown-it 的 block rule，
 * 编辑器侧是 lezer 的 `Paragraph` 节点 + 行文本判断。两边各写一套「哪行算开、
 * 哪行算闭、内容多空白算空」的规则，**必然漂**（一边 `trim` 一边没 `trim`，
 * 于是同一条 `$$` 在一侧是公式、另一侧是文本 —— 这正是这个库最怕的那类 bug）。
 *
 * 所以判定只有这一份：
 *
 * - **渲染侧** `src/render/features/math.ts` 的 block rule；
 * - **编辑器侧** `src/cm/features/math.ts` 的 `Paragraph` 分支。
 *
 * ## 边界规则（写进契约 §2，三条都是一次踩出来的）
 *
 * 1. **`$$` 之后不能紧跟非空白的普通文本** —— 否则 `$$5`（价格）会被当成公式开头，
 *    把后面整篇文档吃进一个公式块里。所以「开 `$$`」这一行要么是**光秃秃的 `$$`**
 *    （多行形式），要么整行是一个**闭合的单行公式** `$$x^2$$`。
 * 2. **单行形式的 `$$` 必须在行尾闭合** —— `$$x$$ 后面还有字` 不是公式
 *    （作者显然想写正文，硬判成公式会把后半句吞掉）。
 * 3. **内容全空白不算公式** —— `$$\n$$` / `$$$$` 在渲染侧会产出一个**看不见的空块**
 *    （编辑器里更糟：点不到、也删不掉），所以两侧都当普通文本。
 *
 * ⚠️ 前导空格上限 3 个（CommonMark 的块级缩进）：4 个及以上是**缩进代码块**，
 * 那里的 `$$` 是字面量。这里只数**空格** —— tab 按 CommonMark 算 4 列，
 * 也就是缩进代码块，不在这里处理。
 */

/** CommonMark 允许块级元素最多 3 个前导空格。 */
const MAX_INDENT = 3

/**
 * 去掉最多 3 个前导空格；超过就是缩进代码块，返回 `null`（调用方一律当「不是公式」）。
 *
 * ⚠️ 用**手写循环**而不是 `/^ {0,3}/`：正则能匹配 0 个空格，于是 `    $$`（4 个）
 * 会被切出 `" $$"` 这种「看起来合法」的残行 —— 必须能区分「没缩进」和「缩进过头」。
 */
function stripIndent(line: string): string | null {
  let i = 0
  while (i < line.length && line.charCodeAt(i) === 0x20 /* 空格 */) i++
  return i > MAX_INDENT ? null : line.slice(i)
}

/**
 * 这一行是不是**单独成行的 `$$`**（多行形式的开 / 闭围栏）。
 *
 * `$$` 之后只允许空白：`$$x` / `$$ $$` 都不算 —— 见文件头边界规则 1。
 */
export function isMathBlockFenceLine(line: string): boolean {
  const body = stripIndent(line)
  if (body === null) return false
  return body.trimEnd() === '$$'
}

/**
 * 单行形式 `$$x^2$$` → `x^2`；不是单行公式就返回 `null`。
 *
 * ⚠️ 闭合 `$$` 必须在**行尾**（允许尾随空白）：`$$x$$ 后面还有字` 不是公式。
 * ⚠️ 内容全空白 → `null`：`$$$$` / `$$  $$` 两侧都当普通文本。
 */
export function parseSingleLineMathBlock(line: string): string | null {
  const raw = stripIndent(line)
  if (raw === null) return null
  /*
   * ⚠️ 先 `trimEnd` 再判闭合：**行尾空白很常见**（编辑器自动缩进、复制粘贴、
   * Prettier 类工具都会留）。不 trim 的话 `$$x^2$$   ` 会被判成普通文本 ——
   * 作者看不见那几个空格，只会觉得「公式时灵时不灵」。
   * 注意 trim 的是**闭合 `$$` 之后**的空白，`$$x  $$` 里的空白属于 tex，保留。
   */
  const body = raw.trimEnd()
  if (!body.startsWith('$$') || !body.endsWith('$$')) return null

  const tex = body.slice(2, -2)
  // 光秃秃的 `$$` 也会走到这里（`slice(2, -2)` 是空串）—— 空内容一律不算公式，
  // 于是它自然落到 `isMathBlockFenceLine` 那条分支上，两边的分工不会含糊。
  return tex.trim() === '' ? null : tex
}

/**
 * 多行形式的**内容行** → TeX 源码；全空白返回 `null`。
 *
 * 两侧传进来的都是**已剥掉首行缩进**的内容行：
 *
 * - 渲染侧 `state.getLines(startLine + 1, nextLine, state.sCount[startLine], false)`；
 * - 编辑器侧按 `node.from - 行首` 的宽度自己剥（`cm/features/math.ts` 的 `dedent`）。
 *
 * 两边的 dedent 宽度都是「开 `$$` 那一行的缩进」，所以 tex 逐字符一致。
 */
export function joinMathBlockLines(lines: readonly string[]): string | null {
  const tex = lines.join('\n')
  return tex.trim() === '' ? null : tex
}
