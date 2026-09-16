import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface FindReplaceStorage {
  term: string
  caseSensitive: boolean
  matches: Array<{ from: number; to: number }>
  currentIndex: number
}

export interface FindReplaceOptions {
  /** Whether term matching is case sensitive. Defaults to false. */
  caseSensitive?: boolean
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectMatches(
  doc: ProseMirrorNode,
  term: string,
  caseSensitive: boolean,
): Array<{ from: number; to: number }> {
  if (!term) return []
  const flags = caseSensitive ? 'g' : 'gi'
  const regex = new RegExp(escapeRegExp(term), flags)
  const matches: Array<{ from: number; to: number }> = []
  doc.descendants((node, blockPosition) => {
    if (!node.isTextblock) return true
    let text = ''
    const positions: number[] = []
    node.descendants((child, relativePosition) => {
      if (child.isText && child.text) {
        text += child.text
        for (let index = 0; index < child.text.length; index++) {
          positions.push(blockPosition + 1 + relativePosition + index)
        }
      } else if (child.type.name === 'hardBreak') {
        text += '\n'
        positions.push(blockPosition + 1 + relativePosition)
      }
      return true
    })
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const from = positions[match.index]
      const last = positions[match.index + match[0].length - 1]
      if (from !== undefined && last !== undefined) matches.push({ from, to: last + 1 })
      if (match.index === regex.lastIndex) regex.lastIndex++
    }
    return false
  })
  return matches
}

function findDecorations(state: EditorState, storage: FindReplaceStorage): DecorationSet {
  const { matches, currentIndex } = storage
  if (matches.length === 0) return DecorationSet.empty
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class:
        index === currentIndex
          ? 'nexusdown-find-replace__match--current'
          : 'nexusdown-find-replace__match',
    }),
  )
  return DecorationSet.create(state.doc, decorations)
}

export const FindReplace = Extension.create<FindReplaceOptions, FindReplaceStorage>({
  name: 'findReplace',

  addOptions() {
    return { caseSensitive: false }
  },

  addStorage() {
    return { term: '', caseSensitive: false, matches: [], currentIndex: 0 }
  },

  addCommands() {
    return {
      find:
        (term: string) =>
        ({ editor, state, dispatch }) => {
          const storage = editor.storage.findReplace as FindReplaceStorage
          // Honor an explicit extension option, otherwise keep whatever the UI set previously.
          if (this.options.caseSensitive) {
            storage.caseSensitive = true
          }
          storage.term = term
          storage.matches = collectMatches(state.doc, term, storage.caseSensitive)
          storage.currentIndex = 0
          const first = storage.matches[0]
          let tr = state.tr
          if (first) {
            tr = tr.setSelection(TextSelection.create(state.doc, first.from, first.to)).scrollIntoView()
          }
          tr = tr.setMeta('findReplace:refresh', true)
          if (dispatch) dispatch(tr)
          return storage.matches.length > 0
        },
      findNext:
        () =>
        ({ editor, state, dispatch }) => {
          const storage = editor.storage.findReplace as FindReplaceStorage
          if (storage.matches.length === 0) return false
          storage.currentIndex = (storage.currentIndex + 1) % storage.matches.length
          const match = storage.matches[storage.currentIndex]!
          let tr = state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to)).scrollIntoView()
          tr = tr.setMeta('findReplace:refresh', true)
          if (dispatch) dispatch(tr)
          return true
        },
      findPrev:
        () =>
        ({ editor, state, dispatch }) => {
          const storage = editor.storage.findReplace as FindReplaceStorage
          if (storage.matches.length === 0) return false
          storage.currentIndex =
            (storage.currentIndex - 1 + storage.matches.length) % storage.matches.length
          const match = storage.matches[storage.currentIndex]!
          let tr = state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to)).scrollIntoView()
          tr = tr.setMeta('findReplace:refresh', true)
          if (dispatch) dispatch(tr)
          return true
        },
      replaceCurrent:
        (replaceTerm: string) =>
        ({ editor, state, dispatch }) => {
          const storage = editor.storage.findReplace as FindReplaceStorage
          const match = storage.matches[storage.currentIndex]
          if (!match) return false
          let tr = state.tr.insertText(replaceTerm, match.from, match.to)
          storage.matches = collectMatches(tr.doc, storage.term, storage.caseSensitive)
          const replacementEnd = match.from + replaceTerm.length
          const nextIndex = storage.matches.findIndex((candidate) => candidate.from >= replacementEnd)
          storage.currentIndex = nextIndex >= 0 ? nextIndex : 0
          const next = storage.matches[storage.currentIndex]
          if (next) {
            tr = tr.setSelection(TextSelection.create(tr.doc, next.from, next.to)).scrollIntoView()
          }
          tr = tr.setMeta('findReplace:refresh', true)
          if (dispatch) dispatch(tr)
          return true
        },
      replaceAll:
        (replaceTerm: string) =>
        ({ editor, state, dispatch }) => {
          const storage = editor.storage.findReplace as FindReplaceStorage
          const matches = storage.matches.slice().sort((a, b) => b.from - a.from)
          if (matches.length === 0) return false
          let tr = state.tr
          for (const match of matches) {
            tr = tr.insertText(replaceTerm, match.from, match.to)
          }
          storage.matches = collectMatches(tr.doc, storage.term, storage.caseSensitive)
          storage.currentIndex = 0
          tr = tr.setMeta('findReplace:refresh', true)
          if (dispatch) dispatch(tr)
          return true
        },
      clearFind:
        () =>
        ({ editor, state, dispatch }) => {
          const storage = editor.storage.findReplace as FindReplaceStorage
          storage.term = ''
          storage.matches = []
          storage.currentIndex = 0
          let tr = state.tr
          tr = tr.setMeta('findReplace:refresh', true)
          if (dispatch) dispatch(tr)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    const plugin = new Plugin<FindReplaceStorage>({
      key: new PluginKey('findReplace'),
      state: {
        init: () => self.storage,
        apply: (transaction) => {
          const storage = self.storage
          if (
            transaction.docChanged &&
            storage.term &&
            !transaction.getMeta('findReplace:refresh')
          ) {
            storage.matches = collectMatches(transaction.doc, storage.term, storage.caseSensitive)
            // Clamp unconditionally: when the edit removes every match the index
            // must fall back to 0 too, otherwise it stays stale (e.g. 2 with
            // `matches.length === 0`) and violates the storage contract.
            if (storage.currentIndex >= storage.matches.length) {
              storage.currentIndex = Math.max(0, storage.matches.length - 1)
            }
          }
          return storage
        },
      },
      props: {
        decorations(state) {
          return findDecorations(state, self.storage)
        },
      },
    })
    return [plugin]
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      find: (term: string) => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
      replaceCurrent: (replaceTerm: string) => ReturnType
      replaceAll: (replaceTerm: string) => ReturnType
      clearFind: () => ReturnType
    }
  }

  interface Storage {
    findReplace: FindReplaceStorage
  }
}
