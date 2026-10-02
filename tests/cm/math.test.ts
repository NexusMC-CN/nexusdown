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
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type Decoration } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { mathFeature, MathWidget } from '../../src/cm/features/math.js'
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

/** 挂一个真编辑器，把 `mathFeature` 注入 features（key = 它认领的 `Document`）。 */
function mount(doc: string, cursor: number = doc.length) {
  const plugin = nexusdownLivePreview({
    features: new Map([['Document', mathFeature]]),
  })
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

const spans = (ds: Deco[], kind: Kind): number[][] =>
  ds.filter((d) => d.kind === kind).map((d) => [d.from, d.to])

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
    expect(dom.className).toBe('nd-math')
    // 编辑器里不跑 KaTeX，退化成显示 TeX —— 断言这个**约定**，别断言成公式 HTML。
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
