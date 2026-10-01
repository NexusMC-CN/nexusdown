/**
 * `embed` 编辑器侧扩展的测试。
 *
 * 做法同 `emoji.test.ts` / `math.test.ts`：挂真编辑器，把 `embedFeature` 注入
 * `LivePreviewOptions.features`，再读回装饰断言。
 *
 * ⚠️ 功能认领的是 lezer 的 **`FencedCode` 节点**（embed 的语法就是一个围栏），
 * 所以注入表的 key 是 `'FencedCode'`。代价是**所有代码块都会被抢走** ——
 * 本文件里「非 embed 围栏行为完全不变」那一组就是专门盯这条的。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState, type Extension, type Range } from '@codemirror/state'
import { EditorView, ViewPlugin, type Decoration } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { embedFeature, EmbedCardWidget } from '../../src/cm/features/embed.js'
import { decorateFencedCode } from '../../src/cm/decorate/fence.js'
import { nexusdownLivePreview, type LivePreviewPluginValue } from '../../src/cm/plugin.js'
import { parseEmbedFence } from '../../src/render/features/embed.js'

type Kind = 'line' | 'mark' | 'replace' | 'widget'

interface Deco {
  from: number
  to: number
  cls: string | undefined
  kind: Kind
  /** widget 的构造器名（用来区分占位卡和代码标题栏）。 */
  widget: string | undefined
}

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

/** 注入 embedFeature（认领 FencedCode）。 */
function mount(doc: string, cursor: number = doc.length) {
  return mountWith(doc, cursor, {
    features: new Map([['FencedCode', embedFeature]]),
  })
}

/** 走**原有**路径：把 `decorateFencedCode` 挂在 legacy 的 `fencedCode` 槽位上。 */
function mountBaseline(doc: string, cursor: number = doc.length) {
  return mountWith(doc, cursor, { decorators: { fencedCode: decorateFencedCode } })
}

function mountWith(
  doc: string,
  cursor: number,
  opts: Parameters<typeof nexusdownLivePreview>[0],
) {
  const plugin = nexusdownLivePreview(opts)
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

function read(instance: LivePreviewPluginValue): Deco[] {
  const out: Deco[] = []
  instance.decorations.between(0, 1e9, (from, to, value) => {
    const spec = value.spec as { class?: string; widget?: object }
    const widget = spec.widget
    const kind: Kind =
      widget !== undefined
        ? 'widget'
        : 'tagName' in value
          ? 'mark'
          : spec.class !== undefined
            ? 'line'
            : 'replace'
    out.push({
      from,
      to,
      cls: spec.class,
      kind,
      widget: widget ? widget.constructor.name : undefined,
    })
  })
  return out
}

const spans = (ds: Deco[], kind: Kind): number[][] =>
  ds.filter((d) => d.kind === kind).map((d) => [d.from, d.to])

function values(instance: LivePreviewPluginValue): Decoration[] {
  const out: Decoration[] = []
  instance.decorations.between(0, 1e9, (_f, _t, value) => {
    out.push(value)
  })
  return out
}

function widgetOf(instance: LivePreviewPluginValue, ctor: string): Decoration | undefined {
  return values(instance).find(
    (v) => (v.spec as { widget?: object }).widget?.constructor.name === ctor,
  )
}

const EMBED_DOC = '```embed bilibili video BV1xx411c7mD\n```\n\n尾部'
// 开围栏行 = [0, 36)；闭围栏行 = [37, 40)。
const OPEN_TO = 36
const CLOSE_FROM = 37
const CLOSE_TO = 40

describe('embed —— 非揭示态：占位卡', () => {
  it('★ 开围栏行整行换成占位卡 widget，闭围栏行藏掉并压行高', () => {
    const { instance } = mount(EMBED_DOC)

    const widgets = read(instance).filter((d) => d.kind === 'widget')
    expect(widgets.map((d) => [d.from, d.to, d.widget])).toEqual([[0, OPEN_TO, 'EmbedCardWidget']])

    // 闭围栏行：内容 HIDE + 行级 `nd-embed-hidden`。
    expect(spans(read(instance), 'replace')).toEqual([[CLOSE_FROM, CLOSE_TO]])
    expect(
      read(instance)
        .filter((d) => d.kind === 'line')
        .map((d) => [d.from, d.cls]),
    ).toEqual([
      [0, 'nd-embed-open'],
      [CLOSE_FROM, 'nd-embed-hidden'],
    ])
  })

  it('★ 隐藏态的 replace 全部登记为原子区间（否则光标会停在隐藏区间中间）', () => {
    const { instance } = mount(EMBED_DOC)

    const atomic: number[][] = []
    instance.atomicDecorations.between(0, 1e9, (from, to) => {
      atomic.push([from, to])
    })
    expect(atomic).toEqual([
      [0, OPEN_TO],
      [CLOSE_FROM, CLOSE_TO],
    ])
  })

  it('占位卡的 DOM：`.nd-embed-card` + 标题含 provider/kind/id，且**不加载 iframe**', () => {
    const { instance } = mount(EMBED_DOC)
    const deco = widgetOf(instance, 'EmbedCardWidget')!
    const dom = (deco.spec as { widget: EmbedCardWidget }).widget.toDOM()

    expect(dom.className).toContain('nd-embed-card')
    expect(dom.getAttribute('data-nd-embed')).toBe('bilibili:video')
    expect(dom.textContent).toContain('哔哩哔哩')
    expect(dom.textContent).toContain('BV1xx411c7mD')
    // 编辑器里绝不出现 iframe。
    expect(dom.querySelector('iframe')).toBeNull()
  })

  it('★ `EmbedCardWidget.eq`：同 spec 相等，id / provider / kind 任一不同就不等', () => {
    const a = parseEmbedFence('embed bilibili video BV1xx411c7mD')!
    const b = parseEmbedFence('embed bilibili video BV1xx411c7mD')!
    const otherId = parseEmbedFence('embed bilibili video BV0000000000')!
    const otherProvider = parseEmbedFence('embed douyin video 7458617091420114236')!
    const otherKind = parseEmbedFence('embed netease playlist 473007041')!

    expect(new EmbedCardWidget(a).eq(new EmbedCardWidget(b))).toBe(true)
    expect(new EmbedCardWidget(a).eq(new EmbedCardWidget(otherId))).toBe(false)
    expect(new EmbedCardWidget(a).eq(new EmbedCardWidget(otherProvider))).toBe(false)
    expect(new EmbedCardWidget(otherKind).eq(new EmbedCardWidget(otherKind))).toBe(true)
    expect(new EmbedCardWidget(otherKind).eq(new EmbedCardWidget(a))).toBe(false)
  })
})

describe('embed —— 揭示态', () => {
  it('★ 光标落在围栏里 → 保留源码，不产生任何装饰', () => {
    const { instance } = mount(EMBED_DOC, 5)
    const ds = read(instance)

    expect(ds.filter((d) => d.kind === 'widget')).toHaveLength(0)
    expect(ds.filter((d) => d.kind === 'replace')).toHaveLength(0)
    expect(ds.filter((d) => d.kind === 'line')).toHaveLength(0)
    expect(instance.atomicDecorations.size).toBe(0)
  })

  it('光标落在闭围栏行也算揭示（多行节点任意一行都揭示）', () => {
    const { instance } = mount(EMBED_DOC, 38)
    expect(read(instance)).toHaveLength(0)
  })
})

describe('embed —— 非 embed 围栏：行为必须完全不变', () => {
  const DOC = '```js\ncode\n```\n\n尾部'

  it('★ 走 features 路径 与 走原有 fencedCode 路径 产出**完全相同**的装饰', () => {
    const viaFeature = read(mount(DOC).instance)
    const viaLegacy = read(mountBaseline(DOC).instance)

    expect(viaFeature).toEqual(viaLegacy)
    // 顺带把形状钉住（防止两边一起坏成同一个错的样子）。
    expect(spans(viaFeature, 'widget')).toEqual([[0, 5]])
    expect(spans(viaFeature, 'replace')).toEqual([[11, 14]])
    expect(viaFeature.every((d) => d.widget === undefined || d.widget === 'CodeFenceHeaderWidget')).toBe(true)
  })

  it('★ 同一个文档里 js 围栏和 embed 围栏各走各的', () => {
    const doc = '```js\ncode\n```\n\n```embed netease song 110761\n```\n\n尾部'
    const { instance } = mount(doc)
    const ds = read(instance)

    // 有且只有一个占位卡（embed 那条）。
    expect(ds.filter((d) => d.widget === 'EmbedCardWidget')).toHaveLength(1)
    // 也有且只有一个代码标题栏（js 那条）。
    expect(ds.filter((d) => d.widget === 'CodeFenceHeaderWidget')).toHaveLength(1)
  })

  it('★ 非法 embed（ID 不过正则）→ 降级成普通代码块，不显示占位卡', () => {
    const { instance } = mount('```embed bilibili video ../../etc\n```\n\n尾部')
    const ds = read(instance)

    expect(ds.filter((d) => d.widget === 'EmbedCardWidget')).toHaveLength(0)
    expect(ds.filter((d) => d.widget === 'CodeFenceHeaderWidget')).toHaveLength(1)
  })

  it('★ `embedded` 这种"以 embed 开头"的 info 不会被误判成 embed', () => {
    const { instance } = mount('```embedded\nx\n```\n\n尾部')
    const ds = read(instance)

    expect(ds.filter((d) => d.widget === 'EmbedCardWidget')).toHaveLength(0)
    expect(ds.filter((d) => d.widget === 'CodeFenceHeaderWidget')).toHaveLength(1)
  })
})

describe('embed —— context 透传（折叠）', () => {
  /**
   * 直接调 `embedFeature.decorate`，**绕开 `plugin.ts`**。
   *
   * 原因：`plugin.ts` 的 feature 分发分支目前**不传第 6 个 `context` 参数**，
   * 所以走真编辑器时 `folded` 恒为 false（这是骨架的限制，见 `cm/features/embed.ts`
   * 文件头，需要主 agent 修 `plugin.ts`）。但「embed 是否把 `context` 透传给
   * `decorateFencedCode`」是**本功能自己的契约**，可以脱离骨架单独钉住 ——
   * 骨架补上 `context` 的那一刻，折叠会立刻恢复，无需再改这里。
   */
  function collect(doc: string, folded: boolean) {
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown({ base: markdownLanguage })],
    })
    const ranges: Range<Decoration>[] = []
    const atomic: Range<Decoration>[] = []
    syntaxTree(state).iterate({
      enter: (ref) => {
        if (ref.name !== 'FencedCode') return
        embedFeature.decorate(ranges, atomic, ref.node, state.doc, state.selection, { folded })
      },
    })
    return { ranges, atomic, doc: state.doc }
  }

  const lineClasses = (rs: readonly Range<Decoration>[]): Array<[number, string | undefined]> =>
    rs
      .filter(
        (r) =>
          !('tagName' in r.value) &&
          (r.value.spec as { class?: string; widget?: unknown }).widget === undefined,
      )
      .map((r) => [r.from, (r.value.spec as { class?: string }).class])

  it('★ 非 embed 围栏拿到 `folded: true` → 走折叠形态（证明 context 被透传）', () => {
    const { ranges } = collect('```js\ncode\n```\n\n尾部', true)
    const lines = lineClasses(ranges)

    // 折叠态：首行上下都圆角，其余行带 `nd-code-folded`。
    expect(lines).toContainEqual([0, 'nd-code-block nd-code-block-first nd-code-block-last'])
    expect(lines).toContainEqual([6, 'nd-code-block nd-code-folded'])
    expect(lines).toContainEqual([11, 'nd-code-block nd-code-folded'])
    // 展开态的 first/plain/last 一个都不该出现。
    expect(lines.some(([, cls]) => cls === 'nd-code-block nd-code-block-first')).toBe(false)
  })

  it('`folded: false` → 走展开形态', () => {
    const { ranges } = collect('```js\ncode\n```\n\n尾部', false)
    const lines = lineClasses(ranges)

    expect(lines).toContainEqual([0, 'nd-code-block nd-code-block-first'])
    expect(lines).toContainEqual([6, 'nd-code-block'])
    expect(lines).toContainEqual([11, 'nd-code-block nd-code-block-last'])
  })
})

describe('embed —— 三家 kind 都能出卡', () => {
  const cases: Array<[string, string]> = [
    ['```embed bilibili video BV1xx411c7mD\n```\n\n尾部', 'bilibili:video'],
    ['```embed douyin video 7458617091420114236\n```\n\n尾部', 'douyin:video'],
    ['```embed netease song 110761\n```\n\n尾部', 'netease:song'],
    ['```embed netease playlist 473007041\n```\n\n尾部', 'netease:playlist'],
  ]

  for (const [doc, key] of cases) {
    it(`${key} → 占位卡`, () => {
      const { instance } = mount(doc)
      const deco = widgetOf(instance, 'EmbedCardWidget')!
      expect((deco.spec as { widget: EmbedCardWidget }).widget.toDOM().getAttribute('data-nd-embed')).toBe(key)
    })
  }
})
