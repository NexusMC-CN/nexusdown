import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { nexusdown } from '../../src/cm/index.js'
import { editingRange } from '../../src/cm/plugin.js'

const views: EditorView[] = []
const SOURCE = '```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```'
const DOC = `${SOURCE}\n\n尾段`

function mount(doc = DOC, cursor = doc.length): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [nexusdown()],
    }),
  })
  views.push(view)
  return view
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

describe('Pele diagram live preview', () => {
  it('renders a mermaid fence as one SVG block in the default editor', () => {
    const view = mount()

    expect(view.dom.querySelectorAll('.nd-diagram svg')).toHaveLength(1)
    expect(view.dom.querySelector('.nd-diagram')?.textContent).toContain('开始')
    expect(view.dom.querySelector('.nd-code-header')).toBeNull()
    expect(view.state.doc.toString()).toBe(DOC)
  })

  it('reveals and focuses the exact diagram source when clicked', () => {
    const view = mount()
    const diagram = view.dom.querySelector('.nd-diagram')!
    expect(diagram).not.toBeNull()

    diagram.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))

    expect(view.dom.querySelector('.nd-diagram')).toBeNull()
    expect(view.state.field(editingRange)).toEqual({ from: 0, to: SOURCE.length })
    expect(view.state.selection.main.head).toBe(DOC.indexOf('flowchart'))
    expect(view.hasFocus).toBe(true)
    expect(view.state.doc.toString()).toBe(DOC)
  })

  it.each(['Enter', ' '])('opens diagram source with the %j key', (key) => {
    const view = mount()
    const diagram = view.dom.querySelector<HTMLElement>('.nd-diagram')!
    diagram.focus()
    diagram.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

    expect(view.state.selection.main.head).toBe(DOC.indexOf('flowchart'))
    expect(view.state.field(editingRange)).toEqual({ from: 0, to: SOURCE.length })
    expect(view.hasFocus).toBe(true)
  })

  it('reveals source for keyboard selection and renders edits when the cursor leaves', () => {
    const view = mount()
    const label = DOC.indexOf('开始')
    view.dispatch({ selection: EditorSelection.cursor(label) })
    expect(view.dom.querySelector('.nd-diagram')).toBeNull()

    view.dispatch({ changes: { from: label, to: label + 2, insert: '启动' } })
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) })

    expect(view.dom.querySelectorAll('.nd-diagram svg')).toHaveLength(1)
    expect(view.dom.querySelector('.nd-diagram')?.textContent).toContain('启动')
  })

  it('leaves ordinary code, embed and math fences on their existing paths', () => {
    const doc = `${SOURCE}\n\n\`\`\`js\nconst answer = 42\n\`\`\`\n\n\`\`\`math\nx^2\n\`\`\`\n\n\`\`\`embed bilibili video BV1xx411c7mD\n\`\`\`\n\n尾段`
    const view = mount(doc)

    expect(view.dom.querySelectorAll('.nd-diagram svg')).toHaveLength(1)
    expect(view.dom.querySelectorAll('.nd-code-header')).toHaveLength(2)
    expect(view.dom.querySelector('.nd-embed-card')).not.toBeNull()
  })

  it('preserves the existing SVG DOM when an unrelated cursor moves', () => {
    const view = mount()
    const svg = view.dom.querySelector('.nd-diagram svg')
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length - 1) })

    expect(svg).not.toBeNull()
    expect(view.dom.querySelector('.nd-diagram svg')).toBe(svg)
  })

  it('gives repeated diagrams and separate editors distinct SVG IDs', () => {
    const accessible = SOURCE.replace('flowchart LR', 'flowchart LR\naccTitle: 流程图\naccDescr: 从开始到结束')
    const first = mount(`${accessible}\n\n${accessible}\n\n尾段`)
    const second = mount(`${accessible}\n\n尾段`)
    const diagrams = [...first.dom.querySelectorAll('.nd-diagram svg'), ...second.dom.querySelectorAll('.nd-diagram svg')]
    expect(diagrams).toHaveLength(3)
    const ids = diagrams.flatMap((svg) => [...svg.querySelectorAll('[id]')].map((element) => element.id))

    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(['~~~', '````'])('supports %s fences and leading indentation', (marker) => {
    const view = mount(`  ${marker}mermaid\n  flowchart LR\n    A[开始] --> B[结束]\n  ${marker}\n\n尾段`)

    expect(view.dom.querySelectorAll('.nd-diagram svg')).toHaveLength(1)
    expect(view.dom.querySelector('.nd-diagram')?.textContent).toContain('开始')
  })

  it('keeps unsupported diagrams readable and safely editable', () => {
    const source = 'unsupportedDiagram\n<script>alert(1)</script>'
    const doc = `\`\`\`mermaid\n${source}\n\`\`\`\n\n尾段`
    const view = mount(doc)
    const fallback = view.dom.querySelector('.nd-diagram-source')!

    expect(fallback.textContent).toBe(source)
    expect(fallback.querySelector('script')).toBeNull()
    fallback.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(view.state.selection.main.head).toBe(doc.indexOf('unsupportedDiagram'))
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('lets tabs own the whole group and opens the selected diagram panel source', () => {
    const doc = `${SOURCE}\n{tab="一"}\n\n${SOURCE}\n{tab="二"}\n\n尾段`
    const view = mount(doc)
    const panels = view.dom.querySelectorAll('.nd-tabs__panel')

    expect(panels).toHaveLength(2)
    expect(view.dom.querySelector('.nd-diagram-editor')).toBeNull()
    expect(panels[1]!.querySelector('svg')).not.toBeNull()
    panels[1]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

    expect(view.state.selection.main.head).toBe(doc.indexOf('flowchart', SOURCE.length))
    expect(view.state.doc.toString()).toBe(doc)
    expect(view.hasFocus).toBe(true)
  })

  it('renders a single diagram with a tab attribute without losing it to grouping', () => {
    const view = mount(`${SOURCE}\n{tab="唯一"}\n\n尾段`)

    expect(view.dom.querySelectorAll('.nd-diagram-editor svg')).toHaveLength(1)
    expect(view.dom.querySelector('.nd-tabs')).toBeNull()
  })

  it('isolates diagram IDs and radio selections between tab widgets at identical positions', () => {
    const accessible = SOURCE.replace('flowchart LR', 'flowchart LR\naccTitle: 流程图\naccDescr: 从开始到结束')
    const source = `${accessible}\n{tab="一"}\n\n${accessible}\n{tab="二"}\n\n尾段`
    const first = mount(source)
    const second = mount(source)
    const diagrams = [...first.dom.querySelectorAll('.nd-diagram svg'), ...second.dom.querySelectorAll('.nd-diagram svg')]
    expect(diagrams).toHaveLength(4)
    const ids = diagrams.flatMap((svg) => [...svg.querySelectorAll('[id]')].map((element) => element.id))
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)

    const firstRadios = first.dom.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    const secondRadios = second.dom.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    expect(firstRadios[0]!.name).not.toBe(secondRadios[0]!.name)
    first.dom.querySelectorAll<HTMLLabelElement>('.nd-tabs__bar label')[1]!.click()
    expect(firstRadios[1]!.checked).toBe(true)
    expect(secondRadios[0]!.checked).toBe(true)

    first.dispatch({ selection: EditorSelection.cursor(first.state.doc.length - 1) })
    expect(first.dom.querySelectorAll('input[type="radio"]')[1]).toBe(firstRadios[1])
    expect(firstRadios[1]!.checked).toBe(true)
  })

  it('does not replace quoted or list-contained fences across their container markers', () => {
    const doc = '> ```mermaid\n> flowchart LR\n> A --> B\n> ```\n\n- item\n\n  ```mermaid\n  flowchart LR\n  C --> D\n  ```\n\n尾段'
    const view = mount(doc)

    expect(view.dom.querySelector('.nd-diagram')).toBeNull()
    expect(view.state.doc.toString()).toBe(doc)
    expect(view.contentDOM.textContent).toContain('flowchart LR')
  })
})
