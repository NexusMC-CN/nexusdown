/**
 * `link-card` 渲染侧测试。
 *
 * ⚠️ 重点是**降级**：没有元数据时，段落必须**原样**渲染成普通链接 ——
 * 降级路径不该经过卡片代码的任何一行（见 `link-card.ts` 的注释）。
 */
import { renderMarkdown } from '../../src/render/index.js'
import type { RenderData } from '../../src/render/feature.js'

const links = (entries: Array<[string, NonNullable<RenderData['links']> extends ReadonlyMap<string, infer V> ? V : never]>) =>
  ({ links: new Map(entries) }) as RenderData

describe('link-card', () => {
  it('独占一段的裸链接 + 有元数据 → 出卡片', () => {
    const html = renderMarkdown('https://example.com/post', {
      data: links([['https://example.com/post', { card: { title: '标题', description: '描述', site: 'Example' } }]]),
    })
    expect(html).toContain('class="nd-card"')
    expect(html).toContain('标题')
    expect(html).toContain('描述')
    expect(html).toContain('Example')
    // 卡片本身就是一个 <a>，不该再套一层 <p>
    expect(html).not.toContain('<p>')
  })

  it('★ 没有数据 → 原样渲染成普通链接（降级）', () => {
    const html = renderMarkdown('https://example.com/post')
    expect(html).not.toContain('nd-card')
    expect(html).toContain('<p>')
    expect(html).toContain('<a ')
    expect(html).toContain('https://example.com/post')
  })

  it('★ 段落里混了文字 → 不是卡片', () => {
    const html = renderMarkdown('看这个 https://example.com/post 挺好', {
      data: links([['https://example.com/post', { card: { title: '不该出现' } }]]),
    })
    expect(html).not.toContain('nd-card')
    expect(html).toContain('看这个')
    expect(html).not.toContain('不该出现')
  })

  it('Markdown 链接写法也认', () => {
    const html = renderMarkdown('[标题](https://example.com/post)', {
      data: links([['https://example.com/post', { card: { title: '卡片标题' } }]]),
    })
    expect(html).toContain('nd-card')
    expect(html).toContain('卡片标题')
  })

  it('★ 缩略图 URL 非法（javascript:）→ 不输出 img', () => {
    const html = renderMarkdown('https://example.com/post', {
      data: links([['https://example.com/post', { card: { title: 't', image: 'javascript:alert(1)' } }]]),
    })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
  })

  it('★ 元数据里的 HTML 被转义', () => {
    const html = renderMarkdown('https://example.com/post', {
      data: links([['https://example.com/post', { card: { title: '<img src=x onerror=alert(1)>' } }]]),
    })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('外链带 noopener/noreferrer/nofollow', () => {
    const html = renderMarkdown('https://example.com/post', {
      data: links([['https://example.com/post', { card: { title: 't' } }]]),
    })
    expect(html).toContain('rel="noopener noreferrer nofollow"')
    expect(html).toContain('target="_blank"')
  })

  it('没有 site 时退回 hostname', () => {
    const html = renderMarkdown('https://example.com/a/b', {
      data: links([['https://example.com/a/b', { card: { title: 't' } }]]),
    })
    expect(html).toContain('example.com')
  })
})
