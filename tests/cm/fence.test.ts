/**
 * 围栏代码块的单元测试。
 *
 * 断言重点（参考文档 4.5 节）：
 * - 围栏**按整行藏**，`Decoration.replace` 一个都不跨行；
 * - **背景加在每一行上**（含两行围栏）—— 整个块是**一张连续的卡片**，
 *   首尾行各自圆外角、上下各留一段灰边（视觉上就是卡片的内边距）；
 * - 未闭合围栏只有一个 `CodeMark`，只藏一次（不能重复推同一区间）。
 *
 * ⚠️ 和别处一样，`cursor` 默认落在**末行**。凡是要测「非揭示态」的用例，
 * 文档都写成 `目标\n\n尾部`。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { Range, Text } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'

import { decorateFencedCode } from '../../src/cm/decorate/fence.js'

interface Collected {
  ranges: Range<Decoration>[]
  atomicRanges: Range<Decoration>[]
  doc: Text
}

function collectFence(doc: string, cursor = doc.length): Collected {
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
      if (ref.name !== 'FencedCode') return
      hits++
      decorateFencedCode(ranges, atomicRanges, ref.node, state.doc, state.selection)
      // 不 return false：和 plugin.ts 一致，让高亮 tag 还能落进去（这里不影响断言）。
    },
  })

  if (hits === 0) throw new Error('语法树里没有 FencedCode 节点')
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

/** `Decoration.replace({ widget })` —— 代码窗口的标题栏。 */
const isWidget = (r: Range<Decoration>): boolean => specOf(r.value).widget !== undefined

/** LineDecoration 没有 `tagName`。 */
const isLine = (r: Range<Decoration>, cls: string): boolean =>
  specOf(r.value).class === cls && !('tagName' in r.value)

const spans = (rs: readonly Range<Decoration>[]): number[][] => rs.map((r) => [r.from, r.to])

const FIRST = 'nd-code-block nd-code-block-first'
const PLAIN = 'nd-code-block'
const LAST = 'nd-code-block nd-code-block-last'
const ONLY = 'nd-code-block nd-code-block-first nd-code-block-last'

describe('decorateFencedCode —— 围栏按行藏 + 卡片式背景', () => {
  const DOC = '```js\ncode\n```\n\n尾部'

  it('开围栏行 → 标题栏 widget，闭围栏行 → 整行 HIDE，三行各一个背景装饰', () => {
    const c = collectFence(DOC)

    // 开围栏行（含语言信息 `js`）整行换成**标题栏 widget**（窗口上写语言名）。
    expect(spans(c.ranges.filter(isWidget))).toEqual([[0, 5]])
    expect(c.doc.sliceString(0, 5)).toBe('```js')
    // 闭围栏行整行藏掉。
    expect(spans(c.ranges.filter(isHide))).toEqual([[11, 14]])
    expect(c.doc.sliceString(11, 14)).toBe('```')

    // 两段替换都要登记成原子区间。
    expect(spans(c.atomicRanges)).toEqual([
      [0, 5],
      [11, 14],
    ])

    // ⚠️ **每一行都有背景**，含两行围栏 —— 这样才是一张连续的卡片。
    //    围栏行的文字虽然被藏了，但它保留了卡片的上下内边距和圆角。
    expect(spans(c.ranges.filter((r) => isLine(r, FIRST)))).toEqual([[0, 0]])
    expect(spans(c.ranges.filter((r) => isLine(r, PLAIN)))).toEqual([[6, 6]])
    expect(spans(c.ranges.filter((r) => isLine(r, LAST)))).toEqual([[11, 11]])
    // 中间行绝不能同时被当成 first / last。
    expect(c.ranges.filter((r) => isLine(r, ONLY))).toHaveLength(0)
  })

  it('围栏行必须有背景和圆角，不能被折叠掉', () => {
    // ⚠️ 这条守着用户实际报的问题：曾经把围栏行改成 `height: 0` 折叠掉，
    //    结果是"卡片上下凭空缺一块"，比多两条灰边更奇怪，而且围栏行没高度
    //    就没法用鼠标点进去改语言标记。用户原话："我建议是保留上和下行，
    //    显示为一个真正的卡片的样子，这样方便你编辑和看。"
    const c = collectFence(DOC)

    const fenceLines = spans(c.ranges.filter((r) => isLine(r, FIRST) || isLine(r, LAST)))
    expect(fenceLines).toEqual([
      [0, 0],
      [11, 11],
    ])
    // 不能出现任何"折叠围栏"的 class。
    expect(c.ranges.filter((r) => specOf(r.value).class === 'nd-code-fence')).toHaveLength(0)
  })

  it('没有任何 replace 跨行', () => {
    const c = collectFence(DOC)

    for (const r of [...c.ranges, ...c.atomicRanges]) {
      const startLine = c.doc.lineAt(r.from).number
      const endLine = c.doc.lineAt(Math.max(r.from, r.to - 1)).number
      expect(endLine).toBe(startLine)
    }
  })

  it('揭示态：围栏可见（没有 HIDE），背景 line 装饰保留', () => {
    const c = collectFence(DOC, 6)

    expect(c.ranges.filter(isHide)).toHaveLength(0)
    expect(c.ranges.filter(isWidget)).toHaveLength(0)
    expect(c.atomicRanges).toHaveLength(0)
    expect(spans(c.ranges.filter((r) => isLine(r, FIRST)))).toEqual([[0, 0]])
    expect(spans(c.ranges.filter((r) => isLine(r, PLAIN)))).toEqual([[6, 6]])
    expect(spans(c.ranges.filter((r) => isLine(r, LAST)))).toEqual([[11, 11]])
  })

  it('选区跨进代码块也算揭示（多行选区必须揭示被跨越的行）', () => {
    const c = collectFence(DOC, 12)

    expect(c.ranges.filter(isHide)).toHaveLength(0)
  })

  it('单行块 ```` ```\\n``` ````：上下都圆角', () => {
    const c = collectFence('```\n```\n\n尾部')

    expect(spans(c.ranges.filter((r) => isLine(r, FIRST)))).toEqual([[0, 0]])
    expect(spans(c.ranges.filter((r) => isLine(r, LAST)))).toEqual([[4, 4]])
    expect(spans(c.ranges.filter(isWidget))).toEqual([[0, 3]])
    expect(spans(c.ranges.filter(isHide))).toEqual([[4, 7]])
  })

  it('多行内容：first / last 落在两行围栏上，内容行全是 plain', () => {
    const c = collectFence('```js\na\nb\nc\n```\n\n尾部')

    // first / last 是**围栏行**（0 和 12），内容行 a / b / c 都是 plain。
    expect(spans(c.ranges.filter((r) => isLine(r, FIRST)))).toEqual([[0, 0]])
    expect(spans(c.ranges.filter((r) => isLine(r, PLAIN)))).toEqual([
      [6, 6],
      [8, 8],
      [10, 10],
    ])
    expect(spans(c.ranges.filter((r) => isLine(r, LAST)))).toEqual([[12, 12]])
  })

  it('~~~ 围栏同样处理', () => {
    const c = collectFence('~~~js\ncode\n~~~\n\n尾部')

    expect(spans(c.ranges.filter(isWidget))).toEqual([[0, 5]])
    expect(spans(c.ranges.filter(isHide))).toEqual([[11, 14]])
    expect(spans(c.ranges.filter((r) => isLine(r, FIRST)))).toEqual([[0, 0]])
  })

  it('未闭合围栏只有一个 CodeMark → 只藏一次（同一区间不能推两遍）', () => {
    // 未闭合的围栏会吃掉后面所有内容，所以把它放进引用块里，
    // 让末行落在围栏之外，才能测到「非揭示态」这条分支。
    const c = collectFence('> ```\n> unclosed\n\n尾部')

    expect(spans(c.ranges.filter(isWidget))).toEqual([[0, 5]])
    expect(spans(c.atomicRanges)).toEqual([[0, 5]])
    // 引用块里的围栏只有两行：first 落在围栏行，last 落在内容行。
    expect(spans(c.ranges.filter((r) => isLine(r, FIRST)))).toEqual([[0, 0]])
    expect(spans(c.ranges.filter((r) => isLine(r, LAST)))).toEqual([[6, 6]])
  })
})
