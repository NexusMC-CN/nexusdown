import { describe, expect, it } from 'vitest'
import * as render from '../../src/render/index.js'

const available = { status: 'available' as const, kind: 'tutorial' as const, title: 'Current <title>', href: '/tutorials/start#block-b1', targetTitle: 'Install <now>', summary: 'Plain [[post:nested]] <script>alert(1)</script>' }
const data = { contentReferences: new Map([['tutorial:t1#block:b1', available]]) }

describe('stable content references', () => {
  it('renders a standalone reference as a card with current escaped data and no recursive embedding', () => {
    const html = render.renderMarkdown('[[tutorial:t1#block:b1]]', { data })
    expect(html).toContain('class="nd-content-reference-card"')
    expect(html).toContain('href="/tutorials/start#block-b1"')
    expect(html).toContain('Current &lt;title&gt;')
    expect(html).toContain('Install &lt;now&gt;')
    expect(html).toContain('Plain [[post:nested]] &lt;script&gt;')
    expect(html).not.toContain('<p>')
    expect(html.match(/<a /g)).toHaveLength(1)
  })

  it('renders inline links while keeping ordinary reference links and legacy mentions', () => {
    const html = render.renderMarkdown('Read [[tutorial:t1#block:b1]], [ordinary][doc] and @legacy.\n\n[doc]: /guide', {
      data: { ...data, mentions: new Map([['legacy', { title: 'Legacy', href: '/resources/legacy', kind: 'resource' as const }]]) },
    })
    expect(html).toContain('class="nd-content-reference"')
    expect(html).not.toContain('nd-content-reference-card')
    expect(html).toContain('href="/guide"')
    expect(html).toContain('class="nd-mention"')
  })

  it('keeps missing data as safe source and unavailable data as a generic non-link tombstone', () => {
    expect(render.renderMarkdown('[[post:p1]]')).toBe('<p>[[post:p1]]</p>')
    const html = render.renderMarkdown('[[post:p1]]', { data: { contentReferences: new Map([['post:p1', { status: 'unavailable' as const }]]) } })
    expect(html).toContain('内容不可用')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('p1')
  })

  it.each(['//evil.test/x', '/\\evil.test/x', 'https://evil.test', 'javascript:alert(1)', '/ok\nwrong', '/ok\u007fwrong'])('rejects unsafe href %j', (href) => {
    const html = render.renderMarkdown('[[post:p1]]', { data: { contentReferences: new Map([['post:p1', { status: 'available' as const, kind: 'post' as const, title: 'Secret', href }]]) } })
    expect(html).not.toContain('<a')
    expect(html).not.toContain('Secret')
  })

  it('uses render-time maps without retaining another request’s data', () => {
    const first = render.renderMarkdown('[[tutorial:t1#block:b1]]', { data })
    const next = render.renderMarkdown('[[tutorial:t1#block:b1]]', { data: { contentReferences: new Map([['tutorial:t1#block:b1', { ...available, title: 'Renamed' }]]) } })
    expect(first).toContain('Current &lt;title&gt;')
    expect(next).toContain('Renamed')
    expect(next).not.toContain('Current')
    expect(render.renderMarkdown('[[tutorial:t1#block:b1]]')).not.toContain('Renamed')
  })

  it('extracts unique semantic targets in source order across kinds and fragments', () => {
    expect(render.extractContentReferences('[[resource:R_1]] [[tutorial:t1#section:s1]] [[tutorial:t1#block:b1]] [[post:p-1]] [[resource:R_1]]')).toEqual([
      { kind: 'resource', id: 'R_1' },
      { kind: 'tutorial', id: 't1', fragmentType: 'section', fragmentId: 's1' },
      { kind: 'tutorial', id: 't1', fragmentType: 'block', fragmentId: 'b1' },
      { kind: 'post', id: 'p-1' },
    ])
  })

  it('excludes code, escapes, links, images, destinations, definitions, HTML attrs, and dialect attrs', () => {
    const source = [
      '`[[post:code]]`', '```md\n[[post:fence]]\n```', '    [[post:indent]]',
      '\\[[post:escaped]]', '[see [[post:label]]](/a)', '[ref [[post:label2]]][r]',
      '![[[post:alt]]](/a.png)', '[url](/[[post:dest]])', '[r]: /[[post:def]]',
      '<span title="[[post:html]]">text</span>', '{title="[[post:attr]]"}',
      '- item\n\n{caption="[[post:caption]]"}', '**[[post:yes]]**',
    ].join('\n\n')
    expect(render.extractContentReferences(source)).toEqual([{ kind: 'post', id: 'yes' }])
    const html = render.renderMarkdown(source, { data: { contentReferences: new Map([['post:label', { status: 'available' as const, kind: 'post' as const, title: 'Nested', href: '/posts/label' }]]) } })
    expect(html).not.toContain('Nested')
  })

  it('validates IDs and tutorial-only paired fragments', () => {
    const good = { kind: 'tutorial' as const, id: 'T_1', fragmentType: 'section' as const, fragmentId: 'S-1' }
    expect(render.contentReferenceKey(good)).toBe('tutorial:T_1#section:S-1')
    expect(render.formatContentReference(good)).toBe('[[tutorial:T_1#section:S-1]]')
    for (const invalid of [
      { kind: 'post', id: '-bad' }, { kind: 'resource', id: 'a'.repeat(129) },
      { kind: 'tutorial', id: 'x', fragmentType: 'block' },
      { kind: 'post', id: 'x', fragmentType: 'block', fragmentId: 'b' },
      { kind: 'tutorial', id: 'x', fragmentId: 'b' },
      { kind: 'post', id: 'p\n' },
      { kind: 'tutorial', id: 't', fragmentType: 'block', fragmentId: 'b\r\n' },
    ]) expect(() => render.contentReferenceKey(invalid as never)).toThrow()
    expect(render.extractContentReferences('[[post:-bad]] [[resource:x#block:b]] [[tutorial:t#other:b]] [[post:中文]]')).toEqual([])
  })

  it('preserves an ordinary Markdown link whose full label resembles reference syntax', () => {
    const source = '[[post:p1]](/ordinary) ![[[post:p2]]](/image.png) <https://example.test/[[post:p3]]> https://example.test/[[post:p4]]'
    expect(render.extractContentReferences(source)).toEqual([])
    const html = render.renderMarkdown(source, { data: { contentReferences: new Map([['post:p1', { status: 'available' as const, kind: 'post' as const, title: 'Should not appear', href: '/posts/p1' }]]) } })
    expect(html).toContain('href="/ordinary"')
    expect(html).not.toContain('Should not appear')
  })

  it.each([
    ['www.example.com/[[post:p1]]', 'http://www.example.com/%5B%5Bpost:p1%5D%5D'],
    ['www.example.com/path?q=[[post:p1]]', 'http://www.example.com/path?q=%5B%5Bpost:p1%5D%5D'],
  ])('preserves the complete fuzzy URL %s without a body reference', (source, href) => {
    expect(render.extractContentReferences(source)).toEqual([])
    const html = render.renderMarkdown(source, { data: { contentReferences: new Map([['post:p1', { status: 'available' as const, kind: 'post' as const, title: 'Incorrect live reference', href: '/posts/p1' }]]) } })
    expect(html).toContain(`href="${href}"`)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).not.toContain('nd-content-reference')
    expect(html).not.toContain('Incorrect live reference')
  })

  it.each([
    '<span title="line\n[[post:p1]]">text</span>',
    '<span title="a > [[post:p1]]">text</span>',
    "<span title='line\n[[post:p1]]'>text</span>",
    "<span title='a > [[post:p1]]'>text</span>",
  ])('excludes a quoted HTML attribute in %s and resumes after the tag', (tag) => {
    const source = `${tag} see [[post:p2]]`
    expect(render.extractContentReferences(source)).toEqual([{ kind: 'post', id: 'p2' }])
    const html = render.renderMarkdown(source, { data: { contentReferences: new Map([
      ['post:p1', { status: 'available' as const, kind: 'post' as const, title: 'Incorrect attribute reference', href: '/posts/p1' }],
      ['post:p2', { status: 'available' as const, kind: 'post' as const, title: 'Visible body reference', href: '/posts/p2' }],
    ]) } })
    expect(html).not.toContain('Incorrect attribute reference')
    expect(html).toContain('Visible body reference')
    expect(html.match(/class="nd-content-reference"/g)).toHaveLength(1)
  })

  it('does not let quoted tag text inside code hide a real reference between code spans', () => {
    const source = '`<span title="` [[post:p2]] `">`'
    expect(render.extractContentReferences(source)).toEqual([{ kind: 'post', id: 'p2' }])
    expect(render.renderMarkdown(source, { data: { contentReferences: new Map([
      ['post:p2', { status: 'available' as const, kind: 'post' as const, title: 'Real body reference', href: '/posts/p2' }],
    ]) } })).toContain('Real body reference')
  })

  it('accepts maximum length IDs and bounds preview by Unicode characters', () => {
    const target = { kind: 'tutorial' as const, id: 'a'.repeat(128), fragmentType: 'section' as const, fragmentId: 'b'.repeat(128) }
    const source = '[[tutorial:' + 'a'.repeat(128) + '#section:' + 'b'.repeat(128) + ']]'
    expect(render.extractContentReferences(source)).toEqual([target])
    const html = render.renderMarkdown('[[post:p1]]', { data: { contentReferences: new Map([['post:p1', { status: 'available' as const, kind: 'post' as const, title: 'Title', href: '/posts/p1', summary: '😀'.repeat(281) }]]) } })
    expect((html.match(/😀/g) ?? []).length).toBe(280)
    expect(html).not.toContain('\ufffd')
  })
})
