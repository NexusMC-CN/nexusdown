/**
 * 四个装饰器的单元测试。
 *
 * 做法：用 `EditorState.create` 建一个真实的 markdown 状态（GFM），
 * 遍历语法树找到目标节点，**直接调用装饰器函数**（传两个空数组），
 * 再对推出来的装饰数量与区间做断言。
 *
 * 断言的是**区间与种类**，不是「跑起来了」：
 * - `isHide`            —— `Decoration.replace({})`（无 class、无 widget）
 * - `isMark(cls)`       —— MarkDecoration（带 `tagName`）
 * - `isLine(cls)`       —— LineDecoration（无 `tagName`，零长度）
 * - `isWidgetReplace`   —— 带 widget 的 replace（任务复选框）
 *
 * ⚠️ `cursor` 默认取 `doc.length`，即落在**末行**。所以凡是测「非揭示态」的
 * 用例，文档都写成 `目标行\n\n尾部` —— 否则单行文档的光标本身就落在目标行上，
 * 会被判成揭示态。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { EditorSelection, Range, Text } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

import { decorateBlockquote } from '../../src/cm/decorate/blockquote.js'
import { decorateHeading } from '../../src/cm/decorate/heading.js'
import { decorateInline } from '../../src/cm/decorate/inline.js'
import { decorateListItem } from '../../src/cm/decorate/list.js'
import { BulletMarkerWidget, OrderedMarkerWidget } from '../../src/cm/widgets/list.js'
import { TaskCheckboxWidget } from '../../src/cm/widgets/task.js'

type Decorate = (
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
) => void

interface Collected {
  ranges: Range<Decoration>[]
  atomicRanges: Range<Decoration>[]
  doc: Text
}

/**
 * 建状态 → 遍历树 → 对**每个**名字命中的节点调用 `decorate`。
 * 不 `return false`：和 plugin.ts 对 inline 节点的处理一致，
 * 这样 `***粗斜体***` 的两层都能拿到。
 */
function collect(doc: string, match: string[], decorate: Decorate, cursor = doc.length): Collected {
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
      if (!match.includes(ref.name)) return
      hits++
      decorate(ranges, atomicRanges, ref.node, state.doc, state.selection)
    },
  })

  // 防止「一个节点都没命中」时测试静默变成空断言。
  if (hits === 0) throw new Error(`语法树里没有 ${match.join(' / ')} 节点`)
  return { ranges, atomicRanges, doc: state.doc }
}

interface DecoSpec {
  class?: string
  widget?: unknown
}

const specOf = (value: Decoration): DecoSpec => value.spec as DecoSpec

/** `Decoration.replace({})` —— 没有 class、也没有 widget。 */
const isHide = (r: Range<Decoration>): boolean => {
  const spec = specOf(r.value)
  return spec.class === undefined && spec.widget === undefined
}

const isWidgetReplace = (r: Range<Decoration>): boolean => specOf(r.value).widget !== undefined

/** MarkDecoration 才带 `tagName`。 */
const isMark = (r: Range<Decoration>, cls: string): boolean =>
  specOf(r.value).class === cls && 'tagName' in r.value

/** LineDecoration 没有 `tagName`。 */
const isLine = (r: Range<Decoration>, cls: string): boolean =>
  specOf(r.value).class === cls && !('tagName' in r.value)

/** 复选框 widget 的字段是 private，用结构化断言而不是直接读属性。 */
const checkboxOf = (widget: unknown): { checked: boolean; from: number; to: number } =>
  widget as unknown as { checked: boolean; from: number; to: number }

/**
 * 取 widget **实际渲染出来的文本**（`•` / `3.`）。
 *
 * `toDOM` 的签名要一个 `EditorView`，但列表符号 widget 根本不读它 ——
 * 所以这里不挂编辑器（本文件其余部分也不建 view），直接调即可。
 */
const renderedText = (widget: unknown): string =>
  (widget as { toDOM: (view: unknown) => HTMLElement }).toDOM(null).textContent ?? ''

const spans = (rs: readonly Range<Decoration>[]): number[][] => rs.map((r) => [r.from, r.to])
const sortedSpans = (rs: readonly Range<Decoration>[]): number[][] =>
  spans(rs).sort((a, b) => a[0] - b[0])

describe('decorateInline —— 粗体 / 斜体 / 行内代码 / 删除线', () => {
  const DOC = '**粗体**\n\n尾部'

  it('非揭示态：两个 `**` 各一个 HIDE，样式 mark 覆盖整个节点（含定界符）', () => {
    const c = collect(DOC, ['StrongEmphasis'], decorateInline)

    expect(spans(c.ranges.filter(isHide))).toEqual([
      [0, 2],
      [4, 6],
    ])
    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-strong')))).toEqual([[0, 6]])
  })

  it('坑 ③ 回归：atomic 只含两个定界符，不含整个节点（否则光标跨不过词中间）', () => {
    const c = collect(DOC, ['StrongEmphasis'], decorateInline)

    expect(spans(c.atomicRanges)).toEqual([
      [0, 2],
      [4, 6],
    ])
    // 整个节点 [0,6) 绝不能被注册成原子区间。
    expect(c.atomicRanges.some((r) => r.from === 0 && r.to === 6)).toBe(false)
    // 内容 [2,4) 里也不能有任何原子区间。
    expect(c.atomicRanges.some((r) => r.from >= 2 && r.to <= 4)).toBe(false)
  })

  it('揭示态（光标在该行）：两个 MUTED_MARK，没有 HIDE，也没有 atomic', () => {
    const c = collect(DOC, ['StrongEmphasis'], decorateInline, 3)

    expect(c.ranges.filter(isHide)).toHaveLength(0)
    expect(c.atomicRanges).toHaveLength(0)
    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-mark')))).toEqual([
      [0, 2],
      [4, 6],
    ])
    // 样式 mark 仍在：`**` 落在 .nd-strong 里，靠 .nd-mark 中和继承来的粗体。
    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-strong')))).toEqual([[0, 6]])
  })

  it('斜体 / 行内代码 / 删除线各自用对应的 class', () => {
    const em = collect('*斜*\n\n尾部', ['Emphasis'], decorateInline)
    expect(spans(em.ranges.filter((r) => isMark(r, 'nd-em')))).toEqual([[0, 3]])
    expect(spans(em.ranges.filter(isHide))).toEqual([
      [0, 1],
      [2, 3],
    ])

    const code = collect('`码`\n\n尾部', ['InlineCode'], decorateInline)
    expect(spans(code.ranges.filter((r) => isMark(r, 'nd-code')))).toEqual([[0, 3]])
    expect(spans(code.ranges.filter(isHide))).toEqual([
      [0, 1],
      [2, 3],
    ])

    const strike = collect('~~删~~\n\n尾部', ['Strikethrough'], decorateInline)
    expect(spans(strike.ranges.filter((r) => isMark(r, 'nd-strike')))).toEqual([[0, 5]])
    expect(spans(strike.ranges.filter(isHide))).toEqual([
      [0, 2],
      [3, 5],
    ])
  })

  it('非行内节点不会被误装饰', () => {
    const c = collect('普通段落\n\n尾部', ['Paragraph'], decorateInline)
    expect(c.ranges).toHaveLength(0)
    expect(c.atomicRanges).toHaveLength(0)
  })
})

describe('decorateInline —— 嵌套 ***粗斜体***', () => {
  const DOC = '***粗斜体***\n\n尾部'

  it('Emphasis 与 StrongEmphasis 各推一个 mark，两层叠加覆盖同一段文字', () => {
    const c = collect(DOC, ['Emphasis', 'StrongEmphasis'], decorateInline)

    const em = c.ranges.filter((r) => isMark(r, 'nd-em'))
    const strong = c.ranges.filter((r) => isMark(r, 'nd-strong'))
    expect(em).toHaveLength(1)
    expect(strong).toHaveLength(1)

    // 实测区间：Emphasis 是外层 [0,9)，StrongEmphasis 是内层 [1,8)。
    // 参考文档说的「两层区间完全相同」在 @lezer/markdown 1.7.2 上不成立 ——
    // 外层 Emphasis 把 `*` 定界符也算进了自己的区间。
    // 要点是两层**叠加**（内容同时落在两个 class 里），不是区间相等。
    expect(spans(em)).toEqual([[0, 9]])
    expect(spans(strong)).toEqual([[1, 8]])
    expect(em[0].from).toBeLessThanOrEqual(strong[0].from)
    expect(em[0].to).toBeGreaterThanOrEqual(strong[0].to)
  })

  it('四个定界符全部藏掉，和两层 mark 一起完整覆盖 [0,9)', () => {
    const c = collect(DOC, ['Emphasis', 'StrongEmphasis'], decorateInline)

    const hides = sortedSpans(c.ranges.filter(isHide))
    expect(hides).toEqual([
      [0, 1],
      [1, 3],
      [6, 8],
      [8, 9],
    ])
    // 定界符分两组首尾相接：[0,3) 与 [6,9)，中间 [3,6) 正好是正文。
    expect(hides[0][0]).toBe(0)
    expect(hides[0][1]).toBe(hides[1][0])
    expect(hides[2][1]).toBe(hides[3][0])
    expect(hides[3][1]).toBe(9)
    expect(c.doc.sliceString(hides[1][1], hides[2][0])).toBe('粗斜体')
  })
})

describe('decorateHeading —— ATX 标题', () => {
  it('## 标题 → 1 个 line 装饰 + HIDE 覆盖 `##` 和后面的空格', () => {
    const c = collect('## 标题\n\n尾部', ['ATXHeading2'], decorateHeading)

    // 必须是 line 装饰（零长度、无 tagName），不是 mark。
    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-h2')))).toEqual([[0, 0]])
    expect(c.ranges.filter((r) => isMark(r, 'nd-h2'))).toHaveLength(0)

    expect(spans(c.ranges.filter(isHide))).toEqual([[0, 3]])
    expect(c.doc.sliceString(0, 3)).toBe('## ')
    expect(spans(c.atomicRanges)).toEqual([[0, 3]])
  })

  it('1-6 级各自映射到 nd-h1..nd-h6', () => {
    for (let level = 1; level <= 6; level++) {
      const doc = `${'#'.repeat(level)} 标题\n\n尾部`
      const c = collect(doc, [`ATXHeading${level}`], decorateHeading)

      expect(spans(c.ranges.filter((r) => isLine(r, `nd-h${level}`)))).toEqual([[0, 0]])
      expect(spans(c.ranges.filter(isHide))).toEqual([[0, level + 1]])
      expect(c.doc.sliceString(0, level + 1)).toBe(`${'#'.repeat(level)} `)
    }
  })

  it('坑 ⑥：`#  两空格  标题` 的尾随空格全部藏掉，不残留', () => {
    const c = collect('#  两空格  标题\n\n尾部', ['ATXHeading1'], decorateHeading)

    expect(spans(c.ranges.filter(isHide))).toEqual([[0, 3]])
    expect(c.doc.sliceString(0, 3)).toBe('#  ')
  })

  it('揭示态：标记变淡而不是藏掉，line 装饰仍在', () => {
    const c = collect('## 标题', ['ATXHeading2'], decorateHeading, 3)

    expect(c.ranges.filter(isHide)).toHaveLength(0)
    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-mark')))).toEqual([[0, 3]])
    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-h2')))).toEqual([[0, 0]])
  })

  it('标题里的嵌套行内标记仍然被 decorateInline 处理（坑 ② 不复现）', () => {
    const c = collect('# 这是 **粗体** 标题\n\n尾部', ['StrongEmphasis'], decorateInline)

    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-strong')))).toEqual([[5, 11]])
    expect(spans(c.ranges.filter(isHide))).toEqual([
      [5, 7],
      [9, 11],
    ])
  })

  it('Setext 标题（`标题\\n====`）：line 装饰落在标题文字行，下划线也被藏掉', () => {
    // plugin.ts 的 HEADING_NODES 含 SetextHeading1/2，所以这条路必须不崩。
    const h1 = collect('标题\n====\n\n尾部', ['SetextHeading1'], decorateHeading)
    expect(spans(h1.ranges.filter((r) => isLine(r, 'nd-h1')))).toEqual([[0, 0]])
    expect(spans(h1.ranges.filter(isHide))).toEqual([[3, 7]])
    expect(h1.doc.sliceString(3, 7)).toBe('====')

    const h2 = collect('标题\n----\n\n尾部', ['SetextHeading2'], decorateHeading)
    expect(spans(h2.ranges.filter((r) => isLine(r, 'nd-h2')))).toEqual([[0, 0]])
    expect(spans(h2.ranges.filter(isHide))).toEqual([[3, 7]])
  })
})

describe('decorateBlockquote —— 引用块', () => {
  it('> 引用 → 每一行一个 line 装饰 + HIDE 覆盖 `> `（含空格）', () => {
    const c = collect('> 引用\n\n尾部', ['Blockquote'], decorateBlockquote)

    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-blockquote')))).toEqual([[0, 0]])
    expect(spans(c.ranges.filter(isHide))).toEqual([[0, 2]])
    expect(c.doc.sliceString(0, 2)).toBe('> ')
    expect(spans(c.atomicRanges)).toEqual([[0, 2]])
  })

  it('多行引用：整块每一行都推一个 line 装饰', () => {
    const c = collect('> a\n> b\n\n尾部', ['Blockquote'], decorateBlockquote)

    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-blockquote')))).toEqual([
      [0, 0],
      [4, 4],
    ])
    expect(spans(c.ranges.filter(isHide))).toEqual([
      [0, 2],
      [4, 6],
    ])
    expect(c.atomicRanges).toHaveLength(2)
  })

  it('>tight → HIDE 只覆盖 `>`，不含不存在的空格', () => {
    const c = collect('>tight\n\n尾部', ['Blockquote'], decorateBlockquote)

    expect(spans(c.ranges.filter(isHide))).toEqual([[0, 1]])
    expect(c.doc.sliceString(0, 1)).toBe('>')
    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-blockquote')))).toEqual([[0, 0]])
  })

  it('三行引用：每个 `>` 都藏掉 —— 续行的 QuoteMark 嵌在 Paragraph 里，不能只扫直接子节点', () => {
    const c = collect('> a\n> b\n> c\n\n尾部', ['Blockquote'], decorateBlockquote)

    expect(sortedSpans(c.ranges.filter(isHide))).toEqual([
      [0, 2],
      [4, 6],
      [8, 10],
    ])
    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-blockquote')))).toEqual([
      [0, 0],
      [4, 4],
      [8, 8],
    ])
  })

  it('空引用行 `>` 没有尾随空格时只藏 `>`', () => {
    const c = collect('> a\n>\n> b\n\n尾部', ['Blockquote'], decorateBlockquote)

    expect(sortedSpans(c.ranges.filter(isHide))).toEqual([
      [0, 2],
      [4, 5],
      [6, 8],
    ])
  })

  it('嵌套引用：每层只藏自己那一个 `>`，同一区间不重复推', () => {
    const c = collect('> > nested\n\n尾部', ['Blockquote'], decorateBlockquote)

    expect(sortedSpans(c.ranges.filter(isHide))).toEqual([
      [0, 2],
      [2, 4],
    ])
    expect(c.doc.sliceString(0, 2)).toBe('> ')
    expect(c.doc.sliceString(2, 4)).toBe('> ')
    // 已知的坑 ⑤：两层给同一行推同一个 class，CSS 只算一次 → 嵌套没有视觉层级。
    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-blockquote')))).toEqual([
      [0, 0],
      [0, 0],
    ])
  })

  it('揭示态：line 装饰仍在，定界符变淡而不是藏掉', () => {
    const c = collect('> 引用', ['Blockquote'], decorateBlockquote, 3)

    expect(c.ranges.filter(isHide)).toHaveLength(0)
    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-mark')))).toEqual([[0, 2]])
    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-blockquote')))).toEqual([[0, 0]])
  })
})

describe('decorateListItem —— 列表项与任务复选框', () => {
  it('- [x] 完成 → 复选框 widget 替换 `[x]`', () => {
    const c = collect('- [x] 完成\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([[2, 5]])
    expect(c.doc.sliceString(2, 5)).toBe('[x]')

    const widget = specOf(widgets[0].value).widget
    expect(widget).toBeInstanceOf(TaskCheckboxWidget)
    expect(checkboxOf(widget)).toMatchObject({ checked: true, from: 2, to: 5 })
  })

  it('- [ ] 未完成 → 复选框 unchecked', () => {
    const c = collect('- [ ] 未完成\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([[2, 5]])
    expect(checkboxOf(specOf(widgets[0].value).widget).checked).toBe(false)
  })

  it('ListItem 首行加 line class；任务项的 `- ` 藏掉，而不是换成符号 widget', () => {
    const c = collect('- [x] 完成\n\n尾部', ['ListItem'], decorateListItem)

    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-list-item')))).toEqual([[0, 0]])
    // `- `（含尾随空格）藏掉：复选框已经占住标记位，再画一个圆点就成了 `• ☐`。
    expect(spans(c.ranges.filter(isHide))).toEqual([[0, 2]])
    expect(c.doc.sliceString(0, 2)).toBe('- ')
    // 藏的是 `- `，不是复选框：HIDE 一律止步于 2，复选框的 [2,5) 原样保留。
    expect(c.ranges.filter(isHide).every((r) => r.to <= 2)).toBe(true)
    // `-` 是 [0,1)，不会被当成符号 widget 替换掉。
    expect(c.ranges.filter(isWidgetReplace).some((r) => r.from === 0)).toBe(false)
  })

  it('复选框进 atomicRanges（它永远渲染）；藏掉的 `- ` 也进', () => {
    const c = collect('- [x] 完成\n\n尾部', ['ListItem'], decorateListItem)

    expect(sortedSpans(c.atomicRanges)).toEqual([
      [0, 2],
      [2, 5],
    ])
  })

  it('揭示态下复选框依然渲染 —— 它本身就是编辑入口（故意背离揭示规则）', () => {
    const c = collect('- [x] 完成', ['ListItem'], decorateListItem, 5)

    expect(c.ranges.filter(isWidgetReplace)).toHaveLength(1)
    expect(spans(c.atomicRanges)).toEqual([[2, 5]])
  })

  it('普通列表项：line 装饰 + 恰好 1 个符号 widget，没有 HIDE / atomic', () => {
    for (const doc of ['- item\n\n尾部', '1. one\n\n尾部', '* star\n\n尾部']) {
      const c = collect(doc, ['ListItem'], decorateListItem)

      expect(spans(c.ranges.filter((r) => isLine(r, 'nd-list-item')))).toEqual([[0, 0]])
      // 非揭示态：符号被换成 widget（`-` → `•`，`1.` → 淡化的 `1.`）。
      expect(c.ranges.filter(isWidgetReplace)).toHaveLength(1)
      expect(c.ranges.filter(isHide)).toHaveLength(0)
      // 符号 widget **不**做成原子区间：光标落在这一行时符号已经被揭示了，
      // 不存在「光标停在被替换区间里」的情况，登记 atomic 是多余的。
      expect(c.atomicRanges).toHaveLength(0)
    }
  })
})

describe('decorateListItem —— 列表符号渲染（`-` → `•`，`1.` → 淡化的 `1.`）', () => {
  it('`- 项` 非揭示态 → 1 个 widget replace，widget 渲染出的文本是 `•`', () => {
    const c = collect('- 项\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(widgets).toHaveLength(1)
    expect(spans(widgets)).toEqual([[0, 1]])
    expect(c.doc.sliceString(0, 1)).toBe('-')

    const widget = specOf(widgets[0].value).widget
    expect(widget).toBeInstanceOf(BulletMarkerWidget)
    expect(renderedText(widget)).toBe('•')
  })

  it('`*` / `+` 和 `-` 一样渲染成圆点（源码里的符号不影响渲染结果）', () => {
    for (const doc of ['* 项\n\n尾部', '+ 项\n\n尾部']) {
      const c = collect(doc, ['ListItem'], decorateListItem)

      const widgets = c.ranges.filter(isWidgetReplace)
      expect(spans(widgets)).toEqual([[0, 1]])
      expect(renderedText(specOf(widgets[0].value).widget)).toBe('•')
    }
  })

  it('`- 项` 揭示态 → 没有 widget，`-` 原样留在文本流里（变淡）', () => {
    const c = collect('- 项', ['ListItem'], decorateListItem, 1)

    expect(c.ranges.filter(isWidgetReplace)).toHaveLength(0)
    expect(c.ranges.filter(isHide)).toHaveLength(0)
    expect(c.doc.sliceString(0, 1)).toBe('-')
    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-mark')))).toEqual([[0, 1]])
  })

  it('`1. 项` → widget 文本是 `1.`', () => {
    const c = collect('1. 项\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([[0, 2]])
    expect(c.doc.sliceString(0, 2)).toBe('1.')

    const widget = specOf(widgets[0].value).widget
    expect(widget).toBeInstanceOf(OrderedMarkerWidget)
    expect(renderedText(widget)).toBe('1.')
  })

  it('★ `3. 项`（start=3）→ widget 文本是 `3.`，不是硬编码的 `1.`', () => {
    const c = collect('3. 项\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([[0, 2]])
    expect(c.doc.sliceString(0, 2)).toBe('3.')
    expect(renderedText(specOf(widgets[0].value).widget)).toBe('3.')
  })

  it('★ 数字宽度不固定：`9.` 是 2 字符，`10.` 是 3 字符，各自保留', () => {
    const c = collect('9. 项\n10. 项\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([
      [0, 2],
      [5, 8],
    ])
    expect(widgets.map((r) => renderedText(specOf(r.value).widget))).toEqual(['9.', '10.'])
  })

  it('`1) 项` 的分隔符归一化成 `.`，数字保留', () => {
    const c = collect('1) 项\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([[0, 2]])
    expect(c.doc.sliceString(0, 2)).toBe('1)')
    expect(renderedText(specOf(widgets[0].value).widget)).toBe('1.')
  })

  it('嵌套列表：每一层各自的 ListMark 都换成 widget（缩进由源码空格体现）', () => {
    const c = collect('- a\n  - b\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([
      [0, 1],
      [6, 7],
    ])
    expect(widgets.map((r) => renderedText(specOf(r.value).widget))).toEqual(['•', '•'])
    // 嵌套层自己的 `-` 在 [6,7)，前面的两个空格（[4,6)）是缩进，**不藏**。
    expect(c.doc.sliceString(4, 6)).toBe('  ')
  })

  it('嵌套有序列表：两层的数字各按自己的 ListMark 渲染', () => {
    const c = collect('  1. a\n  2. b\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([
      [2, 4],
      [9, 11],
    ])
    expect(widgets.map((r) => renderedText(specOf(r.value).widget))).toEqual(['1.', '2.'])
  })

  it('揭示判定按**符号自己那一行**：多行列表项的续行上放光标，首行符号仍渲染', () => {
    // `- a\n  续行` 是一个 ListItem（两行），光标在第 2 行（位置 5）。
    const c = collect('- a\n  续行\n\n尾部', ['ListItem'], decorateListItem, 5)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([[0, 1]])
    expect(renderedText(specOf(widgets[0].value).widget)).toBe('•')
  })

  it('回归：`- [ ] 项` 复选框 widget 仍在，`- ` 藏掉而不是变成 `• ☐`', () => {
    const c = collect('- [ ] 项\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(widgets).toHaveLength(1)
    expect(spans(widgets)).toEqual([[2, 5]])
    expect(c.doc.sliceString(2, 5)).toBe('[ ]')

    const widget = specOf(widgets[0].value).widget
    expect(widget).toBeInstanceOf(TaskCheckboxWidget)
    expect(checkboxOf(widget).checked).toBe(false)

    expect(spans(c.ranges.filter(isHide))).toEqual([[0, 2]])
  })

  it('回归：`- [x] 项` 复选框 checked', () => {
    const c = collect('- [x] 项\n\n尾部', ['ListItem'], decorateListItem)

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(widgets).toHaveLength(1)
    expect(spans(widgets)).toEqual([[2, 5]])
    expect(checkboxOf(specOf(widgets[0].value).widget).checked).toBe(true)
  })
})
