// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { renderMarkdown } from '../../src/render/index.js'
import { DIALECT_SYNTAXES, fixtures } from '../../playground/src/fixtures.js'

/**
 * **方言画廊的 parity 脚手架**（阶段 0）。
 *
 * ## 这个文件想解决什么
 *
 * 每加一条语法，要在两侧各写一遍（编辑器 + 渲染器），而「两侧一致」是这个库
 * 存在的理由。编辑器侧有 `tests/cm/*.test.ts` 逐个守着；**渲染侧以前没有一张
 * 「全方言」的网** —— 加一条语法时容易只测它自己，忘了它和别的语法叠在一起的样子
 * （表格单元格里的高亮、引用块里的公式、连续图片变轮播……）。
 *
 * 这里的做法是**遍历 playground 画廊**：每个 fixture 自带
 * `expects`（这条语法独有的 HTML 结构），测试只负责遍历 + 断言 + 拍快照。
 * 于是「加一个组件」的渲染侧成本 = **一个 fixture**，不用碰这个文件。
 *
 * ## 快照的用法
 *
 * 快照锁的是**整段 HTML** —— 它比 `expects` 敏感得多：类名改了、属性顺序变了、
 * 多了一个换行，都会红。所以：
 *
 * - 断言失败先看 `expects` 那条（语义坏了）；
 * - 只有快照红 = 输出形状变了，**确认是有意的**再 `npm test -- -u` 更新。
 *
 * ⚠️ 环境是 **node**：渲染侧必须在无 DOM 下工作（同 `tests/render/renderMarkdown.test.ts`）。
 *
 * ⚠️ 画廊内容**不带外部数据**（`RenderData`）：提及因此显示成源码、短链 embed
 * 降级成代码块。那本身就是契约里的降级路径，一并锁住。
 */

describe('方言画廊 —— fixture 元数据', () => {
  it('fixture id 唯一', () => {
    const ids = fixtures.map((fixture) => fixture.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('★ `covers` 里的每个 id 都在目录里（防止拼错导致状态栏永远显示"未覆盖"）', () => {
    const known = new Set(DIALECT_SYNTAXES.map((syntax) => syntax.id))
    for (const fixture of fixtures) {
      for (const id of fixture.covers) {
        expect(known.has(id), `fixture ${fixture.id} 的 covers 里有未知语法 ${id}`).toBe(true)
      }
    }
  })

  it('★ 每条语法都至少有一个 fixture 覆盖（这就是"画廊"的定义）', () => {
    const covered = new Set(fixtures.flatMap((fixture) => fixture.covers))
    const missing = DIALECT_SYNTAXES.filter((syntax) => !covered.has(syntax.id)).map((syntax) => syntax.id)
    expect(missing).toEqual([])
  })

  it('`full` 覆盖全部语法（它是"一次看全"的那份）', () => {
    const full = fixtures.find((fixture) => fixture.id === 'full')
    expect(full).toBeDefined()
    expect([...full!.covers].sort()).toEqual(DIALECT_SYNTAXES.map((syntax) => syntax.id).sort())
  })
})

describe('方言画廊 —— 渲染侧 parity', () => {
  for (const fixture of fixtures) {
    it(`${fixture.id}（${fixture.label}）`, () => {
      const html = renderMarkdown(fixture.markdown)

      // ① 这条语法该有的结构一个都不能少。
      for (const needle of fixture.expects) {
        expect(html, `${fixture.id} 的渲染产出里缺少 ${needle}`).toContain(needle)
      }

      // ② 空内容必须是空串（不是 `<p></p>` 之类）。
      if (fixture.markdown.trim() === '') expect(html).toBe('')

      // ③ 整段 HTML 快照 —— 形状变了就得有人确认（压力样例除外，见 `Fixture.snapshot`）。
      if (fixture.snapshot !== false) expect(html).toMatchSnapshot()
    })
  }
})

describe('方言画廊 —— 全功能样例里各语法互不吞掉', () => {
  const html = renderMarkdown(fixtures.find((fixture) => fixture.id === 'full')!.markdown)

  it('★ 块级结构都在（表格 / 代码块 / 公式 / embed / 轮播 / 变体）', () => {
    // full 样例现在包含变体（步骤/参数表/行号/页签），同一种块会出现多次 ——
    // 这里只断言「没被吞掉」，精确次数交给各自的 fixture 快照。
    expect(html.match(/<table>/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(html.match(/class="nd-code-fence"/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(html.match(/class="nd-math nd-math-block"/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(html.match(/class="nd-embed /g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(html.match(/class="nd-carousel"/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(html).toContain('nd-steps')
    expect(html).toContain('nd-fields')
    expect(html).toContain('class="nd-tabs"')
  })

  it('★ callout 和普通引用块共存（一个变成 div，另一个还是 blockquote）', () => {
    expect(html).toContain('<div class="nd-callout nd-callout--tip">')
    expect(html).toContain('<blockquote>')
  })

  it('★ 行内语法没有被块级改写吞掉（高亮 / 删除线 / 行内码都还在）', () => {
    expect(html).toContain('<mark class="nd-highlight">')
    expect(html).toContain('<s>')
    expect(html).toContain('<code>行内代码</code>')
  })
})
