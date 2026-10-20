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
})
