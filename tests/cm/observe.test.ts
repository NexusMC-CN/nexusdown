import { undo, undoDepth, redoDepth } from '@codemirror/commands'
import { StateEffect } from '@codemirror/state'
import { afterEach, describe, expect, it } from 'vitest'
import * as cm from '../../src/cm/index.js'
import type { EditorView } from '../../src/cm/index.js'

const views: EditorView[] = []

function editor(doc = 'abc', extensions?: cm.Extension) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = cm.mountEditor({ parent, doc, extensions })
  views.push(view)
  return view
}

function observe(view: EditorView, listener: () => void) {
  expect(cm).toHaveProperty('observeEditorUpdates', expect.any(Function))
  return (cm as typeof cm & {
    observeEditorUpdates: (view: EditorView, listener: () => void) => () => void
  }).observeEditorUpdates(view, listener)
}

afterEach(() => {
  views.splice(0).forEach(view => view.destroy())
  document.body.replaceChildren()
})

describe('observeEditorUpdates', () => {
  it('installs one update bridge across repeated subscriptions on the same view', () => {
    let appendConfigs = 0
    const view = editor('abc', cm.EditorView.updateListener.of(update => {
      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          if (effect.is(StateEffect.appendConfig)) appendConfigs++
        }
      }
    }))
    let notifications = 0
    for (let index = 0; index < 25; index++) {
      const stop = observe(view, () => notifications++)
      view.dispatch({ selection: { anchor: index % 3 } })
      stop()
    }

    expect(appendConfigs).toBe(1)
    expect(notifications).toBe(25)
    expect(view.state.doc.toString()).toBe('abc')
    expect(undoDepth(view.state)).toBe(0)
  })

  it('observes real document edits, selections and external replacements', () => {
    const view = editor()
    const changes: { doc: string; anchor: number }[] = []
    observe(view, () => changes.push({ doc: view.state.doc.toString(), anchor: view.state.selection.main.anchor }))

    expect(changes).toEqual([])
    view.dispatch({ changes: { from: 3, insert: 'd' } })
    expect(changes).toEqual([{ doc: 'abcd', anchor: 0 }])
    view.dispatch({ selection: { anchor: 2 } })
    expect(changes.at(-1)).toEqual({ doc: 'abcd', anchor: 2 })
    expect(changes).toHaveLength(2)

    cm.setEditorValue(view, 'next draft')
    expect(changes.at(-1)?.doc).toBe('next draft')
  })

  it('keeps subscriptions independent when they use the same callback', () => {
    const view = editor()
    let notifications = 0
    const listener = () => notifications++
    const stopFirst = observe(view, listener)
    const stopSecond = observe(view, listener)
    notifications = 0
    view.dispatch({ selection: { anchor: 1 } })
    expect(notifications).toBe(2)
    stopFirst()
    notifications = 0
    view.dispatch({ selection: { anchor: 2 } })
    expect(notifications).toBe(1)
    stopSecond()
    view.dispatch({ selection: { anchor: 0 } })
    expect(notifications).toBe(1)
  })

  it('unsubscribes independently without changing the document or undo stack', () => {
    const view = editor()
    view.dispatch({ changes: { from: 3, insert: 'd' }, userEvent: 'input.type' })
    const history = [undoDepth(view.state), redoDepth(view.state)]
    let first = 0
    let second = 0
    const stopFirst = observe(view, () => first++)
    const stopSecond = observe(view, () => second++)
    first = second = 0

    expect(view.state.doc.toString()).toBe('abcd')
    expect([undoDepth(view.state), redoDepth(view.state)]).toEqual(history)
    stopFirst()
    first = second = 0
    view.dispatch({ selection: { anchor: 1 } })
    expect(first).toBe(0)
    expect(second).toBe(1)
    stopFirst()
    stopSecond()

    expect(view.state.doc.toString()).toBe('abcd')
    expect([undoDepth(view.state), redoDepth(view.state)]).toEqual(history)
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('abc')
    expect(first).toBe(0)
  })

  it('isolates updates and disposal across editor instances', () => {
    const first = editor('first')
    const second = editor('second')
    const seen: string[] = []
    observe(first, () => seen.push('first'))
    const stopSecond = observe(second, () => seen.push('second'))

    first.dispatch({ selection: { anchor: 1 } })
    second.dispatch({ selection: { anchor: 1 } })
    expect(seen).toEqual(['first', 'second'])
    stopSecond()
    seen.length = 0
    first.dispatch({ selection: { anchor: 2 } })
    second.dispatch({ selection: { anchor: 2 } })
    expect(seen).toEqual(['first'])
  })

  it('makes cleanup safe and idempotent after the view has been destroyed', () => {
    const view = editor()
    const stop = observe(view, () => { throw new Error('disposed observer was notified') })
    view.destroy()
    // A destroyed host must never receive another transaction during child cleanup.
    view.dispatch = () => { throw new Error('dispatch after destroy') }
    expect(() => { stop(); stop() }).not.toThrow()
  })
})
