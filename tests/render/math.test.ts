// @vitest-environment node
import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'

import type { RenderFeatureContext } from '../../src/render/feature.js'
import { katexRenderer, mathFeature, type KatexLike } from '../../src/render/features/math.js'

/**
 * `math` 渲染侧的测试。
 *
 * 环境是 **node**（同 `renderMarkdown.test.ts`）：渲染侧必须在无 DOM 下工作。
 *
 * ## 为什么注入一个**假** KaTeX，而不是装真 KaTeX
 *
 * 1. KaTeX 是可选依赖（~4 MB），不该为了跑测试装进 devDependencies；
 * 2. 这些测试要验的是**我们的接线**（何时调渲染器、传什么选项、怎么降级），
 *    不是 KaTeX 自己的排版 —— 断言它的 HTML 只会把测试绑死在它的内部实现上。
 *
 * 所以用一个记录调用的 stub：既能断言「传了正确的 tex 与安全选项」，
 * 又能断言「没注入 / 抛错时降级成源码」。
 */

interface StubKatex extends KatexLike {
  calls: Array<{ tex: string; options: Record<string, unknown> | undefined }>
}

/** 造一个假的 KaTeX，返回可断言的调用记录。 */
function makeStub(behavior: 'ok' | 'throw' = 'ok'): StubKatex {
  const calls: StubKatex['calls'] = []
  return {
    calls,
    renderToString(tex: string, options?: Record<string, unknown>): string {
      calls.push({ tex, options })
      if (behavior === 'throw') throw new Error('boom')
      return `<span class="katex-stub" data-tex="${tex}" data-display="${String(options?.displayMode)}"></span>`
    },
  }
}

/**
 * 建一个 markdown-it、装上 `mathFeature`、可选注入 KaTeX。
 *
 * 这里**不**跑 `applyNexusdownRenderer`：只测本功能，避免把代码块标题栏等
 * 无关规则卷进来。`ctx.rules.fence` 此时是 markdown-it 的默认围栏规则 ——
 * 正好用来验证「非 math 围栏被原样交还给 baseFence」。
 */
function build(katex?: KatexLike) {
  const md = new MarkdownIt({ html: false })
  const ctx: RenderFeatureContext = {
    md,
    rules: md.renderer.rules,
    escapeHtml: md.utils.escapeHtml,
  }
  mathFeature.install(ctx)
  if (katex) katexRenderer(katex)(md)
  return md
}

describe('math 渲染侧 —— 行内公式', () => {
  it('★ `$x^2$` 交给注入的渲染器，且传的是安全选项', () => {
    const katex = makeStub()
    const html = build(katex).render('a $x^2$ b')

    expect(katex.calls).toHaveLength(1)
    expect(katex.calls[0]!.tex).toBe('x^2')
    // 契约硬要求：trust 绝不能开；throwOnError 必须 false（脏公式不升级成 500）。
    expect(katex.calls[0]!.options!.trust).toBe(false)
    expect(katex.calls[0]!.options!.throwOnError).toBe(false)
    // 行内 → displayMode false。
    expect(katex.calls[0]!.options!.displayMode).toBe(false)
    // DoS 封顶。
    expect(katex.calls[0]!.options!.maxSize).toBe(50)
    expect(katex.calls[0]!.options!.maxExpand).toBe(1000)
    // 渲染器输出被内联进段落。
    expect(html).toContain('<p>a ')
    expect(html).toContain('class="katex-stub"')
    expect(html).toContain('data-tex="x^2"')
  })

  it('★ 没注入 KaTeX → 降级成源码文本（不抛）', () => {
    const html = build().render('a $x^2$ b')
    expect(html).toContain('<code class="nd-math-source">$x^2$</code>')
  })

  it('★ 渲染器抛错 → 也降级成源码文本（契约：不要抛）', () => {
    const katex = makeStub('throw')
    expect(() => build(katex).render('a $x^2$ b')).not.toThrow()
    expect(build(katex).render('a $x^2$ b')).toContain('<code class="nd-math-source">$x^2$</code>')
  })

  it('降级路径会转义 HTML（源码是用户输入）', () => {
    const html = build().render('$<script>alert(1)</script>$')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('行内代码里的 `$x$` 不算公式', () => {
    const katex = makeStub()
    const html = build(katex).render('`$x$`')
    expect(katex.calls).toHaveLength(0)
    expect(html).toContain('<code>$x$</code>')
  })

  it('转义的 `\\$x\\$` 不算公式', () => {
    const katex = makeStub()
    build(katex).render('\\$x\\$')
    expect(katex.calls).toHaveLength(0)
  })

  it('货币式 `$5 and $6` 不算公式', () => {
    const katex = makeStub()
    build(katex).render('$5 and $6')
    expect(katex.calls).toHaveLength(0)
  })

  it('`$$x$$` 不算行内公式（块级走围栏）', () => {
    const katex = makeStub()
    build(katex).render('$$x$$')
    expect(katex.calls).toHaveLength(0)
  })
})

describe('math 渲染侧 —— 块级围栏', () => {
  it('★ ```math 围栏 → KaTeX displayMode，包在 `.nd-math-block` 里', () => {
    const katex = makeStub()
    const html = build(katex).render('```math\n\\int_0^1 x\\,dx\n```')

    expect(katex.calls).toHaveLength(1)
    expect(katex.calls[0]!.tex).toBe('\\int_0^1 x\\,dx')
    expect(katex.calls[0]!.options!.displayMode).toBe(true)
    expect(html).toBe(
      '<div class="nd-math nd-math-block">' +
        '<span class="katex-stub" data-tex="\\int_0^1 x\\,dx" data-display="true"></span>' +
        '</div>',
    )
  })

  it('` ```math ` 的 info 带附加词（` ```math title=x `）也认作 math', () => {
    const katex = makeStub()
    build(katex).render('```math title=x\nx\n```')
    expect(katex.calls).toHaveLength(1)
  })

  it('★ 非 math 的围栏**原样**交还给 baseFence（普通代码块不受影响）', () => {
    const katex = makeStub()
    const html = build(katex).render('```js\nconst x = 1\n```')

    expect(katex.calls).toHaveLength(0)
    expect(html).toContain('class="language-js"')
    expect(html).toContain('const x = 1')
  })

  it('没注入 KaTeX → 块级降级成源码 `<pre>`', () => {
    const html = build().render('```math\nx^2\n```')
    expect(html).toContain('<div class="nd-math nd-math-block">')
    expect(html).toContain('<pre class="nd-math-source">x^2</pre>')
  })
})

describe('math 渲染侧 —— 注入通道', () => {
  it('`katexRenderer` 只挂函数、不改规则（规则由 install 注册）', () => {
    const md = new MarkdownIt({ html: false })
    const before = md.renderer.rules.fence
    katexRenderer(makeStub())(md)
    expect(md.renderer.rules.fence).toBe(before)
  })

  it('没有注入时渲染器不抛、给出源码（可用状态，而非 500）', () => {
    // markdown-it 给块级标签追加一个尾部 `\n`（`renderMarkdown` 会去掉它，
    // 这里直接调 `md.render` 所以带上）。
    expect(build().render('$a$')).toBe('<p><code class="nd-math-source">$a$</code></p>\n')
  })
})
