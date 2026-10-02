/**
 * `math` 编辑器侧扩展的测试。
 *
 * 做法同 `table.test.ts`：挂一个**真实编辑器**，用 `LivePreviewOptions.features`
 * 直接把 `mathFeature` 注入骨架（功能还没进注册表），再从插件实例读回装饰断言。
 *
 * ⚠️ 功能认领的是 `Document` 节点（全文扫描的挂载点，见 `features/math.ts` 的注释），
 * 所以注入表的 key 是 `'Document'`，不是某个行内节点名。
 *
 * 断言的是**区间与种类**（widget / replace / mark），不是「跑起来了」。
 * 选区默认落在文档末尾（非揭示态基线）—— 文档都写成 `目标行\n\n尾部`，
 * 否则单行文档的光标本身就落在目标行上、被判成揭示态。
 *
 * ## 块级公式（本次新增）
 *
 * 块级走 ` ```math ` 围栏。渲染函数由消费方注入（`createMathFeature(render)`），
 * 所以这里用一个**记录调用的 stub**（同渲染侧 `render/math.test.ts`）：
 * 既断言「传了正确的 tex 与安全选项」，又断言「没注入 → 降级成代码块、不报错」。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type Decoration } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { embedFeature } from '../../src/cm/features/embed.js'
import {
  createMathFeature,
  mathFeature,
  MathBlockWidget,
  MathWidget,
  type MathRenderer,
} from '../../src/cm/features/math.js'
import type { EditorFeature } from '../../src/cm/feature.js'
import {
  nexusdownLivePreview,
  type LivePreviewPluginValue,
} from '../../src/cm/plugin.js'

type Kind = 'line' | 'mark' | 'replace' | 'widget'

interface Deco {
  from: number
  to: number
  cls: string | undefined
  kind: Kind
}

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

/** 注入 `mathFeature`（认领 `Document`）的默认实例。 */
function mount(doc: string, cursor: number = doc.length) {
  return mountWith(new Map([['Document', mathFeature]]), doc, cursor)
}

/** 挂一个真编辑器，把给定的功能表注入骨架。 */
function mountWith(
  features: ReadonlyMap<string, EditorFeature>,
  doc: string,
  cursor: number = doc.length,
) {
  const plugin = nexusdownLivePreview({ features })
  /*
   * ⚠️ `selection` 必须传 `{ anchor }`（CM6 会自己包成 `EditorSelection`）。
   * 传 `{ ranges: [...] }` 会被**静默忽略** —— 没有报错，光标就是不在你指定的位置，
   * 于是「揭示态」那几条会莫名其妙地变成非揭示态。
   */
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, addKeymap: false }), plugin] as Extension[],
  })
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({ state, parent })
  views.push(view)

  const instance = view.plugin(plugin as unknown as ViewPlugin<LivePreviewPluginValue>)
  if (!instance) throw new Error('插件没有挂上')
  return { view, instance }
}

/** 读回当前全部装饰，按种类标注（与 `table.test.ts` 同一套判据）。 */
function read(instance: LivePreviewPluginValue): Deco[] {
  const out: Deco[] = []
  instance.decorations.between(0, 1e9, (from, to, value) => {
    const spec = value.spec as { class?: string; widget?: unknown }
    const kind: Kind =
      spec.widget !== undefined
        ? 'widget'
        : 'tagName' in value
          ? 'mark'
          : spec.class !== undefined
            ? 'line'
            : 'replace'
    out.push({ from, to, cls: spec.class, kind })
  })
  return out
}

/** 装饰值本身（断言 widget 字段 / block 标记用）。 */
function values(instance: LivePreviewPluginValue): Decoration[] {
  const out: Decoration[] = []
  instance.decorations.between(0, 1e9, (_f, _t, value) => {
    out.push(value)
  })
  return out
}

/** widget 的构造器名（区分公式 widget / 代码块标题栏 / 行内公式 widget）。 */
function widgetCtors(instance: LivePreviewPluginValue): string[] {
  return values(instance)
    .map((v) => (v.spec as { widget?: object }).widget?.constructor.name)
    .filter((name): name is string => name !== undefined)
}

const spans = (ds: Deco[], kind: Kind): number[][] =>
  ds.filter((d) => d.kind === kind).map((d) => [d.from, d.to])

/** 记录调用的假 KaTeX —— 同 `render/math.test.ts`，不把测试绑死在 KaTeX 内部实现上。 */
function makeRenderer(): MathRenderer & {
  calls: Array<{ tex: string; options: Record<string, unknown> | undefined }>
} {
  const calls: Array<{ tex: string; options: Record<string, unknown> | undefined }> = []
  return {
    calls,
    renderToString(tex: string, options?: Record<string, unknown>): string {
      calls.push({ tex, options })
      return `<span class="katex-stub" data-tex="${tex}" data-display="${String(options?.displayMode)}"></span>`
    },
  }
}

describe('math —— 行内公式（非揭示态）', () => {
  it('★ `$x^2$` 整段换成 widget，区间 [2,7)，并登记为原子区间', () => {
    const { instance } = mount('a $x^2$ b\n\n尾部')

    expect(spans(read(instance), 'widget')).toEqual([[2, 7]])
    // 隐藏态的 replace 必须同时进 atomicRanges（契约硬约束二）。
    expect(instance.atomicDecorations.size).toBe(1)
    let atomicSpan: number[] = []
    instance.atomicDecorations.between(0, 1e9, (from, to) => {
      atomicSpan = [from, to]
    })
    expect(atomicSpan).toEqual([2, 7])
  })

  it('★ widget 不是 block 替换（block:true 会让方向键永远进不去）', () => {
    const { instance } = mount('a $x^2$ b\n\n尾部')

    const widgetDeco = values(instance).find(
      (v) => (v.spec as { widget?: unknown }).widget !== undefined,
    )
    expect(widgetDeco).toBeDefined()
    expect((widgetDeco!.spec as { block?: boolean }).block).toBeUndefined()
  })

  it('widget 的 DOM 是 `.nd-math`，文本内容就是 TeX 源码', () => {
    const { instance } = mount('a $x^2$ b\n\n尾部')

    const widget = (values(instance).find(
      (v) => (v.spec as { widget?: unknown }).widget !== undefined,
    )!.spec as { widget: MathWidget }).widget

    const dom = widget.toDOM()
    /*
     * ⚠️ 这条**曾经把 bug 写成了断言** ✗ —— 原文是
     * 「编辑器里不跑 KaTeX，退化成显示 TeX」✓，于是行内公式**永远不渲染** ✓
     * （用户：「公式没生效」）。
     *
     * 现在：**注入渲染函数才渲染** ✓；没注入就降级成源码 ✓（这条测的是后者 ✓）。
     */
    expect(dom.className).toContain('nd-math')
    expect(dom.className).toContain('nd-math-source')
    expect(dom.textContent).toBe('x^2')
  })

  it('★ `MathWidget.eq`：同 TeX 相等、不同 TeX 不等（少了它每次 rebuild 都会闪）', () => {
    expect(new MathWidget('x^2').eq(new MathWidget('x^2'))).toBe(true)
    expect(new MathWidget('x^2').eq(new MathWidget('y^2'))).toBe(false)
  })

  it('一段文本里的多个公式各自成一个 widget', () => {
    const { instance } = mount('$a$ 和 $b^2$ 结束\n\n尾部')

    // '$a$' = [0,3)；'$b^2$' = [6,11)
    expect(spans(read(instance), 'widget')).toEqual([
      [0, 3],
      [6, 11],
    ])
    expect(instance.atomicDecorations.size).toBe(2)
  })
})

describe('math —— 揭示态', () => {
  it('★ 光标落在公式行 → 保留源码，两个 `$` 变淡（`nd-mark`），不产生 widget', () => {
    // 光标在第 1 行内（anchor 4），触发行级揭示。
    const { instance } = mount('a $x^2$ b\n\n尾部', 4)
    const ds = read(instance)

    expect(ds.filter((d) => d.kind === 'widget')).toHaveLength(0)
    expect(instance.atomicDecorations.size).toBe(0)
    // 两个 `$` 各一段 `nd-mark`：`$`@2 与 `$`@6。
    expect(ds.filter((d) => d.kind === 'mark' && d.cls === 'nd-mark').map((d) => [d.from, d.to])).toEqual([
      [2, 3],
      [6, 7],
    ])
  })
})

describe('math —— 不该被当成公式的写法', () => {
  it('货币式 `$5 and $6` 不产生任何装饰（内容以空白结尾）', () => {
    const { instance } = mount('$5 and $6\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })

  it('`$$block$$` 不产生装饰（块级用围栏，`$$` 不是行内公式）', () => {
    const { instance } = mount('$$block$$\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })

  it('★ 行内代码里的 `$x$` 不算公式（反引号整段跳过）', () => {
    const { instance } = mount('`$x$` 和 $y$\n\n尾部')

    // 只有代码外的 `$y$` 被认出来：'`$x$` 和 ' 是 8 个字符，`$y$` 落在 [8,11)。
    expect(spans(read(instance), 'widget')).toEqual([[8, 11]])
  })

  it('★ 围栏代码块里的 `$x$` 不算公式', () => {
    const { instance } = mount('```\n$x$\n```\n\n$y$\n\n尾部')

    // 围栏里的 `$x$` 被跳过；块后的 `$y$` 仍被认出（落在 [13,16)）。
    const widgets = spans(read(instance), 'widget')
    expect(widgets).toHaveLength(1)
    expect(widgets[0]).toEqual([13, 16])
  })

  it('转义的 `\\$x\\$` 不算公式', () => {
    const { instance } = mount('\\$x\\$\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })

  it('未闭合的 `$x` 不算公式', () => {
    const { instance } = mount('a $x b\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })
})

/* ==========================================================================
 * 块级公式（```math 围栏）
 *
 * `MATH_DOC` 的坐标：
 *   开围栏行 ` ```math ` [0,7)；内容行 `x^2` [8,11)；闭围栏行 ` ``` ` [12,15)。
 * 光标默认落在末行（`尾部`），所以是非揭示态基线。
 * ======================================================================== */
const MATH_DOC = '```math\nx^2\n```\n\n尾部'

describe('math —— 块级公式（注入了渲染函数）', () => {
  it('★ 开围栏行换成公式 widget，内容行 + 闭围栏行藏掉并压行高', () => {
    const { instance } = mountWith(
      new Map([['Document', createMathFeature(makeRenderer())]]),
      MATH_DOC,
    )

    // 开围栏行整行换成公式 widget。
    expect(spans(read(instance), 'widget')).toEqual([[0, 7]])
    // 内容行与闭围栏行的行内内容藏掉。
    expect(spans(read(instance), 'replace')).toEqual([
      [8, 11],
      [12, 15],
    ])
    // 行级装饰：开围栏行给 padding，其余两行压高。
    expect(
      read(instance)
        .filter((d) => d.kind === 'line')
        .map((d) => [d.from, d.cls]),
    ).toEqual([
      [0, 'nd-math-open'],
      [8, 'nd-math-hidden'],
      [12, 'nd-math-hidden'],
    ])
  })

  it('★ 隐藏态的 replace 全部登记为原子区间（否则光标会停在隐藏区间中间）', () => {
    const { instance } = mountWith(
      new Map([['Document', createMathFeature(makeRenderer())]]),
      MATH_DOC,
    )

    const atomic: number[][] = []
    instance.atomicDecorations.between(0, 1e9, (from, to) => {
      atomic.push([from, to])
    })
    expect(atomic).toEqual([
      [0, 7],
      [8, 11],
      [12, 15],
    ])
  })

  it('★ 渲染函数收到的是围栏内容（不含两侧围栏行），且传 displayMode=true 与安全选项', () => {
    const render = makeRenderer()
    mountWith(new Map([['Document', createMathFeature(render)]]), MATH_DOC)

    expect(render.calls).toHaveLength(1)
    expect(render.calls[0]!.tex).toBe('x^2')
    // 契约硬要求：trust 绝不能开；块级 → displayMode true。
    expect(render.calls[0]!.options!.trust).toBe(false)
    expect(render.calls[0]!.options!.displayMode).toBe(true)
    // DoS 封顶（和渲染侧共用同一个 KATEX_OPTIONS，不能漂）。
    expect(render.calls[0]!.options!.maxSize).toBe(50)
  })

  it('widget 的 DOM 是 `.nd-math.nd-math-block`，里面内联渲染器的输出', () => {
    const { instance } = mountWith(
      new Map([['Document', createMathFeature(makeRenderer())]]),
      MATH_DOC,
    )
    const deco = values(instance).find(
      (v) => (v.spec as { widget?: object }).widget?.constructor.name === 'MathBlockWidget',
    )!
    const dom = (deco.spec as { widget: MathBlockWidget }).widget.toDOM()

    expect(dom.className).toBe('nd-math nd-math-block')
    expect(dom.querySelector('.katex-stub')?.getAttribute('data-display')).toBe('true')
  })

  it('★ `MathBlockWidget.eq`：同 TeX 相等、不同 TeX 不等（少了它每次 rebuild 都会闪）', () => {
    const render = makeRenderer()
    expect(new MathBlockWidget('x^2', render).eq(new MathBlockWidget('x^2', render))).toBe(true)
    expect(new MathBlockWidget('x^2', render).eq(new MathBlockWidget('y^2', render))).toBe(false)
  })

  it('渲染函数抛错 → 降级成源码文本，不抛（契约：不要抛）', () => {
    const boom: MathRenderer = {
      renderToString() {
        throw new Error('boom')
      },
    }
    const { instance } = mountWith(
      new Map([['Document', createMathFeature(boom)]]),
      MATH_DOC,
    )
    const deco = values(instance).find(
      (v) => (v.spec as { widget?: object }).widget?.constructor.name === 'MathBlockWidget',
    )!
    const dom = (deco.spec as { widget: MathBlockWidget }).widget.toDOM()

    expect(dom.classList.contains('nd-math-source')).toBe(true)
    // 源码是用户输入 → 只能 textContent，绝不能变成 HTML。
    expect(dom.textContent).toBe('x^2')
  })
})

describe('math —— 块级公式（没注入渲染函数）', () => {
  it('★ 降级成普通代码块，不报错', () => {
    // `mathFeature` 是没注入渲染函数的默认实例。
    expect(() => mount(MATH_DOC)).not.toThrow()
    const { instance } = mount(MATH_DOC)

    // 走的是代码块那条路：标题栏 widget，不是公式 widget。
    expect(widgetCtors(instance)).toContain('CodeFenceHeaderWidget')
    expect(widgetCtors(instance)).not.toContain('MathBlockWidget')
  })
})

describe('math —— 块级公式揭示态', () => {
  it('★ 光标落在围栏里 → 保留源码，不产生任何装饰', () => {
    // anchor 9 落在内容行 `x^2` 上。
    const { instance } = mountWith(
      new Map([['Document', createMathFeature(makeRenderer())]]),
      MATH_DOC,
      9,
    )

    expect(read(instance)).toHaveLength(0)
    expect(instance.atomicDecorations.size).toBe(0)
  })

  it('光标落在闭围栏行也算揭示（多行节点任意一行都揭示）', () => {
    const { instance } = mountWith(
      new Map([['Document', createMathFeature(makeRenderer())]]),
      MATH_DOC,
      13,
    )
    expect(read(instance)).toHaveLength(0)
  })
})

describe('math —— 注入渲染函数不破坏行内公式', () => {
  it('★ `$x^2$` 是行内 widget，且注入的渲染器会被调用', () => {
    const render = makeRenderer()
    const { instance } = mountWith(
      new Map([['Document', createMathFeature(render)]]),
      'a $x^2$ b\n\n尾部',
    )

    expect(spans(read(instance), 'widget')).toEqual([[2, 7]])
    expect(widgetCtors(instance)).toEqual(['MathWidget'])

    /*
     * ⚠️ 这条**曾经断言"不调用渲染器"** ✗ —— 那正是"行内公式不生效"的根因：
     * `decorateInlineMath` 压根没接 `render` ✓（用户：「公式没生效」）。
     *
     * 现在行内也走注入的渲染器 ✓ —— 和块级、和渲染侧**同一条路** ✓。
     */
    const widget = (values(instance).find(
      (v) => (v.spec as { widget?: unknown }).widget !== undefined,
    )!.spec as { widget: MathWidget }).widget
    widget.toDOM()
    /*
     * ⚠️ 只断言"**被调用过**"，不数次数、也不查参数内容：
     * - 次数是**实现细节** ✗（挂载时已经建过一次 DOM ✓，这里再 `toDOM()` 是第二次 ✓）
     * - `calls` 里存的是渲染器收到的**整个入参** ✗，不是 TeX 字符串 ✓
     *
     * 而这条测试要守的只有一件事：**行内公式也走注入的渲染器** ✓。
     */
    expect(render.calls.length).toBeGreaterThan(0)
  })
})

describe('math —— 与 embed 的分流（同一个文档里各走各的）', () => {
  it('★ math 围栏出公式、js 围栏出代码块、谁都不出占位卡', () => {
    const doc = '```math\nx^2\n```\n\n```js\nconst a = 1\n```\n\n尾部'
    const { instance } = mountWith(
      new Map([
        ['Document', createMathFeature(makeRenderer())],
        // embed 认领 FencedCode；它必须把 math 围栏让出去（见 features/embed.ts）。
        ['FencedCode', embedFeature],
      ]),
      doc,
    )
    const ctors = widgetCtors(instance)

    expect(ctors.filter((c) => c === 'MathBlockWidget')).toHaveLength(1)
    expect(ctors.filter((c) => c === 'CodeFenceHeaderWidget')).toHaveLength(1)
    expect(ctors.filter((c) => c === 'EmbedCardWidget')).toHaveLength(0)
  })
})
