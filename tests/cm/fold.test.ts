/**
 * 代码块折叠的单元测试。
 *
 * 折叠状态存在 `StateField` 里（`foldedBlocks`），不是挂在 widget 上 ——
 * 因为 widget 每次装饰重建都是新对象，状态活不过一次重建。
 */
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'

import { decorateFencedCode } from '../../src/cm/decorate/fence.js'
import { foldedBlocks, toggleFold } from '../../src/cm/fold.js'

const DOC = '```yaml\n我是内容\n\n还有一行\n```\n\n尾段\n'

function mount(doc = DOC) {
  const state = EditorState.create({
    doc,
    /*
     * ⚠️ 光标默认落在 **0**（文档开头），而文档开头就是代码块的首行 ——
     * 那是**揭示态**，`fence.ts` 会原样显示围栏、不挂标题栏 widget。
     * 想测"非揭示态"必须把光标挪到代码块之外，这里放到文档末尾（`尾段` 之后）。
     */
    selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage }), foldedBlocks],
  })
  const view = new EditorView({ state })
  return view
}

/** 拿到唯一的 FencedCode 节点的 `from`。 */
function fenceFrom(view: EditorView): number {
  let from = -1
  syntaxTree(view.state).iterate({
    enter: (ref) => {
      if (ref.name === 'FencedCode') from = ref.from
    },
  })
  return from
}

function collect(view: EditorView, folded: boolean) {
  const ranges: any[] = []
  const atomicRanges: any[] = []
  syntaxTree(view.state).iterate({
    enter: (ref) => {
      if (ref.name !== 'FencedCode') return
      decorateFencedCode(ranges, atomicRanges, ref.node, view.state.doc, view.state.selection, { folded })
    },
  })
  const cls = (r: any) => (r.value.spec.class as string | undefined) ?? null
  const isWidget = (r: any) => r.value.spec.widget !== undefined
  return { ranges, atomicRanges, cls, isWidget }
}

describe('foldedBlocks（StateField）', () => {
  it('初始为空', () => {
    const view = mount()
    expect(view.state.field(foldedBlocks).size).toBe(0)
    view.destroy()
  })

  it('toggleFold 加上、再点一次去掉', () => {
    const view = mount()
    const key = fenceFrom(view)

    view.dispatch({ effects: toggleFold.of(key) })
    expect(view.state.field(foldedBlocks).has(key)).toBe(true)

    view.dispatch({ effects: toggleFold.of(key) })
    expect(view.state.field(foldedBlocks).has(key)).toBe(false)

    view.destroy()
  })

  it('多个块各自独立折叠', () => {
    const doc = '```a\n1\n```\n\n```b\n2\n```\n\n尾\n'
    const view = mount(doc)

    const keys: number[] = []
    syntaxTree(view.state).iterate({
      enter: (ref) => {
        if (ref.name === 'FencedCode') keys.push(ref.from)
      },
    })
    expect(keys).toHaveLength(2)

    view.dispatch({ effects: toggleFold.of(keys[0]!) })
    const folded = view.state.field(foldedBlocks)
    expect(folded.has(keys[0]!)).toBe(true)
    expect(folded.has(keys[1]!)).toBe(false)

    view.destroy()
  })

  it('★ 在折叠块**上面**插一行，折叠状态跟着块走（位置被 mapPos 映射）', () => {
    const view = mount()
    const key = fenceFrom(view)
    view.dispatch({ effects: toggleFold.of(key) })

    // 在文档最前面插一行
    view.dispatch({ changes: { from: 0, insert: '新的一行\n' } })

    const folded = view.state.field(foldedBlocks)
    expect(folded.size).toBe(1)
    // 块起点整体后移了 5 个字符（'新的一行\n'.length），旧的 key 不该还在
    expect(folded.has(key)).toBe(false)
    expect([...folded][0]).toBe(key + '新的一行\n'.length)

    view.destroy()
  })
})

describe('decorateFencedCode 的折叠态', () => {
  it('折叠态：只有标题栏行有背景，其余行被压掉', () => {
    const view = mount()
    const { ranges, cls } = collect(view, true)

    // 唯一一个**首尾都圆角**的行装饰，落在首行（标题栏是整张卡片唯一可见的部分）
    const headerLines = ranges.filter(
      (r) => cls(r)?.includes('nd-code-block-first') && cls(r)?.includes('nd-code-block-last'),
    )
    expect(headerLines).toHaveLength(1)
    expect(headerLines[0].from).toBe(0)

    // 其余 4 行（我是内容 / 空行 / 还有一行 / 闭围栏）都拿到"压成 0 高"的行装饰。
    // ⚠️ 它们**同时带 `.nd-code-block`** —— 折叠动画靠 `max-height` 过渡，
    //    两个状态共用同一条属性才插得了值（见 `fence.ts` 的注释）。
    const foldedLines = ranges.filter((r) => cls(r)?.includes('nd-code-folded'))
    expect(foldedLines).toHaveLength(4)
    for (const r of foldedLines) {
      expect(cls(r)).toBe('nd-code-block nd-code-folded')
    }

    view.destroy()
  })

  it('折叠态：标题栏 widget 收到 folded=true', () => {
    const view = mount()
    const { ranges, isWidget } = collect(view, true)

    const widgetRange = ranges.find(isWidget)
    expect(widgetRange).toBeDefined()
    // widget 的 folded 字段决定画哪个箭头
    expect(widgetRange.value.spec.widget.folded).toBe(true)
    // 还要带上块起点，否则折叠按钮会 dispatch 到错的位置
    expect(widgetRange.value.spec.widget.from).toBe(fenceFrom(view))

    view.destroy()
  })

  it('展开态：每一行都有背景，widget 收到 folded=false', () => {
    const view = mount()
    const { ranges, cls, isWidget } = collect(view, false)

    // 5 行（开围栏 / 我是内容 / 空行 / 还有一行 / 闭围栏）各有背景
    expect(ranges.filter((r) => cls(r)?.includes('nd-code-block'))).toHaveLength(5)
    // 展开态不该有"压成 0 高"的行
    expect(ranges.filter((r) => cls(r) === 'nd-code-folded')).toHaveLength(0)

    const widgetRange = ranges.find(isWidget)
    expect(widgetRange.value.spec.widget.folded).toBe(false)

    view.destroy()
  })
})
