// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/render/index.js'

describe('markdown extensions', () => {
  it('renders footnote references and return links', () => {
    const html = renderMarkdown('正文[^note].\n\n[^note]: 说明文字', { idPrefix: 'post-a' })
    expect(html).toContain('class="footnote-ref"')
    expect(html).toContain('id="post-a-fn1"')
    expect(html).toContain('href="#post-a-fn1"')
    expect(html).toContain('href="#post-a-fnref1"')
    expect(html).toContain('说明文字')
    expect(html).not.toContain('[^note]')
    expect(html).not.toContain('target="_blank"')
  })

  it('gives repeated references distinct return destinations', () => {
    const html = renderMarkdown('第一次[^n]，第二次[^n]。\n\n[^n]: 注释', { idPrefix: 'notes' })
    expect(html).toContain('id="notes-fnref1"')
    expect(html).toContain('id="notes-fnref1:1"')
    expect(html).toContain('href="#notes-fnref1:1"')
    expect(renderMarkdown('[^unknown]')).toContain('[^unknown]')
  })

  it.each(['note', 'tip', 'info', 'warning', 'danger'])('renders a controlled %s container', (type) => {
    const html = renderMarkdown('::: ' + type + ' 标题\n正文 **加粗**\n:::')
    expect(html).toContain('class="nd-container nd-container--' + type + '"')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('标题')
    expect(html).not.toContain(':::')
  })

  it('uses native details and an escaped summary', () => {
    const html = renderMarkdown('::: details <img src=x onerror=alert(1)>\n隐藏文字\n:::')
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
    expect(html).toContain('隐藏文字')
  })

  it('preserves unknown and unclosed container markers', () => {
    expect(renderMarkdown('::: iframe\n正文\n:::')).not.toContain('nd-container')
    expect(renderMarkdown('::: note\n正文')).toContain('::: note')
  })

  it('supports nested containers without consuming the outer close', () => {
    const html = renderMarkdown(':::: note 外层\n::: tip 内层\n文字\n:::\n::::')
    expect(html).toContain('nd-container--note')
    expect(html).toContain('nd-container--tip')
    expect(html).not.toContain(':::')
  })

  it('renders semantic definition lists', () => {
    const html = renderMarkdown('术语\n: 第一条 **定义**\n: 第二条定义')
    expect(html).toContain('<dl>')
    expect(html).toContain('<dt>术语</dt>')
    expect(html).toContain('<dd>')
    expect(html).toContain('<strong>定义</strong>')
  })

  it('keeps old headings unchanged until anchors or numbering are requested', () => {
    expect(renderMarkdown('# 旧标题')).toBe('<h1>旧标题</h1>')
    expect(renderMarkdown('# 旧标题', { headingNumbers: false })).toBe('<h1>旧标题</h1>')
    expect(renderMarkdown('# 标题', { idPrefix: 'post' })).toBe('<h1 id="post-标题">标题</h1>')
  })

  it('generates a TOC with local links to unique Chinese headings', () => {
    const html = renderMarkdown('[TOC]\n\n# 安装 **说明**\n\n## 安装 说明\n\n## 安装 说明', { idPrefix: 'guide' })
    expect(html).toContain('class="nd-toc"')
    expect(html).toContain('href="#guide-安装-说明"')
    expect(html).toContain('id="guide-安装-说明"')
    expect(html).toContain('id="guide-安装-说明-2"')
    expect(html).toContain('id="guide-安装-说明-3"')
    expect(html).not.toContain('target="_blank"')
    expect(renderMarkdown('文字 [TOC]')).toContain('[TOC]')
  })

  it('uses explicit heading IDs without including them in visible text', () => {
    const html = renderMarkdown('[TOC]\n\n## 安装 {#install}\n\n## 更新 {#install}', { idPrefix: 'resource' })
    expect(html).toContain('id="resource-install"')
    expect(html).toContain('id="resource-install-2"')
    expect(html).toContain('href="#resource-install"')
    expect(html).not.toContain('{#install}')
  })

  it('numbers headings on request while preserving their stable IDs', () => {
    const source = '# 开始\n\n## 安装\n\n### Windows\n\n## 更新\n\n# 其他'
    const html = renderMarkdown(source, { idPrefix: 'article', headingNumbers: true })
    expect(html).toContain('class="nd-heading-number"')
    expect(html).toContain('>1</span> ')
    expect(html).toContain('>1.1</span> ')
    expect(html).toContain('>1.1.1</span> ')
    expect(html).toContain('>1.2</span> ')
    expect(html).toContain('>2</span> ')
    expect(html).toContain('id="article-安装"')
    expect(renderMarkdown(source, { idPrefix: 'article' })).toContain('id="article-安装"')
  })

  it('uses an empty-heading fallback and safely normalizes the namespace', () => {
    const html = renderMarkdown('[TOC]\n\n# !!!\n\n# !!!', { idPrefix: 'post" onmouseover="x' })
    expect(html).not.toContain('onmouseover=')
    expect(html).toContain('-section"')
    expect(html).toContain('-section-2"')
  })

  it('isolates per-render heading, footnote, and carousel state', () => {
    const source = '[TOC]\n\n# 标题\n\n脚注[^n]\n\n[^n]: 说明\n\n![a](a.png) ![b](b.png)'
    const before = renderMarkdown(source, { idPrefix: 'a' })
    const other = renderMarkdown(source, { idPrefix: 'b' })
    expect(other).toContain('id="b-c-1-1"')
    expect(other).not.toContain('id="a-')
    expect(renderMarkdown(source, { idPrefix: 'a' })).toBe(before)
  })

  it('marks ordinary and carousel images, without marking card thumbnails', () => {
    expect(renderMarkdown('![a](a.png)')).toContain('data-nd-image')
    expect(renderMarkdown('![a](a.png) ![b](b.png)').match(/data-nd-image/g)).toHaveLength(2)
    const html = renderMarkdown('https://example.com\n\n{.card}', {
      data: { links: new Map([['https://example.com', { card: { title: 'Card', image: 'https://example.com/a.png' } }]]) },
    })
    expect(html).toContain('class="nd-card__image"')
    expect(html).not.toContain('data-nd-image')
  })

  it('preserves new syntax, Emoji, and strike markers inside code', () => {
    const fence = String.fromCharCode(96).repeat(3)
    const source = fence + '\n[TOC]\n::: note\n[^x]: note\nterm\n: definition\n:smile: ~~strike~~\n' + fence
    const html = renderMarkdown(source, { headingNumbers: true })
    expect(html).toContain('[TOC]')
    expect(html).toContain(':smile: ~~strike~~')
    expect(html).not.toContain('nd-toc')
    expect(html).not.toContain('nd-container')
    expect(html).not.toContain('footnote-ref')
    expect(html).not.toContain('<s>')
  })

  it('retains existing table alignment, Emoji, and strikethrough', () => {
    const html = renderMarkdown('| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| :smile: | ~~删除~~ | 保留 |')
    expect(html).toContain('text-align:left')
    expect(html).toContain('text-align:center')
    expect(html).toContain('text-align:right')
    expect(html).toContain('😄')
    expect(html).toContain('<s>删除</s>')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
