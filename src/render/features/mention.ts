/**
 * `mention` —— 站内实体提及，**渲染侧**（契约：`docs/dialect-extensions.md` 第 8 节）。
 *
 * 语法：`@slug`（可选 `#fragment`）。
 *
 * ## 一个 token，两种形态（抄自 `link-card`）
 *
 * 「**独占一段 → 卡片、在句中 → 行内**」这条规则是从 `link-card` 抄的：
 * 它自己的规则就是「独占一段的链接 → 卡片」。好处是用户不用记两套语法，
 * 写作时「换个段落」就换形态。
 *
 * 两种形态由**两套机制**产出：
 *
 * - **行内**：覆盖 `rules.text`（同 `emoji`），只处理**文本 token**，
 *   所以天然跳过行内代码 / 围栏代码 —— 那些根本不是 `text` token。
 * - **卡片**：core 规则（同 `link-card`）把「整段只有一个提及」的段落换成卡片 token。
 *   core 规则拿到完整 token 流，能在渲染前 `splice` 掉 `paragraph_open` / `inline` /
 *   `paragraph_close` 三个 token —— 渲染规则是逐个 token 调的，`paragraph_close`
 *   那一步没有干净的办法回头改前面已吐出的字符串。
 *
 * ## ★ 边界：**库不查库**
 *
 * 和 `link-card` 同一条：库只认文本、从 `env.data.mentions` 取结果。
 * 查库解析 slug、落 `reference` 关系、墓碑都是**消费方**的事。
 * **没有数据就完全不动 token** —— 段落照常渲染成纯文本 `@slug`，
 * 降级路径不经过本文件任何一行代码，所以不可能因为提及功能出问题而让文本消失。
 *
 * ## ⚠️ 为什么 `rules.text` 必须**链式**覆盖
 *
 * `emoji` 已经覆盖了 `rules.text`。如果这里直接赋值，就把 emoji 的规则挤掉了
 * （`:smile:` 不再变字形）。所以先调上一个规则拿到（已转义的）文本，再在**它**里面
 * 找提及 —— `@`、slug 字符、`#` 都不在 `escapeHtml` 的转义集里，扫描结果不受影响。
 * 这样顺序就固定成「先 emoji、后 mention」，两者都不丢。
 */
import type { StateCore, Token } from 'markdown-it'

import { scanMentions, type MentionSpan } from '../../shared/mention.js'
import {
  readRenderData,
  type MentionResolution,
  type RenderFeature,
  type RenderFeatureContext,
} from '../feature'

/** 自定义 token 类型。卡片渲染规则挂在它上面。 */
const CARD_TOKEN = 'nd_mention_card'
const CARD_META = 'ndMentionCard'

/** 墓碑。契约 §8 写死的标记，**不是链接**（点了会 404）。 */
const MISSING_HTML = '<span class="nd-mention nd-mention--missing">已失效</span>'

interface CardSpec {
  href: string
  res: MentionResolution
  fragment?: string
}

export const mentionFeature: RenderFeature = {
  name: 'mention',
  install(ctx: RenderFeatureContext) {
    installCardCore(ctx)
    installInlineTextRule(ctx)
    ctx.rules[CARD_TOKEN] = (tokens, idx, _options, _env, _self) => {
      const spec = specOf(tokens[idx])
      return spec ? renderCard(spec, ctx) : ''
    }
  },
}

/**
 * core 规则：把「独占一段的单个提及」换成 `nd_mention_card`。
 *
 * ⚠️ **只有拿到解析结果时才动 token。** 没数据、或目标是墓碑（`missing`）就
 * `continue`，段落原样走 `rules.text` 的行内路径 —— 墓碑是行内形态，
 * 不是卡片（契约只说墓碑，没说卡片形态的墓碑）。
 *
 * ⚠️ 只认 `level === 0` 的段落：块引用 / 列表项里的段落 level ≥ 1，
 * 抽掉它们的 `paragraph_open/close` 会让 `<li>` / `<blockquote>` 里空一块，
 * 而且它们本来也不是「独占一段」。**编辑器侧用「父节点是 Document」对齐这条。**
 */
function installCardCore(ctx: RenderFeatureContext): void {
  ctx.md.core.ruler.push('nd_mention_card', (state: StateCore) => {
    const tokens = state.tokens
    const mentions = readRenderData(state.env)?.mentions
    if (!mentions || mentions.size === 0) return

    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]
      if (!open || open.type !== 'paragraph_open' || open.level !== 0) continue

      const inline = tokens[i + 1]
      const close = tokens[i + 2]
      if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') continue

      const target = loneMention(inline)
      if (!target) continue

      const res = mentions.get(target.slug)
      // 取不到 → 交给行内规则降级；墓碑 → 行内「已失效」。两者都不做卡片。
      if (!res || res.missing) continue

      const token = new state.Token(CARD_TOKEN, '', 0)
      token.block = true
      token.meta = {
        [CARD_META]: {
          href: res.href,
          res,
          ...(target.fragment === undefined ? {} : { fragment: target.fragment }),
        } satisfies CardSpec,
      }
      // 三个 token 换一个；`i` 落到新 token 上，下一轮 `i++` 跳过它继续扫。
      tokens.splice(i, 3, token)
    }
  })
}

/**
 * 这个 `inline` 是不是「**整段只有一个提及**」？是就返回它，不是返回 `null`。
 *
 * 判据：children 恰好是一个 `text` token，且**去掉首尾空白后**整串就是一个提及
 * （span 覆盖 `[0, len)`）。段落里混了任何别的字（`看这个 @foo 挺好`）都不算 ——
 * 那种情况换成卡片会把作者写的话吞掉。
 *
 * ⚠️ `**@foo**` / `[@foo](url)` 的 children 不是单个 `text`（有 strong / link 包裹），
 * 所以天然判成「非独占」→ 走行内。这和编辑器侧按「原始文本 trim 后是不是只有提及」
 * 判是一致的（那些写法里提及的 span 不会覆盖整串）。
 */
function loneMention(inline: Token): { slug: string; fragment?: string } | null {
  const children = inline.children
  if (!children || children.length !== 1) return null

  const text = children[0]
  if (!text || text.type !== 'text') return null

  const content = text.content.trim()
  const spans = scanMentions(content)
  if (spans.length !== 1) return null

  const span = spans[0]!
  if (span.from !== 0 || span.to !== content.length) return null
  return span.fragment === undefined ? { slug: span.slug } : { slug: span.slug, fragment: span.fragment }
}

/**
 * 行内提及：**链式**覆盖 `rules.text`。
 *
 * 先调上一个规则（`emoji` 的，或 markdown-it 默认的 `escapeHtml`）拿到已转义文本，
 * 再在它里面切出提及。普通片段**已经转义过了**，直接拼回去即可；
 * 提及那一段替换成我们构造的 HTML。
 */
function installInlineTextRule(ctx: RenderFeatureContext): void {
  const previous = ctx.rules.text

  ctx.rules.text = (tokens, idx, options, env, self) => {
    const content = tokens[idx]!.content
    // 快路径：绝大多数文本 token 没有 `@`，连上一个规则都不用调（emoji 也一样省）。
    if (content.indexOf('@') === -1) {
      return previous ? previous(tokens, idx, options, env, self) : ctx.escapeHtml(content)
    }

    const rendered = previous ? previous(tokens, idx, options, env, self) : ctx.escapeHtml(content)
    const spans = scanMentions(rendered)
    if (spans.length === 0) return rendered

    const mentions = readRenderData(env)?.mentions
    let out = ''
    let pos = 0
    for (const span of spans) {
      out += rendered.slice(pos, span.from)
      out += inlineMention(span, rendered.slice(span.from, span.to), mentions, ctx)
      pos = span.to
    }
    return out + rendered.slice(pos)
  }
}

/**
 * 一条行内提及的 HTML。
 *
 * - 取不到解析结果 → 原样输出纯文本（`text` 已是转义过的，直接返回即可）。
 * - `missing` → 墓碑，**不是链接**（契约：点了会 404）。
 * - 有结果 → 胶囊 + 显示名（**显示名来自查库，不是 slug**）。
 */
function inlineMention(
  span: MentionSpan,
  text: string,
  mentions: ReadonlyMap<string, MentionResolution> | undefined,
  ctx: RenderFeatureContext,
): string {
  const res = mentions?.get(span.slug)
  if (!res) return text
  if (res.missing) return MISSING_HTML

  const esc = ctx.escapeHtml
  return `<a class="nd-mention" href="${esc(withFragment(res.href, span.fragment))}">${esc(res.title)}</a>`
}

function specOf(token: Token | undefined): CardSpec | undefined {
  const spec = token?.meta?.[CARD_META]
  return spec && typeof spec === 'object' ? (spec as CardSpec) : undefined
}

/**
 * 卡片 HTML。
 *
 * ⚠️ **所有来自外部的字段一律转义**（`ctx.escapeHtml`）：`title` / `summary` /
 * `byline` / `badges` 都是消费方查库得到的**第三方可控内容**，`image` / `href`
 * 是 URL。库不做 HTML 消毒，安全性就靠「只往文本位置插 + 转义」。
 *
 * ⚠️ **不给 `target` / `rel`** —— 和 `link-card` 刻意不同：提及是**站内**链接
 * （`href` 是站内路径），站内跳转不该开新标签页，也不该加 `nofollow`。
 *
 * 「图标」是一个 `data-kind` 的空 span：图标由消费方 CSS 按 `kind` 画
 * （不引入图标库 / CDN —— 离线环境会静默变空标签，同 `code-header-parts.ts` 的取舍）。
 */
function renderCard(spec: CardSpec, ctx: RenderFeatureContext): string {
  const { res } = spec
  const esc = ctx.escapeHtml

  /*
   * 缩略图：**必须过白名单**。消费方查库时就该过滤，库这边再挡一道 ——
   * 只放行 http(s) 与 `data:image/`，和 `link-card` 对缩略图的策略一致。
   */
  const image =
    res.image && /^(https?:|data:image\/)/i.test(res.image)
      ? `<img class="nd-mention-card__image" src="${esc(res.image)}" alt="" loading="lazy" decoding="async">`
      : ''

  const icon = `<span class="nd-mention-card__icon" data-kind="${esc(res.kind)}" aria-hidden="true"></span>`
  const title = `<span class="nd-mention-card__title">${esc(res.title)}</span>`
  const summary = res.summary ? `<span class="nd-mention-card__summary">${esc(res.summary)}</span>` : ''
  const byline = res.byline ? `<span class="nd-mention-card__byline">${esc(res.byline)}</span>` : ''
  const badges =
    res.badges && res.badges.length > 0
      ? `<span class="nd-mention-card__badges">${res.badges
          .map((badge) => `<span class="nd-mention-card__badge">${esc(badge)}</span>`)
          .join('')}</span>`
      : ''

  return (
    `<a class="nd-mention-card" href="${esc(withFragment(res.href, spec.fragment))}" data-kind="${esc(res.kind)}">` +
    icon +
    `<span class="nd-mention-card__body">${title}${summary}${byline}</span>` +
    badges +
    image +
    '</a>'
  )
}

/**
 * 把 `#fragment` 拼到站内路径上。
 *
 * `fragment` 只含 `[a-z0-9-]`（扫描器保证），拼进去是安全的。
 * `href` 自己已经带 `#` 时不拼 —— 再拼一个 `#` 会造出错误的锚点。
 */
function withFragment(href: string, fragment: string | undefined): string {
  if (!fragment || href.includes('#')) return href
  return `${href}#${fragment}`
}
