/**
 * `embed` —— 第三方嵌入（B站 / 抖音 / 网易云）。渲染侧。
 *
 * 契约：`docs/dialect-extensions.md` 第 4 节。
 *
 * ## 这个文件是「embed 方言」的**单一来源**
 *
 * 三家的差异只有两样：**ID 正则**和**iframe src 模板**。契约要求「做成一张表」，
 * 所以表在这里，**编辑器侧 `src/cm/features/embed.ts` 反过来 import 本文件**。
 *
 * ⚠️ 为什么表放在**渲染侧**而不是 `src/cm/features/embed.ts`：
 * 渲染侧必须在 **Node/SSR、无 DOM、且没装 CodeMirror** 的环境下能跑 ——
 * `@codemirror/view` 是**可选 peer 依赖**。如果表放编辑器侧，渲染侧一 import
 * 就会把 CodeMirror 拉进 SSR 依赖图（没装的消费方直接 import 失败）。
 * 本文件只依赖 `markdown-it` 的**类型**（`import type`，编译期擦除）和纯函数
 * `readRenderData`，所以两个方向都安全。
 *
 * 反过来方向（渲染 → 编辑器）是仓库里已有的约定：`render/renderer.ts` 就 import 了
 * `cm/widgets/code-header-parts.js`。这里只是把方向反过来，原因就是上面那条。
 *
 * ## 安全底线（契约原文）
 *
 * **ID 必须过正则校验后才拼进 URL** —— iframe 的 src **永远由我们用模板构造**，
 * **绝不放用户给的 URL**。所以：
 *
 * - `buildSpec` 是唯一的构造入口，ID 不过 `idPattern` 就返回 `null`；
 * - 所有 URL 都来自 `PROVIDERS` 里的**字面模板**，用户输入只落在 `{id}` 一个槽位，
 *   而那个槽位只可能匹配 `[0-9A-Za-z]`（见各家正则）；
 * - 链接自动识别也**不直接用**用户给的 URL 当 src —— 只从里面**提取 ID**，
 *   再走同一套模板。
 *
 * ## 点击才加载：能做到哪一步（如实说明）
 *
 * 契约要求「默认点击才加载（防首屏第三方追踪）」，且**不引入运行时 JS**。
 * 这里用 `<details>/<summary>` 做纯 CSS 的「点击展开」。
 *
 * ⚠️ **但「点击前绝不发请求」在纯 HTML/CSS 下做不到，这是硬限制，不是没写好：**
 *
 * - 按 WHATWG 规范，`<iframe>` 在**插入文档时**（post-connection steps →
 *   `process the iframe attributes` → *Navigate*）就会创建 child navigable 并开始
 *   导航，**与元素是否被渲染无关** —— 所以 `display:none`、闭合的 `<details>`
 *   都不构成「不加载」的规范保证。
 * - `loading="lazy"`（契约要求带上）**只在启用 JS 时**才推迟加载（MDN 明说是
 *   反跟踪措施），而且只推迟到「接近视口」，不是「到点击」。
 * - 因此纯 CSS 方案的**真实行为依浏览器而定**：闭合 `<details>` 内的 iframe
 *   可能被推迟、也可能在插入时就被抓取。**本机无浏览器可实测，标「未验证」。**
 *
 * 结论：`<details>` 给出的是**UI 上的**点击展开 + `loading="lazy"` 的尽力而为；
 * 要**保证**点击前不加载，必须由消费方加一小段 JS（本库不带运行时，见契约）。
 *
 * ## iframe 属性（每一条的来源）
 *
 * 四个属性都**逐字照契约**写。已用 MDN `<iframe>` 文档核对语义：
 *
 * - `sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"`
 *   —— MDN 确认：`allow-scripts` 允许内嵌文档执行脚本，`allow-same-origin`
 *   让内嵌文档保留自己的源（否则被当作恒失败的特殊源，播放器读写 storage/cookie
 *   会挂），`allow-popups` 允许开新窗口（分享按钮），`allow-presentation` 允许投屏。
 *   ⚠️ MDN 有一条警告：**当内嵌文档与嵌入页同源时**，`allow-scripts` +
 *   `allow-same-origin` 会让内嵌文档**移除自己的 sandbox**。这里内嵌的是
 *   `player.bilibili.com` / `music.163.com` 这类**第三方源**，与嵌入页不同源，
 *   所以那条警告不适用 —— 这两个 token 是播放器正常工作的必要条件。
 * - `allow="fullscreen; autoplay"`
 *   —— MDN 确认 `allow` 是 Permissions Policy（旧写法 `allowfullscreen` 被重定义为
 *   `allow="fullscreen *"`）。`fullscreen` / `autoplay` 都是合法的策略特性名。
 *   ⚠️ MDN 该页**没有**给出 `"fullscreen; autoplay"` 这个字面示例，具体字符串
 *   以契约为准（**字符串形式未在 MDN 逐字核对**）。
 * - `referrerpolicy="strict-origin-when-cross-origin"`
 *   —— MDN 确认这是**浏览器默认值**：同源发完整 URL，跨源只发 origin，降级不发。
 *   显式写出来是为了不依赖浏览器默认。
 * - `loading="lazy"`
 *   —— MDN 确认：把加载推迟到接近视口；**仅在启用 JS 时生效**。
 */
import type { StateCore } from 'markdown-it'

import { readRenderData, type RenderFeature, type RenderFeatureContext } from '../feature.js'

/** 支持的平台。 */
export type EmbedProvider = 'bilibili' | 'douyin' | 'netease'

/** 支持的嵌入类型。同一个 provider 可以有多种 kind（网易云有 song / playlist）。 */
export type EmbedKind = 'video' | 'song' | 'playlist'

/**
 * 一条**已校验**的嵌入描述。
 *
 * 只有 `buildSpec` 能造出它 —— 拿到 `EmbedSpec` 就等于「ID 已过正则、src 已构造好」，
 * 下游不需要再校验。
 */
export interface EmbedSpec {
  provider: EmbedProvider
  kind: EmbedKind
  /** **已过 `idPattern`** 的 ID。 */
  id: string
  /** iframe 的 src —— 永远由模板构造，绝不含用户给的 URL。 */
  src: string
}

/**
 * ID 的硬上限。
 *
 * ⚠️ 各家的 `idPattern` 本身已经把长度限死了（最长的是抖音/网易云的 20），
 * 这一条是**纵深防御**：万一以后有人把某个 `idPattern` 改成不封顶的 `\d+`，
 * 这里还能兜住「一条几万位的 ID 撑出一个巨大 URL」。任务书明确要求「超长 → 拒绝」。
 */
const MAX_ID_LENGTH = 20

/** 一家平台的一个 `(provider, kind)` 组合。 */
interface ProviderDef {
  readonly provider: EmbedProvider
  readonly kind: EmbedKind
  /** 展示名（占位卡用）。 */
  readonly label: string
  /** 类型名（占位卡用）。 */
  readonly kindLabel: string
  /** 占位卡图标。用字符而不是图标库：`iconify-icon` 要从 CDN 拉数据，离线会变空标签。 */
  readonly glyph: string
  /**
   * ID 的**整串**匹配正则（锚定 `^…$`）。
   *
   * ⚠️ 网易云的契约写的是 `\d+`（不封顶）。这里收紧成 `\d{1,20}` —— 依据是任务书
   * 明确的「超长 → 拒绝」。20 位对歌曲/歌单 ID 已经绰绰有余（真实值都是个位数到
   * 十位），收紧不会误伤正常内容。
   */
  readonly idPattern: RegExp
  /** src 模板。`{id}` 是唯一被替换的槽位。 */
  readonly src: (id: string) => string
}

/**
 * ★ **唯一的 provider 表。** 契约第 4 节那张表就是它。
 *
 * 模板逐字照契约；`//` 开头的两条（bilibili / netease）是**协议相对 URL** ——
 * 契约就是这么写的。⚠️ 这意味着在 `file://` 或非 http(s) 页面下它们会解析失败，
 * 但那是契约的选择（跟随页面协议，避免 https 页面里混 http 的混合内容警告）。
 */
const PROVIDERS: readonly ProviderDef[] = [
  {
    provider: 'bilibili',
    kind: 'video',
    label: '哔哩哔哩',
    kindLabel: '视频',
    glyph: '▶',
    idPattern: /^BV[0-9A-Za-z]{10}$/,
    src: (id) => `//player.bilibili.com/player.html?bvid=${id}&autoplay=0`,
  },
  {
    provider: 'douyin',
    kind: 'video',
    label: '抖音',
    kindLabel: '视频',
    glyph: '▶',
    idPattern: /^\d{15,20}$/,
    src: (id) => `https://open.douyin.com/player/video?vid=${id}&autoplay=0`,
  },
  {
    provider: 'netease',
    kind: 'song',
    label: '网易云音乐',
    kindLabel: '单曲',
    glyph: '♪',
    idPattern: /^\d{1,20}$/,
    src: (id) => `//music.163.com/outchain/player?type=2&id=${id}&auto=0&height=66`,
  },
  {
    provider: 'netease',
    kind: 'playlist',
    label: '网易云音乐',
    kindLabel: '歌单',
    glyph: '♪',
    idPattern: /^\d{1,20}$/,
    src: (id) => `//music.163.com/outchain/player?type=0&id=${id}&auto=0&height=430`,
  },
]

const KEY = (provider: string, kind: string): string => `${provider}:${kind}`

const BY_KEY = new Map<string, ProviderDef>(PROVIDERS.map((def) => [KEY(def.provider, def.kind), def]))

/** 短链域名 —— 渲染期解不了，只能走 `RenderData.links`。 */
const SHORT_LINK_HOSTS: ReadonlySet<string> = new Set(['b23.tv', 'v.douyin.com', '163cn.tv'])

/** iframe 属性常量。见文件头「iframe 属性（每一条的来源）」。 */
const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation'
const IFRAME_ALLOW = 'fullscreen; autoplay'
const IFRAME_REFERRER_POLICY = 'strict-origin-when-cross-origin'

/**
 * 造一条 `EmbedSpec`。**这是唯一的构造入口**，也是安全闸门。
 *
 * 返回 `null` 的三种情况：provider/kind 不在表里、ID 为空或超长、ID 不过正则。
 * 调用方一律**降级**（编辑器交回普通围栏、渲染交回 `baseFence`），绝不抛。
 */
export function buildSpec(provider: string, kind: string, id: string): EmbedSpec | null {
  const def = BY_KEY.get(KEY(provider, kind))
  if (!def) return null
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return null
  // ⚠️ 锚定匹配，用 `test` 前不需要 `lastIndex`（正则不带 `g`）。
  if (!def.idPattern.test(id)) return null
  return { provider: def.provider, kind: def.kind, id, src: def.src(id) }
}

/**
 * 解析围栏 info：`embed <provider> <kind> <id>`。
 *
 * ⚠️ **必须恰好四段**。多一段（`embed bilibili video BV1xx411c7mD extra`）就说明
 * 作者写了他以为有意义的东西 —— 与其猜，不如返回 `null` 让上层降级成普通代码块，
 * 作者一眼就能看到自己写错了。
 */
export function parseEmbedFence(info: string | null | undefined): EmbedSpec | null {
  if (!info) return null
  const parts = info.trim().split(/\s+/)
  if (parts.length !== 4 || parts[0] !== 'embed') return null
  return buildSpec(parts[1]!, parts[2]!, parts[3]!)
}

/**
 * 把作者贴的一行**长链**解析成 `EmbedSpec`；不是已知平台就返回 `null`。
 *
 * 只认长链（`bilibili.com/video/BV…` 这类），短链见 `isShortLink` / `resolveEmbedFromText`。
 *
 * ## 为什么用 `URL` 而不是正则拼串
 *
 * 用 `new URL` 拿到结构化的 `hostname` / `pathname` / `searchParams`，比正则稳：
 * 正则要同时处理 scheme 有无、`//` 前缀、query 顺序、大小写，很容易写出能被绕过的
 * 模式（比如把 host 匹配写成子串匹配，`evil-bilibili.com` 就混进来了）。
 * `URL` 是 Node 与浏览器都有的**全局对象**（不是 DOM API），渲染侧用它不违反「无 DOM」。
 *
 * ⚠️ 提取出来的只有 **ID**；src 仍由模板构造 —— 用户给的 URL 本身**永远不进输出**。
 */
export function parseEmbedUrl(raw: string): EmbedSpec | null {
  const parsed = toUrl(raw)
  if (!parsed) return null

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const path = parsed.pathname

  if (host === 'bilibili.com') {
    const match = /^\/video\/(BV[0-9A-Za-z]{10})$/.exec(path)
    return match ? buildSpec('bilibili', 'video', match[1]!) : null
  }
  if (host === 'douyin.com') {
    const match = /^\/video\/(\d{15,20})$/.exec(path)
    return match ? buildSpec('douyin', 'video', match[1]!) : null
  }
  if (host === 'music.163.com') {
    const kind = path === '/song' ? 'song' : path === '/playlist' ? 'playlist' : null
    if (!kind) return null
    const id = parsed.searchParams.get('id')
    return id ? buildSpec('netease', kind, id) : null
  }
  return null
}

/** 是不是已知平台的**短链**（`b23.tv` / `v.douyin.com` / `163cn.tv`）。 */
export function isShortLink(raw: string): boolean {
  const parsed = toUrl(raw)
  return parsed !== null && SHORT_LINK_HOSTS.has(parsed.hostname.toLowerCase())
}

/**
 * 把「独占一段的文本」解析成 `EmbedSpec`。
 *
 * 两条路：
 * 1. 长链 → 直接 `parseEmbedUrl`；
 * 2. 短链 → 从 `readRenderData(env)` 拿消费方**预先解析**的结果，再从跳转后的
 *    长链里提 ID。**拿不到就返回 `null`**（降级成普通链接，不报错）。
 *
 * ⚠️ 短链在渲染期解不了是**设计**，不是缺陷：渲染是同步、无网络的，发请求会让
 * 整条 SSR 链路变异步；而且「服务端抓用户给的任意 URL」本身就是 SSRF 面。
 * 所以取数据是消费方的事，见 `RenderData` 的注释。
 */
export function resolveEmbedFromText(text: string, env: unknown): EmbedSpec | null {
  const raw = text.trim()
  if (!raw) return null

  const direct = parseEmbedUrl(raw)
  if (direct) return direct

  if (!isShortLink(raw)) return null
  // key 用「作者写的原样」—— 消费方在预取时按同样的原文建表（见 `RenderData`）。
  const resolved = readRenderData(env)?.links?.get(raw)?.url
  return resolved ? parseEmbedUrl(resolved) : null
}

/** 占位卡的标题：`哔哩哔哩 · 视频 BV1xx411c7mD`。编辑器侧也用它，保证两侧一致。 */
export function embedTitle(spec: EmbedSpec): string {
  const def = BY_KEY.get(KEY(spec.provider, spec.kind))!
  return `${def.label} · ${def.kindLabel} ${spec.id}`
}

/** 占位卡图标。 */
export function embedGlyph(spec: EmbedSpec): string {
  return BY_KEY.get(KEY(spec.provider, spec.kind))!.glyph
}

/** 补协议后交给 `URL` 解析；不是 http(s)（或压根不是 URL）就返回 `null`。 */
function toUrl(raw: string): URL | null {
  const text = raw.trim()
  if (!text) return null

  /*
   * ⚠️ 只放行 http(s) 与「无 scheme」。
   *
   * 补协议只是为了能解析：作者常写 `www.bilibili.com/…` 或 `//bilibili.com/…`。
   * 但如果作者写的是 `ftp://www.bilibili.com/…`，`URL` 依然能解出
   * hostname=`www.bilibili.com` —— 不拦的话就会被当成 embed。这里显式拒掉
   * 非 http(s) 的 scheme（顺带把 `javascript:` 之类也挡在门外）。
   *
   * ⚠️ 补出来的协议**不会**进输出：src 由模板构造。
   */
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text)
  if (scheme && !/^https?$/i.test(scheme[1]!)) return null

  try {
    const withScheme = scheme ? text : `https://${text.replace(/^\/\//, '')}`
    return new URL(withScheme)
  } catch {
    return null
  }
}

export const embedFeature: RenderFeature = {
  name: 'embed',
  install(ctx) {
    installEmbedFence(ctx)
    installEmbedTokenRule(ctx)
    installEmbedLink(ctx)
  },
}

/**
 * 围栏：` ```embed bilibili video BV… `。
 *
 * ⚠️ **不能直接覆盖 `rules.fence`** —— 那是 `renderer.ts` 给普通代码块装的标题栏
 * 规则，覆盖掉所有代码块都会遭殃。这里和 `features/math.ts` 一样**包一层**：
 * 只有 `info` 能解析成 embed 才走 embed，其余原样交回 `baseFence`。
 * 非法 embed（provider/kind/id 不对）也走 `baseFence` —— 和编辑器侧「降级成普通
 * 代码块」是同一个决定，两侧行为因此一致。
 */
function installEmbedFence(ctx: RenderFeatureContext): void {
  const baseFence = ctx.rules.fence

  ctx.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!
    // `info` 是开围栏后的自由文本，和 `renderer.ts` / `features/math.ts` 同一套取法。
    const info = token.info ? ctx.md.utils.unescapeAll(token.info).trim() : ''
    const spec = parseEmbedFence(info)
    if (!spec) {
      return baseFence
        ? baseFence(tokens, idx, options, env, self)
        : self.renderToken(tokens, idx, options)
    }
    return renderEmbedHtml(spec, ctx.escapeHtml)
  }
}

/** 链接自动识别的 token 类型。 */
const EMBED_TOKEN = 'nd_embed'

/** `token.meta` 里放 `EmbedSpec` 的键。 */
const EMBED_META = 'ndEmbed'

/**
 * 链接自动识别：**独占一段**的一行链接 → embed。
 *
 * ## 为什么用 core 规则而不是渲染规则
 *
 * 要把「一个段落」整体换掉，得同时吞掉 `paragraph_open` / `inline` / `paragraph_close`
 * 三个 token。渲染规则是**逐个 token** 调用的，`paragraph_close` 那一步没有干净的
 * 办法回头改前面已经吐出去的字符串。core 规则拿到的是**完整 token 流**，可以在
 * 渲染之前直接 `splice` 掉这三个 token、换成一个自包含的块级 token。
 *
 * ## 只认「独占一段」
 *
 * 判断依据是 `inline.content.trim()` **整串**等于一个已知平台链接 —— 因为
 * `parseEmbedUrl` 是锚定的，段落里只要还有别的字就匹配不上。所以
 * `看这个 https://www.bilibili.com/video/BV… 很好` 不会被误转。
 *
 * ⚠️ 用 `inline.content`（原始文本）而不是 `inline.children`：`linkify` 会把
 * `https://…` 变成 `link_open` + `text` + `link_close`，而无 scheme 的
 * `music.163.com/song?id=…` 根本不会被 linkify。两条路下 `content` 都是原样的
 * 那串 URL，用 `content` 才能一条逻辑覆盖两种写法。
 */
function installEmbedLink(ctx: RenderFeatureContext): void {
  ctx.md.core.ruler.push('nd_embed_link', (state: StateCore) => {
    const tokens = state.tokens

    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]!
      if (open.type !== 'paragraph_open') continue
      const inline = tokens[i + 1]
      const close = tokens[i + 2]
      if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') continue

      const spec = resolveEmbedFromText(inline.content, state.env)
      if (!spec) continue

      const token = new state.Token(EMBED_TOKEN, '', 0)
      token.block = true
      token.meta = { [EMBED_META]: spec }
      // 三个 token 换一个，`i` 落到新 token 上；下一轮 `i++` 跳过它继续扫。
      tokens.splice(i, 3, token)
    }
  })
}

/**
 * 渲染一段 embed。**围栏和链接两条路都走这里** —— 产出因此逐字一致。
 *
 * ⚠️ 所有插进 HTML 的东西都过 `escapeHtml`：`title` 含作者写的 id（虽已过正则，
 * 但转义是结构性保证），`src` 含 `&`（模板里的 `?bvid=…&autoplay=0`）必须变成
 * `&amp;` 才是合法 HTML。
 *
 * ⚠️ 类名/属性名里的 `provider` / `kind` 来自**固定枚举**，不是用户输入 ——
 * 用户输入（id）只出现在**文本位置**和**已构造好的 src 的值位置**。
 */
function renderEmbedHtml(spec: EmbedSpec, escapeHtml: (value: string) => string): string {
  return (
    `<div class="nd-embed nd-embed--${spec.provider}" data-nd-embed="${spec.provider}:${spec.kind}">` +
    '<details class="nd-embed__gate">' +
    '<summary class="nd-embed__placeholder">' +
    `<span class="nd-embed__icon" aria-hidden="true">${embedGlyph(spec)}</span>` +
    `<span class="nd-embed__label">${escapeHtml(embedTitle(spec))}</span>` +
    '<span class="nd-embed__hint">点击加载</span>' +
    '</summary>' +
    `<iframe class="nd-embed__frame" src="${escapeHtml(spec.src)}" ` +
    `sandbox="${IFRAME_SANDBOX}" allow="${IFRAME_ALLOW}" ` +
    `referrerpolicy="${IFRAME_REFERRER_POLICY}" loading="lazy"></iframe>` +
    '</details>' +
    '</div>'
  )
}

/** 给 `rules.nd_embed` 用：从 token 上取回 spec。 */
function specOfToken(token: { meta: Record<string, unknown> | null } | undefined): EmbedSpec | undefined {
  const meta = token?.meta
  if (!meta) return undefined
  const spec = meta[EMBED_META]
  return spec && typeof spec === 'object' ? (spec as EmbedSpec) : undefined
}

/** 注册 `nd_embed` 的渲染规则。放在 `install` 里单独一步，便于和 fence 那条对照阅读。 */
function installEmbedTokenRule(ctx: RenderFeatureContext): void {
  ctx.rules[EMBED_TOKEN] = (tokens, idx) => {
    const spec = specOfToken(tokens[idx])
    return spec ? renderEmbedHtml(spec, ctx.escapeHtml) : ''
  }
}
