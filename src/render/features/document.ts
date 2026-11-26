import type { StateCore, Token } from 'markdown-it'
import { normalizeRenderId, scopedRenderId } from '../../shared/render-ids.js'
import { EMOJI_SHORTCODES, EMOJI_SHORTCODE_RE } from '../../shared/emoji-data.js'
import type { RenderFeature } from '../feature.js'
import { TABS_IDS_META } from './tabs.js'

interface Heading { id: string; text: string; level: number; number?: string }
interface DocumentEnv {
  idPrefix?: string
  headingNumbers?: boolean
  ndHeadings?: Heading[]
  footnotes?: { list?: Array<{ count?: number }> }
}

function headingText(children: readonly Token[]): string {
  return children.map((token) => {
    if (token.type === 'text') {
      return token.content.replace(EMOJI_SHORTCODE_RE, (whole, name: string) => EMOJI_SHORTCODES.get(name) ?? whole)
    }
    if (token.type === 'code_inline') return token.content
    if (token.type === 'image') return headingText(token.children ?? [])
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' '
    return ''
  }).join('')
}

function isToc(tokens: readonly Token[], index: number): boolean {
  return tokens[index]?.type === 'paragraph_open' &&
    tokens[index + 1]?.type === 'inline' && tokens[index + 1]!.content.trim() === '[TOC]' &&
    tokens[index + 2]?.type === 'paragraph_close'
}

export const documentFeature: RenderFeature = {
  name: 'document',
  install({ md, rules, escapeHtml }) {
    // Remove an explicit ID before inline parsing so footnotes are parsed once.
    md.core.ruler.before('inline', 'nd_heading_ids', (state) => {
      for (const [index, token] of state.tokens.entries()) {
        if (token.type !== 'heading_open') continue
        const inline = state.tokens[index + 1]
        if (inline?.type !== 'inline') continue
        const explicit = /[ \t]+\{#([^\s{}]+)\}[ \t]*$/.exec(inline.content)
        if (!explicit) continue
        inline.meta = { ...inline.meta, ndExplicitId: explicit[1] }
        inline.content = inline.content.slice(0, explicit.index)
      }
    })
    md.core.ruler.push('nd_document', (state: StateCore) => {
      const env = state.env as DocumentEnv
      const tokens = state.tokens
      const hasToc = tokens.some((_token, index) => isToc(tokens, index))
      const anchored = !!env.idPrefix || !!env.headingNumbers || hasToc
      const used = new Set<string>()
      const reserved = new Set<string>()
      const counters = Array<number>(6).fill(0)
      const headings: Heading[] = []
      const explicitBases = new Set<string>()
      for (let index = 0; index < tokens.length; index++) {
        if (tokens[index]!.type !== 'heading_open') continue
        const inline = tokens[index + 1]
        if (inline?.type !== 'inline') continue
        const explicit = inline.meta?.ndExplicitId as string | undefined
        if (explicit) explicitBases.add(scopedRenderId(env, normalizeRenderId(explicit)))
      }
      for (const [index, footnote] of (env.footnotes?.list ?? []).entries()) {
        const number = index + 1
        reserved.add(scopedRenderId(env, 'fn' + number))
        reserved.add(scopedRenderId(env, 'fnref' + number))
        const count = Math.max(1, footnote.count ?? 1)
        for (let subId = 1; subId < count; subId++) {
          reserved.add(scopedRenderId(env, 'fnref' + number + ':' + subId))
        }
      }
      for (const candidate of tokens) {
        const meta = candidate.meta
        if (!meta || typeof meta !== 'object') continue
        const tabIds: unknown = (meta as Record<string, unknown>)[TABS_IDS_META]
        if (Array.isArray(tabIds)) {
          for (const id of tabIds) if (typeof id === 'string') reserved.add(id)
        }
        for (const value of Object.values(meta as Record<string, unknown>)) {
          if (!value || typeof value !== 'object') continue
          const { prefix, images } = value as { prefix?: unknown; images?: unknown }
          if (typeof prefix !== 'string' || !Array.isArray(images)) continue
          for (const [slide] of images.entries()) reserved.add(prefix + '-' + (slide + 1))
        }
      }
      for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]!
        if (token.type !== 'heading_open') continue
        const inline = tokens[index + 1]
        if (inline?.type !== 'inline') continue
        const explicit = inline.meta?.ndExplicitId as string | undefined
        const text = headingText(inline.children ?? []).trim()
        const level = Number(token.tag.slice(1))
        counters[level - 1] = counters[level - 1]! + 1
        counters.fill(0, level)
        const number = env.headingNumbers ? counters.slice(0, level).filter(Boolean).join('.') : undefined
        let id = ''
        if (anchored || explicit) {
          const base = scopedRenderId(env, normalizeRenderId(explicit ?? text))
          id = base
          for (let duplicate = 2;
            used.has(id) || reserved.has(id) || ((!explicit || id !== base) && explicitBases.has(id));
            duplicate++
          ) {
            id = base + '-' + duplicate
          }
          used.add(id)
          token.attrSet('id', id)
        }
        if (number) token.meta = { ...token.meta, ndHeadingNumber: number }
        headings.push({ id, text, level, number })
      }
      env.ndHeadings = headings
      for (let index = 0; index < tokens.length; index++) {
        if (!isToc(tokens, index)) continue
        const toc = new state.Token('nd_toc', 'nav', 0)
        toc.block = true
        toc.map = tokens[index]!.map
        tokens.splice(index, 3, toc)
      }
    })
    rules.heading_open = (tokens, idx, options, _env, self) => {
      const html = self.renderToken(tokens, idx, options)
      const number = tokens[idx]!.meta?.ndHeadingNumber as string | undefined
      return number ? html + '<span class="nd-heading-number">' + escapeHtml(number) + '</span> ' : html
    }
    rules.nd_toc = (_tokens, _idx, _options, env) => {
      const headings = (env as DocumentEnv).ndHeadings ?? []
      return '<nav class="nd-toc" aria-label="目录"><ol>' + headings.map((heading) => {
        const label = (heading.number ? heading.number + ' ' : '') + heading.text
        return '<li class="nd-toc__level-' + heading.level + '"><a href="#' + escapeHtml(heading.id) + '">' +
          escapeHtml(label) + '</a></li>'
      }).join('') + '</ol></nav>'
    }
  },
}
