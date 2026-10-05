/**
 * `emoji` 编辑器侧扩展的测试。
 *
 * 做法同 `table.test.ts` / `math.test.ts`：挂真编辑器，把 `emojiFeature` 注入
 * `LivePreviewOptions.features`，再读回装饰断言。
 *
 * ⚠️ 功能认领的是 lezer 的 **`Emoji` 节点**（`@codemirror/lang-markdown` 的
 * `markdownLanguage` 默认带 `Emoji` 扩展），所以注入表的 key 是 `'Emoji'`。
 * 这也是「跳过代码块与行内代码」的**结构性**保证 —— 那些位置根本不产出 `Emoji` 节点。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type Decoration } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { emojiFeature, EmojiWidget } from '../../src/cm/features/emoji.js'
import {
  nexusdownLivePreview,
  type LivePreviewPluginValue,
} from '../../src/cm/plugin.js'
import { EMOJI_SHORTCODES, EMOJI_SHORTCODE_RE } from '../../src/shared/emoji-data.js'

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

function mount(doc: string, cursor: number = doc.length) {
  const plugin = nexusdownLivePreview({
    features: new Map([['Emoji', emojiFeature]]),
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

/** 取那个字形 widget。 */
function emojiWidgetOf(instance: LivePreviewPluginValue): EmojiWidget {
  const deco = values(instance).find(
    (v) => (v.spec as { widget?: unknown }).widget instanceof EmojiWidget,
  )
  if (!deco) throw new Error('没有 EmojiWidget 装饰')
  return (deco.spec as { widget: EmojiWidget }).widget
}

describe('emoji —— 非揭示态', () => {
  it('★ `:smile:` 换成字形 widget，区间 [2,9)，并登记为原子区间', () => {
    const { instance } = mount('a :smile: b\n\n尾部')

    expect(spans(read(instance), 'widget')).toEqual([[2, 9]])
    expect(instance.atomicDecorations.size).toBe(1)
    let atomicSpan: number[] = []
    instance.atomicDecorations.between(0, 1e9, (from, to) => {
      atomicSpan = [from, to]
    })
    expect(atomicSpan).toEqual([2, 9])
  })

  it('widget 的 DOM：`.nd-emoji` + 字形 + 可读的 aria-label', () => {
    const { instance } = mount('a :smile: b\n\n尾部')
    const dom = emojiWidgetOf(instance).toDOM()

    expect(dom.className).toBe('nd-emoji')
    expect(dom.textContent).toBe('😄')
    expect(dom.getAttribute('role')).toBe('img')
    expect(dom.getAttribute('aria-label')).toBe(':smile:')
  })

  it('★ `EmojiWidget.eq`：同字形相等、不同字形不等', () => {
    expect(new EmojiWidget('😄', 'smile').eq(new EmojiWidget('😄', 'smile'))).toBe(true)
    expect(new EmojiWidget('😄', 'smile').eq(new EmojiWidget('😂', 'joy'))).toBe(false)
  })

  it('一行里多个短代码各自成一个 widget', () => {
    const { instance } = mount('a :smile: b :joy: c\n\n尾部')

    // ':smile:' = [2,9)；':joy:' = [12,17)
    expect(spans(read(instance), 'widget')).toEqual([
      [2, 9],
      [12, 17],
    ])
    expect(instance.atomicDecorations.size).toBe(2)
  })
})

describe('emoji —— 揭示态', () => {
  it('★ 光标落在这一行 → 保留源码，整段变淡，不产生 widget', () => {
    const { instance } = mount('a :smile: b\n\n尾部', 4)
    const ds = read(instance)

    expect(ds.filter((d) => d.kind === 'widget')).toHaveLength(0)
    expect(instance.atomicDecorations.size).toBe(0)
    expect(ds.filter((d) => d.kind === 'mark' && d.cls === 'nd-mark').map((d) => [d.from, d.to])).toEqual([
      [2, 9],
    ])
  })
})

describe('emoji —— 只替换表里有的', () => {
  it('★ 表外的 `:not_real_emoji:` 原样保留（lezer 会为它产出 Emoji 节点）', () => {
    const { instance } = mount('a :not_real_emoji: b\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })
})

describe('emoji —— 跳过代码块与行内代码', () => {
  it('★ 行内代码里的 `:smile:` 不装饰（lezer 不产出 Emoji 节点）', () => {
    const { instance } = mount('`:smile:` 和 :joy:\n\n尾部')

    // 只有代码外的 `:joy:` 被装饰，落在 [12,17)。
    expect(spans(read(instance), 'widget')).toEqual([[12, 17]])
  })

  it('★ 围栏代码块里的 `:smile:` 不装饰', () => {
    const { instance } = mount('```\n:smile:\n```\n\n:joy:\n\n尾部')

    const widgets = spans(read(instance), 'widget')
    expect(widgets).toHaveLength(1)
    expect(widgets[0]).toEqual([17, 22])
  })
})

describe('emoji —— 两侧共用同一张表', () => {
  it('表的条目数就是注释里写的那个数（防止悄悄漂移）', () => {
    expect(EMOJI_SHORTCODES.size).toBe(226)
  })

  it('表里有 :smile: / :joy: / :thumbsup: 这些两侧都会用到的条目', () => {
    expect(EMOJI_SHORTCODES.get('smile')).toBe('😄')
    expect(EMOJI_SHORTCODES.get('joy')).toBe('😂')
    expect(EMOJI_SHORTCODES.get('thumbsup')).toBe('👍')
  })

  it('★ 渲染侧正则的字符集不含 `+`/`-`，与 lezer 的 Emoji 扩展对齐', () => {
    // `:+1:` 两边都不能认 —— 认了就会「渲染器认、编辑器不认」。
    EMOJI_SHORTCODE_RE.lastIndex = 0
    expect(EMOJI_SHORTCODE_RE.test(':+1:')).toBe(false)
    EMOJI_SHORTCODE_RE.lastIndex = 0
    expect(EMOJI_SHORTCODE_RE.test(':thumbsup:')).toBe(true)
    EMOJI_SHORTCODE_RE.lastIndex = 0
  })
})
