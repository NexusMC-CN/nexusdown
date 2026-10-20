/**
 * `callout` 编辑器侧的测试（契约 `docs/dialect-extensions.md` 第 9 节）。
 *
 * 做法同 `decorate.test.ts`：建真实的 markdown 状态（GFM），遍历语法树找到
 * `Blockquote` 节点，**直接调用装饰器**，再对推出来的装饰做断言。
 *
 * 断言的是**区间与种类**，不是「跑起来了」：
 * - `isHide`         —— `Decoration.replace({})`（藏 `> `）
 * - `isMark(cls)`    —— MarkDecoration（揭示态的 `.nd-mark`）
 * - `isLine(cls)`    —— LineDecoration（`.nd-callout--note` / `.nd-blockquote`）
 * - widget replace   —— 徽章（非揭示态）
 *
 * ⚠️ `cursor` 默认取 `doc.length`（落在**末行**），所以测「非揭示态」的用例
 * 文档都写成 `目标块\n\n尾部` —— 否则光标本身就落在目标块里，会被判成揭示态。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { EditorSelection, Range, Text } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { describe, expect, it } from 'vitest'

import { CallOutBadgeWidget, decorateBlockquote } from '../../src/cm/decorate/blockquote.js'
import { MARK_CLASS } from '../../src/cm/decorate/shared.js'

interface Collected {
  ranges: Range<Decoration>[]
  atomicRanges: Range<Decoration>[]
}

/** 遍历树，对每个 `Blockquote` 节点调用 `decorateBlockquote`（不剪枝：嵌套两层都要处理）。 */
function collect(doc: string, cursor = doc.length): Collected {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage })],
  })

  const ranges: Range<Decoration>[] = []
  const atomicRanges: Range<Decoration>[] = []
  let hits = 0

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'Blockquote') return
      hits++
      const node: SyntaxNode = ref.node
      const sel: EditorSelection = state.selection
      const text: Text = state.doc
      decorateBlockquote(ranges, atomicRanges, node, text, sel)
    },
  })

  if (hits === 0) throw new Error('语法树里没有 Blockquote 节点')
  return { ranges, atomicRanges }
}

interface DecoSpec {
  class?: string
  widget?: unknown
}

const specOf = (value: Decoration): DecoSpec => value.spec as DecoSpec

const isHide = (r: Range<Decoration>): boolean => {
  const spec = specOf(r.value)
  return spec.class === undefined && spec.widget === undefined
}

const isMark = (r: Range<Decoration>, cls: string): boolean =>
  specOf(r.value).class === cls && 'tagName' in r.value

/**
 * 行装饰的类名。
 *
 * ⚠️ 判据是「**没有 `tagName` 且有 class**」：`Decoration.replace({})`（藏 `> ` 的 HIDE）
 * 同样没有 `tagName`，只按 `tagName` 过滤会把 HIDE 也算成行装饰（class 是 `undefined`）。
 */
const lineClasses = (ranges: readonly Range<Decoration>[]): string[] =>
  ranges
    .filter((r) => !('tagName' in r.value) && specOf(r.value).class !== undefined)
    .map((r) => specOf(r.value).class ?? '')

const widgetRanges = (ranges: readonly Range<Decoration>[]): Array<[number, number]> =>
  ranges.filter((r) => specOf(r.value).widget !== undefined).map((r) => [r.from, r.to])

const spans = (rs: readonly Range<Decoration>[]): Array<[number, number]> =>
  rs.map((r) => [r.from, r.to] as [number, number])

/**
 * `> [!NOTE]\n> 正文` + 尾段。
 *
 * 区间：Blockquote [0,14] / Paragraph [2,14] / 标记 `[!NOTE]` [2,9]。
 */
const DOC = '> [!NOTE]\n> 正文\n\n尾部'

describe('callout 编辑器侧 —— 非揭示态', () => {
  it('★ 行装饰换成 `.nd-callout--note`（不是 `.nd-blockquote`），首末行带圆角类', () => {
    const { ranges } = collect(DOC)
    const classes = lineClasses(ranges)

    expect(classes).toEqual(['nd-callout nd-callout--note nd-callout-first', 'nd-callout nd-callout--note nd-callout-last'])
    expect(classes.some((c) => c.includes('nd-blockquote'))).toBe(false)
  })

  it('★ 标记 `[!NOTE]` 换成徽章（带 widget 的 replace），且**登记了原子区间**', () => {
    const { ranges, atomicRanges } = collect(DOC)

    expect(widgetRanges(ranges)).toEqual([[2, 9]])
    // 硬约束一：隐藏态的 replace 必须同时进 atomicRanges，否则光标会停在区间中间。
    expect(spans(atomicRanges)).toContainEqual([2, 9])
  })

  it('`> ` 照旧藏掉（两行各一个 HIDE）', () => {
    const { ranges } = collect(DOC)
    expect(ranges.filter(isHide).map((r) => [r.from, r.to])).toEqual([
      [0, 2],
      [10, 12],
    ])
  })
})

describe('callout 编辑器侧 —— 揭示态', () => {
  it('★ 光标进块 → 露出 `[!NOTE]` 源码（`.nd-mark`），不推徽章', () => {
    const { ranges } = collect(DOC, 3)

    expect(widgetRanges(ranges)).toEqual([])
    expect(ranges.filter((r) => isMark(r, MARK_CLASS)).map((r) => [r.from, r.to])).toContainEqual([2, 9])
  })

  it('揭示态下 `> ` 也变成 `.nd-mark`（不是 HIDE）', () => {
    const { ranges } = collect(DOC, 13)

    expect(ranges.filter(isHide)).toHaveLength(0)
    expect(ranges.filter((r) => isMark(r, MARK_CLASS)).length).toBeGreaterThanOrEqual(3)
  })
})

describe('callout 编辑器侧 —— 降级', () => {
  it('★ 未知类型 → 普通引用块（`.nd-blockquote`），不推徽章', () => {
    const { ranges } = collect('> [!FOO]\n> 正文\n\n尾部')

    expect(lineClasses(ranges)).toEqual(['nd-blockquote', 'nd-blockquote'])
    expect(widgetRanges(ranges)).toEqual([])
  })

  it('首行不是标记的普通引用块：行为和加 callout 之前一致', () => {
    const { ranges } = collect('> 普通引用\n> 第二行\n\n尾部')

    expect(lineClasses(ranges)).toEqual(['nd-blockquote', 'nd-blockquote'])
    expect(widgetRanges(ranges)).toEqual([])
    // 两个 `>` 照旧藏掉
    expect(ranges.filter(isHide)).toHaveLength(2)
  })

  it('标记不在首行 → 不是 callout', () => {
    const { ranges } = collect('> 正文\n> [!NOTE]\n\n尾部')
    expect(lineClasses(ranges)).toEqual(['nd-blockquote', 'nd-blockquote'])
  })

  it('`[!NOTE]x`（`]` 后没有空白）→ 不是 callout', () => {
    const { ranges } = collect('> [!NOTE]x\n\n尾部')
    expect(lineClasses(ranges)).toEqual(['nd-blockquote'])
  })

  it('大小写不敏感：`[!note]` 也认', () => {
    const { ranges } = collect('> [!note]\n> 正文\n\n尾部')
    expect(lineClasses(ranges)[0]).toContain('nd-callout--note')
  })

  it('单行 callout 同时是首行和末行（两个圆角类都在）', () => {
    const { ranges } = collect('> [!TIP] 一行搞定\n\n尾部')
    expect(lineClasses(ranges)).toEqual(['nd-callout nd-callout--tip nd-callout-first nd-callout-last'])
  })
})

describe('callout 编辑器侧 —— 嵌套引用', () => {
  it('★ `> > [!NOTE]` → 外层普通引用块，内层才是 callout', () => {
    const { ranges } = collect('> > [!NOTE]\n> > 正文\n\n尾部')
    const classes = lineClasses(ranges)

    // 外层两行 + 内层两行
    expect(classes.filter((c) => c === 'nd-blockquote')).toHaveLength(2)
    expect(classes.filter((c) => c.includes('nd-callout--note'))).toHaveLength(2)
    // 只有内层那一个徽章
    expect(widgetRanges(ranges)).toHaveLength(1)
  })
})

describe('callout 编辑器侧 —— 徽章 widget', () => {
  it('DOM 结构与渲染侧对齐（`__title` > `__icon` + `__label`）', () => {
    const widget = new CallOutBadgeWidget({ type: 'warning', label: '警告', glyph: '⚠' })
    const el = widget.toDOM()

    expect(el.className).toBe('nd-callout__title')
    expect(el.getAttribute('data-nd-callout')).toBe('warning')
    expect(el.querySelector('.nd-callout__icon')?.textContent).toBe('⚠')
    expect(el.querySelector('.nd-callout__label')?.textContent).toBe('警告')
    // 图标是装饰，屏幕阅读器跳过
    expect(el.querySelector('.nd-callout__icon')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('★ `eq` 按类型比较 —— 类型没变就不重建 DOM', () => {
    const a = new CallOutBadgeWidget({ type: 'note', label: '注意', glyph: 'ℹ' })
    const b = new CallOutBadgeWidget({ type: 'note', label: '注意', glyph: 'ℹ' })
    const c = new CallOutBadgeWidget({ type: 'danger', label: '危险', glyph: '⛔' })

    expect(a.eq(b)).toBe(true)
    expect(a.eq(c)).toBe(false)
  })
})
