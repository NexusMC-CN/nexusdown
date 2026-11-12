import { syntaxTree } from '@codemirror/language'
import { isolateHistory } from '@codemirror/commands'
import type { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { embedUrl, parseEmbedFence, parseEmbedUrl, isShortLink } from '../render/features/embed.js'
import { parseAttrLine, formatAttrLine, type AttrToken } from '../shared/attrs.js'
import type { LinkResolution } from '../render/feature.js'
import MarkdownIt from 'markdown-it'

export type LinkDisplayMode = 'link' | 'card' | 'embed'
export type ResolveLinks = (urls: string[], options: { signal: AbortSignal }) => Promise<Record<string, LinkResolution>>
export interface LinkEditTarget {
  doc: Text
  from: number
  to: number
  url: string
  label: string
  mode: LinkDisplayMode
  block: boolean
  attrs: readonly AttrToken[]
  title?: string
}

function safeLinkInput(raw: string): boolean {
  if (!raw || /[\s\\]/.test(raw) || [...raw].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false
  if (/^(?:\/(?!\/)|\.\.?\/|#|\?)/.test(raw)) return true
  try {
    const url = new URL(raw)
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
  } catch { return false }
}

export function extractLinkUrl(text: string): string | null {
  const trimmed = text.trim()
  const matches = trimmed.match(/https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+/gi)
  if (matches?.length !== 1) {
    if (matches?.length) return null
    if (/^(?:www\.|music\.163\.com\/)/i.test(trimmed)) return safeLinkInput(`https://${trimmed}`) ? `https://${trimmed}` : null
    return safeLinkInput(trimmed) ? trimmed : null
  }
  let raw = matches[0]!.replace(/[.,;!]+$/, '')
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (raw.endsWith(close!) && raw.split(close!).length > raw.split(open!).length) raw = raw.slice(0, -1)
  }
  return safeLinkInput(raw) ? raw : null
}

const linkParser = new MarkdownIt({ html: false, linkify: true })
function existingLink(source: string, document = ''): { url: string; label: string; title?: string } | null {
  if (source.startsWith('[') || source.startsWith('<')) {
    const env = {}
    if (document) linkParser.parse(document, env)
    const children = linkParser.parseInline(source, env)[0]?.children ?? []
    if (children[0]?.type === 'link_open' && children[children.length - 1]?.type === 'link_close' && children.filter(token => token.type === 'link_open').length === 1) {
      const url = String(children[0].attrGet('href') ?? '')
      const title = String(children[0].attrGet('title') ?? '') || undefined
      const label = /^\[([\s\S]*)\]\(/.exec(source)?.[1] ?? /^\[([\s\S]*)\]\[[^\]]*\]$/.exec(source)?.[1] ?? /^\[([\s\S]*)\]$/.exec(source)?.[1] ?? ''
      return {url, label, title}
    }
  }
  const url = extractLinkUrl(source)
  return url && !/\s/.test(source.trim()) ? { url, label: '' } : null
}

/** Snapshot the source and range before moving focus into the insertion panel. */
export function captureLinkEditTarget(view: EditorView): LinkEditTarget {
  const { state } = view
  const range = state.selection.main
  const target: LinkEditTarget = { doc: state.doc, from: range.from, to: range.to, url: '', label: state.sliceDoc(range.from, range.to), mode: 'link', block: false, attrs: [] }
  let node = syntaxTree(state).resolveInner(range.head, range.head === 0 ? 1 : -1)
  while (node.parent && !['FencedCode', 'Paragraph', 'Link', 'Autolink'].includes(node.name)) node = node.parent
  if (node.name === 'FencedCode') {
    const first = state.doc.lineAt(node.from)
    const info = first.text.replace(/^\s*(?:`{3,}|~{3,})/, '').trim()
    const parts = info.split(/\s+/)
    const spec = parseEmbedFence(info)
    if (parts[0] === 'embed' && (parts.length === 2 || spec)) {
      return { ...target, from: node.from, to: node.to, url: parts.length === 2 ? parts[1]! : embedUrl(spec!), label: '', mode: 'embed', block: true }
    }
  }
  if (['Paragraph', 'Link', 'Autolink'].includes(node.name)) {
    // Prefer the entire standalone paragraph, so its mode suffix is replaced too.
    const paragraph = node.name === 'Paragraph' ? node : node.parent?.name === 'Paragraph' ? node.parent : null
    if (paragraph) {
      const source = state.sliceDoc(paragraph.from, paragraph.to).split('\n')
      const suffix = source.length === 2 ? parseAttrLine(source[1]!) : null
      const parsed = suffix ? existingLink(source[0]!.trimEnd(), state.doc.toString()) : null
      if (parsed && suffix?.some(attr => attr.kind === 'class' && ['card', 'no-card'].includes(attr.name))) {
        return { ...target, from: paragraph.from, to: paragraph.to, url: parsed.url, label: parsed.label, block: true,
          mode: suffix.some(attr => attr.kind === 'class' && attr.name === 'card') ? 'card' : 'link',
          attrs: suffix.filter(attr => !(attr.kind === 'class' && ['card', 'no-card'].includes(attr.name))), title: parsed.title }
      }
    }
    const candidate = paragraph && existingLink(state.sliceDoc(paragraph.from, paragraph.to), state.doc.toString()) ? paragraph : node
    const parsed = existingLink(state.sliceDoc(candidate.from, candidate.to), state.doc.toString())
    if (parsed) {
      target.from = candidate.from
      target.to = candidate.to
      target.url = parsed.url
      target.label = parsed.label
      target.title = parsed.title
      target.block = candidate.name === 'Paragraph'
      if (target.block) {
        let line = state.doc.lineAt(candidate.to).number + 1
        if (line <= state.doc.lines && !state.doc.line(line).text.trim()) line++
        const suffix = line <= state.doc.lines ? state.doc.line(line) : null
        const attrs = suffix ? parseAttrLine(suffix.text) : null
        if (attrs) {
          target.attrs = attrs.filter(attr => !(attr.kind === 'class' && ['card', 'no-card'].includes(attr.name)))
          target.mode = attrs.some(attr => attr.kind === 'class' && attr.name === 'card') ? 'card' : 'link'
          target.to = suffix!.to
        } else if (parseEmbedUrl(parsed.url) && !parsed.label) target.mode = 'embed'
      }
      return target
    }
  }
  const start = state.doc.lineAt(range.from)
  const end = state.doc.lineAt(range.to)
  target.block = range.from === start.from && range.to === end.to
  return target
}

export function applyLinkEdit(view: EditorView, target: LinkEditTarget, input: string, mode: LinkDisplayMode, resolution?: LinkResolution): boolean {
  if (view.state.readOnly || view.state.doc !== target.doc) return false
  const url = extractLinkUrl(input)
  if (!url || (mode === 'embed' && !parseEmbedUrl(url) && !(isShortLink(url) && parseEmbedUrl(resolution?.url ?? '')))) return false
  const label = target.label || url
  const destination = url.replace(/\(/g, '%28').replace(/\)/g, '%29')
  const block = target.block || mode !== 'link'
  const title = target.title ? ` "${target.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : ''
  let source = mode === 'embed' ? `\x60\x60\x60embed ${url}\n\x60\x60\x60` : `[${label}](${destination}${title})`
  if (block && mode !== 'embed') {
    source += '\n\n' + formatAttrLine([...target.attrs, { kind: 'class', name: mode === 'card' ? 'card' : 'no-card' }])
  }
  if (block) {
    const before = view.state.sliceDoc(0, target.from)
    const after = view.state.sliceDoc(target.to)
    if (before && !before.endsWith('\n\n')) source = (before.endsWith('\n') ? '\n' : '\n\n') + source
    if (after && !after.startsWith('\n\n')) source += after.startsWith('\n') ? '\n' : '\n\n'
  }
  view.dispatch({ changes: { from: target.from, to: target.to, insert: source }, selection: { anchor: target.from + source.length }, annotations: isolateHistory.of('full'), userEvent: 'input.link' })
  return true
}
