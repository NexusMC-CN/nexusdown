// @vitest-environment node
import MarkdownIt from 'markdown-it'
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it'
import { describe, expect, it } from 'vitest'

import type { RenderFeatureContext } from '../../src/render/feature.js'
import { emojiFeature } from '../../src/render/features/emoji.js'

/**
 * `emoji` 渲染侧的测试（node 环境，验证无 DOM 也能渲染）。
 *
 * 建一个裸 markdown-it，装上 `emojiFeature`，直接 `render` 断言输出 ——
 * 和 `renderMarkdown.test.ts` 的写法一致，只是这里只关心本功能。
 */
function build(): MarkdownItInstance {
  const md = new MarkdownIt({ html: false })
  const ctx: RenderFeatureContext = {
    md,
    rules: md.renderer.rules,
    escapeHtml: md.utils.escapeHtml,
  }
  emojiFeature.install(ctx)
  return md
}

/**
 * 渲染并去掉 markdown-it 追加的**块级分隔换行**。
 *
 * markdown-it 的 `renderToken` 会在每个块级标签后补一个 `\n`（`renderMarkdown`
 * 会把它剥掉，见 `renderer.ts` 的 `applyNoBlockSeparators`）。这里直接调 `md.render`，
 * 所以要自己处理 —— 测试关心的是**内容**，不是那个分隔符。
 */
function render(src: string): string {
  return build().render(src).replace(/\n+$/, '')
}

describe('emoji 渲染侧', () => {
  it('★ `:smile:` → 字形', () => {
    expect(render(':smile:')).toBe('<p>😄</p>')
  })

  it('一段里的多个短代码都替换', () => {
    expect(render(':smile: 和 :joy:')).toBe('<p>😄 和 😂</p>')
  })

  it('表外的短代码原样保留', () => {
    expect(render('a :not_a_real_emoji: b')).toBe('<p>a :not_a_real_emoji: b</p>')
  })

  it('★ 行内代码里的 `:smile:` 不替换（文本 token 到不了这里）', () => {
    expect(render('`:smile:`')).toBe('<p><code>:smile:</code></p>')
  })

  it('★ 围栏代码块里的 `:smile:` 不替换', () => {
    const html = render('```\n:smile:\n```')
    expect(html).not.toContain('😄')
    expect(html).toContain(':smile:')
  })

  it('★ 转义仍然生效：文本里的 `<` 变成 `&lt;`，字形正常输出', () => {
    expect(render('a < b :smile:')).toBe('<p>a &lt; b 😄</p>')
  })

  it('链接文字里的短代码也被替换', () => {
    const html = render('[点 :smile:](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('😄')
  })

  it('和 `shared/emoji-data.ts` 用同一张表（`:+1:` 两边都不认）', () => {
    // 若渲染侧自己放行 `+`，这里就会变成 👍 —— 那正是要避免的两侧不一致。
    expect(render(':+1:')).toBe('<p>:+1:</p>')
  })
})
