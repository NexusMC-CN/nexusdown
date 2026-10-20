/**
 * `callout` —— GitHub 风格的提示块 `> [!NOTE]`，**渲染侧**
 * （契约：`docs/dialect-extensions.md` 第 9 节）。
 *
 * ## 语法只有一条规则
 *
 * **引用块的第一段、且以 `[!TYPE]` 开头**。别的什么都不认：
 *
 * ```md
 * > [!NOTE]
 * > 正文
 * ```
 *
 * ## 为什么用 core 规则改写 token，而不是包一层 `rules.blockquote_*`
 *
 * 要做的事情有三件，而且**互相牵连**：
 *
 * 1. `<blockquote>` 要换成 `<div class="nd-callout nd-callout--note">`；
 * 2. 在正文**前面**插一个标题（`<p class="nd-callout__title">`）；
 * 3. 把首段的 `[!NOTE]` 从**已经分词好的 inline children 里**摘掉。
 *
 * 渲染规则是**逐个 token** 调用的：`blockquote_close` 那一步没有干净的办法回头
 * 改前面已经吐出去的字符串，也没法「在已经渲染完的首段前面插一段」。
 * core 规则拿到的是**完整 token 流**（还没渲染），三件事都能在渲染前做完。
 * `embed` / `link-card` / `carousel` 用的是同一招。
 *
 * ## 未知类型 = 什么都不做
 *
 * 契约要求「未知类型 → 退回普通 `<blockquote>`（不报错、不吞内容）」。
 * `parseCallOutMarker` 对未知类型返回 `null`，这里直接 `continue` ——
 * 于是引用块一个 token 都不动，`[!FOO]` 作为正文原样留在那里。
 * **降级路径不经过本文件任何一行代码**，所以不可能因为 callout 出问题而让内容消失。
 *
 * ## 安全
 *
 * 类型名、显示名、图标**全部来自 `shared/callouts.ts` 的常量表**，
 * 用户输入（`[!TYPE]` 里那串词）只用来**查表**，永远不进标签名/属性名。
 * 万一 meta 里出现了表外的值（不该发生），`typeOf` 也会退回 `note`，
 * 而不是把任意字符串拼进 `class`。
 */
import type { StateCore, Token } from 'markdown-it'

import { CALL_OUT_BY_TYPE, parseCallOutMarker, type CallOutType } from '../../shared/callouts.js'
import type { RenderFeature, RenderFeatureContext } from '../feature.js'

/** 自定义 token 类型：外层 `<div>` 的开 / 闭 + 标题。 */
const OPEN_TOKEN = 'nd_callout_open'
const CLOSE_TOKEN = 'nd_callout_close'
const TITLE_TOKEN = 'nd_callout_title'

/** `token.meta` 里放类型名的键。 */
const TYPE_META = 'ndCalloutType'

/** 兜底类型 —— 只在 meta 缺失 / 值不在表里时用（见文件头「安全」）。 */
const FALLBACK_TYPE = 'note'

export const calloutFeature: RenderFeature = {
  name: 'callout',
  install(ctx: RenderFeatureContext) {
    installCalloutCore(ctx)

    ctx.rules[OPEN_TOKEN] = (tokens, idx) =>
      `<div class="nd-callout nd-callout--${typeOf(tokens[idx])}">`
    ctx.rules[CLOSE_TOKEN] = () => '</div>'
    ctx.rules[TITLE_TOKEN] = (tokens, idx) => renderTitle(typeOf(tokens[idx]), ctx.escapeHtml)
  },
}

/**
 * core 规则：把「首段以 `[!TYPE]` 开头的引用块」改写成 callout。
 *
 * ⚠️ 只认**这一层**引用块的首段：`pOpen.level` 必须正好是 `open.level + 1`。
 * 少了这条，`> > [!NOTE]` 的外层也会被当成 callout（它的「首段」其实是内层引用块），
 * 于是嵌套两层引用会套出两个 `<div class="nd-callout">`，而且外层那个的标题
 * 和内层重复。
 */
function installCalloutCore(ctx: RenderFeatureContext): void {
  ctx.md.core.ruler.push('nd_callout', (state: StateCore) => {
    const tokens = state.tokens

    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]!
      if (open.type !== 'blockquote_open') continue

      const pOpen = tokens[i + 1]
      const inline = tokens[i + 2]
      if (!pOpen || pOpen.type !== 'paragraph_open') continue
      if (pOpen.level !== open.level + 1) continue
      if (!inline || inline.type !== 'inline') continue

      // 不是标记 / 未知类型 → 普通引用块，一个 token 都不动。
      const marker = parseCallOutMarker(inline.content)
      if (!marker) continue

      const closeIndex = findMatchingClose(tokens, i)
      if (closeIndex < 0) continue

      const paragraphEmptied = stripMarker(inline, marker.length)
      if (paragraphEmptied === null) continue

      // ①② 外层标签：`<blockquote>` → `<div class="nd-callout nd-callout--x">`。
      open.type = OPEN_TOKEN
      open.tag = 'div'
      open.meta = { [TYPE_META]: marker.def.type }
      const close = tokens[closeIndex]!
      close.type = CLOSE_TOKEN
      close.tag = 'div'

      // ③ 标题插在正文**前面**。正文首段已经被摘空的话，连同三个 token 一起换掉。
      const title = new state.Token(TITLE_TOKEN, '', 0)
      title.block = true
      title.level = open.level + 1
      title.meta = { [TYPE_META]: marker.def.type }
      if (paragraphEmptied) {
        // `> [!NOTE]` 后面没有正文：`paragraph_open / inline / paragraph_close`
        // 三个 token 换成一个标题，否则会留下一个空的 `<p></p>`。
        tokens.splice(i + 1, 3, title)
      } else {
        tokens.splice(i + 1, 0, title)
      }
    }
  })
}

/** 从 `start`（那个 `blockquote_open`）出发找配对的 `blockquote_close`。 */
function findMatchingClose(tokens: readonly Token[], start: number): number {
  let depth = 0
  for (let j = start; j < tokens.length; j++) {
    const token = tokens[j]!
    if (token.type === 'blockquote_open') depth++
    else if (token.type === 'blockquote_close') {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

/**
 * 把首段的 `[!TYPE]` 摘掉。
 *
 * 返回 `true` = 摘完之后**整个段落空了**（调用方把三个 token 一起换掉）；
 * 返回 `false` = 还有正文；返回 `null` = 结构不像预期，**放弃改写**（调用方当普通引用块）。
 *
 * ⚠️ 改的是 `inline.children`（**渲染用的那份**），不是 `inline.content`：
 * 渲染器只读 children。`content` 一起改是为了让后续 core 规则看到一致的原文
 * （`embed` / `link-card` 都读 `content`）。
 *
 * ⚠️ 摘完如果剩下**纯空白**，还要把紧跟的 `softbreak` 也去掉 ——
 * 否则正文会以 `<br>` 开头（`> [!NOTE]\n> 正文` 的第一个子 token 就是 softbreak）。
 */
function stripMarker(inline: Token, length: number): boolean | null {
  const children = inline.children
  const first = children?.[0]
  // 标记一定是纯文本（`[!NOTE]` 里没有能触发别的行内规则的字符）。
  // 不是的话说明我们的判定和 markdown-it 的分词不一致 —— 宁可不动。
  if (!children || !first || first.type !== 'text') return null
  if (!first.content.startsWith(inline.content.slice(0, length))) return null

  inline.content = inline.content.slice(length).replace(/^[ \t]+/, '')

  const rest = first.content.slice(length)
  if (rest.trim() === '') {
    children.shift()
    if (children[0]?.type === 'softbreak') children.shift()
  } else {
    first.content = rest.replace(/^[ \t]+/, '')
  }
  return children.length === 0
}

/** 从 token 的 meta 里取类型名，**只信表里有的值**（见文件头「安全」）。 */
function typeOf(token: Token | undefined): string {
  const raw = token?.meta?.[TYPE_META]
  if (typeof raw === 'string' && CALL_OUT_BY_TYPE.has(raw)) return raw
  return FALLBACK_TYPE
}

/**
 * 标题：`<p class="nd-callout__title">图标 + 显示名</p>`。
 *
 * 图标是**字符**（同 `embed` 的取舍：图标库要从 CDN 拉数据，离线会静默变空标签），
 * 带 `aria-hidden` —— 屏幕阅读器念一个符号没有意义，显示名已经说清楚了。
 *
 * ⚠️ `escapeHtml` 虽然对常量表来说是多余的（表是我们自己写的），但保持
 * 「所有进 HTML 的字符串都过转义」这条纪律，比记住"这个值是安全的"可靠。
 */
function renderTitle(type: string, escapeHtml: (value: string) => string): string {
  const def: CallOutType = CALL_OUT_BY_TYPE.get(type) ?? CALL_OUT_BY_TYPE.get(FALLBACK_TYPE)!
  return (
    '<p class="nd-callout__title">' +
    `<span class="nd-callout__icon" aria-hidden="true">${escapeHtml(def.glyph)}</span>` +
    `<span class="nd-callout__label">${escapeHtml(def.label)}</span>` +
    '</p>'
  )
}
