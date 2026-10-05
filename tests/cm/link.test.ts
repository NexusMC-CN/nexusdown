/**
 * 链接 / 图片 / 自动链接 / 水平线的单元测试。
 *
 * 做法和 `decorate.test.ts` 一致：用 `EditorState.create` 建一个真实的 GFM
 * markdown 状态，遍历语法树找到目标节点，**直接调用装饰器函数**（传两个空数组），
 * 再对推出的装饰数量与区间做断言。
 *
 * ⚠️ `cursor` 默认取 `doc.length`（末行）。所以凡是要测「非揭示态」的用例，
 * 文档都写成 `目标行\n\n尾部` —— 否则单行文档的光标本身就落在目标行上，
 * 会被判成揭示态。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { Range, Text } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'

import { decorateBlock } from '../../src/cm/decorate/block.js'
import { decorateLink } from '../../src/cm/decorate/link.js'
import { ImageWidget } from '../../src/cm/widgets/image.js'

interface Collected {
  ranges: Range<Decoration>[]
  atomicRanges: Range<Decoration>[]
  doc: Text
}

interface CollectOpts {
  cursor?: number
  references?: ReadonlyMap<string, string>
  urlPolicy?: (url: string) => string | null
}

function stateOf(doc: string, cursor: number) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage })],
  })
}

/** 遍历树 → 对每个名字命中的节点调 `decorateLink`。命中后不再下降（同 plugin.ts）。 */
function collectLink(doc: string, names: string[], opts: CollectOpts = {}): Collected {
  const state = stateOf(doc, opts.cursor ?? doc.length)
  const ranges: Range<Decoration>[] = []
  const atomicRanges: Range<Decoration>[] = []
  let hits = 0

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (!names.includes(ref.name)) return
      hits++
      decorateLink(ranges, atomicRanges, ref.node, state.doc, state.selection, opts.references, opts.urlPolicy)
      return false
    },
  })

  if (hits === 0) throw new Error(`语法树里没有 ${names.join(' / ')} 节点`)
  return { ranges, atomicRanges, doc: state.doc }
}

/** 同上，但走 `decorateBlock`（`plugin.ts` 把 Image / HorizontalRule 归到这块）。 */
function collectBlock(doc: string, names: string[], opts: CollectOpts = {}): Collected {
  const state = stateOf(doc, opts.cursor ?? doc.length)
  const ranges: Range<Decoration>[] = []
  const atomicRanges: Range<Decoration>[] = []
  let hits = 0

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (!names.includes(ref.name)) return
      hits++
      decorateBlock(ranges, atomicRanges, ref.node, state.doc, state.selection)
      return false
    },
  })

  if (hits === 0) throw new Error(`语法树里没有 ${names.join(' / ')} 节点`)
  return { ranges, atomicRanges, doc: state.doc }
}

interface DecoSpec {
  class?: string
  widget?: unknown
  attributes?: Record<string, string>
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

const spans = (rs: readonly Range<Decoration>[]): number[][] => rs.map((r) => [r.from, r.to])
const hrefOf = (r: Range<Decoration>): string | undefined => specOf(r.value).attributes?.['data-href']

/**
 * 每个 replace / mark 都必须落在**同一行**内（`Decoration.replace` 不能跨行）。
 *
 * ★ **唯一的豁免是 `block: true` 的整块替换** —— 全项目只有 `features/table.ts`
 * 产出它（3 行表格 → 一张 `<table>`），而它**故意**跨行：整块渲染本来就得跨行。
 *
 * ⚠️ 这个例外为什么安全：跨行 replace 会让整块**永远无法编辑** ✗（光标进不去
 * 替换区间）。table 配了「**紧邻即揭示**」—— 光标一到 `from - 1` / `to + 1`
 * 就换回源码，光标随即能走进去 ✓。详见 `src/cm/features/table.ts` 文件头。
 *
 * ⚠️ `decorateLink` 自己一个 block 装饰都不产，所以这条豁免在这里是空操作 ——
 * 写出来是为了让「不许跨行」这条规矩有一个**显式的、有理由的**例外。
 */
function expectNoCrossLineReplace(c: Collected): void {
  for (const r of [...c.ranges, ...c.atomicRanges]) {
    if ((r.value.spec as { block?: boolean }).block === true) continue
    const startLine = c.doc.lineAt(r.from).number
    const endLine = c.doc.lineAt(Math.max(r.from, r.to - 1)).number
    expect(endLine).toBe(startLine)
  }
}

describe('decorateLink —— 行内链接 [文字](url)', () => {
  const DOC = '[文字](https://a.com)\n\n尾部'

  it('非揭示态：`[` 与 `](url)` 两段 HIDE + 文字段 1 个 nd-link mark 带 data-href', () => {
    const c = collectLink(DOC, ['Link'])

    const hides = c.ranges.filter(isHide)
    expect(spans(hides)).toEqual([
      [0, 1],
      [3, 19],
    ])
    // 两段 HIDE 都要登记成原子区间。
    expect(spans(c.atomicRanges)).toEqual([
      [0, 1],
      [3, 19],
    ])
    expect(c.doc.sliceString(0, 1)).toBe('[')
    expect(c.doc.sliceString(3, 19)).toBe('](https://a.com)')

    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(spans(links)).toEqual([[1, 3]])
    expect(c.doc.sliceString(1, 3)).toBe('文字')
    expect(hrefOf(links[0])).toBe('https://a.com')

    // 一共 3 个装饰：两段 HIDE + 一个 link mark。
    expect(c.ranges).toHaveLength(3)
    expectNoCrossLineReplace(c)
  })

  it('揭示态：全是 MUTED_MARK，没有 HIDE，也没有 atomic；文字仍有 nd-link', () => {
    const c = collectLink(DOC, ['Link'], { cursor: 1 })

    expect(c.ranges.filter(isHide)).toHaveLength(0)
    expect(c.atomicRanges).toHaveLength(0)

    // `[` 与 `](url)` 都「变灰」而不是藏掉。
    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-mark')))).toEqual([
      [0, 1],
      [3, 19],
    ])

    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(spans(links)).toEqual([[1, 3]])
    expect(hrefOf(links[0])).toBe('https://a.com')

    // 全部装饰只可能是这两类。
    expect(c.ranges).toHaveLength(3)
  })

  it('带标题的链接：`](url "标题")` 整段一起藏', () => {
    const c = collectLink('[文字](https://a.com "标题")\n\n尾部', ['Link'])

    expect(spans(c.ranges.filter(isHide))).toEqual([
      [0, 1],
      [3, 24],
    ])
    expect(c.doc.sliceString(3, 24)).toBe('](https://a.com "标题")')
  })

  it('尖括号包裹的目标：`<>` 剥掉后再过白名单，data-href 不含尖括号', () => {
    const c = collectLink('[x](<https://a.com/a b>)\n\n尾部', ['Link'])

    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(hrefOf(links[0])).toBe('https://a.com/a b')
  })

  it('空文字 `[](url)`：只藏两段语法，不推零长度的 mark', () => {
    const c = collectLink('[](https://a.com)\n\n尾部', ['Link'])

    expect(spans(c.ranges.filter(isHide))).toEqual([
      [0, 1],
      [1, 17],
    ])
    expect(c.ranges.filter((r) => isMark(r, 'nd-link'))).toHaveLength(0)
  })
})

describe('decorateLink —— URL 白名单（被拒时什么都不做）', () => {
  const REJECTED = [
    ['javascript:', '[x](javascript:alert(1))\n\n尾部'],
    ['mailto:', '[x](mailto:a@b.com)\n\n尾部'],
    ['协议相对 //', '[x](//evil.com)\n\n尾部'],
    ['反斜杠变体 \\\\', '[x](\\\\evil.com)\n\n尾部'],
    ['vbscript:', '[x](vbscript:x)\n\n尾部'],
    ['file:', '[x](file:///etc/passwd)\n\n尾部'],
  ] as const

  for (const [label, doc] of REJECTED) {
    it(`${label} 被拒 → 没有 link mark，也没有 HIDE（源码原样显示）`, () => {
      const c = collectLink(doc, ['Link'])

      expect(c.ranges).toHaveLength(0)
      expect(c.atomicRanges).toHaveLength(0)
    })
  }

  it('无 scheme 的相对路径放行 → 有 link mark', () => {
    const c = collectLink('[x](./relative)\n\n尾部', ['Link'])

    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(spans(links)).toEqual([[1, 2]])
    expect(c.doc.sliceString(1, 2)).toBe('x')
    expect(hrefOf(links[0])).toBe('./relative')
    expect(spans(c.ranges.filter(isHide))).toEqual([
      [0, 1],
      [2, 15],
    ])
  })

  it('自定义 urlPolicy 可以放行默认被拒的 scheme，也可以改写 URL', () => {
    const c = collectLink('[x](mailto:a@b.com)\n\n尾部', ['Link'], {
      urlPolicy: (url) => url.replace(/^mailto:/, ''),
    })

    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(spans(links)).toEqual([[1, 2]])
    expect(hrefOf(links[0])).toBe('a@b.com')
  })
})

describe('decorateLink —— 引用式 / 快捷式', () => {
  it('[文字][label] 完整引用式：URL 从定义行现算，两段语法各自 HIDE', () => {
    const c = collectLink('[文字][label]\n\n[label]: https://a.com\n\n尾部', ['Link'])

    expect(spans(c.ranges.filter(isHide))).toEqual([
      [0, 1],
      [3, 11],
    ])
    expect(c.doc.sliceString(3, 11)).toBe('][label]')

    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(spans(links)).toEqual([[1, 3]])
    expect(hrefOf(links[0])).toBe('https://a.com')
  })

  it('[label] 快捷引用式：文字本身就是 label', () => {
    const c = collectLink('[label]\n\n[label]: https://a.com\n\n尾部', ['Link'])

    expect(spans(c.ranges.filter(isHide))).toEqual([
      [0, 1],
      [6, 7],
    ])
    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(spans(links)).toEqual([[1, 6]])
    expect(hrefOf(links[0])).toBe('https://a.com')
  })

  it('label 匹配大小写不敏感', () => {
    const c = collectLink('[x][LABEL]\n\n[label]: https://a.com\n\n尾部', ['Link'])

    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(hrefOf(links[0])).toBe('https://a.com')
  })

  it('围栏代码块里的假定义不算数 —— 扫描跳过围栏内部，认外面那条真定义', () => {
    // 假定义写在真定义**之前**，所以只有「跳过围栏」才会选到 safe.com。
    const doc = '[label]\n\n```\n[label]: https://evil.com\n```\n\n[label]: https://safe.com\n\n尾部'
    const c = collectLink(doc, ['Link'])

    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(spans(links)).toEqual([[1, 6]])
    expect(hrefOf(links[0])).toBe('https://safe.com')
  })

  it('外部传入 references 时优先生效（不做文本扫描）', () => {
    const references = new Map([['label', 'https://from-option.com']])
    const c = collectLink('[文字][label]\n\n[label]: https://a.com\n\n尾部', ['Link'], { references })

    expect(hrefOf(c.ranges.filter((r) => isMark(r, 'nd-link'))[0])).toBe('https://from-option.com')
  })

  it('引用式链接的 URL 被拒时也不做任何装饰', () => {
    const c = collectLink('[x][b]\n\n[b]: javascript:alert(1)\n\n尾部', ['Link'])

    expect(c.ranges).toHaveLength(0)
  })
})

describe('decorateLink —— 自动链接', () => {
  it('尖括号自动链接 <https://x.com>：`<` `>` 两段 HIDE，URL 段是链接文字', () => {
    const c = collectLink('<https://x.com>\n\n尾部', ['Autolink'])

    expect(spans(c.ranges.filter(isHide))).toEqual([
      [0, 1],
      [14, 15],
    ])
    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(spans(links)).toEqual([[1, 14]])
    expect(hrefOf(links[0])).toBe('https://x.com')
    expectNoCrossLineReplace(c)
  })

  it('裸 GFM 自动链接 https://x.com：整段一个 link mark，没有 HIDE', () => {
    const c = collectLink('https://x.com/raw\n\n尾部', ['URL'])

    expect(c.ranges.filter(isHide)).toHaveLength(0)
    const links = c.ranges.filter((r) => isMark(r, 'nd-link'))
    expect(spans(links)).toEqual([[0, 17]])
    expect(hrefOf(links[0])).toBe('https://x.com/raw')
  })

  it('裸自动链接被拒时不做任何装饰', () => {
    // `www.x.com` / `a@b.com` 也会被 lezer 认成裸 URL 节点，但它们没有显式 scheme
    // —— 当相对路径放行会得到错误的 href，所以裸自动链接要求 http(s)://。
    for (const doc of ['www.x.com\n\n尾部', 'a@b.com\n\n尾部']) {
      const c = collectLink(doc, ['URL'])

      expect(c.ranges).toHaveLength(0)
      expect(c.atomicRanges).toHaveLength(0)
    }
  })
})

describe('decorateLink —— 图片 ![alt](src)', () => {
  const DOC = '![alt](https://a.com/i.png)\n\n尾部'

  it('非揭示态：整个节点换成 1 个 ImageWidget replace', () => {
    const c = collectLink(DOC, ['Image'])

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([[0, 27]])
    expect(c.doc.sliceString(0, 27)).toBe('![alt](https://a.com/i.png)')

    const widget = specOf(widgets[0].value).widget
    expect(widget).toBeInstanceOf(ImageWidget)
    expect(widget).toMatchObject({ src: 'https://a.com/i.png', alt: 'alt' })

    expect(spans(c.atomicRanges)).toEqual([[0, 27]])
    expectNoCrossLineReplace(c)
  })

  it('揭示态：显示源码（变灰），没有 widget', () => {
    const c = collectLink(DOC, ['Image'], { cursor: 3 })

    expect(c.ranges.filter(isWidgetReplace)).toHaveLength(0)
    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-mark')))).toEqual([
      [0, 2],
      [5, 27],
    ])
    expect(c.atomicRanges).toHaveLength(0)
  })

  it('src 被拒（javascript:）→ 什么都不做，源码原样显示', () => {
    const c = collectLink('![alt](javascript:x)\n\n尾部', ['Image'])

    expect(c.ranges).toHaveLength(0)
    expect(c.atomicRanges).toHaveLength(0)
  })

  it('引用式图片 ![alt][img]：src 从定义行现算', () => {
    const c = collectLink('![alt][img]\n\n[img]: ./i.png\n\n尾部', ['Image'])

    const widget = specOf(c.ranges.filter(isWidgetReplace)[0].value).widget
    expect(widget).toMatchObject({ src: './i.png', alt: 'alt' })
  })

  it('plugin.ts 把 Image 归到 block 桶 —— decorateBlock 产出同一个 widget', () => {
    const c = collectBlock(DOC, ['Image'])

    const widgets = c.ranges.filter(isWidgetReplace)
    expect(spans(widgets)).toEqual([[0, 27]])
    expect(specOf(widgets[0].value).widget).toMatchObject({ src: 'https://a.com/i.png', alt: 'alt' })
    expect(spans(c.atomicRanges)).toEqual([[0, 27]])
  })
})

describe('decorateBlock —— 水平线', () => {
  it('--- → 一个 nd-hr line 装饰 + 整行 HIDE（不跨行）', () => {
    const c = collectBlock('---\n\n尾部', ['HorizontalRule'])

    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-hr')))).toEqual([[0, 0]])
    expect(spans(c.ranges.filter(isHide))).toEqual([[0, 3]])
    expect(c.doc.sliceString(0, 3)).toBe('---')
    expect(spans(c.atomicRanges)).toEqual([[0, 3]])
    expectNoCrossLineReplace(c)
  })

  it('*** / ___ 与缩进的 `  ---` 都识别为水平线', () => {
    for (const doc of ['***\n\n尾部', '___\n\n尾部', '  ---\n\n尾部']) {
      const c = collectBlock(doc, ['HorizontalRule'])

      expect(spans(c.ranges.filter((r) => isLine(r, 'nd-hr')))).toHaveLength(1)
      expect(c.ranges.filter(isHide)).toHaveLength(1)
    }
  })

  it('揭示态：`---` 变淡而不是藏掉，line 装饰仍在', () => {
    const c = collectBlock('---\n\n尾部', ['HorizontalRule'], { cursor: 1 })

    expect(c.ranges.filter(isHide)).toHaveLength(0)
    expect(c.atomicRanges).toHaveLength(0)
    expect(spans(c.ranges.filter((r) => isMark(r, 'nd-mark')))).toEqual([[0, 3]])
    expect(spans(c.ranges.filter((r) => isLine(r, 'nd-hr')))).toEqual([[0, 0]])
  })
})
