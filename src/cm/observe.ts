import { StateEffect } from '@codemirror/state'
import { EditorView, ViewPlugin, logException } from '@codemirror/view'

const observers = new WeakMap<EditorView, Set<() => void>>()

/** Subscribe to transactions without changing the document or its history. */
export function observeEditorUpdates(view: EditorView, listener: () => void): () => void {
  let listeners = observers.get(view)
  if (!listeners) {
    const current = new Set<() => void>()
    listeners = current
    observers.set(view, current)
    view.dispatch({
      effects: StateEffect.appendConfig.of([
        ViewPlugin.define(() => ({
          destroy() {
            current.clear()
            observers.delete(view)
          },
        })),
        EditorView.updateListener.of(update => {
          if (update.transactions.length === 0) return
          for (const notify of [...current]) {
            if (!current.has(notify)) continue
            try { notify() }
            catch (error) { logException(view.state, error, 'update listener') }
          }
        }),
      ]),
    })
  }

  // Separate registrations of the same callback must still unsubscribe independently.
  const notify = () => listener()
  listeners.add(notify)
  return () => { listeners.delete(notify) }
}
