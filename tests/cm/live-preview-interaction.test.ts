import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { nexusdown } from '../../src/cm/index.js'
import { TabsWidget } from '../../src/cm/features/tabs.js'
import { editingBlock, editingRange, setEditingRange } from '../../src/cm/plugin.js'

const views: EditorView[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

function mount(doc: string, cursor = 0) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [nexusdown({
        mathRenderer: { renderToString: (tex) => `<span>${tex}</span>` },
      })],
    }),
  })
  views.push(view)
  return view
}

describe('live preview interaction', () => {
  it.each(['click', 'shift-click', 'drag'] as const)('keeps %s coordinates stable when closing source', (action) => {
    const doc = 'intro\n\n| a | b |\n| - | - |\n| c | d |\n\nclicked line\nlater line'
    const from = doc.indexOf('|')
    const to = doc.indexOf('\n\nclicked line')
    const target = doc.indexOf('clicked line')
    const later = doc.indexOf('later line')
    const view = mount(doc, from)
    view.dispatch({ effects: setEditingRange.of({ from, to }) })
    view.focus()

    // jsdom has no layout. Supply only the coordinate lookup: once the source
    // block closes, the same screen point falls on a different document line.
    const atPoint = ({ y }: { y: number }) =>
      y >= 120 || !view.state.field(editingRange) ? later : target
    vi.spyOn(view, 'posAtCoords').mockImplementation(atPoint)
    vi.spyOn(view, 'posAndSideAtCoords').mockImplementation((point) => ({ pos: atPoint(point), assoc: 1 }))
    const clicked = [...view.contentDOM.querySelectorAll('.cm-line')]
      .find((line) => line.textContent === 'clicked line')!

    clicked.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, clientY: 100,
      shiftKey: action === 'shift-click',
    }))
    if (action === 'drag') {
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true, buttons: 1, clientX: 100, clientY: 120,
      }))
    }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))

    expect(view.state.selection.main.anchor).toBe(action === 'shift-click' ? from : target)
    expect(view.state.selection.main.head).toBe(action === 'drag' ? later : target)
    expect(view.state.field(editingRange)).toBeNull()
    if (action === 'shift-click') expect(view.dom.querySelector('.nd-table')).toBeNull()
    else expect(view.dom.querySelector('.nd-table')).not.toBeNull()
  })

  it.each(['```', '~~~~', '````'])('clicking later %s tabs places the cursor in the selected code', (marker) => {
    const source = [
      `${marker}bash`,
      'first-command',
      marker,
      '{tab="Ubuntu"}',
      '',
      `${marker}bash`,
      'second-command',
      marker,
      '{tab="macOS"}',
      '',
      `${marker}bash`,
      'third-command',
      marker,
      '{tab="Windows"}',
    ].join('\n')
    const doc = `intro\n\n${source}\n\noutro`
    const from = doc.indexOf(marker)
    const view = mount(doc)
    const widget = new TabsWidget(source, from, from + source.length).toDOM(view)
    const panels = widget.querySelectorAll('.nd-tabs__panel')
    expect(panels).toHaveLength(3)

    panels[1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    expect(view.state.selection.main.head).toBe(doc.indexOf('second-command'))
    expect(view.state.field(editingRange)).toEqual({ from, to: from + source.length })

    panels[2]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(view.state.selection.main.head).toBe(doc.indexOf('third-command'))
  })

  it('keeps shorter fence markers inside the selected code panel', () => {
    const source = [
      '````markdown',
      '```js',
      'first-command',
      '```',
      '````',
      '{tab="A"}',
      '',
      '````bash',
      'second-command',
      '````',
      '{tab="B"}',
    ].join('\n')
    const doc = `intro\n\n${source}\n\noutro`
    const from = doc.indexOf('````')
    const view = mount(doc)
    const widget = new TabsWidget(source, from, from + source.length).toDOM(view)

    widget.querySelectorAll('.nd-tabs__panel')[1]!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    expect(view.state.selection.main.head).toBe(doc.indexOf('second-command'))
  })

  it('does not group tagged fences across an ordinary paragraph', () => {
    const doc = [
      'intro', '',
      '```bash', 'first-command', '```', '{tab="A"}', '',
      'an ordinary paragraph', '',
      '```bash', 'second-command', '```', '{tab="B"}', '',
      'outro',
    ].join('\n')
    const view = mount(doc)

    expect(view.dom.querySelector('.nd-tabs-block')).toBeNull()
    expect(view.contentDOM.textContent).toContain('an ordinary paragraph')
  })

  it('clicking a formula reveals its source when the cursor is already on the blank line before it', () => {
    const doc = 'intro\n\n$$x^2$$\n\noutro'
    const from = doc.indexOf('$$')
    const view = mount(doc, from - 1)
    const formula = view.dom.querySelector('.nd-math-block')
    expect(formula).not.toBeNull()

    formula!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    expect(view.state.field(editingBlock)).toBe(from)
    expect(view.dom.querySelector('.nd-math-block')).toBeNull()
    expect(view.contentDOM.textContent).toContain('$$x^2$$')
  })

  it('focuses the editor when a formula is clicked after an outside input', () => {
    const view = mount('intro\n\n$$x^2$$\n\noutro')
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()
    expect(view.hasFocus).toBe(false)

    view.dom.querySelector('.nd-math-block')!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )

    expect(view.hasFocus).toBe(true)
    expect(document.activeElement).toBe(view.contentDOM)
  })
})
