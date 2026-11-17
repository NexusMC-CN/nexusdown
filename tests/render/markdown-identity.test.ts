// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/render/index.js'

describe('Markdown identity and mixed syntax', () => {
  it('does not parse a heading footnote twice when stripping an explicit ID', () => {
    const html = renderMarkdown('# 标题[^n] {#title}\n\n[^n]: 注释', { idPrefix: 'post' })
    expect(html).toContain('id="post-title"')
    expect(html).toContain('id="post-fnref1"')
    expect(html).toContain('href="#post-fnref1"')
    expect(html).not.toContain('post-fnref1:1')
  })

  it('uses visible Emoji text for the TOC without replacing code-span shortcodes', () => {
    const html = renderMarkdown('[TOC]\n\n# :smile: 安装\n\n## ' +
      String.fromCharCode(96) + ':rocket:' + String.fromCharCode(96), { idPrefix: 'guide' })
    const toc = html.slice(0, html.indexOf('</nav>'))
    expect(toc).toContain('>😄 安装</a>')
    expect(toc).toContain('>:rocket:</a>')
    expect(html).toContain('id="guide-安装"')
  })

  it('keeps heading IDs distinct from footnotes and carousel targets', () => {
    const source = '[TOC]\n\n# fn1\n\n# fnref1\n\n# c-1-1\n\n正文[^n]' +
      '\n\n[^n]: 注释\n\n![a](a.png) ![b](b.png)'
    const html = renderMarkdown(source, { idPrefix: 'post' })
    const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    expect(html).toContain('href="#post-fn1"')
    expect(html).toContain('href="#post-c-1-1"')
  })

  it('reserves explicit stable IDs before automatic heading slugs', () => {
    const html = renderMarkdown('[TOC]\n\n# install\n\n# 安装步骤 {#install}', { idPrefix: 'guide' })
    expect(html).toContain('<h1 id="guide-install">安装步骤</h1>')
    expect(html).toContain('<h1 id="guide-install-2">install</h1>')
  })

  it('does not close a container at a marker inside fenced code', () => {
    const fence = String.fromCharCode(96).repeat(3)
    const html = renderMarkdown('::: note\n\n' + fence + '\n:::\n' + fence +
      '\n\n容器最后一段\n:::')
    expect(html).toContain('nd-container--note')
    expect(html).toContain('容器最后一段</p></div>')
    expect(html).toContain('<code>:::</code>')
  })
})
