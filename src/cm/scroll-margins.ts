import { Prec, type Extension, type SelectionRange } from '@codemirror/state'
import { EditorView, ViewPlugin, type Rect, type ViewUpdate } from '@codemirror/view'

type MarginReader = (view: EditorView) => Partial<Rect> | null
const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

function scrollPositions(element: HTMLElement) {
  const positions: { element: HTMLElement; top: number; left: number }[] = []
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    positions.push({ element: current, top: current.scrollTop, left: current.scrollLeft })
  }
  return positions
}

function positionsChanged(positions: ReturnType<typeof scrollPositions>): boolean {
  return positions.some(({ element, top, left }) => element.scrollTop !== top || element.scrollLeft !== left)
}

/** Keep CM's normal scrolling, then repair a top margin clipped by an inner scroll boundary. */
export function editorScrollMargins(margins: MarginReader): Extension {
  const correction: ViewPlugin<ScrollMarginCorrection> = ViewPlugin.define(view => new ScrollMarginCorrection(view, margins), {
    eventObservers: {
      scroll: (_event, view) => view.plugin(correction)?.scrolled(),
    },
  })
  return [
    EditorView.scrollMargins.of(margins),
    correction,
    Prec.lowest(EditorView.scrollHandler.of((view, range, options) => {
      if (options.y === 'nearest' || options.y === 'start') view.plugin(correction)?.reveal(range)
      return false
    })),
  ]
}

class ScrollMarginCorrection {
  private alive = true
  private version = 0
  private settling = false
  private readonly cancelInput = () => this.cancel()

  constructor(private view: EditorView, private margins: MarginReader) {
    // Native/ancestor scrollbars receive input outside CM's contentDOM too.
    for (const type of inputEvents) view.dom.ownerDocument.addEventListener(type, this.cancelInput, { capture: true, passive: true })
  }

  cancel(): void { this.version++; this.settling = false }

  scrolled(): void {
    if (!this.settling) this.cancel()
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet) this.cancel()
  }

  destroy(): void {
    this.alive = false
    this.cancel()
    for (const type of inputEvents) this.view.dom.ownerDocument.removeEventListener(type, this.cancelInput, true)
  }

  reveal(range: SelectionRange): void {
    const { view } = this
    const version = ++this.version
    const { doc, selection } = view.state
    const unchanged = () => this.alive && version === this.version && view.dom.isConnected
      && view.state.doc === doc && view.state.selection.eq(selection)
    this.settling = true

    // Finish CM's current measure and native selection redraw before inspecting
    // the final caret. Its own scroll events may arrive during this interval;
    // wheel, touch, pointer, keyboard and state changes still cancel immediately.
    queueMicrotask(() => {
      if (!unchanged()) return
      const win = view.dom.ownerDocument.defaultView
      if (!win) return
      // These are observed after CM's default scroll, never restored. A later
      // programmatic scroll also cancels, even without an input event.
      const baseline = scrollPositions(view.scrollDOM)
      const baselineX = win.scrollX, baselineY = win.scrollY
      view.requestMeasure({
        key: this,
        read: () => {
          const scroller = view.scrollDOM
          // Page mode already retains CM's margin without an inner clipping boundary.
          if (!unchanged()) return null
          this.settling = false
          if (win.scrollX !== baselineX || win.scrollY !== baselineY || positionsChanged(baseline)) return null
          if (scroller.scrollHeight <= scroller.clientHeight + 1) return null
          const margin = this.margins(view)?.top ?? 0
          if (!(margin > 0)) return null
          const caret = view.coordsAtPos(range.head, range.assoc || (range.head > range.anchor ? -1 : 1))
          if (!caret) return null

          let top = Math.max(0, scroller.getBoundingClientRect().top)
          const ancestors: { element: HTMLElement; style: CSSStyleDeclaration }[] = []
          for (let element = scroller.parentElement; element; element = element.parentElement) {
            const style = win.getComputedStyle(element)
            ancestors.push({ element, style })
            if (/auto|scroll|hidden|clip|overlay/.test(style.overflowY || style.overflow)) {
              top = Math.max(top, element.getBoundingClientRect().top + element.clientTop)
            }
          }
          let remaining = top + margin - caret.top
          // The target must be visible apart from the actual top obstruction.
          if (remaining <= 1 || caret.top < top - 1) return null

          const positions = scrollPositions(scroller)
          const moves: { element: HTMLElement; amount: number }[] = []
          for (const { element, style } of [{ element: scroller, style: win.getComputedStyle(scroller) }, ...ancestors]) {
            if (element === scroller.ownerDocument.body || element === scroller.ownerDocument.documentElement) break
            if (!/auto|scroll|overlay/.test(style.overflowY || style.overflow) || element.scrollTop <= 0) continue
            const scale = element.offsetHeight ? element.getBoundingClientRect().height / element.offsetHeight : 1
            if (!(scale > 0)) continue
            const amount = Math.min(remaining / scale, element.scrollTop)
            moves.push({ element, amount })
            remaining -= amount * scale
            if (remaining <= 1) break
          }
          return { win, x: win.scrollX, y: win.scrollY, positions, moves, windowAmount: Math.min(remaining, win.scrollY) }
        },
        write: result => {
          if (!result || !unchanged()) return
          const { win, x, y, positions, moves, windowAmount } = result
          if (win.scrollX !== x || win.scrollY !== y
            || positionsChanged(positions)) return
          for (const { element, amount } of moves) element.scrollBy({ top: -amount, behavior: 'instant' })
          if (windowAmount > 1) win.scrollBy({ top: -windowAmount, behavior: 'instant' })
        },
      })
    })
  }
}
