import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * The dialect contract: Nexusdown writes **pure Markdown**.
 *
 * No HTML tags and no BBCode shortcodes may appear in the Markdown the editor
 * produces. Every feature that could only serialise as one of those (colour,
 * underline, superscript, subscript, text alignment, `margin-left` indentation)
 * was removed for exactly this reason, so this file pins the property for
 * everything that *did* survive.
 *
 * Highlight is the one feature that came back: it was re-added with a plain-text
 * syntax (`==text==`) rather than the HTML/BBCode it used to emit, so it belongs
 * in the list below rather than in the removed set.
 */

/** A raw HTML tag anywhere in the output. */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/

/**
 * A closing BBCode shortcode tag such as `[/color]`.
 *
 * A literal `[/color]` typed by the user is written with an escaped bracket
 * (`\[/color\]`) so it re-reads as text rather than a shortcode, hence the
 * negative lookbehind. Requiring the closing tag is enough to detect a
 * shortcode: every one has one.
 */
const BBCODE_CLOSE = /(?<!\\)\[\/[a-zA-Z][\w-]*\]/

function markdownAfter(
  apply: (session: ReturnType<typeof createNexusdownEditor>) => void,
  content = '<p>hello world</p>',
): string {
  const session = createNexusdownEditor({ content, contentType: 'html' })
  session.getEditor().commands.selectAll()
  apply(session)
  const markdown = session.getMarkdown()
  session.destroy()
  return markdown
}

/**
 * One entry per retained toolbar operation. The Markdown each one writes is
 * checked for HTML and BBCode, so a future feature that reintroduces an escape
 * hatch fails here rather than shipping impure Markdown.
 */
const OPERATIONS: Array<[string, (session: ReturnType<typeof createNexusdownEditor>) => void]> = [
  ['bold', (session) => { session.commands.toggleBold() }],
  ['italic', (session) => { session.commands.toggleItalic() }],
  ['strike', (session) => { session.commands.toggleStrike() }],
  ['inline code', (session) => { session.commands.toggleCode() }],
  ['highlight', (session) => { session.commands.toggleHighlight() }],
  ['heading', (session) => { session.commands.setHeading(2) }],
  ['blockquote', (session) => { session.commands.toggleBlockquote() }],
  ['bullet list', (session) => { session.commands.toggleBulletList() }],
  ['ordered list', (session) => { session.commands.toggleOrderedList() }],
  ['task list', (session) => { session.commands.toggleTaskList() }],
  ['code block', (session) => { session.commands.toggleCodeBlock() }],
  ['horizontal rule', (session) => { session.commands.setHorizontalRule() }],
  ['link', (session) => { session.commands.setLink('https://example.com', 'hello world') }],
  ['image', (session) => { session.commands.insertImage('https://example.com/a.png', 'alt') }],
  ['table', (session) => { session.commands.insertTable(2, 2) }],
  ['hard break', (session) => {
    const editor = session.getEditor()
    editor.commands.setTextSelection(editor.state.doc.content.size - 2)
    editor.commands.setHardBreak()
    editor.commands.insertContent('next')
  }],
]

describe('Markdown produced by the toolbar contains no HTML and no BBCode', () => {
  for (const [label, apply] of OPERATIONS) {
    it(`writes pure Markdown for ${label}`, () => {
      const markdown = markdownAfter(apply)

      expect(markdown, `${label} produced an HTML tag`).not.toMatch(HTML_TAG)
      expect(markdown, `${label} produced a BBCode shortcode`).not.toMatch(BBCODE_CLOSE)
      // Sanity check: something was actually written, so the two assertions
      // above are not passing on an empty string.
      expect(markdown.length, `${label} produced nothing`).toBeGreaterThan(0)
    })
  }

  it('writes a table as a GFM pipe table, not an HTML <table>', () => {
    const markdown = markdownAfter((session) => { session.commands.insertTable(2, 2) })

    expect(markdown).not.toContain('<table')
    expect(markdown).not.toContain('<td')
    expect(markdown).toMatch(/\|\s*---\s*\|/) // the GFM delimiter row
    expect(markdown.trimStart().startsWith('|')).toBe(true)
  })

  it('writes a hard break as two trailing spaces, not <br>', () => {
    const markdown = markdownAfter((session) => {
      const editor = session.getEditor()
      editor.commands.setTextSelection(editor.state.doc.content.size - 2)
      editor.commands.setHardBreak()
      editor.commands.insertContent('next')
    }, '<p>hello</p>')

    expect(markdown).not.toContain('<br')
    expect(markdown).toMatch(/ {2}\n/)
  })

  it('writes a highlight as ==text==, not <mark> and not a shortcode', () => {
    // Highlight came back as a *plain-text* syntax on purpose: `==text==` is the
    // Obsidian / markdown-it-mark spelling, so the renderer reads it back with
    // no extra wiring. Anything that serialised as `<mark>` or `[highlight]`
    // would break that loop and reopen the impurity this file exists to stop.
    const markdown = markdownAfter((session) => { session.commands.toggleHighlight() })

    expect(markdown.trim()).toBe('==hello world==')
    expect(markdown).not.toContain('<mark')
    expect(markdown).not.toMatch(HTML_TAG)
    expect(markdown).not.toMatch(BBCODE_CLOSE)
  })

  it('writes a fenced code block with its language, not <pre>', () => {
    const markdown = markdownAfter((session) => { session.commands.toggleCodeBlock() })

    expect(markdown).not.toContain('<pre')
    expect(markdown).not.toContain('<code')
    expect(markdown).toMatch(/^```/m)
    // The fence carries an info string (the block's language) so a reader knows
    // how to highlight the body instead of guessing from nothing.
    expect(markdown).toMatch(/^```[a-zA-Z]/m)
  })

  it('neutralises a literal [color]...[/color] typed by the user', () => {
    // The deleted feature's syntax must not come back through the front door:
    // literal brackets are escaped so the text survives without ever being
    // readable as a shortcode.
    const session = createNexusdownEditor({
      content: '<p>[color color="#ff0000"]x[/color]</p>',
      contentType: 'html',
    })
    const markdown = session.getMarkdown()

    expect(markdown).not.toMatch(BBCODE_CLOSE)
    expect(markdown).toContain('\\[color color="#ff0000"\\]')

    const reloaded = createNexusdownEditor({ content: markdown, contentType: 'markdown' })
    expect(reloaded.getHTML()).toContain('[color color="#ff0000"]x[/color]')
    reloaded.destroy()
    session.destroy()
  })

  it('keeps a mixed document free of HTML and BBCode', () => {
    const source = [
      '# Title',
      '',
      '**bold** and *italic* and `code` and ~~strike~~ and ==marked==',
      '',
      '> quote',
      '',
      '- item',
      '',
      '| a | b |',
      '| --- | --- |',
      '| c | d |',
      '',
      '![alt](https://example.com/a.png)',
      '',
      '[link](https://example.com)',
      '',
      'line one  ',
      'line two',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '- [ ] todo',
    ].join('\n')

    const session = createNexusdownEditor({ content: source, contentType: 'markdown' })
    const markdown = session.getMarkdown()

    expect(markdown).not.toMatch(HTML_TAG)
    expect(markdown).not.toMatch(BBCODE_CLOSE)
    // Every construct survived the trip through the editor.
    for (const fragment of [
      '# Title',
      '**bold**',
      '*italic*',
      '`code`',
      '~~strike~~',
      '==marked==',
      '> quote',
      '- item',
      '| --- | --- |',
      '![alt](https://example.com/a.png)',
      '[link](https://example.com)',
      'line one  \nline two',
      '```ts',
      '- [ ] todo',
    ]) {
      expect(markdown, `lost ${JSON.stringify(fragment)}`).toContain(fragment)
    }
    session.destroy()
  })
})
