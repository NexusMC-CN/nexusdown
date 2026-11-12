import { afterEach, expect, it } from 'vitest'
import { undo, redo } from '@codemirror/commands'
import { EditorState, StateEffect } from '@codemirror/state'
import { mountEditor } from '../../src/cm/mount.js'
import * as edits from '../../src/cm/link-edit.js'

const views: ReturnType<typeof mountEditor>[] = []
afterEach(() => views.splice(0).forEach(view => view.destroy()))
function editor(doc: string, from = 0, to = from) {
  const view = mountEditor({ parent: document.createElement('div'), doc })
  view.dispatch({ selection: { anchor: from, head: to } })
  views.push(view)
  return view
}
it('extracts exactly one URL from share prose and rejects ambiguous or unsafe input', () => {
  expect(edits.extractLinkUrl('分享：https://b23.tv/abc 复制打开')).toBe('https://b23.tv/abc')
  expect(edits.extractLinkUrl('https://a.com https://b.com')).toBeNull()
  expect(edits.extractLinkUrl('https://name:pass@b23.tv/abc')).toBeNull()
  expect(edits.extractLinkUrl('javascript:alert(1)')).toBeNull()
})
it('preserves captured selection when focus/cursor moves and supports undo/redo', () => {
  const view = editor('before selected after', 7, 15)
  const target = edits.captureLinkEditTarget(view)
  view.dispatch({ selection: { anchor: 0 } })
  expect(edits.applyLinkEdit(view, target, 'https://example.com', 'link')).toBe(true)
  const result = view.state.doc.toString()
  expect(result).toContain('[selected](https://example.com)')
  expect(result).toContain('before ')
  undo(view)
  expect(view.state.doc.toString()).toBe('before selected after')
  redo(view)
  expect(view.state.doc.toString()).toBe(result)
})
it('edits an existing embed block then switches card to ordinary link', () => {
  const raw = 'start\n\n```embed https://www.bilibili.com/video/BV1xx411c7mD\n```\n\nend'
  const view = editor(raw, 20)
  let target = edits.captureLinkEditTarget(view)
  expect(target.mode).toBe('embed')
  expect(target.url).toContain('bilibili.com')
  expect(edits.applyLinkEdit(view, target, 'https://example.com', 'card')).toBe(true)
  expect(view.state.doc.toString()).toContain('{.card}')
  view.dispatch({ selection: { anchor: 10 } })
  target = edits.captureLinkEditTarget(view)
  expect(target.mode).toBe('card')
  expect(edits.applyLinkEdit(view, target, 'https://example.com', 'link')).toBe(true)
  expect(view.state.doc.toString()).toContain('{.no-card}')
  expect(view.state.doc.toString()).not.toContain('{.card}')
  expect(view.state.doc.toString()).toMatch(/^start\n\n[\s\S]*\n\nend$/)
})
it('refuses a stale target after document replacement and unknown iframe URL', () => {
  const view = editor('text')
  const target = edits.captureLinkEditTarget(view)
  expect(edits.applyLinkEdit(view, target, 'https://evil.com', 'embed')).toBe(false)
  view.dispatch({ changes: { from: 0, to: 4, insert: 'new draft' } })
  expect(edits.applyLinkEdit(view, target, 'https://example.com', 'card')).toBe(false)
  expect(view.state.doc.toString()).toBe('new draft')
})
it('does not mutate a read-only editor', () => {
  const view = editor('text')
  view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) })
  const target = edits.captureLinkEditTarget(view)
  expect(edits.applyLinkEdit(view, target, 'https://example.com', 'link')).toBe(false)
  expect(view.state.doc.toString()).toBe('text')
})
it('reopens an immediate mode suffix and keeps its source block range', () => {
  const view = editor('before\n\nhttps://example.com/post  \n{.card}\n\nafter', 20)
  const target = edits.captureLinkEditTarget(view)
  expect(target.url).toBe('https://example.com/post')
  expect(target.mode).toBe('card')
  expect(edits.applyLinkEdit(view, target, 'https://example.com/next', 'link')).toBe(true)
  expect(view.state.doc.toString()).not.toContain('{.card}')
  expect(view.state.doc.toString()).toContain('{.no-card}')
  expect(view.state.doc.toString()).toContain('\n\nafter')
})
it('recognizes the URL block at the beginning of a document', () => {
  const view = editor('https://example.com/first\n\nend')
  expect(edits.captureLinkEditTarget(view).url).toBe('https://example.com/first')
})
it('edits titled and reference links as complete source blocks', () => {
  for (const raw of ['[Article](https://example.com "Title")\n\n{.card}', '[Article][target]\n\n{.card}\n\n[target]: https://example.com "Title"']) {
    const view = editor(raw, 4)
    const target = edits.captureLinkEditTarget(view)
    expect(target.url).toBe('https://example.com')
    expect(edits.applyLinkEdit(view, target, 'https://example.org', 'link')).toBe(true)
    expect(view.state.doc.toString()).toContain('[Article](https://example.org "Title")')
    expect(view.state.doc.toString()).not.toContain('Art\n')
  }
})
it('strips share wrappers without damaging balanced URL parentheses', () => {
  expect(edits.extractLinkUrl('Read (https://b23.tv/abc)')).toBe('https://b23.tv/abc')
  expect(edits.extractLinkUrl('[Watch](https://b23.tv/abc)')).toBe('https://b23.tv/abc')
  expect(edits.extractLinkUrl('https://example.com/a_(b)')).toBe('https://example.com/a_(b)')
})
it('preserves a known shortlink in Markdown only after a verified provider resolution', () => {
  const view = editor('')
  const target = edits.captureLinkEditTarget(view)
  expect(edits.applyLinkEdit(view, target, 'https://b23.tv/abc', 'embed', {url: 'https://www.bilibili.com/video/BV1xx411c7mD/'})).toBe(true)
  expect(view.state.doc.toString()).toBe('```embed https://b23.tv/abc\n```')
  const other = editor('')
  expect(edits.applyLinkEdit(other, edits.captureLinkEditTarget(other), 'https://evil.com', 'embed', {url: 'https://www.bilibili.com/video/BV1xx411c7mD/'})).toBe(false)
})
it('keeps ordinary URL ports and site-relative links usable without widening media providers', () => {
  expect(edits.extractLinkUrl('https://example.com:8443/article')).toBe('https://example.com:8443/article')
  expect(edits.extractLinkUrl('/resources/example')).toBe('/resources/example')
  const view = editor('[local](/resources/example)', 4)
  expect(edits.applyLinkEdit(view, edits.captureLinkEditTarget(view), '/resources/next', 'link')).toBe(true)
  expect(view.state.doc.toString()).toContain('[local](/resources/next)')
  const media = editor('')
  expect(edits.applyLinkEdit(media, edits.captureLinkEditTarget(media), 'https://www.bilibili.com:8443/video/BV1xx411c7mD', 'embed')).toBe(false)
})
