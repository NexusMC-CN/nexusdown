import { StateEffect, StateField, Transaction, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import type { ContentReferenceResolutions } from '../shared/content-reference.js'

export const setContentReferenceData = StateEffect.define<ContentReferenceResolutions | undefined>()
export const contentReferenceData = StateField.define<{ resolutions?: ContentReferenceResolutions }>({
  create: () => ({}),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setContentReferenceData)) return { resolutions: effect.value }
    return value
  },
})

const pending = new WeakMap<EditorView, { resolutions?: ContentReferenceResolutions }>()
const destroyed = new WeakSet<EditorView>()
const lifecycle = ViewPlugin.define((view) => {
  destroyed.delete(view)
  return { destroy() { destroyed.add(view); pending.delete(view) } }
})

/** Refresh decorations only. Source, selection, and undo history are untouched. */
export function updateContentReferences(view: EditorView, resolutions: ContentReferenceResolutions | undefined): void {
  if (destroyed.has(view)) return
  if (view.compositionStarted || view.composing) {
    pending.set(view, { resolutions })
    return
  }
  pending.delete(view)
  view.dispatch({ effects: setContentReferenceData.of(resolutions), annotations: Transaction.addToHistory.of(false) })
}

export function contentReferenceDataExtension(resolutions?: ContentReferenceResolutions): Extension {
  return [
    contentReferenceData.init(() => ({ resolutions })),
    lifecycle,
    EditorView.domEventObservers({
      compositionend(_event, view) {
        view.requestMeasure({
          key: pending,
          read: () => null,
          write: () => queueMicrotask(() => {
            const result = pending.get(view)
            if (result && !destroyed.has(view) && !view.compositionStarted && !view.composing) updateContentReferences(view, result.resolutions)
          }),
        })
      },
    }),
  ]
}
