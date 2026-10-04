/**
 * `table` 编辑器侧扩展的测试。
 *
 * 这个功能是**唯一**一个产出「跨行 block replace」的地方，所以测试分两层：
 *
 * 1. **纯函数层**（`tableFeature.decorate`）—— 精确断言装饰的**区间 / 种类 / block 标记**，
 *    以及揭示态、代码块里的 `|` 行等边界。这一层不依赖 CM6 的视图。
 * 2. **集成层**（挂一个真编辑器）—— 断言 widget 真的画出了 `<table>`、
 *    点击真的把光标放到门口、光标一进门就换回源码。
 *
 * ⚠️ 为什么必须有第 2 层：块级装饰走的是 **StateField**（不是 ViewPlugin，CM6 硬限制，
 * 见 `features/table.ts` 文件头），所以从 `view.plugin(...).decorations` 里**读不到它**。
 * 只有挂真视图、看 DOM 才能证明它真的生效。
 *
 * ⚠️ 文档一律写成 `前言\n\n<表格>\n\n尾部`：光标默认落在**文档末尾**，
 * 而表格的判据是「光标在表格里 / 紧邻」—— 前后都垫一行，非揭示态基线才成立。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState, type Extension, type Range, type Text } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { TableWidget, tableFeature } from '../../src/cm/features/table.js'
import { nexusdownLivePreview } from '../../src/cm/plugin.js'

interface Collected {
  ranges: Range<Decoration>[]
  atomicRanges: Range<Decoration>[]
  doc: Text
  /** 语法树里找到了几个 `Table` 节点（用来证明「没被认领」的用例）。 */
  hits: number
}

/** 在真语法树里找 `Table`，把每个都交给 `tableFeature.decorate`。 */
function collectTable(doc: string, cursor: number = doc.length): Collected {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, addKeymap: false })],
  })

  const ranges: Range<Decoration>[] = []
  const atomicRanges: Range<Decoration>[] = []
  let hits = 0

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'Table') return
      hits++
      tableFeature.decorate(ranges, atomicRanges, ref.node, state.doc, state.selection)
    },
  })

  return { ranges, atomicRanges, doc: state.doc, hits }
}

const specOf = (value: Decoration): { block?: boolean; widget?: unknown; class?: string } =>
  value.spec as { block?: boolean; widget?: unknown; class?: string }

const TABLE = '| a | b |\n| - | - |\n| c | d |'
const DOC = `前言\n\n${TABLE}\n\n尾部`
const FROM = 4 // `前言\n\n` = 4 个字符，表格首行行首
const TO = 33 // 表格末行行尾（`| c | d |` 结束处）

describe('table —— 纯函数层：装饰区间与种类', () => {
  it('★ 非揭示态 → **一个跨行的 block replace**（显式断言它是 block）', () => {
    const c = collectTable(DOC)

    expect(c.hits).toBe(1)
    expect(c.ranges).toHaveLength(1)

    const r = c.ranges[0]!
    // 整块 = 从表格首行行首到末行行尾。
    expect([r.from, r.to]).toEqual([FROM, TO])
    expect(c.doc.sliceString(r.from, r.to)).toBe(TABLE)

    const spec = specOf(r.value)
    // ★ 核心断言：它是 **block**，而且带 TableWidget。
    expect(spec.block).toBe(true)
    expect(spec.widget).toBeInstanceOf(TableWidget)

    // 跨行：首行行号 ≠ 末行行号（这正是「ViewPlugin 提供不了、必须走 StateField」的原因）。
    expect(c.doc.lineAt(r.from).number).toBe(3)
    expect(c.doc.lineAt(r.to - 1).number).toBe(5)

    // 块级 replace 不登记 atomicRanges —— 光标本来就被 CM6 挡在区间外（见文件头）。
    expect(c.atomicRanges).toHaveLength(0)
  })

  it('★ 光标在表格里 → **不推任何装饰**（揭示源码）', () => {
    const c = collectTable(DOC, FROM + 2)

    expect(c.hits).toBe(1)
    expect(c.ranges).toHaveLength(0)
  })

  /* ★ 空行整行都是门口 → 光看位置分不清"路过"和"要编辑" ✗（见 math.test.ts 同名两条）。 */
  it('★ 光标停在**空**的相邻行（`from - 1` / `to + 1`）→ **照常渲染成表格**', () => {
    /*
     * ⚠️ 用户实测（2026-10-04）：表格/公式上下是**空行**时 ✓，
     * 光标停在那一行（空行**整行**都是门口 ✓）→ **块莫名其妙不渲染** ✗。
     * 修复后：空行上路过**不再**算"要编辑" ✓ —— 这条就是那个回归 ✓。
     */
    for (const cursor of [FROM - 1, TO + 1]) {
      const { parent } = mount(DOC, cursor)
      expect(parent.querySelector('.nd-table')).not.toBeNull()
    }
  })

  it('选区跨进表格也算揭示（多行选区必须揭示被跨越的行）', () => {
    const state = EditorState.create({
      doc: DOC,
      selection: { anchor: 0, head: DOC.length },
      extensions: [markdown({ base: markdownLanguage, addKeymap: false })],
    })
    const ranges: Range<Decoration>[] = []
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name === 'Table') {
          tableFeature.decorate(ranges, [], ref.node, state.doc, state.selection)
        }
      },
    })
    expect(ranges).toHaveLength(0)
  })

  it('单行 `| a | b |` **不是**表格（GFM 要求表头 + 分隔行）→ 不被认领', () => {
    const c = collectTable('前言\n\n| a | b |\n\n尾部')
    expect(c.hits).toBe(0)
    expect(c.ranges).toHaveLength(0)
  })

  it('★ 围栏代码块里的 `|` 行**不是**表格 → 不被认领', () => {
    // lezer 不把围栏内容当块解析，所以这里压根没有 `Table` 节点 ——
    // 「跳过代码块」是认领语法树**白送**的，不用自己跟踪围栏开关。
    const c = collectTable('前言\n\n```\n| a | b |\n| - | - |\n```\n\n尾部')
    expect(c.hits).toBe(0)
    expect(c.ranges).toHaveLength(0)
  })

  it('缩进代码块（4 空格）里的 `|` 行也不是表格', () => {
    const c = collectTable('前言\n\n    | a | b |\n    | - | - |\n\n尾部')
    expect(c.hits).toBe(0)
    expect(c.ranges).toHaveLength(0)
  })

  it('无表体的两行表格（只有表头 + 分隔行）也认', () => {
    const c = collectTable('前言\n\n| a | b |\n| - | - |\n\n尾部')
    expect(c.hits).toBe(1)
    expect(c.ranges).toHaveLength(1)
    expect(specOf(c.ranges[0]!.value).block).toBe(true)
  })
})

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

/** 挂一个真编辑器，把 `tableFeature` 注入 features（块级功能会自动走 StateField）。 */
function mount(doc: string, cursor: number = doc.length) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [
        markdown({ base: markdownLanguage, addKeymap: false }),
        nexusdownLivePreview({ features: new Map([['Table', tableFeature]]) }),
      ] as Extension[],
    }),
    parent,
  })
  views.push(view)
  return { view, parent }
}

describe('table —— 集成层：真编辑器里渲染成 <table>', () => {
  it('★ 非揭示态 → widget 里真的是一张 `<table>`', () => {
    const { parent } = mount(DOC)

    const widget = parent.querySelector('.nd-table')
    expect(widget).not.toBeNull()
    // ★ 渲染侧那份产出的结构（不是我们自己拼的 HTML）。
    expect(widget!.querySelector('table')).not.toBeNull()
    expect(widget!.querySelectorAll('th')).toHaveLength(2)
    expect(widget!.querySelectorAll('td')).toHaveLength(2)
    expect(widget!.textContent).toContain('a')
    // 三行源码被一个块级 widget 替掉了 —— 源码本身不再出现在正文里。
    expect(parent.querySelector('.cm-content')!.textContent).not.toContain('| - | - |')
  })

  it('★ 点 widget → 光标落到 `from - 1`（门口），表格换回源码', () => {
    const { view, parent } = mount(DOC)
    expect(parent.querySelector('.nd-table')).not.toBeNull()

    parent.querySelector('.nd-table')!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )

    expect(view.state.selection.main.head).toBe(FROM - 1)
    expect(parent.querySelector('.nd-table')).toBeNull()
    expect(parent.querySelector('.cm-content')!.textContent).toContain('| - | - |')
  })

  it('★ 光标走进表格 → 源码露出（widget 消失）', () => {
    const { view, parent } = mount(DOC)

    view.dispatch({ selection: { anchor: FROM + 2 } })
    expect(parent.querySelector('.nd-table')).toBeNull()

    // 光标再离开 → 表格回来。
    view.dispatch({ selection: { anchor: DOC.length } })
    expect(parent.querySelector('.nd-table')).not.toBeNull()
  })

  it('★ 光标停在门口（空行）→ **照常渲染**；点开才揭示', () => {
    const { view, parent } = mount(DOC)

    /*
     * ⚠️ 旧断言在这里是"源码露出" ✗ —— 那正是用户报的 bug ✓：
     * 文档上下是空行时，光标停在那一行（空行整行都是门口 ✓）就**块不渲染** ✗。
     */
    view.dispatch({ selection: { anchor: FROM - 1 } })
    expect(parent.querySelector('.nd-table')).not.toBeNull()

    view.dispatch({ selection: { anchor: TO + 1 } })
    expect(parent.querySelector('.nd-table')).not.toBeNull()

    view.dispatch({ selection: { anchor: DOC.length } })
    expect(parent.querySelector('.nd-table')).not.toBeNull()
  })

  it('★ **点开**表格才揭示源码（意图判据 —— 位置分不清路过和要编辑）', () => {
    const { parent } = mount(DOC)
    const widget = parent.querySelector('.nd-table') as HTMLElement | null
    expect(widget).not.toBeNull()

    // 点击 = 用户明确说要编辑 ✓ → 露出源码 ✓
    widget!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(parent.querySelector('.nd-table')).toBeNull()
  })

  it('★ 表格就在文档开头：点 widget 也不能抛（`from - 1` 会被夹到 0）', () => {
    // `from === 0` 时 `from - 1 === -1` —— 直接 dispatch 会抛
    // `Selection points outside of document`。夹到 0 之后落在表格首行行首，
    // 一样是揭示态。
    const doc = '| a | b |\n| - | - |\n| c | d |\n\n尾部'
    const { view, parent } = mount(doc, doc.length)

    expect(parent.querySelector('.nd-table')).not.toBeNull()
    parent.querySelector('.nd-table')!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    expect(view.state.selection.main.head).toBe(0)
    expect(parent.querySelector('.nd-table')).toBeNull()
  })

  it('★ 单元格里的原始 HTML 被转义（证明编辑器侧真的复用了渲染侧）', () => {
    /*
     * 这条守的是 `TableWidget` 用 `innerHTML` 的**前提**：渲染侧 `html: false`，
     * 用户输入里的标签会被转义成文本。
     *
     * 转义规则本身由渲染侧测试守着（`tests/render/renderMarkdown.test.ts`），
     * 这里要证明的是**编辑器侧确实走的是同一个 `renderMarkdown`** ——
     * 如果哪天有人图省事在编辑器里另写一份渲染，这条会立刻红。
     */
    const { parent } = mount('前言\n\n| <img src=x onerror=alert(1)> | b |\n| - | - |\n\n尾部')
    const widget = parent.querySelector('.nd-table')!

    // 没有真的 `<img>` 元素……
    expect(widget.querySelector('img')).toBeNull()
    // ……而是原样的文本（`&lt;img …&gt;` 在 textContent 里就是 `<img …>`）。
    expect(widget.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
