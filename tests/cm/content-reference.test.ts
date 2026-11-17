import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as cm from '../../src/cm/index.js'
import type { ContentReferenceResolutions } from '../../src/shared/content-reference.js'

const views: cm.EditorView[] = []
const target = { kind: 'tutorial' as const, id: 't1', fragmentType: 'block' as const, fragmentId: 'b1' }
function editor(doc: string, data?: ContentReferenceResolutions) {
  const view = cm.mountEditor({ parent: document.body.appendChild(document.createElement('div')), doc, contentReferences: data })
  views.push(view)
  return view
}
const resolutions = (title: string): ContentReferenceResolutions => new Map([['tutorial:t1#block:b1', { status: 'available', kind: 'tutorial', title, href: '/tutorials/start#block-b1', summary: 'Preview' }]])
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); vi.restoreAllMocks() })

describe('content reference editor command', () => {
  it('replaces each selected range and undoes the complete insertion once', () => {
    const view = editor('one two')
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(4, 7)]) })
    expect(cm.insertContentReference(target)(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('[[tutorial:t1#block:b1]] [[tutorial:t1#block:b1]]')
    expect(view.state.selection.ranges).toHaveLength(2)
    expect(cm.undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('one two')
    expect(view.state.selection.ranges.map(range => [range.from, range.to])).toEqual([[0, 3], [4, 7]])
  })
  it('isolates block insertion with blank lines and leaves a valid cursor', () => {
    const view = editor('beforeafter')
    view.dispatch({ selection: { anchor: 6 } })
    expect(cm.insertContentReference({ kind: 'post', id: 'p1' }, { block: true })(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('before\n\n[[post:p1]]\n\nafter')
    expect(view.state.selection.main.head).toBe(19)
    expect(cm.undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('beforeafter')
  })
  it('rejects malformed targets and waits for IME composition before insertion', () => {
    const view = editor('中文')
    expect(cm.insertContentReference({ kind: 'post', id: '../bad' })(view)).toBe(false)
    vi.spyOn(view, 'compositionStarted', 'get').mockReturnValue(true)
    expect(cm.insertContentReference(target)(view)).toBe(false)
    expect(view.state.doc.toString()).toBe('中文')
    expect(cm.undo(view)).toBe(false)
  })
})

describe('current content reference data in Live Preview', () => {
  it('continues updating after a consumer reconfigures the editor extension', () => {
    const compartment = new Compartment()
    const view = new cm.EditorView({
      parent: document.body.appendChild(document.createElement('div')),
      state: EditorState.create({
        doc: 'intro\n\n[[tutorial:t1#block:b1]]',
        extensions: [compartment.of(cm.nexusdown({ contentReferences: resolutions('First') }))],
      }),
    })
    views.push(view)
    view.dispatch({ effects: compartment.reconfigure(cm.nexusdown({ contentReferences: resolutions('Reconfigured') })) })
    cm.updateContentReferences(view, resolutions('Latest'))
    expect(view.contentDOM.querySelector('.nd-content-reference-card')?.textContent).toContain('Latest')
  })
  it('renders current cards and updates data without document, selection, or history changes', () => {
    const source = 'intro\n\n[[tutorial:t1#block:b1]]\n\ntail'
    const view = editor(source, resolutions('First'))
    expect(view.contentDOM.querySelector('.nd-content-reference-card')?.textContent).toContain('First')
    view.dispatch({ changes: { from: 0, insert: 'x' }, selection: { anchor: 1 }, userEvent: 'input.type' })
    const selection = view.state.selection
    cm.updateContentReferences(view, resolutions('Renamed'))
    expect(view.contentDOM.querySelector('.nd-content-reference-card')?.textContent).toContain('Renamed')
    expect(view.state.doc.toString()).toBe('x' + source)
    expect(view.state.selection.eq(selection)).toBe(true)
    expect(cm.undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(source)
    cm.updateContentReferences(view, new Map([['tutorial:t1#block:b1', { status: 'unavailable' }]]))
    expect(view.contentDOM.querySelector('.nd-content-reference--unavailable')?.textContent).toBe('内容不可用')
    expect(view.contentDOM.querySelector('.nd-content-reference-card')).toBeNull()
    expect(view.contentDOM.textContent).not.toContain('Renamed')
  })

  it('does not render references inside links, code, images, or attrs; supports heading and table text', () => {
    const r = '[[tutorial:t1#block:b1]]'
    const source = `intro\n\n${r}\n\n# Heading ${r}\n\n| Cell ${r} |\n| --- |\n\n\`${r}\`\n\n[${r}](/a)\n\n![${r}](/a.png)\n\n{title="${r}"}\n\n\\${r}\n\n\`\`\`\n${r}\n\`\`\``
    const view = editor(source, resolutions('Current'))
    expect(view.contentDOM.querySelectorAll('.nd-content-reference-card')).toHaveLength(1)
    expect(view.contentDOM.querySelectorAll('.nd-content-reference')).toHaveLength(2)
  })

  it('keeps complete ordinary link labels as links when they resemble the reference delimiters', () => {
    const view = editor('intro\n\n[[tutorial:t1#block:b1]](/ordinary)\n\ntail', resolutions('Not a reference'))
    expect(view.contentDOM.querySelector('.nd-content-reference')).toBeNull()
    expect(view.contentDOM.querySelector('.nd-content-reference-card')).toBeNull()
    expect(view.contentDOM.textContent).not.toContain('Not a reference')
  })

  it.each([
    'www.example.com/[[post:p1]]',
    'www.example.com/path?q=[[post:p1]]',
    '<span title="line\n[[post:p1]]">text</span>',
    '<span title="a > [[post:p1]]">text</span>',
  ])('keeps URL and attribute references literal in Live Preview: %s', (excluded) => {
    const source = `intro\n\n${excluded}\n\nsee [[post:p2]]`
    const view = editor(source, new Map([
      ['post:p1', { status: 'available', kind: 'post', title: 'Incorrect nested reference', href: '/posts/p1' }],
      ['post:p2', { status: 'available', kind: 'post', title: 'Visible body reference', href: '/posts/p2' }],
    ]))
    expect(view.contentDOM.querySelectorAll('.nd-content-reference')).toHaveLength(1)
    expect(view.contentDOM.querySelector('.nd-content-reference')?.textContent).toBe('Visible body reference')
    expect(view.contentDOM.textContent).not.toContain('Incorrect nested reference')
    expect(view.state.doc.toString()).toBe(source)
  })

  it('preserves composing DOM and applies only the latest result after composition ends', async () => {
    const view = editor('intro\n\n[[tutorial:t1#block:b1]]', resolutions('First'))
    let composing = true
    vi.spyOn(view, 'compositionStarted', 'get').mockImplementation(() => composing)
    vi.spyOn(view, 'composing', 'get').mockImplementation(() => composing)
    const original = view.contentDOM.querySelector('.nd-content-reference-card')
    cm.updateContentReferences(view, resolutions('Stale'))
    cm.updateContentReferences(view, resolutions('Latest'))
    expect(view.contentDOM.querySelector('.nd-content-reference-card')).toBe(original)
    expect(original?.textContent).toContain('First')
    composing = false
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await vi.waitFor(() => expect(view.contentDOM.querySelector('.nd-content-reference-card')?.textContent).toContain('Latest'))
    expect(view.state.doc.toString()).toBe('intro\n\n[[tutorial:t1#block:b1]]')
  })
})
