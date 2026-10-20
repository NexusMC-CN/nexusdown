import { history, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, type ViewPlugin } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { decorateInline } from '../../src/cm/decorate/inline.js'
import { HIDE } from '../../src/cm/decorate/shared.js'
import { nexusdownLivePreview, type LivePreviewPluginValue } from '../../src/cm/plugin.js'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function mount() {
  const doc = 'plain\n\n**bold**\n\ntail'
  const plugin = nexusdownLivePreview({ decorators: { inline: decorateInline } }) as ViewPlugin<LivePreviewPluginValue>
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement('div')),
    state: EditorState.create({ doc, extensions: [markdown(), history(), plugin] }),
  })
  views.push(view)
  const instance = view.plugin(plugin)!
  let composing = false
  let started = false
  vi.spyOn(view, 'composing', 'get').mockImplementation(() => composing)
  vi.spyOn(view, 'compositionStarted', 'get').mockImplementation(() => started)
  return {
    view,
    instance,
    compose: (active: boolean, hasChange = active) => { started = active; composing = hasChange },
  }
}

function hidden(view: EditorView, instance: LivePreviewPluginValue) {
  const spans: Array<[number, number, string]> = []
  instance.decorations.between(0, view.state.doc.length, (from, to, value) => {
    if (value === HIDE) spans.push([from, to, view.state.sliceDoc(from, to)])
  })
  return spans
}

describe('live preview during IME composition', () => {
  it('preserves the final DOM composition commit before refreshing decorations', async () => {
    const plugin = nexusdownLivePreview({ decorators: { inline: decorateInline } })
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement('div')),
      state: EditorState.create({ doc: 'plain', extensions: [markdown(), plugin] }),
    })
    views.push(view)
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const text = view.contentDOM.querySelector('.cm-line')!.firstChild as Text
    text.data = 'plainn'
    await Promise.resolve()
    expect(view.state.doc.toString()).toBe('plainn')
    expect(view.composing).toBe(true)

    text.data = 'plain你'
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(view.state.doc.toString()).toBe('plain你')
    expect(view.contentDOM.textContent).toBe('plain你')
  })

  it('maps hidden markers and atomic ranges through composing edits and undo', () => {
    const { view, instance, compose } = mount()
    const build = vi.spyOn(instance, 'build')
    compose(true)

    expect(() => view.dispatch({
      changes: { from: 0, insert: '中文' },
      userEvent: 'input.type.compose',
    })).not.toThrow()

    expect(build).not.toHaveBeenCalled()
    expect(hidden(view, instance)).toEqual([[9, 11, '**'], [15, 17, '**']])
    const atomic: Array<[number, number]> = []
    instance.atomicDecorations.between(0, view.state.doc.length, (from, to) => { atomic.push([from, to]) })
    expect(atomic).toEqual([[9, 11], [15, 17]])

    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('plain\n\n**bold**\n\ntail')
    expect(hidden(view, instance)).toEqual([[7, 9, '**'], [13, 15, '**']])
    expect(build).not.toHaveBeenCalled()
  })

  it('refreshes postponed formatting when composition ends without another transaction', async () => {
    const { view, instance, compose } = mount()
    compose(true)
    view.dispatch({ changes: { from: 0, insert: '**中**' }, userEvent: 'input.type.compose' })
    expect(view.contentDOM.querySelector('.cm-line .nd-strong')?.textContent).not.toBe('**中**')

    compose(false)
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await vi.waitFor(() => {
      expect(view.contentDOM.querySelector('.cm-line .nd-strong')?.textContent).toBe('**中**')
    })

    expect(hidden(view, instance).every((span) => span[2] === '**')).toBe(true)
  })

  it('still reveals the active line before the first composed change', () => {
    const { view, instance, compose } = mount()
    compose(true, false)
    view.dispatch({ selection: { anchor: 10 } })

    expect(instance.atomicDecorations.size).toBe(0)
    expect(view.contentDOM.textContent).toContain('**bold**')
  })

  it('does not refresh a destroyed editor from a pending composition callback', async () => {
    const { view, compose } = mount()
    compose(true)
    view.dispatch({ changes: { from: 0, insert: '中文' }, userEvent: 'input.type.compose' })
    compose(false)
    const measurements: Array<() => void> = []
    vi.spyOn(view, 'requestMeasure').mockImplementation((request) => {
      if (request) measurements.push(() => request.write?.(request.read(view), view))
    })
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    expect(measurements.length).toBeGreaterThan(0)
    const dispatch = vi.spyOn(view, 'dispatch')

    view.destroy()
    views.splice(views.indexOf(view), 1)
    measurements.forEach((measure) => measure())
    await Promise.resolve()

    expect(dispatch).not.toHaveBeenCalled()
  })
})
