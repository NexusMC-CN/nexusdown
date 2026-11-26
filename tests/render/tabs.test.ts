/**
 * `tabs` 渲染侧：相邻围栏 + `{tab="…"}` → 一个零 JS 页签组。
 */
import { describe, expect, it } from 'vitest'

import { renderMarkdown } from '../../src/render/index.js'

const GROUP = [
  '```bash',
  'apt install nginx',
  '```',
  '{tab="Ubuntu"}',
  '',
  '```bash',
  'brew install nginx',
  '```',
  '{tab="macOS"}',
].join('\n')

describe('tabs', () => {
  it('★ 两段相邻围栏 → nd-tabs + 两个 label/panel', () => {
    const html = renderMarkdown(GROUP)
    expect(html).toContain('<div class="nd-tabs">')
    expect(html).toContain('class="nd-tabs__bar"')
    expect((html.match(/class="nd-tabs__panel"/g) ?? []).length).toBe(2)
    expect(html).toContain('for="nd-tabs-1-1"')
    expect(html).toContain('Ubuntu')
    expect(html).toContain('macOS')
  })

  it('只有一段 → 不组（普通代码块）', () => {
    const html = renderMarkdown('```bash\nx\n```\n{tab="Ubuntu"}')
    expect(html).not.toContain('nd-tabs')
    expect(html).toContain('nd-code-fence')
  })

  it('两段之间夹了别的块 → 断开，不组', () => {
    const html = renderMarkdown('```bash\nx\n```\n{tab="A"}\n\n中间\n\n```bash\ny\n```\n{tab="B"}')
    expect(html).not.toContain('nd-tabs')
  })

  it('每个片段的 radio name、id 和 label for 使用相同的稳定命名空间', () => {
    const root = document.createElement('div')
    root.innerHTML = renderMarkdown(GROUP, { idPrefix: 'article-a' }) +
      renderMarkdown(GROUP, { idPrefix: 'article-b' })
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    const labels = Array.from(root.querySelectorAll<HTMLLabelElement>('label'))

    expect(radios.map((radio) => radio.name)).toEqual([
      'article-a-tabs-1', 'article-a-tabs-1', 'article-b-tabs-1', 'article-b-tabs-1',
    ])
    expect(radios.map((radio) => radio.id)).toEqual([
      'article-a-tabs-1-1', 'article-a-tabs-1-2', 'article-b-tabs-1-1', 'article-b-tabs-1-2',
    ])
    expect(labels.map((label) => label.htmlFor)).toEqual([
      'article-a-tabs-1-1', 'article-a-tabs-1-2', 'article-b-tabs-1-1', 'article-b-tabs-1-2',
    ])
  })

  it('同页挂载两个片段时，点击第二组 label 只改变第二组的选中项', () => {
    const root = document.createElement('div')
    root.innerHTML = renderMarkdown(GROUP, { idPrefix: 'article-a' }) +
      renderMarkdown(GROUP, { idPrefix: 'article-b' })
    document.body.append(root)
    try {
      const groups = root.querySelectorAll('.nd-tabs')
      const first = groups[0]!.querySelectorAll<HTMLInputElement>('input')
      const second = groups[1]!.querySelectorAll<HTMLInputElement>('input')

      groups[1]!.querySelectorAll<HTMLLabelElement>('label')[1]!.click()

      expect(Array.from(first, (radio) => radio.checked)).toEqual([true, false])
      expect(Array.from(second, (radio) => radio.checked)).toEqual([false, true])
    } finally {
      root.remove()
    }
  })

  it('多组页签的同参数重复渲染不受其它片段渲染影响', () => {
    const source = GROUP + '\n\n分隔段落\n\n' + GROUP
    const first = renderMarkdown(source, { idPrefix: 'article-a' })
    renderMarkdown(source, { idPrefix: 'article-b' })
    renderMarkdown(source)

    expect(first).toContain('name="article-a-tabs-1"')
    expect(first).toContain('name="article-a-tabs-2"')
    expect(renderMarkdown(source, { idPrefix: 'article-a' })).toBe(first)
    expect(renderMarkdown(source)).toBe(renderMarkdown(source))
  })
})
