import type { StateInline, Token } from 'markdown-it'
import {
  contentReferenceKey,
  contentReferenceInsideAttribute,
  parseContentReferenceAt,
  safeContentReferenceHref,
  type ContentReferenceResolution,
  type ContentReferenceTarget,
} from '../../shared/content-reference.js'
import { readRenderData, type RenderFeature } from '../feature.js'

export const CONTENT_REFERENCE_TOKEN = 'nd_content_reference'
const CARD_TOKEN = 'nd_content_reference_card'

interface ReferenceMeta { target: ContentReferenceTarget; from: number; to: number }
const autolinkRanges = new WeakMap<StateInline, readonly { from: number; to: number }[]>()

/** The fuzzy linkify core pass runs after inline rules, so retain its URL spans. */
function insideAutolink(state: StateInline): boolean {
  if (!state.md.options.linkify) return false
  let ranges = autolinkRanges.get(state)
  if (!ranges) {
    ranges = (state.md.linkify.match(state.src) ?? [])
      .filter((match) => (match.schema !== '' || /^www\./i.test(match.raw)) && state.md.validateLink(state.md.normalizeLink(match.url)))
      .map((match) => ({ from: match.index, to: match.lastIndex }))
    autolinkRanges.set(state, ranges)
  }
  let low = 0, high = ranges.length
  while (low < high) {
    const mid = (low + high) >>> 1, range = ranges[mid]!
    if (state.pos < range.from) high = mid
    else if (state.pos >= range.to) low = mid + 1
    else return true
  }
  return false
}

function referenceRule(state: StateInline, silent: boolean): boolean {
  // Link-label lookahead must see ordinary bracket nesting. Consuming a custom
  // token in silent mode would make Markdown mistake it for a nested anchor.
  if (silent || state.linkLevel > 0) return false
  const found = parseContentReferenceAt(state.src, state.pos)
  if (!found || found.to > state.posMax) return false
  if (contentReferenceInsideAttribute(state.src, state.pos, state) || insideAutolink(state)) return false
  if (state.src[found.to] === '(' || state.src[found.to] === '[') return false
  if (!silent) {
    const token = state.push(CONTENT_REFERENCE_TOKEN, '', 0)
    token.content = state.src.slice(state.pos, found.to)
    token.meta = { target: found.target, from: state.pos, to: found.to } satisfies ReferenceMeta
  }
  state.pos = found.to
  return true
}

export function contentReferenceTargetOf(token: Token): ContentReferenceTarget | undefined {
  return (token.type === CONTENT_REFERENCE_TOKEN || token.type === CARD_TOKEN)
    ? (token.meta as ReferenceMeta | null)?.target : undefined
}

/** Shared HTML for display and editor widgets; every field remains plain text. */
export function renderContentReference(
  target: ContentReferenceTarget,
  raw: string,
  resolution: ContentReferenceResolution | undefined,
  card: boolean,
  escapeHtml: (text: string) => string,
): string {
  if (!resolution) return escapeHtml(raw)
  if (resolution.status !== 'available' || resolution.kind !== target.kind || !safeContentReferenceHref(resolution.href)) {
    return '<span class="nd-content-reference nd-content-reference--unavailable">内容不可用</span>'
  }
  const esc = escapeHtml
  const title = esc(resolution.title)
  const targetTitle = resolution.targetTitle ? `<span class="nd-content-reference${card ? '-card' : ''}__target">${esc(resolution.targetTitle)}</span>` : ''
  if (!card) return `<a class="nd-content-reference" href="${esc(resolution.href)}">${title}${targetTitle}</a>`
  // The bound limits layout work if a consumer accidentally supplies a full body.
  const summary = resolution.summary ? `<span class="nd-content-reference-card__summary">${esc(Array.from(resolution.summary).slice(0, 280).join(''))}</span>` : ''
  return `<a class="nd-content-reference-card" data-kind="${esc(target.kind)}" href="${esc(resolution.href)}"><span class="nd-content-reference-card__title">${title}</span>${targetTitle}${summary}</a>`
}

export const contentReferenceFeature: RenderFeature = {
  name: 'content-reference',
  install({ md, rules, escapeHtml }) {
    // Escape/backtick/image/link rules retain their normal parsing semantics.
    md.inline.ruler.after('link', CONTENT_REFERENCE_TOKEN, referenceRule)
    md.core.ruler.push('nd_content_reference_cards', (state) => {
      for (let i = 0; i < state.tokens.length - 2; i++) {
        const open = state.tokens[i]!
        const inline = state.tokens[i + 1]!
        const close = state.tokens[i + 2]!
        if (open.type !== 'paragraph_open' || open.level !== 0 || inline.type !== 'inline' || close.type !== 'paragraph_close') continue
        const children = (inline.children ?? []).filter((token) => token.type !== 'text' || token.content.trim() !== '')
        if (children.length !== 1 || children[0]!.type !== CONTENT_REFERENCE_TOKEN) continue
        const reference = children[0]!
        const replacement = new state.Token(CARD_TOKEN, '', 0)
        replacement.block = true
        replacement.content = reference.content
        replacement.meta = reference.meta
        replacement.map = open.map
        state.tokens.splice(i, 3, replacement)
      }
    })
    for (const type of [CONTENT_REFERENCE_TOKEN, CARD_TOKEN]) rules[type] = (tokens, index, _options, env) => {
      const token = tokens[index]!
      const target = contentReferenceTargetOf(token)!
      const resolution = readRenderData(env)?.contentReferences?.get(contentReferenceKey(target))
      const card = type === CARD_TOKEN
      const html = renderContentReference(target, token.content, resolution, card, escapeHtml)
      return card && (!resolution || resolution.status !== 'available' || !safeContentReferenceHref(resolution.href) || resolution.kind !== target.kind)
        ? `<p>${html}</p>` : html
    }
  },
}
