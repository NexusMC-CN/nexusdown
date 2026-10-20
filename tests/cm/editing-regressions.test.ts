import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { insertTable, toggleBulletList, wrapCodeBlock } from '../../src/cm/commands.js'
import { flushPendingSync, mountEditor, setEditorValue } from '../../src/cm/mount.js'
import { editingBlock, editingRange, setEditingBlock, setEditingRange } from '../../src/cm/plugin.js'
import { renderMarkdown } from '../../src/render/index.js'

const views: EditorView[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const view of views.splice(0)) {
    flushPendingSync(view)
    view.destroy()
  }
  document.body.replaceChildren()
})

function editor(doc: string, anchor: number, head = anchor): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  })
  views.push(view)
  return view
}

function mounted(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = mountEditor({ parent, doc })
  views.push(view)
  return view
}

function composing(view: EditorView) {
  // jsdom has no native IME. Only the browser composition state is supplied;
  // both editors, their documents, and the synchronization path remain real.
  const active = vi.spyOn(view, 'composing', 'get').mockReturnValue(true)
  const started = vi.spyOn(view, 'compositionStarted', 'get').mockReturnValue(true)
  return () => {
    active.mockRestore()
    started.mockRestore()
  }
}

describe('block command boundaries', () => {
  it('inserts a complete fenced block between the two sides of a paragraph', () => {
    const view = editor('before after', 6)

    wrapCodeBlock(view)

    expect(view.state.doc.toString()).toBe('before\n```\n\n```\n after')
    expect(view.state.selection.main.head).toBe(11)
  })

  it('does not add a list marker to the unselected line at an exclusive selection end', () => {
    const view = editor('one\ntwo\nthree', 0, 4)

    toggleBulletList(view)

    expect(view.state.doc.toString()).toBe('- one\ntwo\nthree')
  })

  it('does not wrap the unselected line at an exclusive selection end', () => {
    const view = editor('one\ntwo', 0, 4)

    wrapCodeBlock(view)

    expect(view.state.doc.toString()).toBe('```\none\n```\ntwo')
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('one')
  })

  it('handles a backward selection ending at the start of the following line', () => {
    const view = editor('one\ntwo', 4, 0)

    toggleBulletList(view)

    expect(view.state.doc.toString()).toBe('- one\ntwo')
    expect(view.state.selection.main.anchor).toBe(6)
    expect(view.state.selection.main.head).toBe(2)
  })

  it.each([
    ['before', 6, 'before\n```\n\n```', 11],
    ['after', 0, '```\n\n```\nafter', 4],
    ['before\n\nafter', 7, 'before\n```\n\n```\nafter', 11],
  ] as const)('inserts a fence at line boundaries without consuming text: %s', (doc, cursor, expected, head) => {
    const view = editor(doc, cursor)

    wrapCodeBlock(view)

    expect(view.state.doc.toString()).toBe(expected)
    expect(view.state.selection.main.head).toBe(head)
  })

  it('inserts a table between paragraphs without treating the following text as a row', () => {
    const view = editor('before after', 6)

    insertTable(view)

    const html = renderMarkdown(view.state.doc.toString())
    expect(html).toContain('<p>before</p>')
    expect(html).toContain('<table')
    expect(html).toContain('<p>after</p>')
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('列一')
  })

  it('separates a table from text on the following line', () => {
    const view = editor('replace\nafter', 0, 7)

    insertTable(view)

    const html = renderMarkdown(view.state.doc.toString())
    expect(html).toContain('<p>after</p>')
    expect(html).not.toContain('replace')
  })
})

describe('composition value synchronization', () => {
  it('keeps a pending external value attached to the editor that received it', () => {
    const first = mounted('first')
    const second = mounted('second')
    const endComposition = composing(first)
    setEditorValue(first, 'first draft')
    endComposition()

    flushPendingSync(second)
    flushPendingSync(first)

    expect(second.state.doc.toString()).toBe('second')
    expect(first.state.doc.toString()).toBe('first draft')
  })

  it('discards an older queued value after a newer external value is applied', () => {
    const view = mounted('original')
    const endComposition = composing(view)
    setEditorValue(view, 'old draft')
    endComposition()
    setEditorValue(view, 'latest draft')

    flushPendingSync(view)

    expect(view.state.doc.toString()).toBe('latest draft')
  })

  it('cancels an older queued value when the latest external value matches the current document', () => {
    const view = mounted('original')
    const endComposition = composing(view)
    setEditorValue(view, 'old draft')
    setEditorValue(view, 'original')
    endComposition()

    flushPendingSync(view)

    expect(view.state.doc.toString()).toBe('original')
  })

  it('preserves an explicitly queued empty document', () => {
    const view = mounted('original')
    const endComposition = composing(view)
    setEditorValue(view, '')
    endComposition()

    flushPendingSync(view)

    expect(view.state.doc.toString()).toBe('')
  })

  it('defers external updates as soon as composition starts and flushes after it ends', async () => {
    const view = mounted('original')
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    expect(view.compositionStarted).toBe(true)
    expect(view.composing).toBe(false)

    setEditorValue(view, 'next draft')

    expect(view.state.doc.toString()).toBe('original')
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await Promise.resolve()
    expect(view.state.doc.toString()).toBe('next draft')
  })

  it('keeps a pending draft switch through composition edits and the v-model feedback loop', async () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const seen: string[] = []
    const view = mountEditor({
      parent,
      doc: 'old draft',
      onDocChange: (value) => {
        seen.push(value)
        queueMicrotask(() => setEditorValue(view, value))
      },
    })
    views.push(view)
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    setEditorValue(view, 'loaded draft')

    for (const text of ['中', '文']) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: text },
        userEvent: 'input.type.compose',
      })
      await Promise.resolve()
      expect(seen).toEqual([])
    }
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(view.state.doc.toString()).toBe('loaded draft')
    expect(seen).toEqual(['loaded draft'])
  })

  it('keeps reporting consecutive composition changes when no external draft is pending', async () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const seen: string[] = []
    const view = mountEditor({
      parent,
      doc: '',
      onDocChange: (value) => {
        seen.push(value)
        queueMicrotask(() => setEditorValue(view, value))
      },
    })
    views.push(view)
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))

    for (const text of ['中', '文']) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: text },
        userEvent: 'input.type.compose',
      })
      await Promise.resolve()
    }
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await Promise.resolve()

    expect(view.state.doc.toString()).toBe('中文')
    expect(seen).toEqual(['中', '中文'])
  })
})

describe('external document replacement', () => {
  it('preserves source editing intent during unchanged v-model feedback', () => {
    const view = mounted('**source**')
    view.dispatch({
      effects: [
        setEditingRange.of({ from: 0, to: 10 }),
        setEditingBlock.of(0),
      ],
    })

    setEditorValue(view, '**source**')

    expect(view.state.field(editingRange)).toEqual({ from: 0, to: 10 })
    expect(view.state.field(editingBlock)).toBe(0)
  })

  it('clears source editing intent from the previous document so the new document can preview', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const previous = '```sh\na\n```\n{tab="A"}\n\n```sh\nb\n```\n{tab="B"}'
    const view = mountEditor({
      parent,
      doc: previous,
      mathRenderer: { renderToString: (tex) => `<span class="rendered-math">${tex}</span>` },
    })
    views.push(view)
    view.dispatch({
      selection: { anchor: 0 },
      effects: [
        setEditingRange.of({ from: 0, to: previous.length }),
        setEditingBlock.of(0),
      ],
    })

    setEditorValue(view, 'intro\n\n```math\nx^2\n```\n\nend')

    expect(view.state.field(editingRange)).toBeNull()
    expect(view.state.field(editingBlock)).toBeNull()
    expect(parent.querySelector('.rendered-math')?.textContent).toBe('x^2')
  })
})
