import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * Round-trip fidelity for every Markdown construct the editor keeps.
 *
 * Markdown -> parse -> serialise -> Markdown must lose nothing. The first
 * serialisation is allowed to *normalise* (a table gains padding, a paragraph
 * gains a trailing newline), so the contract is:
 *
 *   1. the second serialisation is byte-identical to the first (stable), and
 *   2. the second parse renders the same HTML as the first (lossless).
 *
 * Anything that only survived by being written as HTML or a BBCode shortcode
 * would fail step 1 or 2 the moment it is read back.
 */
function roundTrip(markdown: string) {
  const first = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
  const once = first.getMarkdown()
  const html = first.getHTML()
  first.destroy()

  const second = createNexusdownEditor({ content: once, contentType: 'markdown' })
  const twice = second.getMarkdown()
  const reloaded = second.getHTML()
  second.destroy()

  return { markdown, once, twice, html, reloaded }
}

const CONSTRUCTS: Array<[string, string]> = [
  ['paragraph', 'plain paragraph'],
  ['bold', '**bold**'],
  ['italic', '*italic*'],
  ['strike', '~~strike~~'],
  ['inline code', '`code`'],
  ['highlight', '==highlighted=='],
  ['heading', '## Heading'],
  ['blockquote', '> quoted'],
  ['bullet list', '- one\n- two'],
  ['ordered list', '1. one\n2. two'],
  ['nested list', '- one\n  - nested'],
  ['task list', '- [ ] todo\n- [x] done'],
  ['link', '[text](https://example.com)'],
  ['link with title', '[text](https://example.com "Title")'],
  ['image', '![alt](https://example.com/a.png)'],
  ['image with title', '![alt](https://example.com/a.png "T")'],
  ['table', '| a | b |\n| --- | --- |\n| c | d |'],
  ['hard break', 'line one  \nline two'],
  ['horizontal rule', '---'],
  ['code block', '```ts\nconst x = 1\n```'],
]

describe('Markdown round trip loses nothing', () => {
  for (const [label, markdown] of CONSTRUCTS) {
    it(`is stable and lossless for ${label}`, () => {
      const { once, twice, html, reloaded } = roundTrip(markdown)

      expect(twice, `${label} was not stable on re-serialisation`).toBe(once)
      expect(reloaded, `${label} rendered differently after the round trip`).toBe(html)
      // The construct must still be written as Markdown, not degraded to text.
      expect(once.length, `${label} produced nothing`).toBeGreaterThan(0)
    })
  }

  it('keeps a GFM table readable as a pipe table', () => {
    const { once, reloaded } = roundTrip('| a | b |\n| --- | --- |\n| c | d |')

    expect(once).toMatch(/\|\s*---\s*\|/)
    expect(once).not.toContain('<table')
    expect(reloaded).toContain('<table')
    expect(reloaded).toContain('<th')
    expect(reloaded).toContain('<td')
  })

  it('keeps a hard break as trailing spaces, not <br>', () => {
    const { once, reloaded } = roundTrip('line one  \nline two')

    expect(once).toMatch(/ {2}\n/)
    expect(once).not.toContain('<br')
    // It re-reads as a real break, so the two lines stay in one paragraph.
    expect(reloaded).toContain('<br>')
  })

  it('keeps a highlight as ==...==, not <mark>', () => {
    const { once, reloaded } = roundTrip('==highlighted==')

    expect(once).toContain('==highlighted==')
    expect(once).not.toContain('<mark')
    // It re-reads as a real highlight, so the syntax is understood, not just
    // echoed back as text.
    expect(reloaded).toContain('<mark')
    expect(reloaded).toContain('highlighted')
  })

  it('keeps a single = inside a highlight from closing it early', () => {
    // `==a=b==` must stay one highlight over `a=b`. If the writer lets the inner
    // `=` through, the mark ends at it and the tail leaks into the paragraph as
    // literal text (`<mark>a</mark>b==`), which loses the mark on reload.
    const { once, twice, html, reloaded } = roundTrip('==a=b==')

    expect(twice, 'the inner = made the output unstable').toBe(once)
    expect(reloaded, 'the inner = changed the rendering').toBe(html)
    expect(reloaded.match(/<mark/g)?.length, 'the highlight was split or lost').toBe(1)
    expect(reloaded).toContain('a=b')
  })

  it('does not turn an empty ==== into a phantom highlight', () => {
    // There is nothing to wrap, so `====` stays literal text rather than
    // becoming a `<mark></mark>` with no content — which cannot even exist as a
    // ProseMirror mark, since marks attach to text.
    const { once, twice, html, reloaded } = roundTrip('====')

    expect(twice, 'the empty delimiter pair was unstable').toBe(once)
    expect(reloaded, 'the empty delimiter pair changed the rendering').toBe(html)
    expect(reloaded).not.toContain('<mark')
  })

  it('round-trips a highlight nested with bold', () => {
    for (const source of ['==**bold**==', '**==bold==**']) {
      const { once, twice, html, reloaded } = roundTrip(source)

      expect(twice, `${source} was not stable`).toBe(once)
      expect(reloaded, `${source} rendered differently after the round trip`).toBe(html)
      // Both marks survive, each exactly once — neither swallows the other.
      expect(reloaded.match(/<mark/g)?.length, `${source} lost the highlight`).toBe(1)
      expect(reloaded.match(/<strong>/g)?.length, `${source} lost the bold`).toBe(1)
      expect(reloaded).toContain('bold')
    }
  })

  it('keeps a code block as a ```lang fence, not <pre>', () => {
    const { once, reloaded } = roundTrip('```ts\nconst x = 1\n```')

    expect(once).toMatch(/^```ts/m)
    expect(once).not.toContain('<pre')
    // The fence re-reads as a real code block with its language intact.
    expect(reloaded).toContain('<pre>')
    expect(reloaded).toContain('language-ts')
    expect(reloaded).toContain('const x = 1')
  })

  it('keeps a whole document intact across a round trip', () => {
    const source = [
      '# Title',
      '',
      'A paragraph with **bold**, *italic*, `code`, ==highlight== and a [link](https://example.com).',
      '',
      '> a quote',
      '',
      '1. first',
      '2. second',
      '',
      '- [x] done',
      '',
      '| a | b |',
      '| --- | --- |',
      '| c | d |',
      '',
      '```ts',
      'const x = 1',
      '```',
    ].join('\n')

    const { once, twice, html, reloaded } = roundTrip(source)

    expect(twice).toBe(once)
    expect(reloaded).toBe(html)
    expect(once).not.toMatch(/<\/?[a-zA-Z][^>]*>/)
    expect(once).not.toMatch(/(?<!\\)\[\/[a-zA-Z]/)
  })
})
