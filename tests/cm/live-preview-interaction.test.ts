import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { nexusdown } from '../../src/cm/index.js'
import { TabsWidget } from '../../src/cm/features/tabs.js'
import { editingBlock, editingRange } from '../../src/cm/plugin.js'

const views: EditorView[] = []

afterEach(() => {
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
