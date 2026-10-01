/**
 * `link-card` —— SEO 卡片，**渲染侧**（契约：`docs/dialect-extensions.md` 第 6 节）。
 *
 * 语法：**独占一段的单个链接**（裸 URL 或 `[标题](url)`）。
 *
 * ## ★ 边界：**库绝不抓取**
 *
 * 服务端去抓用户给的任意 URL 就是 **SSRF 面** —— 内网地址、`169.254.169.254`
 * （云元数据端点）、`file:` 全都能打到。所以边界这样划：
 *
 * | 谁 | 做什么 |
 * | --- | --- |
 * | **库（这里）** | 识别「独占一段的链接」→ 从 `env.data.links` 取元数据 → 渲染卡片 |
 * | **消费方** | 抓取、缓存、超时、robots、**SSRF 防御** |
 *
 * **没有数据就完全不动 token** —— 段落照常渲染成普通 `<a>`。
 * 这是最重要的性质：**降级路径不经过本文件任何一行代码**，所以不可能因为
 * 卡片功能出问题而让链接消失。
 *
 * ## 为什么用 core 规则（和 `carousel` / `embed` 一样）
 *
 * 要把「一个段落」整体换掉，得同时吞掉 `paragraph_open` / `inline` /
 * `paragraph_close`。渲染规则是**逐个 token** 调的，`paragraph_close` 那一步
 * 没有干净的办法回头改前面已经吐出去的字符串。core 规则拿到完整 token 流，
 * 可以在渲染前直接 `splice`。
 */
import type { StateCore, Token } from 'markdown-it'

import {
  readRenderData,
  type LinkCardMeta,
  type RenderFeature,
  type RenderFeatureContext,
} from '../feature'

/** 自定义 token 类型。渲染规则挂在它上面。 */
const CARD_TOKEN = 'nd_link_card'
const CARD_META = 'ndLinkCard'

interface CardSpec {
  href: string
  meta: LinkCardMeta
}

export const linkCardFeature: RenderFeature = {
  name: 'link-card',
  install(ctx: RenderFeatureContext) {
    installCardCore(ctx)
    ctx.rules[CARD_TOKEN] = (tokens, idx, _options, _env, _self) => {
      const spec = specOf(tokens[idx])
      return spec ? renderCard(spec, ctx) : ''
    }
  },
}

/**
 * core 规则：把「独占一段的单个链接」换成 `nd_link_card`。
 *
 * ⚠️ **只有拿到元数据时才动 token。** 没数据就 `continue`，段落原样渲染 ——
 * 降级路径不碰任何东西。
 *
 * ⚠️ 只认 `level === 0` 的段落：列表项里的段落是 `hidden` 的（level ≥ 2）、
 * 块引用里的 level ≥ 1，抽掉它们的 `paragraph_open/close` 会让 `<li>` /
 * `<blockquote>` 里空一块，而且它们本来也不是「独占一段」。
 */
function installCardCore(ctx: RenderFeatureContext): void {
  ctx.md.core.ruler.push('nd_link_card', (state: StateCore) => {
    const tokens = state.tokens
    const links = readRenderData(state.env)?.links
    if (!links || links.size === 0) return

    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]
      if (!open || open.type !== 'paragraph_open' || open.level !== 0) continue

      const inline = tokens[i + 1]
      const close = tokens[i + 2]
      if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') continue

      const target = loneLink(inline)
      if (!target) continue

      /*
       * 查表用两个键：**href 优先，可见文字兜底**。
       *
       * `RenderData.links` 的 key 约定是「作者写的原样」（见 `feature.ts`）——
       * 裸 URL 时两者相同；`[标题](url)` 时消费方可能按 href 建表、也可能按
       * 原文建表，两个都试一下最省事，代价只是一次多余的 Map 查询。
       */
      const meta = links.get(target.href)?.card ?? links.get(target.text)?.card
      if (!meta) continue

      const token = new state.Token(CARD_TOKEN, '', 0)
      token.block = true
      token.meta = { [CARD_META]: { href: target.href, meta } }
      // 三个 token 换一个；`i` 落到新 token 上，下一轮 `i++` 跳过它继续扫。
      tokens.splice(i, 3, token)
    }
  })
}

/**
 * 这个 `inline` 是不是「**整段只有一条链接**」？是就返回它，不是返回 `null`。
 *
 * 判据：children 恰好是 `link_open` / `text` / `link_close` 三个，
 * 且文字非空。段落里混了任何别的字（`看这个 https://… 挺好`）都不算 ——
 * 那种情况换成卡片会把作者写的话吞掉。
 */
function loneLink(inline: Token): { href: string; text: string } | null {
  const children = inline.children
  if (!children || children.length !== 3) return null

  const [open, text, close] = children
  if (!open || !text || !close) return null
  if (open.type !== 'link_open' || text.type !== 'text' || close.type !== 'link_close') return null

  const href = open.attrGet('href')
  if (!href) return null

  /*
   * `String(href)`：markdown-it 的 `attrGet` 类型是 `string | number | null`
   * （属性值理论上可以是数字），而 `CardSpec.href` 要 `string`。
   * 显式转一次，别用 `as` —— 转错了会在这里露出来，`as` 会把它藏到运行时。
   */
  return { href: String(href), text: text.content }
}

function specOf(token: Token | undefined): CardSpec | undefined {
  const spec = token?.meta?.[CARD_META]
  return spec && typeof spec === 'object' ? (spec as CardSpec) : undefined
}

/**
 * 卡片 HTML。
 *
 * ⚠️ **所有来自外部的字段一律转义**（`ctx.escapeHtml`）：`title` / `description` /
 * `site` 都是目标网页上的文本，是**第三方可控内容**；`image` 是 URL，
 * 也必须转义后才能进属性。库不做 HTML 消毒，安全性就靠「只往文本位置插 + 转义」。
 *
 * ⚠️ `href` 用 `target="_blank" rel="noopener noreferrer nofollow"` ——
 * 和 `renderer.ts` 的 `rules.link_open` 保持一致（外链一律 nofollow，
 * 这是这个库既有的对外契约）。
 */
function renderCard(spec: CardSpec, ctx: RenderFeatureContext): string {
  const { href, meta } = spec
  const esc = ctx.escapeHtml

  /*
   * 缩略图：**必须过白名单**。
   *
   * 消费方预取时就该过滤掉 `javascript:` 之类，但库这边再挡一道 ——
   * 元数据是第三方内容，不能假设上游一定洗干净了。
   * 只放行 http(s) 与 `data:image/`（和 `src/cm/url.ts` 的策略一致）。
   */
  const image =
    meta.image && /^(https?:|data:image\/)/i.test(meta.image)
      ? `<img class="nd-card__image" src="${esc(meta.image)}" alt="" loading="lazy" decoding="async">`
      : ''

  const title = meta.title ? `<span class="nd-card__title">${esc(meta.title)}</span>` : ''
  const desc = meta.description
    ? `<span class="nd-card__desc">${esc(meta.description)}</span>`
    : ''

  /*
   * 站点名：`og:site_name` 优先，没有就退回 URL 的 hostname。
   *
   * `new URL()` 在这里是安全的 —— 渲染侧跑在 Node（有全局 URL），
   * 而 href 已经被 markdown-it 校验过（`md.validateLink`，`javascript:` 之类
   * 在解析阶段就被降级成纯文本了）。解析失败就整块省略，不抛。
   */
  let site = meta.site ?? ''
  if (!site) {
    try {
      site = new URL(href).hostname
    } catch {
      site = ''
    }
  }
  const siteEl = site ? `<span class="nd-card__site">${esc(site)}</span>` : ''

  return (
    `<a class="nd-card" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">` +
    `<span class="nd-card__body">${siteEl}${title}${desc}</span>` +
    image +
    '</a>'
  )
}
