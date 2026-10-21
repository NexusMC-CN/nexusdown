import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { nexusdown } from '../../src/cm/index.js'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

function mount(source: string): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [nexusdown()],
    }),
  })
  views.push(view)
  return view
}

describe('empty task list items', () => {
  it.each([
    ['- [ ]', false],
    ['- [x]', true],
  ])('renders %s as a checkbox without trailing whitespace', (source, checked) => {
    const view = mount(source)
    const checkbox = view.dom.querySelector<HTMLInputElement>('.nd-task-checkbox')

    expect(checkbox).not.toBeNull()
    expect(checkbox?.checked).toBe(checked)
    expect(view.state.doc.toString()).toBe(source)
  })
})
