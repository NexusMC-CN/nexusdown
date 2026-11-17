// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { contentReferenceKey, extractContentReferences, renderMarkdown, type ContentReferenceTarget } from '../../src/render/index.js'

describe('DOM-free content references', () => {
  it('isolates resolver data across concurrent server work', async () => {
    expect(typeof document).toBe('undefined')
    const target: ContentReferenceTarget = { kind: 'post', id: 'p1' }
    const render = async (title: string) => renderMarkdown('[[post:p1]]', { data: { contentReferences: new Map([[contentReferenceKey(target), { status: 'available', kind: 'post', title, href: '/posts/p1' }]]) } })
    const results = await Promise.all([render('First request'), render('Second request')])
    expect(results[0]).toContain('First request')
    expect(results[0]).not.toContain('Second request')
    expect(results[1]).toContain('Second request')
    expect(renderMarkdown('[[post:p1]]')).toBe('<p>[[post:p1]]</p>')
  })

  it('extracts visible text semantics in Markdown structures while excluding code metadata', () => {
    const source = [
      '# Heading [[resource:heading]]', '> Quote [[post:quote]]', '- Item [[post:list]]',
      '| [[tutorial:table#section:s1]] |\n| --- |',
      '::: note\nContainer [[post:container]]\n:::',
      'Term\n: Definition [[post:definition]]',
      'Note[^n]\n\n[^n]: Footnote [[post:footnote]]',
      '```text title="[[post:meta]]"\n[[post:code]]\n```',
    ].join('\n\n')
    expect(extractContentReferences(source)).toEqual([
      { kind: 'resource', id: 'heading' }, { kind: 'post', id: 'quote' }, { kind: 'post', id: 'list' },
      { kind: 'tutorial', id: 'table', fragmentType: 'section', fragmentId: 's1' },
      { kind: 'post', id: 'container' }, { kind: 'post', id: 'definition' }, { kind: 'post', id: 'footnote' },
    ])
  })
})
