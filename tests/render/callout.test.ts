// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { renderMarkdown } from '../../src/render/index.js'
import { CALL_OUT_TYPES, parseCallOutMarker } from '../../src/shared/callouts.js'

/**
 * `callout` 渲染侧的测试（契约 `docs/dialect-extensions.md` 第 9 节）。
 *
 * 环境是 **node**：渲染侧必须在无 DOM 下工作。
 *
 * ## 为什么用完整的 `renderMarkdown` 而不是自己建 markdown-it
 *
 * 和 `embed` / `math` 那两份测试不同：callout 是**改写引用块的 token 流**，
 * 它的正确性依赖 `renderer.ts` 里那套 `paragraph_open` / `paragraph_close`
 * 的覆盖（`<p>` 而不是带换行的默认标签）。自己建一个裸 markdown-it 测出来的
 * 结构和真实产出不一样，等于没测。
 *
 * 所以这里断言的是**发布出去的那串 HTML**，一个字一个字对。
 */

const note = renderMarkdown('> [!NOTE]\n> 正文')

describe('callout 渲染侧 —— 基本形态', () => {
  it('★ `> [!NOTE]` → `.nd-callout` + 标题 + 正文，不再有 `<blockquote>`', () => {
    expect(note).toBe(
      '<div class="nd-callout nd-callout--note">' +
        '<p class="nd-callout__title">' +
        '<span class="nd-callout__icon" aria-hidden="true">ℹ</span>' +
        '<span class="nd-callout__label">注意</span>' +
        '</p>' +
        '<p>正文</p>' +
        '</div>',
    )
    expect(note).not.toContain('<blockquote')
  })

  it('★ 10 种类型都认，类名逐个对得上', () => {
    expect(CALL_OUT_TYPES).toHaveLength(10)
    for (const def of CALL_OUT_TYPES) {
      const html = renderMarkdown(`> [!${def.type.toUpperCase()}]\n> 正文`)
      expect(html).toContain(`<div class="nd-callout nd-callout--${def.type}">`)
      expect(html).toContain(`<span class="nd-callout__label">${def.label}</span>`)
      expect(html).toContain(`<span class="nd-callout__icon" aria-hidden="true">${def.glyph}</span>`)
    }
  })

  it('标记可以和正文同一行（`> [!NOTE] 正文`）', () => {
    const html = renderMarkdown('> [!NOTE] 正文')
    expect(html).toContain('<div class="nd-callout nd-callout--note">')
    expect(html).toContain('<p>正文</p>')
    // 标记本身不能留在正文里
    expect(html).not.toContain('[!NOTE]')
  })

  it('★ 只有标记、没有正文 → 不产出空的 `<p></p>`', () => {
    const html = renderMarkdown('> [!NOTE]')
    expect(html).toBe(
      '<div class="nd-callout nd-callout--note">' +
        '<p class="nd-callout__title">' +
        '<span class="nd-callout__icon" aria-hidden="true">ℹ</span>' +
        '<span class="nd-callout__label">注意</span>' +
        '</p>' +
        '</div>',
    )
    expect(html).not.toContain('<p></p>')
  })

  it('多行正文都留在同一个 callout 里（含行内标记）', () => {
    const html = renderMarkdown('> [!TIP]\n> 第一行 **加粗**\n> 第二行')
    expect(html).toContain('<div class="nd-callout nd-callout--tip">')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('第二行')
    // 只开一个 div
    expect(html.split('nd-callout--tip').length).toBe(2)
  })
})

describe('callout 渲染侧 —— 降级（未知类型 / 不是标记）', () => {
  it('★ 未知类型 → 退回普通 `<blockquote>`，`[!FOO]` 原样留着', () => {
    const html = renderMarkdown('> [!FOO]\n> 正文')
    expect(html).not.toContain('nd-callout')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('[!FOO]')
    expect(html).toContain('正文')
  })

  it('首行不是标记的普通引用块完全不受影响', () => {
    const html = renderMarkdown('> 普通引用\n> 第二行')
    expect(html).not.toContain('nd-callout')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('普通引用')
  })

  it('标记不在首行 → 不是 callout（契约：标记是第一行）', () => {
    const html = renderMarkdown('> 正文\n> [!NOTE]')
    expect(html).not.toContain('nd-callout')
    expect(html).toContain('[!NOTE]')
  })

  it('`[!NOTE]x`（`]` 后没有空白）→ 不是标记，引用块原样', () => {
    const html = renderMarkdown('> [!NOTE]x')
    expect(html).not.toContain('nd-callout')
    expect(html).toContain('[!NOTE]x')
  })

  it('大小写不敏感：`[!note]` 也认（归一成小写查表）', () => {
    const html = renderMarkdown('> [!note]\n> 正文')
    expect(html).toContain('<div class="nd-callout nd-callout--note">')
  })
})

describe('callout 渲染侧 —— 嵌套引用', () => {
  it('★ `> > [!NOTE]` → 外层是普通引用块，内层才是 callout', () => {
    const html = renderMarkdown('> > [!NOTE]\n> > 正文')

    expect(html).toContain('<blockquote>')
    expect(html).toContain('<div class="nd-callout nd-callout--note">')
    // 只有**一个** callout（外层不该也变成 callout）
    expect(html.split('class="nd-callout ').length).toBe(2)
    // 外层引用块里包着 callout：`<blockquote><div …>`
    expect(html.indexOf('<blockquote>')).toBeLessThan(html.indexOf('nd-callout--note'))
  })

  it('引用块里先有别的块（列表）时，`[!NOTE]` 不在首段 → 不是 callout', () => {
    const html = renderMarkdown('> - 一项\n> [!NOTE]')
    expect(html).not.toContain('nd-callout')
  })
})

describe('callout 渲染侧 —— 标记解析（两侧共用的那一份）', () => {
  it('解析结果带类型和标记长度', () => {
    const marker = parseCallOutMarker('[!WARNING] 正文')
    expect(marker?.def.type).toBe('warning')
    expect(marker?.length).toBe('[!WARNING]'.length)
  })

  it('未知类型 / 不带 `!` / 不在行首 一律 null', () => {
    expect(parseCallOutMarker('[!FOO]')).toBeNull()
    expect(parseCallOutMarker('[NOTE]')).toBeNull()
    expect(parseCallOutMarker(' 正文 [!NOTE]')).toBeNull()
    expect(parseCallOutMarker('[!NOTE]x')).toBeNull()
  })

  it('`[!NOTE]` 独占一行也算（`]` 后是行尾）', () => {
    expect(parseCallOutMarker('[!NOTE]')?.def.type).toBe('note')
  })
})
