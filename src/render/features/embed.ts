/** Shared, synchronous provider recognition. Rendering never creates an iframe. */
import type { StateCore } from 'markdown-it'
import { readRenderData, type RenderFeature, type RenderFeatureContext } from '../feature.js'

export type EmbedProvider = 'bilibili' | 'douyin' | 'netease'
export type EmbedKind = 'video' | 'song' | 'playlist'
export interface EmbedSpec {
  provider: EmbedProvider
  kind: EmbedKind
  id: string
  src: string
  url?: string
}
const SHORT_LINK_HOSTS = new Set(['b23.tv', 'v.douyin.com', '163cn.tv'])

/** Reject credentials, unusual ports, controls and browser URL repair tricks. */
export function mediaUrl(raw: string): URL | null {
  const text = raw.trim()
  if (!text || /[\s\\]/.test(text) || [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)
  if (scheme && !/^https?$/i.test(scheme[1]!)) return null
  try {
    const url = new URL(scheme ? text : `https://${text.replace(/^\/\//, '')}`)
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.port ? url : null
  } catch { return null }
}
export function buildSpec(provider: string, kind: string, id: string): EmbedSpec | null {
  if (provider === 'bilibili' && kind === 'video' && /^(?:BV[0-9A-Za-z]{10}|av[1-9]\d{0,19})$/.test(id)) {
    const query = id.startsWith('av') ? `aid=${id.slice(2)}` : `bvid=${id}`
    return { provider, kind, id, src: `//player.bilibili.com/player.html?${query}&autoplay=0` }
  }
  if (provider === 'douyin' && kind === 'video' && /^\d{15,20}$/.test(id)) return { provider, kind, id, src: `https://open.douyin.com/player/video?vid=${id}&autoplay=0` }
  if (provider === 'netease' && (kind === 'song' || kind === 'playlist') && /^\d{1,20}$/.test(id)) return { provider, kind, id, src: `//music.163.com/outchain/player?type=${kind === 'song' ? 2 : 0}&id=${id}&auto=0&height=${kind === 'song' ? 66 : 430}` }
  return null
}
export function embedUrl(spec: EmbedSpec): string {
  if (spec.url) return spec.url
  if (spec.provider === 'bilibili') return `https://www.bilibili.com/video/${spec.id}`
  if (spec.provider === 'douyin') return `https://www.douyin.com/video/${spec.id}`
  return `https://music.163.com/${spec.kind}?id=${spec.id}`
}
export function parseEmbedUrl(raw: string): EmbedSpec | null {
  const url = mediaUrl(raw)
  if (!url) return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  let spec: EmbedSpec | null = null
  if (host === 'bilibili.com' || host === 'm.bilibili.com') {
    const match = /^\/video\/(BV[0-9A-Za-z]{10}|av[1-9]\d{0,19})\/?$/.exec(url.pathname)
    if (!match) return null
    spec = buildSpec('bilibili', 'video', match[1]!)
    if (!spec) return null
    const page = url.searchParams.get('p')
    const time = url.searchParams.get('t')
    if (page && /^[1-9]\d{0,3}$/.test(page)) spec.src += `&p=${page}`
    if (time && /^\d{1,7}(?:\.\d{1,3})?$/.test(time)) spec.src += `&t=${time}`
  } else if (host === 'douyin.com') {
    const match = /^\/video\/(\d{15,20})\/?$/.exec(url.pathname)
    if (match) spec = buildSpec('douyin', 'video', match[1]!)
  } else if (host === 'music.163.com') {
    const route = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url
    const kind = /^\/song\/?$/.test(route.pathname) ? 'song' : /^\/playlist\/?$/.test(route.pathname) ? 'playlist' : null
    if (kind) spec = buildSpec('netease', kind, route.searchParams.get('id') ?? '')
  }
  return spec ? { ...spec, url: url.href } : null
}
export function isShortLink(raw: string): boolean {
  const url = mediaUrl(raw)
  return !!url && SHORT_LINK_HOSTS.has(url.hostname.toLowerCase())
}
export function resolveEmbedFromText(text: string, env?: unknown): EmbedSpec | null {
  const raw = text.trim()
  const direct = parseEmbedUrl(raw)
  if (direct) return direct
  if (!isShortLink(raw)) return null
  const resolved = readRenderData(env)?.links?.get(raw)?.url
  return resolved ? parseEmbedUrl(resolved) : null
}
export function parseEmbedFence(info: string | null | undefined, env?: unknown): EmbedSpec | null {
  const parts = info?.trim().split(/\s+/) ?? []
  if (parts[0] !== 'embed') return null
  if (parts.length === 2) return resolveEmbedFromText(parts[1]!, env)
  return parts.length === 4 ? buildSpec(parts[1]!, parts[2]!, parts[3]!) : null
}
export function embedTitle(spec: EmbedSpec): string {
  const label = spec.provider === 'bilibili' ? '哔哩哔哩' : spec.provider === 'douyin' ? '抖音' : '网易云音乐'
  return `${label} · ${spec.kind === 'song' ? '单曲' : spec.kind === 'playlist' ? '歌单' : '视频'} ${spec.id}`
}
export function embedGlyph(spec: EmbedSpec): string { return spec.provider === 'netease' ? '♪' : '▶' }
function renderEmbedHtml(spec: EmbedSpec, original: string, ctx: RenderFeatureContext): string {
  const esc = ctx.escapeHtml
  const href = mediaUrl(original)?.href ?? embedUrl(spec)
  return `<div class="nd-embed nd-embed--${spec.provider}" data-nd-embed="${spec.provider}:${spec.kind}" data-nd-embed-url="${esc(href)}" data-nd-embed-canonical="${esc(embedUrl(spec))}">` +
    `<button type="button" class="nd-embed__placeholder" data-nd-embed-load><span class="nd-embed__icon" aria-hidden="true">${embedGlyph(spec)}</span><span class="nd-embed__label">${esc(embedTitle(spec))}</span><span class="nd-embed__hint">点击加载</span></button>` +
    `<a class="nd-embed__source" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">打开原站</a></div>`
}
export const embedFeature: RenderFeature = {
  name: 'embed',
  install(ctx) {
    const baseFence = ctx.rules.fence
    ctx.rules.fence = (tokens, idx, options, env, self) => {
      const info = ctx.md.utils.unescapeAll(tokens[idx]!.info ?? '').trim()
      const spec = parseEmbedFence(info, env)
      const parts = info.split(/\s+/)
      if (!spec && parts.length === 2 && parts[0] === 'embed' && isShortLink(parts[1]!)) {
        const href = ctx.escapeHtml(mediaUrl(parts[1]!)!.href)
        return `<p class="nd-link-fallback"><a href="${href}" target="_blank" rel="noopener noreferrer nofollow">打开原链接</a></p>`
      }
      if (!spec) return baseFence ? baseFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
      return renderEmbedHtml(spec, parts.length === 2 ? parts[1]! : embedUrl(spec), ctx)
    }
    ctx.rules.nd_embed = (tokens, idx) => {
      const meta = tokens[idx]?.meta as { spec: EmbedSpec; original: string } | undefined
      return meta ? renderEmbedHtml(meta.spec, meta.original, ctx) : ''
    }
    ctx.md.core.ruler.push('nd_embed_link', (state: StateCore) => {
      for (let i = 0; i < state.tokens.length; i++) {
        const open = state.tokens[i]!
        if (open.type !== 'paragraph_open' || open.level !== 0) continue
        if (/(?:^|\s)nd-(?:no-card|card)(?:\s|$)/.test(String(open.attrGet('class') ?? ''))) continue
        const inline = state.tokens[i + 1]
        if (inline?.type !== 'inline' || state.tokens[i + 2]?.type !== 'paragraph_close') continue
        const spec = resolveEmbedFromText(inline.content, state.env)
        if (!spec) continue
        const token = new state.Token('nd_embed', '', 0)
        token.block = true
        token.meta = { spec, original: inline.content.trim() }
        state.tokens.splice(i, 3, token)
      }
    })
  },
}
