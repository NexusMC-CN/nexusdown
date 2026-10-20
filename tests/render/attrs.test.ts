/**
 * `attrs` 渲染侧测试（`src/render/features/attrs.ts`）。
 *
 * 锁住四件事：
 * 1. 属性行从输出里**消失**，不留下 `{.steps}` 文本；
 * 2. 已实现的属性**挂到前一个块**上（列表类 / 表格类 / 围栏标题 / id）；
 * 3. 一个属性都没认出来时**保留原文**（不静默吞用户内容）；
 * 4. 前一个块不是宿主（普通段落）时**不动**。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderMarkdown } from '../../src/render/index.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('attrs —— 已实现的属性', () => {
  it('★ 列表 + `{.steps}` → `<ul class="nd-steps">`，属性行消失', () => {
    const html = renderMarkdown('- a\n- b\n\n{.steps}')
    expect(html).toContain('class="nd-steps"')
    expect(html).not.toContain('{.steps}')
  })

  it('★ 有序列表 + `{.cards}` → `nd-cards`', () => {
    const html = renderMarkdown('1. a\n2. b\n\n{.cards}')
    expect(html).toContain('class="nd-cards"')
    expect(html).not.toContain('{.cards}')
  })

  it('★ 表格 + `{.fields}` → `<table class="nd-fields">`', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n{.fields}')
    expect(html).toContain('<table class="nd-fields">')
    expect(html).not.toContain('{.fields}')
  })

  it('★ 围栏 + `{title="a.ts"}` → 标题栏显示文件名', () => {
    const html = renderMarkdown('```ts\nconst x = 1\n```\n{title="a.ts"}')
    expect(html).toContain('class="nd-code-title">a.ts<')
    expect(html).not.toContain('{title="a.ts"}')
  })

  it('★ `#id` → 块的 id 属性', () => {
    const html = renderMarkdown('- a\n\n{#list-1}')
    expect(html).toContain('id="list-1"')
    expect(html).not.toContain('{#list-1}')
  })

  it('★ 多个属性一起生效', () => {
    const html = renderMarkdown('- a\n\n{.steps #steps-1}')
    expect(html).toContain('id="steps-1"')
    expect(html).toContain('class="nd-steps"')
  })
})

describe('attrs —— 降级路径', () => {
  it('★ 全是未知属性 → 保留原文（不吞内容）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const html = renderMarkdown('- a\n\n{foo="bar"}')
    expect(html).toContain('{foo=&quot;bar&quot;}')
    expect(warn).toHaveBeenCalled()
  })

  it('★ 前一个块是普通段落 → 不动（不是宿主）', () => {
    const html = renderMarkdown('普通段落\n\n{.steps}')
    expect(html).toContain('{.steps}')
  })

  it('★ 引用块里的属性行 → 不动（level > 0）', () => {
    const html = renderMarkdown('> 引用\n>\n> {.steps}')
    expect(html).toContain('{.steps}')
  })

  it('★ 未实现的属性只告警：`label` 被忽略，`title` 仍生效', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const html = renderMarkdown('```ts\nx\n```\n{title="a.ts" label="(1)"}')
    expect(html).toContain('class="nd-code-title">a.ts<')
    expect(html).not.toContain('label=')
    expect(warn).toHaveBeenCalled()
  })
})

describe('attrs —— 表格必须空一行（markdown-it 的表格规则）', () => {
  it('★ 不空行 → `{.fields}` 被当成表格行，不生效', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n{.fields}')
    expect(html).not.toContain('nd-fields')
    expect(html).toContain('{.fields}')
  })

  it('★ 空一行 → 正常挂到表格上', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n{.fields}')
    expect(html).toContain('<table class="nd-fields">')
  })
})

describe('attrs —— 代码块行号 / 行高亮', () => {
  it('★ `{lines}` → 逐行 span + nd-code-lines', () => {
    const html = renderMarkdown('```ts\na\nb\n```\n{lines}')
    expect(html).toContain('class="nd-code-lines"')
    expect((html.match(/class="nd-code-line"/g) ?? []).length).toBe(2)
  })

  it('★ `{highlight="2"}` → 第二行高亮', () => {
    const html = renderMarkdown('```ts\na\nb\n```\n{highlight="2"}')
    expect(html).toContain('class="nd-code-line nd-code-line--hl"')
  })
})
