import type { Env, MarkdownIt, Token } from 'markdown-it'

export type MarkdownBlockKind = 'container' | 'definition-list' | 'toc' | 'footnote'

export interface MarkdownBlock {
  kind: MarkdownBlockKind
  /** Inclusive UTF-16 offset in the original source. */
  from: number
  /** Exclusive UTF-16 offset in the original source. */
  to: number
  html: string
}

export interface FootnoteDefinition {
  label: string
  map: [number, number]
  tokens: Token[]
}

interface AnalysisEnv extends Env {
  ndFootnoteDefinitions?: FootnoteDefinition[]
}

function closeIndex(tokens: readonly Token[], start: number): number {
  let depth = 0
  for (let index = start; index < tokens.length; index++) {
    depth += tokens[index]!.nesting
    if (depth === 0) return index + 1
  }
  return tokens.length
}

/** Use parser token maps so code, quotes, lists and nested blocks keep their boundaries. */
export function analyzeBlocks(md: MarkdownIt, source: string, env: AnalysisEnv): MarkdownBlock[] {
  const tokens = md.parse(source, env)
  const lines = [0]
  for (let index = 0; index < source.length; index++) {
    const character = source.charCodeAt(index)
    if (character === 13) {
      if (source.charCodeAt(index + 1) === 10) index++
      lines.push(index + 1)
    } else if (character === 10) lines.push(index + 1)
  }
  const blocks: MarkdownBlock[] = []
  const add = (kind: MarkdownBlockKind, map: [number, number], html: string): void => {
    const from = lines[map[0]] ?? 0
    const rawTo = lines[map[1]] ?? source.length
    const to = from + source.slice(from, rawTo).replace(/[ \t\r\n]+$/, '').length
    if (to > from) blocks.push({ kind, from, to, html })
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (token.level !== 0 || !token.map) continue
    let kind: MarkdownBlockKind | undefined
    if (/^container_.+_open$/.test(token.type)) kind = 'container'
    else if (token.type === 'dl_open') kind = 'definition-list'
    else if (token.type === 'nd_toc') kind = 'toc'
    if (!kind) continue
    const end = token.nesting === 1 ? closeIndex(tokens, index) : index + 1
    add(kind, token.map, md.renderer.render(tokens.slice(index, end), md.options, env))
    index = end - 1
  }
  for (const definition of env.ndFootnoteDefinitions ?? []) {
    const index = tokens.findIndex((token) => token.type === 'footnote_open' && token.meta?.label === definition.label)
    let html: string
    if (index >= 0) {
      const number = Number(tokens[index]!.meta?.id) + 1
      html = '<section class="footnotes"><ol start="' + number + '">' +
        md.renderer.render(tokens.slice(index, closeIndex(tokens, index)), md.options, env) + '</ol></section>'
    } else {
      html = '<div class="nd-footnote-definition"><span class="nd-footnote-label">' +
        md.utils.escapeHtml('[^' + definition.label + ']') + '</span>' +
        md.renderer.render(definition.tokens, md.options, env) + '</div>'
    }
    add('footnote', definition.map, html)
  }
  blocks.sort((a, b) => a.from - b.from || b.to - a.to)
  return blocks.filter((block, index) => !blocks.slice(0, index).some(
    (parent) => parent.from <= block.from && parent.to >= block.to,
  ))
}
