import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EditorView, mountEditor } from '../../src/cm/index.js'

const views: EditorView[] = []
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => {
  views.splice(0).forEach(view => view.destroy())
  document.body.replaceChildren()
})

function fixture() {
  const outer = document.createElement('div')
  outer.style.overflowY = 'auto'
  document.body.appendChild(outer)
  Object.defineProperties(outer, {
    scrollHeight: { value: 5000 }, clientHeight: { value: 850 }, offsetHeight: { value: 850 },
    getBoundingClientRect: { value: () => new DOMRect(0, 0, 600, 850) },
  })
  outer.scrollTop = 300
  // jsdom has no layout or native scrolling. Keep CM's view/state/plugins real;
  // model the measured browser scrollports and resulting DOM scroll position.
  outer.scrollBy = (options?: ScrollToOptions | number, y?: number) => {
    outer.scrollTop += typeof options === 'number' ? y ?? 0 : options?.top ?? 0
  }
  const view = mountEditor({ parent: outer, doc: 'content', scrollMargins: () => ({ top: 150 }) })
  views.push(view)
  view.scrollDOM.style.overflowY = 'auto'
  Object.defineProperties(view.scrollDOM, {
    scrollHeight: { value: 5000 }, clientHeight: { value: 1200 }, offsetHeight: { value: 1200 },
    getBoundingClientRect: { value: () => new DOMRect(0, 305 - outer.scrollTop, 600, 1200) },
  })
  view.coordsAtPos = () => ({ left: 10, right: 10, top: 326 - outer.scrollTop, bottom: 345 - outer.scrollTop })
  const pending: (() => void)[] = []
  // Defer the public layout scheduler so intervening real transactions and DOM
  // input can be exercised deterministically before reading/writing geometry.
  view.requestMeasure = request => {
    if (request) pending.push(() => {
      const measured = request.read(view)
      request.write?.(measured, view)
    })
  }
  const options = { x: 'nearest', y: 'nearest', xMargin: 5, yMargin: 5 } as const
  const request = () => view.state.facet(EditorView.scrollHandler).map(handler => handler(view, view.state.selection.main, options))
  const flush = async () => {
    await Promise.resolve()
    pending.splice(0).forEach(measure => measure())
  }
  return { outer, view, request, flush, options }
}

describe('sticky scroll margin correction', () => {
  it('preserves default handling and repairs only the measured top residual', async () => {
    const { outer, view, request, flush, options } = fixture()
    expect(request()).toEqual([false])
    expect(outer.scrollTop).toBe(300)
    await flush()
    expect(outer.scrollTop).toBe(171)
    expect(view.coordsAtPos(0)?.top).toBe(155)
    expect(options).toEqual({ x: 'nearest', y: 'nearest', xMargin: 5, yMargin: 5 })
  })

  it('discards pending work after a newer selection transaction', async () => {
    const { outer, view, request, flush } = fixture()
    request()
    await Promise.resolve()
    view.dispatch({ selection: { anchor: 1 } })
    await flush()
    expect(outer.scrollTop).toBe(300)
    expect(view.state.selection.main.head).toBe(1)
  })

  it('keeps a later ancestor scroll even when it produces no input event', async () => {
    const { outer, request, flush } = fixture()
    request()
    await Promise.resolve()
    outer.scrollTop = 275
    await flush()
    expect(outer.scrollTop).toBe(275)
  })

  it('cancels on scrollbar input outside the editor content', async () => {
    const { outer, request, flush } = fixture()
    request()
    await Promise.resolve()
    outer.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flush()
    expect(outer.scrollTop).toBe(300)
  })

  it('does not read layout or scroll after the view is destroyed', async () => {
    const { outer, view, request, flush } = fixture()
    request()
    await Promise.resolve()
    view.destroy()
    view.coordsAtPos = () => { throw new Error('layout read after destroy') }
    await flush()
    expect(outer.scrollTop).toBe(300)
  })
})
