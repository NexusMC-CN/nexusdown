import footnote from 'markdown-it-footnote'
import { scopedRenderId } from '../../shared/render-ids.js'
import type { RenderFeature } from '../feature.js'
import type { FootnoteDefinition } from '../markdown-blocks.js'

export const footnoteFeature: RenderFeature = {
  name: 'footnote',
  install({ md, rules, escapeHtml }) {
    md.use(footnote)
    md.core.ruler.before('footnote_tail', 'nd_footnote_definitions', (state) => {
      const definitions: FootnoteDefinition[] = []
      for (let index = 0; index < state.tokens.length; index++) {
        const token = state.tokens[index]!
        if (token.type !== 'footnote_reference_open' || token.level !== 0) continue
        const body = []
        let first = Number.POSITIVE_INFINITY
        let last = 0
        for (index += 1; index < state.tokens.length && state.tokens[index]!.type !== 'footnote_reference_close'; index++) {
          const child = state.tokens[index]!
          body.push(child)
          if (child.map) {
            first = Math.min(first, child.map[0]!)
            last = Math.max(last, child.map[1]!)
          }
        }
        if (Number.isFinite(first)) definitions.push({
          label: String(token.meta?.label ?? ''),
          map: [first, last],
          tokens: body,
        })
      }
      ;(state.env as { ndFootnoteDefinitions?: FootnoteDefinition[] }).ndFootnoteDefinitions = definitions
    })
    rules.footnote_ref = (tokens, idx, _options, env) => {
      const meta = tokens[idx]!.meta as { id: number; subId: number }
      const number = meta.id + 1
      const suffix = meta.subId > 0 ? ':' + meta.subId : ''
      const id = escapeHtml(scopedRenderId(env, 'fn' + number))
      const ref = escapeHtml(scopedRenderId(env, 'fnref' + number + suffix))
      return '<sup class="footnote-ref"><a href="#' + id + '" id="' + ref + '" role="doc-noteref">[' + number + ']</a></sup>'
    }
    rules.footnote_block_open = () => '<hr class="footnotes-sep"/><section class="footnotes" role="doc-endnotes"><ol class="footnotes-list">'
    rules.footnote_block_close = () => '</ol></section>'
    rules.footnote_open = (tokens, idx, _options, env) => {
      const number = (tokens[idx]!.meta as { id: number }).id + 1
      return '<li id="' + escapeHtml(scopedRenderId(env, 'fn' + number)) + '" class="footnote-item">'
    }
    rules.footnote_close = () => '</li>'
    rules.footnote_anchor = (tokens, idx, _options, env) => {
      const meta = tokens[idx]!.meta as { id: number; subId: number }
      const suffix = meta.subId > 0 ? ':' + meta.subId : ''
      const id = escapeHtml(scopedRenderId(env, 'fnref' + (meta.id + 1) + suffix))
      return ' <a href="#' + id + '" class="footnote-backref" role="doc-backlink" aria-label="返回脚注引用">↩︎</a>'
    }
  },
}
