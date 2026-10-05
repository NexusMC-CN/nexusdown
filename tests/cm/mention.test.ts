/**
 * `mention` 编辑器侧扩展的测试。
 *
 * 做法同 `emoji.test.ts`：挂真编辑器，把 `mentionFeature` 注入 `LivePreviewOptions.features`，
 * 再读回装饰断言。功能认领的是 lezer 的 **`Paragraph`** 节点，所以注入表的 key 是 `'Paragraph'`。
 *
 * 断言的是**区间与种类**（widget / replace / mark）以及 **atomic 登记**。
 * 文档都写成 `目标行\n\n尾部`，让默认光标（文档末尾）落在非揭示态基线上。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type Decoration } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createMentionFeature,
  mentionFeature,
  MentionCardWidget,
  MentionWidget,
  type MentionResolutions,
} from '../../src/cm/features/mention.js'
import {
  nexusdownLivePreview,
  type LivePreviewPluginValue,
} from '../../src/cm/plugin.js'
import type { MentionResolution } from '../../src/render/feature.js'

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

function mount(doc: string, cursor: number = doc.length, mentions?: MentionResolutions) {
  const plugin = nexusdownLivePreview({
    features: new Map([['Paragraph', mentions ? createMentionFeature(mentions) : mentionFeature]]),
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

function values(instance: LivePreviewPluginValue): Decoration[] {
  const out: Decoration[] = []
  instance.decorations.between(0, 1e9, (_f, _t, value) => {
    out.push(value)
  })
  return out
}

const spans = (ds: Deco[], kind: Kind): number[][] =>
  ds.filter((d) => d.kind === kind).map((d) => [d.from, d.to])

function widgetOf<T>(instance: LivePreviewPluginValue, ctor: new (...args: never[]) => T): T {
  const deco = values(instance).find((v) => (v.spec as { widget?: unknown }).widget instanceof ctor)
  if (!deco) throw new Error(`没有 ${ctor.name} 装饰`)
  return (deco.spec as { widget: T }).widget
}

function atomicSpans(instance: LivePreviewPluginValue): number[][] {
  const out: number[][] = []
  instance.atomicDecorations.between(0, 1e9, (from, to) => {
    out.push([from, to])
  })
  return out
}

describe('mention —— 行内（非揭示态）', () => {
  it('★ `@foo` 换成胶囊 widget，并登记为原子区间', () => {
    const doc = '提到 @foo 很好用\n\n尾部'
    const from = doc.indexOf('@foo')
    const { instance } = mount(doc)

    expect(spans(read(instance), 'widget')).toEqual([[from, from + 4]])
    // 契约硬约束一：隐藏态的 replace 必须同时进 atomicRanges
    expect(atomicSpans(instance)).toEqual([[from, from + 4]])
  })

  it('胶囊 DOM：`.nd-mention` + 源码文本', () => {
    const { instance } = mount('提到 @foo 很好用\n\n尾部')
    const dom = widgetOf(instance, MentionWidget).toDOM()
    expect(dom.className).toBe('nd-mention')
    expect(dom.textContent).toBe('@foo')
  })

  it('一行里多个提及各自成一个胶囊', () => {
    const doc = '@a 和 @b 都好\n\n尾部'
    const a = doc.indexOf('@a')
    const b = doc.indexOf('@b')
    const { instance } = mount(doc)
    expect(spans(read(instance), 'widget')).toEqual([
      [a, a + 2],
      [b, b + 2],
    ])
    expect(instance.atomicDecorations.size).toBe(2)
  })

  it('`#fragment` 一起进胶囊', () => {
    const doc = '见 @foo#bar 一节\n\n尾部'
    const from = doc.indexOf('@foo')
    const { instance } = mount(doc)
    expect(spans(read(instance), 'widget')).toEqual([[from, from + 8]])
    expect(widgetOf(instance, MentionWidget).toDOM().textContent).toBe('@foo#bar')
  })
})

describe('mention —— 独占一段 → 卡片', () => {
  it('★ 整段只有一个提及 → 卡片 widget，并登记 atomic', () => {
    const { instance } = mount('@foo\n\n尾部')
    expect(spans(read(instance), 'widget')).toEqual([[0, 4]])
    expect(atomicSpans(instance)).toEqual([[0, 4]])
    expect(widgetOf(instance, MentionCardWidget).toDOM().className).toBe('nd-mention-card')
  })

  it('★ 段落里混了文字 → 不是卡片，是行内胶囊', () => {
    const doc = '看这个 @foo 挺好\n\n尾部'
    const from = doc.indexOf('@foo')
    const { instance } = mount(doc)
    expect(widgetOf(instance, MentionWidget).toDOM().className).toBe('nd-mention')
    expect(spans(read(instance), 'widget')).toEqual([[from, from + 4]])
  })

  it('★ 引用块里的独占提及**不是**卡片（对齐渲染侧 level 0）', () => {
    const doc = '> @foo\n\n尾部'
    const from = doc.indexOf('@foo')
    const { instance } = mount(doc)
    // 是行内胶囊，不是卡片
    expect(widgetOf(instance, MentionWidget).toDOM().className).toBe('nd-mention')
    expect(spans(read(instance), 'widget')).toEqual([[from, from + 4]])
  })
})

describe('mention —— 揭示态', () => {
  it('★ 光标落在这一行 → 保留源码，整段变淡，不产生 widget', () => {
    const doc = '提到 @foo 很好用\n\n尾部'
    const from = doc.indexOf('@foo')
    const { instance } = mount(doc, 0)
    const ds = read(instance)

    expect(ds.filter((d) => d.kind === 'widget')).toHaveLength(0)
    expect(instance.atomicDecorations.size).toBe(0)
    expect(ds.filter((d) => d.kind === 'mark' && d.cls === 'nd-mark').map((d) => [d.from, d.to])).toEqual([
      [from, from + 4],
    ])
  })

  it('★ 卡片段落里光标进去 → 露出源码（不是卡片）', () => {
    const { instance } = mount('@foo\n\n尾部', 0)
    expect(read(instance).filter((d) => d.kind === 'widget')).toHaveLength(0)
    expect(instance.atomicDecorations.size).toBe(0)
  })
})

describe('mention —— 扫描与排除（和渲染侧一致）', () => {
  it('★ `a@b.com` 不被误认（邮箱）', () => {
    const { instance } = mount('联系 a@b.com 即可\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })

  it('★ 行内代码里的 `@foo` 不装饰', () => {
    const doc = '`@foo` 和 @bar\n\n尾部'
    const bar = doc.indexOf('@bar')
    const { instance } = mount(doc)
    expect(spans(read(instance), 'widget')).toEqual([[bar, bar + 4]])
  })

  it('★ 链接目标里的 `@foo` 不装饰（渲染侧不当文本扫）', () => {
    const { instance } = mount('[x](https://a.com/@foo)\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })

  it('`**@foo**` 里的提及照常装饰（渲染侧也扫强调里的文本）', () => {
    const doc = '**@foo**\n\n尾部'
    const from = doc.indexOf('@foo')
    const { instance } = mount(doc)
    expect(spans(read(instance), 'widget')).toEqual([[from, from + 4]])
  })
})

describe('mention —— widget eq', () => {
  it('同文本相等、不同文本不等', () => {
    expect(new MentionWidget('@foo').eq(new MentionWidget('@foo'))).toBe(true)
    expect(new MentionWidget('@foo').eq(new MentionWidget('@bar'))).toBe(false)
    expect(new MentionCardWidget('@foo').eq(new MentionCardWidget('@foo'))).toBe(true)
    expect(new MentionCardWidget('@foo').eq(new MentionCardWidget('@bar'))).toBe(false)
  })
})

/* ==========================================================================
 * 注入了 `mentions` —— 卡片必须和渲染侧 `renderCard()` 同构
 * ======================================================================== */

const RES: MentionResolution = {
  title: 'Nexus 优化器',
  href: '/resources/nexus-optimizer',
  kind: 'resource',
  summary: '一句话摘要',
  byline: 'alice',
  badges: ['v1.2', '10k'],
  image: 'https://cdn.example.com/x.png',
}

const withRes = (res: MentionResolution = RES): MentionResolutions => new Map([['nexus-optimizer', res]])

/** 卡片行的末尾放个"尾部"段落，让默认光标（文末）落在非揭示态基线上。 */
const CARD_DOC = '@nexus-optimizer\n\n尾部'

describe('mention —— 卡片（注入了解析结果）', () => {
  it('★ DOM 逐节点对齐渲染侧：图标 + 标题 + 摘要 + 署名 + 角标 + 缩略图', () => {
    const { instance } = mount(CARD_DOC, undefined, withRes())
    const card = widgetOf(instance, MentionCardWidget).toDOM()

    expect(card.className).toBe('nd-mention-card')
    expect(card.getAttribute('data-kind')).toBe('resource')
    // 子节点顺序必须和 `renderCard()` 一致（icon → body → badges → image），
    // 顺序错了 CSS 的 flex 布局就变了 —— 两侧长得一样靠的就是这个顺序。
    expect([...card.children].map((c) => c.className)).toEqual([
      'nd-mention-card__icon',
      'nd-mention-card__body',
      'nd-mention-card__badges',
      'nd-mention-card__image',
    ])
    expect(card.querySelector('.nd-mention-card__icon')?.getAttribute('data-kind')).toBe('resource')
    expect(card.querySelector('.nd-mention-card__title')?.textContent).toBe('Nexus 优化器')
    expect(card.querySelector('.nd-mention-card__summary')?.textContent).toBe('一句话摘要')
    expect(card.querySelector('.nd-mention-card__byline')?.textContent).toBe('alice')
    expect([...card.querySelectorAll('.nd-mention-card__badge')].map((b) => b.textContent)).toEqual(['v1.2', '10k'])
    expect(card.querySelector('.nd-mention-card__image')?.getAttribute('src')).toBe('https://cdn.example.com/x.png')
  })

  it('★ 没注入 → 卡片照画，但**不画空的 `__icon`**（空方块看起来就是"图标坏了"）', () => {
    const { instance } = mount(CARD_DOC)
    const card = widgetOf(instance, MentionCardWidget).toDOM()
    expect(card.className).toBe('nd-mention-card')
    expect(card.querySelector('.nd-mention-card__icon')).toBeNull()
    expect(card.textContent).toBe('@nexus-optimizer')
  })

  it('★ `missing: true` → **不是卡片**，退回行内墓碑（和渲染侧同一条判据）', () => {
    const { instance } = mount('@nexus-optimizer\n\n尾部', undefined, withRes({ ...RES, missing: true }))
    const widgets = values(instance).map((v) => (v.spec as { widget?: unknown }).widget)
    expect(widgets.some((w) => w instanceof MentionCardWidget)).toBe(false)

    const pill = widgetOf(instance, MentionWidget).toDOM()
    expect(pill.className).toBe('nd-mention nd-mention--missing')
  })

  it('★ 缩略图 URL 非法（javascript:）→ 不输出 img', () => {
    const { instance } = mount('@nexus-optimizer\n\n尾部', undefined, withRes({ ...RES, image: 'javascript:alert(1)' }))
    expect(widgetOf(instance, MentionCardWidget).toDOM().querySelector('img')).toBeNull()
  })

  it('★ 标题里的 HTML 是**文本**，不产生节点（同渲染侧的转义防线）', () => {
    const { instance } = mount(
      '@nexus-optimizer\n\n尾部',
      undefined,
      // 去掉缩略图，好让下面的 `querySelector('img')` 只可能命中"标题注入"的产物。
      withRes({ ...RES, image: undefined, title: '<img src=x onerror=alert(1)>' }),
    )
    const card = widgetOf(instance, MentionCardWidget).toDOM()
    expect(card.querySelector('img')).toBeNull()
    expect(card.querySelector('.nd-mention-card__title')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('解析结果变了 → `eq` 判不相等（DOM 会重建）', () => {
    expect(new MentionCardWidget('@x', RES).eq(new MentionCardWidget('@x', RES))).toBe(true)
    expect(new MentionCardWidget('@x', RES).eq(new MentionCardWidget('@x', { ...RES, title: '别的' }))).toBe(false)
    expect(new MentionCardWidget('@x', RES).eq(new MentionCardWidget('@x', undefined))).toBe(false)
  })
})

describe('mention —— 卡片替换区间（守住"多出来的空盒子"）', () => {
  it('★ 前导空白被区间吞掉：`  @foo  ` 的替换从**行首**开始', () => {
    const doc = 'x\n\n  @foo  \n\ny'
    const lineFrom = doc.indexOf('  @foo')
    // 段落节点范围不含前导空白（`@foo  `），而卡片是 `width: 100%` ——
    // 留着那两格空白，卡片就会被挤到第二个视觉行，行高凭空多一整行。
    expect(spans(read(mount(doc).instance), 'widget')).toEqual([[lineFrom, lineFrom + '  @foo  '.length]])
    expect(atomicSpans(mount(doc).instance)).toEqual([[lineFrom, lineFrom + '  @foo  '.length]])
  })

  it('没有前导空白时区间照旧从段落起点开始（不受影响）', () => {
    const doc = 'x\n\n@foo\n\ny'
    const from = doc.indexOf('@foo')
    expect(spans(read(mount(doc).instance), 'widget')).toEqual([[from, from + 4]])
  })
})
