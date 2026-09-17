import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/** html -> markdown -> reload -> html. Returns both stages for assertions. */
function roundTrip(html: string): { markdown: string; reloaded: string } {
  const first = createNexusdownEditor({ content: html, contentType: 'html' })
  const markdown = first.getMarkdown()
  first.destroy()
  const second = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
  const reloaded = second.getHTML()
  second.destroy()
  return { markdown, reloaded }
}

function fromHtml(html: string): string {
  const editor = createNexusdownEditor({ content: html, contentType: 'html' })
  const out = editor.getMarkdown()
  editor.destroy()
  return out
}

describe('block-level escaping (issue #1 comments)', () => {
  it('keeps a paragraph starting with "# " from becoming a heading', () => {
    const { markdown, reloaded } = roundTrip('<p># not a heading</p>')
    expect(markdown).toBe('\\# not a heading')
    expect(reloaded).toContain('<p>')
    expect(reloaded).not.toContain('<h1>')
  })

  it('keeps a paragraph starting with "- " from becoming a list', () => {
    const { markdown, reloaded } = roundTrip('<p>- not a list</p>')
    expect(markdown).toBe('\\- not a list')
    expect(reloaded).not.toContain('<ul>')
  })

  it('keeps a paragraph starting with "1. " from becoming an ordered list', () => {
    const { reloaded } = roundTrip('<p>1. not a list</p>')
    expect(reloaded).not.toContain('<ol>')
  })

  it('keeps a paragraph starting with ">" from becoming a blockquote', () => {
    const { reloaded } = roundTrip('<p>&gt; not a quote</p>')
    expect(reloaded).not.toContain('<blockquote>')
  })

  it('leaves headings as headings', () => {
    expect(fromHtml('<h2>real heading</h2>')).toBe('## real heading')
  })

  it('does not escape markers that are not at the line start', () => {
    // Only line starts are ambiguous; escaping mid-line would litter prose.
    expect(fromHtml('<p>a # b</p>')).toBe('a # b')
    expect(fromHtml('<p>see - this</p>')).toBe('see - this')
  })

  it('escapes only the first line of a multi-line paragraph', () => {
    const markdown = fromHtml('<p># first<br># second</p>')
    expect(markdown.startsWith('\\#')).toBe(true)
  })
})

describe('table cell escaping (issue #1 comments)', () => {
  it('escapes a pipe so columns do not shift', () => {
    const html = '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>a|b</p></td><td><p>c</p></td></tr></tbody></table>'
    const { markdown } = roundTrip(html)
    expect(markdown).toContain('a\\|b')

    const editor = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
    // The pipe must survive as cell content, not split the row.
    expect(editor.getHTML()).toContain('a|b')
    editor.destroy()
  })
})

describe('code escaping (issue #1 comments)', () => {
  it('uses a longer fence when a code block contains a backtick fence', () => {
    const html = '<pre><code>line1\n```\nline2</code></pre>'
    const { markdown, reloaded } = roundTrip(html)
    expect(markdown).toContain('````')
    // All three lines must remain inside one code block.
    expect(reloaded).toContain('line1')
    expect(reloaded).toContain('line2')
    expect(reloaded.match(/<pre>/g)?.length).toBe(1)
  })

  it('keeps a plain code block fenced with three backticks', () => {
    const { markdown } = roundTrip('<pre><code>plain</code></pre>')
    expect(markdown.startsWith('```')).toBe(true)
    expect(markdown).not.toContain('````')
  })

  // Inline code containing a backtick must be fenced by a *longer* run than any
  // run inside it, so ``a`b`` is written as `` ``a`b`` `` instead of `` `a`b` ``
  // (which reparsed as `<code>a</code>b\``).
  //
  // The fence cannot be chosen inside the `code` mark's `renderMarkdown`:
  // `@tiptap/markdown` calls that renderer with a synthetic node whose only child
  // is a fixed placeholder, and caches the delimiters from it before the real
  // text is emitted — so the renderer never sees its content. The session instead
  // repairs the emitted Markdown against the code spans in the document itself
  // (see `repairInlineCodeFences`), and a `codespan` tokenizer reads the wider
  // fence back. Full matrix: `inline-code-fence.test.ts`.
  it('widens the fence when inline code contains a backtick', () => {
    const { markdown } = roundTrip('<p><code>a`b</code></p>')
    expect(markdown).toBe('``a`b``')
  })

  it('leaves inline code without backticks single-fenced', () => {
    const { markdown } = roundTrip('<p><code>plain</code></p>')
    expect(markdown).toBe('`plain`')
  })
})

describe('image and link escaping (issue #1 comments)', () => {
  it('escapes a bracket in image alt text', () => {
    const { markdown, reloaded } = roundTrip('<p><img src="https://ex.com/i.png" alt="a]b"></p>')
    expect(markdown).toContain('a\\]b')
    expect(reloaded).toContain('<img')
    expect(reloaded).toContain('a]b')
  })

  it('wraps a destination containing parentheses', () => {
    const markdown = fromHtml('<p><a href="https://ex.com/a(b">x</a></p>')
    expect(markdown).toBe('[x](<https://ex.com/a(b>)')

    const editor = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
    expect(editor.getHTML()).toContain('https://ex.com/a(b')
    editor.destroy()
  })

  it('leaves an ordinary URL unwrapped', () => {
    expect(fromHtml('<p><a href="https://example.com">x</a></p>')).toBe('[x](https://example.com)')
    expect(fromHtml('<p><img src="https://example.com/i.png" alt="E"></p>')).toContain('(https://example.com/i.png)')
  })
})
