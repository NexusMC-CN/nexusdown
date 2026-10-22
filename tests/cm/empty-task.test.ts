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
  ])('renders %s as a checkbox when the line is not active', (source, checked) => {
    // 文末补一段，让光标不在任务行上（揭示态会把复选框换回原文 `[ ]`）。
    const doc = `${source}

尾部`
    const view = mount(doc)
    const checkbox = view.dom.querySelector<HTMLInputElement>('.nd-task-checkbox')

    expect(checkbox).not.toBeNull()
    expect(checkbox?.checked).toBe(checked)
    expect(view.state.doc.toString()).toBe(doc)
  })

  it.each([
    ['- [ ]', false],
    ['- [x]', true],
  ])('reveals %s as raw source when the line is active', (source, _checked) => {
    const view = mount(source)
    expect(view.dom.querySelector('.nd-task-checkbox')).toBeNull()
    expect(view.state.doc.toString()).toBe(source)
  })
})
