/**
 * `mention` 渲染侧测试。
 *
 * ⚠️ 重点是**降级**与**墓碑**：没有解析结果时必须原样输出 `@slug` 纯文本
 * （降级路径不该经过胶囊/卡片代码的任何一行）；`missing` 必须出墓碑而**不是链接**。
 */
import { renderMarkdown } from '../../src/render/index.js'
import type { MentionResolution, RenderData } from '../../src/render/feature.js'

const RES: MentionResolution = { title: 'Nexus 优化器', href: '/resources/nexus-optimizer', kind: 'resource' }

const mentions = (entries: Array<[string, MentionResolution]>) =>
  ({ mentions: new Map(entries) }) as RenderData

describe('mention —— 行内', () => {
  it('句中 `@slug` → 行内胶囊，href + 显示名（显示名来自查库，不是 slug）', () => {
    const html = renderMarkdown('这句话里提到 @nexus-optimizer 很好用', {
      data: mentions([['nexus-optimizer', RES]]),
    })
    expect(html).toContain('class="nd-mention"')
    expect(html).toContain('href="/resources/nexus-optimizer"')
    expect(html).toContain('Nexus 优化器')
    // 段落还在，胶囊只是段落里的一段
    expect(html).toContain('<p>')
    expect(html).not.toContain('nd-mention-card')
  })

  it('★ 取不到解析结果 → 原样输出纯文本（降级）', () => {
    const html = renderMarkdown('提到 @ghost 一句', { data: mentions([['other', RES]]) })
    expect(html).not.toContain('nd-mention')
    expect(html).toContain('@ghost')
  })

  it('★ 完全没有 data 也不报错，纯文本', () => {
    expect(() => renderMarkdown('提到 @ghost 一句')).not.toThrow()
    expect(renderMarkdown('提到 @ghost 一句')).toContain('@ghost')
  })

  it('★ `missing: true` → 「已失效」墓碑，**不是链接**', () => {
    const html = renderMarkdown('提到 @gone 一句', {
      data: mentions([['gone', { ...RES, missing: true }]]),
    })
    expect(html).toContain('nd-mention--missing')
    expect(html).toContain('已失效')
    // 关键：墓碑绝不能是 <a>（点了会 404）
    expect(html).not.toContain('<a ')
  })

  it('`#fragment` 拼进 href', () => {
    const html = renderMarkdown('见 @nexus-optimizer#block-install', {
      data: mentions([['nexus-optimizer', RES]]),
    })
    expect(html).toContain('href="/resources/nexus-optimizer#block-install"')
  })
})

describe('mention —— 独占一段 → 卡片', () => {
  it('整段只有一个提及 → 卡片，不套 <p>', () => {
    const html = renderMarkdown('@nexus-optimizer', { data: mentions([['nexus-optimizer', RES]]) })
    expect(html).toContain('class="nd-mention-card"')
    expect(html).toContain('Nexus 优化器')
    expect(html).not.toContain('<p>')
  })

  it('卡片带 summary / byline / badges / image', () => {
    const html = renderMarkdown('@nexus-optimizer', {
      data: mentions([
        [
          'nexus-optimizer',
          {
            ...RES,
            summary: '一句话摘要',
            byline: 'alice',
            badges: ['v1.2', '10k'],
            image: 'https://cdn.example.com/x.png',
          },
        ],
      ]),
    })
    expect(html).toContain('一句话摘要')
    expect(html).toContain('alice')
    expect(html).toContain('>v1.2<')
    expect(html).toContain('>10k<')
    expect(html).toContain('nd-mention-card__image')
  })

  it('★ 段落里混了文字 → 不是卡片（走行内）', () => {
    const html = renderMarkdown('看这个 @nexus-optimizer 挺好', {
      data: mentions([['nexus-optimizer', RES]]),
    })
    expect(html).not.toContain('nd-mention-card')
    expect(html).toContain('class="nd-mention"')
  })

  it('★ 引用块里的独占提及**不是**卡片（对齐编辑器侧「顶层段落」判据）', () => {
    const html = renderMarkdown('> @nexus-optimizer', { data: mentions([['nexus-optimizer', RES]]) })
    expect(html).not.toContain('nd-mention-card')
    expect(html).toContain('class="nd-mention"')
    expect(html).toContain('<blockquote>')
  })

  it('★ 墓碑即使独占一段也**不是卡片**', () => {
    const html = renderMarkdown('@gone', { data: mentions([['gone', { ...RES, missing: true }]]) })
    expect(html).not.toContain('nd-mention-card')
    expect(html).toContain('nd-mention--missing')
  })

  it('★ 缩略图 URL 非法（javascript:）→ 不输出 img', () => {
    const html = renderMarkdown('@nexus-optimizer', {
      data: mentions([['nexus-optimizer', { ...RES, image: 'javascript:alert(1)' }]]),
    })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
  })
})

describe('mention —— 词边界与转义', () => {
  it('★ `a@b.com` 不被误认（邮箱）', () => {
    const html = renderMarkdown('联系 a@b.com 即可', {
      data: mentions([['b', RES]]),
    })
    expect(html).not.toContain('nd-mention')
    expect(html).toContain('a@b.com')
  })

  it('★ `@Foo`（大写）不认 —— 契约的 slug 只收小写', () => {
    const html = renderMarkdown('@Foo', { data: mentions([['Foo', RES]]) })
    expect(html).not.toContain('nd-mention')
  })

  it('★ 显示名里的 HTML 被转义', () => {
    const html = renderMarkdown('@x', {
      data: mentions([['x', { ...RES, title: '<img src=x onerror=alert(1)>' }]]),
    })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('★ 摘要 / 角标里的 HTML 也被转义', () => {
    const html = renderMarkdown('@x', {
      data: mentions([['x', { ...RES, summary: '<b>s</b>', badges: ['<i>'] }]]),
    })
    expect(html).not.toContain('<b>s</b>')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<i>')
  })

  it('行内代码里的 `@foo` 不替换（文本 token 到不了）', () => {
    const html = renderMarkdown('`@nexus-optimizer`', {
      data: mentions([['nexus-optimizer', RES]]),
    })
    expect(html).not.toContain('nd-mention')
    expect(html).toContain('<code>@nexus-optimizer</code>')
  })
})
