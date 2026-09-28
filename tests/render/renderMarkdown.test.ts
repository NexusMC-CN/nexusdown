// @vitest-environment node
import { Mark, type MarkdownLexerConfiguration, type MarkdownToken } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/render/index.js'

/**
 * `renderMarkdown` is the display side of Nexusdown: it parses Markdown with the
 * same Tiptap extensions the editor uses and renders the result to HTML without
 * touching a DOM, so it is safe to call during SSR.
 *
 * The environment is deliberately **node**, not jsdom: the whole point of the
 * module is that it works without `document`, and running it under jsdom would
 * hide a regression that reintroduced a DOM dependency.
 */
describe('renderMarkdown', () => {
  it('renders without a DOM', () => {
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')

    const html = renderMarkdown('# Hello')
    expect(html).toBe('<h1>Hello</h1>')
  })

  it('renders headings', () => {
    expect(renderMarkdown('# H1')).toBe('<h1>H1</h1>')
    expect(renderMarkdown('## H2')).toBe('<h2>H2</h2>')
    expect(renderMarkdown('###### H6')).toBe('<h6>H6</h6>')
  })

  it('renders inline formatting', () => {
    expect(renderMarkdown('**bold**')).toBe('<p><strong>bold</strong></p>')
    expect(renderMarkdown('*italic*')).toBe('<p><em>italic</em></p>')
    expect(renderMarkdown('~~strike~~')).toBe('<p><s>strike</s></p>')
    expect(renderMarkdown('`code`')).toBe('<p><code>code</code></p>')
  })

  it('renders a highlight written as ==text==, the syntax the editor emits', () => {
    // The closed loop this module exists for: `==text==` is what the editor
    // writes, and the renderer understands it here through the *same* Highlight
    // extension — no second parser, no HTML, no per-consumer wiring. If this
    // fails while the editor side passes, the extension is not actually shared.
    const html = renderMarkdown('==高亮==')

    expect(html).toContain('<mark')
    expect(html).toMatch(/<mark[^>]*>高亮<\/mark>/)
  })

  it('renders links with their destination and title', () => {
    const html = renderMarkdown('[text](https://example.com "Title")')
    expect(html).toContain('<a')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('title="Title"')
    expect(html).toContain('>text</a>')
  })

  it('renders images with their source and alt text', () => {
    const html = renderMarkdown('![alt text](https://example.com/a.png)')
    expect(html).toContain('<img')
    expect(html).toContain('src="https://example.com/a.png"')
    expect(html).toContain('alt="alt text"')
  })

  it('renders bullet and ordered lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>')
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li><p>a</p></li><li><p>b</p></li></ol>')
  })

  it('renders task lists as GFM checkboxes', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done')
    expect(html).toContain('data-type="taskList"')
    expect(html).toContain('data-type="taskItem"')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('data-checked="true"')
  })

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted')).toBe('<blockquote><p>quoted</p></blockquote>')
  })

  it('renders a fenced code block with its language class', () => {
    const html = renderMarkdown('```ts\nconst x = 1\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('class="language-ts"')
    expect(html).toContain('const x = 1')
  })

  it('renders a hard break', () => {
    expect(renderMarkdown('line one  \nline two')).toContain('<br')
  })

  it('renders a horizontal rule', () => {
    expect(renderMarkdown('---')).toBe('<hr/>')
  })

  it('renders a GFM pipe table as an HTML <table>', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| c | d |')

    expect(html).toContain('<table')
    expect(html).toContain('<tbody>')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
    expect(html).toContain('<p>a</p>')
    expect(html).toContain('<p>d</p>')
    // Header cells come first, body cells after.
    expect(html.indexOf('<th')).toBeLessThan(html.indexOf('<td'))
  })

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   ')).toBe('')
    expect(renderMarkdown('\n\n\t ')).toBe('')
  })

  it('accepts the same Markdown the editor writes', () => {
    // A document mixing several constructs, as the editor would serialise it.
    const markdown = [
      '# Title',
      '',
      'A paragraph with **bold**, ==highlight== and a [link](https://example.com).',
      '',
      '| a | b |',
      '| --- | --- |',
      '| c | d |',
    ].join('\n')

    const html = renderMarkdown(markdown)
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<mark')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('<table')
  })

  it('applies a custom extensions array', () => {
    // A consumer syntax registered for the editor is understood here without any
    // further wiring — the same extension set drives both.
    const Badge = Mark.create({
      name: 'badge',
      parseHTML: () => [{ tag: 'span[data-badge]' }],
      renderHTML: () => ['span', { 'data-badge': '' }, 0],
      markdownTokenName: 'badge',
      markdownTokenizer: {
        name: 'badge',
        level: 'inline' as const,
        start: (src: string) => src.indexOf('!!'),
        tokenize(src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) {
          const match = /^!!([^!]+)!!/.exec(src)
          if (!match) return undefined
          return { type: 'badge', raw: match[0], text: match[1], tokens: helpers.inlineTokens(match[1]) } as MarkdownToken
        },
      },
      parseMarkdown: (token, helpers) => helpers.applyMark('badge', helpers.parseInline(token.tokens || [])),
      renderMarkdown: (node, helpers) => `!!${helpers.renderChildren(node)}!!`,
    })
    const extensions = [Badge]

    expect(renderMarkdown('!!custom!!', { extensions })).toBe('<p><span data-badge="">custom</span></p>')
    // Reusing the same array reference must keep working (the pipeline is cached
    // per array, and rebuilding it would grow the shared tokenizer registry).
    expect(renderMarkdown('!!again!!', { extensions })).toBe('<p><span data-badge="">again</span></p>')
  })

  it('treats an empty extensions array as the default set', () => {
    expect(renderMarkdown('**bold**', { extensions: [] })).toBe('<p><strong>bold</strong></p>')
  })
})
