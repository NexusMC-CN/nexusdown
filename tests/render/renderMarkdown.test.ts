// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderMarkdown, type MarkdownItPlugin } from '../../src/render/index.js'

/**
 * `renderMarkdown` is the display side of Nexusdown: it parses Markdown with its
 * own `markdown-it` instance and renders the result to HTML without touching a
 * DOM, so it is safe to call during SSR.
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
    // `==text==` is what the editor writes and what the renderer must read back:
    // the highlight is Nexusdown's own dialect, not GFM, so nothing in a stock
    // Markdown preset understands it.
    const html = renderMarkdown('==高亮==')

    expect(html).toContain('<mark')
    expect(html).toMatch(/<mark[^>]*>高亮<\/mark>/)
  })

  it('keeps an inner = inside a highlight and leaves ==== literal', () => {
    // The editor's highlight tokenizer is lazy and non-empty: it closes at the
    // *first* `==` and refuses an empty span. `[^=]+` (the stock Tiptap rule)
    // would drop `==a=b==` on the floor, and `====` must stay text rather than
    // becoming an empty mark.
    expect(renderMarkdown('==a=b==')).toBe('<p><mark>a=b</mark></p>')
    expect(renderMarkdown('====')).toBe('<p>====</p>')
    expect(renderMarkdown('==a==b==c==')).toBe('<p><mark>a</mark>b<mark>c</mark></p>')
    // A code span still wins over the highlight.
    expect(renderMarkdown('`==x==`')).toBe('<p><code>==x==</code></p>')
  })

  it('escapes raw HTML instead of passing it through', () => {
    // `html: false`. This is the XSS line: the output is inserted with `v-html`,
    // so a tag in the input must never become a tag in the output.
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
  })

  it('refuses to turn a dangerous scheme into a link', () => {
    // markdown-it's own `validateLink` gate. The link degrades to its literal
    // source text — no anchor, and certainly no `javascript:` href.
    for (const markdown of ['[x](javascript:alert(1))', '[x](vbscript:msgbox(1))', '[x](data:text/html,<b>)']) {
      const html = renderMarkdown(markdown)
      expect(html).not.toContain('<a')
      expect(html).toContain('[x]')
    }
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

  it('wraps a task item in the editor\u2019s label + div, nested lists included', () => {
    // `src/style.css` makes `li[data-checked]` a flex row of `label` + `div`.
    // A nested list has to end up *inside* that `div`; as a third child of the
    // `li` it would be laid out beside the text instead of under it.
    expect(renderMarkdown('- [ ] todo')).toBe(
      '<ul data-type="taskList"><li data-checked="false" data-type="taskItem">' +
        '<label><input type="checkbox"/><span/></label><div><p>todo</p></div></li></ul>',
    )
    expect(renderMarkdown('- [x] a\n  - [ ] b')).toBe(
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem">' +
        '<label><input type="checkbox" checked="checked"/><span/></label>' +
        '<div><p>a</p><ul data-type="taskList"><li data-checked="false" data-type="taskItem">' +
        '<label><input type="checkbox"/><span/></label><div><p>b</p></div></li></ul></div></li></ul>',
    )
    // GFM puts task items in *bullet* lists only, and so does the editor.
    expect(renderMarkdown('1. [ ] a')).toBe('<ol><li><p>[ ] a</p></li></ol>')
  })

  it('autolinks what the editor autolinks, and nothing more', () => {
    // A `www.` URL is a link. A bare `word.tld` is not, because plenty of real
    // TLDs are file extensions — `README.md` must stay a filename.
    expect(renderMarkdown('see www.example.com now')).toContain('href="http://www.example.com"')
    expect(renderMarkdown('https://example.com')).toContain('href="https://example.com"')
    expect(renderMarkdown('mail a@b.com')).toContain('href="mailto:a@b.com"')

    expect(renderMarkdown('see example.com now')).toBe('<p>see example.com now</p>')
    expect(renderMarkdown('see README.md here')).toBe('<p>see README.md here</p>')
    expect(renderMarkdown('run start.sh')).toBe('<p>run start.sh</p>')
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

  it('applies a custom plugins array', () => {
    // A consumer syntax has to be described twice — once for the editor, once
    // as a markdown-it plugin for this side. A plugin passed here can add rules
    // or replace any of the Nexusdown defaults.
    const badge: MarkdownItPlugin = (md) => {
      md.inline.ruler.before('emphasis', 'badge', (state, silent) => {
        const match = /^!!([^!]+)!!/.exec(state.src.slice(state.pos))
        if (!match) return false
        if (!silent) {
          state.push('badge_open', 'span', 1).attrSet('data-badge', '')
          state.push('text', '', 0).content = match[1]
          state.push('badge_close', 'span', -1)
        }
        state.pos += match[0].length
        return true
      })
    }
    const plugins = [badge]

    expect(renderMarkdown('!!custom!!', { plugins })).toBe('<p><span data-badge="">custom</span></p>')
    // Reusing the same array reference must keep working (the parser is cached
    // per array, so this exercises the cache rather than a rebuild).
    expect(renderMarkdown('!!again!!', { plugins })).toBe('<p><span data-badge="">again</span></p>')
  })

  it('treats an empty plugins array as the default set', () => {
    expect(renderMarkdown('**bold**', { plugins: [] })).toBe('<p><strong>bold</strong></p>')
  })
})
