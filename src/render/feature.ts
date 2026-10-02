import type { MarkdownIt as MarkdownItInstance, RendererRule } from 'markdown-it'

/**
 * 一个**渲染侧功能模块**。
 *
 * 和编辑器侧的 `EditorFeature`（`src/cm/feature.ts`）成对：**同一个功能必须在两边各实现一次**，
 * 而且产出要对得上 —— 这是整个库存在的理由。编辑器和渲染器一旦各写各的，
 * 就会出现「编辑器写出渲染器读不出来的语法，渲染器接受编辑器写不出来的语法」。
 *
 * ## 三条必须遵守的约束
 *
 * ⚠️ **一、必须是同步的。** `renderMarkdown` 是同步函数（`index.ts`），
 * `install` 里**不能发请求、不能等 Promise**。需要外部数据的功能
 * （短链解析、SEO 卡片元数据）走 `ctx.data` —— 由消费方**预先**取好传进来。
 *
 * ⚠️ **二、不能依赖 DOM。** 渲染侧在 Node 里跑（SSR），没有 `document`。
 *
 * ⚠️ **三、转义一律用 `ctx.escapeHtml`。** 它和 `renderer.ts` 内部用的是同一个
 * （markdown-it 的 `utils.escapeHtml`），自己再写一个迟早会不一致。
 * 库不做 HTML 消毒，安全性来自「**只输出我们自己声明的标签**」——
 * 所以**绝不要把用户输入拼进标签名/属性名**，只往**文本位置**插。
 */
export interface RenderFeature {
  /** 唯一名字，和编辑器侧那个功能同名：`table` / `math` / `emoji` / `embed`。 */
  name: string

  /** 往 markdown-it 上装规则。通常只改 `ctx.rules`，需要 token 化时才用 `ctx.md`。 */
  install: (ctx: RenderFeatureContext) => void
}

export interface RenderFeatureContext {
  /** markdown-it 实例。需要自定义 token 规则时才动它。 */
  md: MarkdownItInstance

  /**
   * 渲染器规则表。改它等价于改 `md.renderer.rules` ——
   * `renderer.ts` 内部就是这么写的，保持一致。
   */
  rules: Record<string, RendererRule>

  /** 转义函数。见上面第三条。 */
  escapeHtml: (value: string) => string
}

/**
 * 从 markdown-it 的 `env` 里取外部数据。
 *
 * ## ⚠️ 为什么数据走 `env` 而不是 `install` 的参数
 *
 * `install` 只在**建解析器时**跑一次（`renderer.ts` 的 `applyNexusdownRenderer`，
 * 而且解析器还被 `resolveParser` 缓存了）；而外部数据是**每次渲染**都可能不同的。
 * 把数据烤进 `install` 会导致第二次渲染拿到第一次的数据 —— 一个很难查的缓存 bug。
 *
 * markdown-it 的渲染器规则签名是 `(tokens, idx, options, env, self)`，
 * **`env` 是每次 `md.render(src, env)` 传进来的**，所以规则里读它才是对的。
 */
export function readRenderData(env: unknown): RenderData | undefined {
  if (!env || typeof env !== 'object') return undefined
  return (env as { data?: RenderData }).data
}

/**
 * 渲染期可用的外部数据。
 *
 * ## 为什么要有这一层
 *
 * 渲染是**同步、无网络**的，但有些功能天然需要外部数据：
 *
 * - **短链**（`b23.tv/xxx`、`v.douyin.com/xxx`、`163cn.tv/xxx`）必须发请求才知道
 *   跳到哪 —— 渲染期做不到；
 * - **SEO 卡片**要抓目标页的 OG 标签 —— 同样做不到，而且**库也不该做**
 *   （服务端抓用户给的任意 URL 就是 SSRF 面：内网地址、`169.254.169.254`、
 *   `file:` …）。
 *
 * 所以边界这样划：**库只负责「拿到数据之后怎么渲染」，取数据是消费方的事。**
 * 消费方（通常在后端，那里有网络和缓存）预取好，通过 `renderMarkdown` 的
 * `data` 选项传进来。
 *
 * ## key 用「作者写的原样」
 *
 * `links` 的 key 是**作者在 Markdown 里写的那串字符**（短链就是短链的原文），
 * 因为渲染期只能做字符串匹配、不能规范化 URL。消费方在预取时按同样的原文建表即可。
 */
export interface RenderData {
  /** 原始链接文本 → 解析结果。 */
  links?: ReadonlyMap<string, LinkResolution>
}

/** 一条链接的解析结果。两个字段都可选：解析失败时留空，功能自己降级。 */
export interface LinkResolution {
  /**
   * 短链**跳转后**的最终 URL。
   *
   * 拿到它之后，嵌入类功能（B站/抖音/网易云）才能从里面提取出 ID ——
   * 这些平台分享出来的基本都是短链，ID 只在跳转后的长链里。
   */
  url?: string

  /** SEO 卡片的元数据（目标页的 OG / `<title>` / description / 缩略图）。 */
  card?: LinkCardMeta
}

/** SEO 卡片的元数据。全部可选 —— 抓不到就降级成普通链接。 */
export interface LinkCardMeta {
  title?: string
  description?: string
  /** 缩略图 URL。**必须过 URL 白名单**（消费方预取时就该过滤掉 `javascript:` 之类）。 */
  image?: string
  /** 站点名（`og:site_name`），没有就用 URL 的 hostname。 */
  site?: string
}
