import { EditorSelection } from '@codemirror/state'
import { Decoration, WidgetType, type Command } from '@codemirror/view'
import type { MarkdownConfig } from '@lezer/markdown'
import MarkdownIt from 'markdown-it'
import { renderContentReference } from '../../render/features/content-reference.js'
import {
  contentReferenceInsideAttribute, contentReferenceKey, formatContentReference,
  parseContentReferenceAt, type ContentReferenceTarget,
} from '../../shared/content-reference.js'
import { pushAtomicRange } from '../decorate/shared.js'
import type { EditorFeature } from '../feature.js'
import { selectionTouchesLineRange } from '../util/selection.js'

const escapeHtml = new MarkdownIt().utils.escapeHtml

/** Native inline syntax; code, escapes, link/image labels remain their own nodes. */
export const contentReferenceMarkdown: MarkdownConfig = {
  defineNodes: ['ContentReference'],
  parseInline: [{
    name: 'ContentReference',
    before: 'Link',
    parse(context, next, pos) {
      if (next !== 91 || context.hasOpenLink) return -1
      const parsed = parseContentReferenceAt(context.text, pos - context.offset)
      if (parsed && contentReferenceInsideAttribute(context.text, pos - context.offset, context)) return -1
      if (parsed && (context.text[parsed.to] === '(' || context.text[parsed.to] === '[')) return -1
      return parsed ? context.addElement(context.elt('ContentReference', pos, context.offset + parsed.to)) : -1
    },
  }],
}

class ContentReferenceWidget extends WidgetType {
  constructor(private readonly html: string) { super() }
  override eq(other: ContentReferenceWidget): boolean { return this.html === other.html }
  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    // The shared renderer admits only fixed tags, escaped text and safe paths.
    span.innerHTML = this.html
    return span.firstElementChild as HTMLElement
  }
  override ignoreEvent(): boolean { return false }
}

export const contentReferenceEditorFeature: EditorFeature = {
  name: 'content-reference',
  nodes: ['ContentReference'],
  decorate(ranges, atomicRanges, node, doc, selection, context) {
    const raw = doc.sliceString(node.from, node.to)
    const parsed = parseContentReferenceAt(raw, 0)
    if (!parsed || parsed.to !== raw.length || selectionTouchesLineRange(doc, selection, node.from, node.to)) return
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      // Block widgets own their interiors and render through the same renderer.
      if (['Link', 'Image', 'InlineCode', 'Table', 'FencedCode', 'CodeBlock'].includes(ancestor.name)) return
    }
    const resolution = context?.contentReferences?.get(contentReferenceKey(parsed.target))
    if (!resolution) return
    const paragraph = node.parent
    const card = paragraph?.name === 'Paragraph' && paragraph.parent?.name === 'Document' && doc.sliceString(paragraph.from, paragraph.to).trim() === raw
    const html = renderContentReference(parsed.target, raw, resolution, card, escapeHtml)
    const from = card ? doc.lineAt(node.from).from : node.from
    const to = card ? paragraph!.to : node.to
    pushAtomicRange(ranges, atomicRanges, Decoration.replace({ widget: new ContentReferenceWidget(html) }), from, to)
  },
}

/** One native transaction per command, including all selections. */
export function insertContentReference(target: ContentReferenceTarget, options: { block?: boolean } = {}): Command {
  let source: string
  try { source = formatContentReference(target) } catch { return () => false }
  return (view) => {
    if (view.compositionStarted || view.composing || view.state.readOnly) return false
    const { state } = view
    const change = state.changeByRange((range) => {
      let before = '', after = ''
      if (options.block) {
        const prefix = state.sliceDoc(Math.max(0, range.from - 2), range.from)
        const suffix = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + 2))
        before = range.from === 0 ? '' : '\n'.repeat(2 - (/\n*$/.exec(prefix)?.[0].length ?? 0))
        after = range.to === state.doc.length ? '' : '\n'.repeat(2 - (/^\n*/.exec(suffix)?.[0].length ?? 0))
      }
      return {
        changes: { from: range.from, to: range.to, insert: before + source + after },
        range: EditorSelection.cursor(range.from + before.length + source.length),
      }
    })
    if (change.changes.empty) return false
    view.dispatch({ ...change, userEvent: 'input.nexusdown.content-reference' })
    return true
  }
}
