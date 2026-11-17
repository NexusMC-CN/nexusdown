/** Stable entity IDs, never slugs, snapshots, or arbitrary URLs. */
export interface ContentReferenceTarget {
  kind: 'resource' | 'tutorial' | 'post'
  id: string
  fragmentType?: 'section' | 'block'
  fragmentId?: string
}

export type ContentReferenceResolution =
  | { status: 'available'; kind: ContentReferenceTarget['kind']; title: string; href: string; summary?: string; targetTitle?: string }
  | { status: 'unavailable' }

export interface ContentReferenceCandidate {
  target: ContentReferenceTarget
  title: string
  summary?: string
  targetTitle?: string
}

export type ContentReferenceProvider = (request: {
  query: string
  target?: ContentReferenceTarget
  signal: AbortSignal
}) => Promise<ContentReferenceCandidate[]>

export type ContentReferenceResolutions = ReadonlyMap<string, ContentReferenceResolution>

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SYNTAX = /^\[\[(resource|tutorial|post):([A-Za-z0-9][A-Za-z0-9_-]{0,127})(?:#(section|block):([A-Za-z0-9][A-Za-z0-9_-]{0,127}))?\]\]/

/** Invalid targets are programmer errors; never emit malformed stored syntax. */
export function contentReferenceKey(target: ContentReferenceTarget): string {
  if (!target || !['resource', 'tutorial', 'post'].includes(target.kind) ||
    typeof target.id !== 'string' || !ID.test(target.id) ||
    ((target.fragmentType === undefined) !== (target.fragmentId === undefined)) ||
    (target.fragmentType !== undefined && (
      target.kind !== 'tutorial' || !['section', 'block'].includes(target.fragmentType) ||
      typeof target.fragmentId !== 'string' || !ID.test(target.fragmentId)
    ))) throw new TypeError('Invalid content reference target')
  return `${target.kind}:${target.id}${target.fragmentType ? `#${target.fragmentType}:${target.fragmentId}` : ''}`
}

export function formatContentReference(target: ContentReferenceTarget): string {
  return `[[${contentReferenceKey(target)}]]`
}

/** Bounded lexing primitive. Markdown context is checked by the inline rule. */
export function parseContentReferenceAt(source: string, from: number): { target: ContentReferenceTarget; to: number } | null {
  if (!source.startsWith('[[', from)) return null
  const match = SYNTAX.exec(source.slice(from, from + 286))
  if (!match || (match[3] && match[1] !== 'tutorial')) return null
  const target: ContentReferenceTarget = {
    kind: match[1] as ContentReferenceTarget['kind'], id: match[2]!,
    ...(match[3] ? { fragmentType: match[3] as 'section' | 'block', fragmentId: match[4]! } : {}),
  }
  return { target, to: from + match[0].length }
}

/** Reject browser URL normalization hazards as well as external URLs. */
export function safeContentReferenceHref(href: unknown): href is string {
  if (typeof href !== 'string' || !/^\/(?!\/)/.test(href) || href.includes('\\')) return false
  for (let index = 0; index < href.length; index++) {
    const code = href.charCodeAt(index)
    if (code <= 32 || (code >= 127 && code <= 159)) return false
  }
  return true
}

interface AttributeRange { from: number; to: number }
const attributeContexts = new WeakMap<object, { source: string; ranges: readonly AttributeRange[] }>()
const HTML_TAG_START = /<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])/y

/** Link each backtick run to the next equal run without rescanning suffixes. */
function inlineCodeEnds(source: string): ReadonlyMap<number, number> {
  const previous = new Map<number, number>(), ends = new Map<number, number>()
  for (let index = 0; index < source.length;) {
    if (source[index] !== '`') { index++; continue }
    const start = index
    while (source[index] === '`') index++
    const length = index - start, before = previous.get(length)
    if (before !== undefined) ends.set(before, index)
    previous.set(length, start)
  }
  return ends
}

/** Quote-aware markup boundaries, scanned once for each inline parsing context. */
function attributeRanges(source: string): AttributeRange[] {
  const ranges: AttributeRange[] = []
  const codeEnds = inlineCodeEnds(source)
  let from = -1, close = '', quote = ''
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    if (from < 0) {
      if (char === '\\') index++
      else if (char === '`') {
        const end = codeEnds.get(index)
        if (end !== undefined) index = end - 1
        else while (source[index + 1] === '`') index++
      } else if (char === '{') { from = index; close = '}' }
      else if (char === '<') {
        HTML_TAG_START.lastIndex = index
        const tag = HTML_TAG_START.exec(source)
        if (tag) { from = index; close = '>'; index += tag[0].length - 1 }
      }
    } else if (close === '}' && char === '\n') {
      // Dialect attributes are one-line suffixes; HTML attributes may span lines.
      from = -1; quote = ''
    } else if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === close) {
      ranges.push({ from, to: index + 1 }); from = -1
    }
  }
  return ranges
}

/** Exclude dialect/HTML attributes without interpreting their contents as facts. */
export function contentReferenceInsideAttribute(source: string, at: number, context: object): boolean {
  let cached = attributeContexts.get(context)
  if (!cached || cached.source !== source) {
    cached = { source, ranges: attributeRanges(source) }
    attributeContexts.set(context, cached)
  }
  let low = 0, high = cached.ranges.length
  while (low < high) {
    const mid = (low + high) >>> 1, range = cached.ranges[mid]!
    if (at < range.from) high = mid
    else if (at >= range.to) low = mid + 1
    else return true
  }
  return false
}
