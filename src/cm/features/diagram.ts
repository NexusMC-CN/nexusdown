import { EditorSelection, type Text } from '@codemirror/state'
import { Decoration, type EditorView, WidgetType } from '@codemirror/view'

import { parseAttrLine } from '../../shared/attrs.js'
import { renderDiagram } from '../../shared/diagram.js'
import { readFenceInfo } from '../decorate/fence.js'
import type { EditorFeature } from '../feature.js'
import { setEditingBlock, setEditingRange } from '../plugin.js'
import type { MarkdownNode } from '../types.js'
import { selectionHoversBlock, selectionTouchesLineRange } from '../util/selection.js'
import { firstChildNamed, lastChildNamed } from '../util/tree.js'
import { createWidgetId } from '../util/widget-id.js'

export function isDiagramInfo(info: string | null | undefined): boolean {
  return /^mermaid(?:\s|$)/.test(info?.trim() ?? '')
}

export class DiagramWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly to: number,
    readonly contentFrom: number,
  ) {
    super()
  }

  override eq(other: DiagramWidget): boolean {
    return this.source === other.source && this.from === other.from &&
      this.to === other.to && this.contentFrom === other.contentFrom
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'nd-diagram nd-diagram-editor'
    wrap.tabIndex = 0
    wrap.setAttribute('role', 'button')
    wrap.setAttribute('aria-label', '编辑图表源码')
    wrap.title = '点击或按 Enter 编辑图表源码'

    // A distinct prefix per mounted widget prevents accessible title IDs from crossing
    // between identical diagrams or editors on the same page.
    const result = renderDiagram(this.source, createWidgetId('nd-editor-diagram'))
    if (result) {
      wrap.innerHTML = result.svg
    } else {
      wrap.classList.add('nd-diagram-source')
      wrap.setAttribute('aria-label', '图表暂时无法渲染，编辑图表源码')
      const source = document.createElement('pre')
      source.textContent = this.source
      wrap.appendChild(source)
    }

    const reveal = (): void => {
      view.dispatch({
        selection: EditorSelection.cursor(this.contentFrom),
        effects: [
          setEditingRange.of({ from: this.from, to: this.to }),
          setEditingBlock.of(this.from),
        ],
      })
      view.focus()
    }
    wrap.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      reveal()
    })
    wrap.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      reveal()
    })
    return wrap
  }

  override ignoreEvent(): boolean {
    return false
  }
}

function tabAttrLine(doc: Text, fence: MarkdownNode | null): number | null {
  if (!fence || fence.name !== 'FencedCode') return null
  const end = doc.lineAt(Math.max(fence.from, fence.to - 1)).number
  if (end === doc.lines) return null
  return parseAttrLine(doc.line(end + 1).text)?.some(
    (attr) => attr.kind === 'key' && attr.name === 'tab',
  ) ? end + 1 : null
}

function adjacentTabs(doc: Text, left: MarkdownNode | null, right: MarkdownNode | null): boolean {
  if (!left || !right || tabAttrLine(doc, right) === null) return false
  const attrLine = tabAttrLine(doc, left)
  if (attrLine === null) return false
  const nextLine = doc.lineAt(right.from).number
  for (let line = attrLine + 1; line < nextLine; line++) {
    if (doc.line(line).text.trim()) return false
  }
  return true
}

/** A tab group owns the whole range and renders its diagram panels itself. */
function isGroupedTab(doc: Text, fence: MarkdownNode): boolean {
  if (tabAttrLine(doc, fence) === null) return false
  const previous = fence.prevSibling
  const next = fence.nextSibling
  return adjacentTabs(doc, previous, fence) || adjacentTabs(doc, previous?.prevSibling ?? null, fence) ||
    adjacentTabs(doc, fence, next) || adjacentTabs(doc, fence, next?.nextSibling ?? null)
}

export const diagramFeature: EditorFeature = {
  name: 'diagram',
  nodes: ['FencedCode'],
  block: true,
  decorate(ranges, _atomicRanges, node, doc, selection, _context, blockEditing) {
    if (!isDiagramInfo(readFenceInfo(doc, node))) return
    // A full-line replacement inside a quote/list would also hide the parent
    // markers. Keep those fences on the ordinary code editing path.
    if (node.parent?.name !== 'Document' || isGroupedTab(doc, node)) return

    const open = firstChildNamed(node, 'CodeMark')
    if (!open) return
    const openLine = doc.lineAt(open.from)
    const from = openLine.from
    const lastLine = doc.lineAt(Math.max(node.from, node.to - 1))
    const to = lastLine.to
    if (to <= from || blockEditing === from ||
      selectionTouchesLineRange(doc, selection, from, to) ||
      selectionHoversBlock(doc, selection, from, to)) return

    const close = lastChildNamed(node, 'CodeMark')
    const contentToLine = close && close.from !== open.from
      ? doc.lineAt(close.from).number - 1
      : lastLine.number
    const indent = open.from - openLine.from
    const lines: string[] = []
    for (let line = openLine.number + 1; line <= contentToLine; line++) {
      const text = doc.line(line).text
      const leadingSpaces = /^ */.exec(text)![0].length
      lines.push(text.slice(Math.min(indent, leadingSpaces)))
    }
    const contentFrom = openLine.number < lastLine.number ? doc.line(openLine.number + 1).from : openLine.to
    ranges.push(Decoration.replace({
      block: true,
      widget: new DiagramWidget(lines.join('\n'), from, to, contentFrom),
    }).range(from, to))
  },
}
