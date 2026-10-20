/**
 * `highlight`（`==高亮==`）编辑器侧测试。
 *
 * 做法同 `emoji.test.ts`：挂真编辑器，把 `highlightFeature` 注入
 * `LivePreviewOptions.features`（key 是它认领的 lezer 节点 `Paragraph`），
 * 再读回装饰断言。
 *
 * 重点锁三件事：
 * 1. **和渲染侧同一个正则**（lazy、非空、不做 flanking）—— 这些边界一旦漂移，
 *    就是「编辑器写得出、渲染器读不出」；
 * 2. 隐藏态的两个 `==` 必须进 `atomicRanges`（否则光标停在定界符中间）；
 * 3. 行内代码里的 `==` 不能被高亮（渲染侧也不会）。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { highlightFeature } from '../../src/cm/features/highlight.js'
import { nexusdownLivePreview, type LivePreviewPluginValue } from '../../src/cm/plugin.js'

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
    features: new Map([['Paragraph', highlightFeature]]),
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

const spans = (ds: Deco[], kind: Kind, cls?: string): number[][] =>
  ds
    .filter((d) => d.kind === kind && (cls === undefined || d.cls === cls))
    .map((d) => [d.from, d.to])

describe('highlight —— 非揭示态', () => {
  it('★ `==高亮==`：内容挂 .nd-highlight，两个定界符 replace 并登记原子区间', () => {
    const { instance } = mount('a ==高亮== b\n\n尾部')

    expect(spans(read(instance), 'mark', 'nd-highlight')).toEqual([[4, 6]])
    expect(spans(read(instance), 'replace')).toEqual([
      [2, 4],
      [6, 8],
    ])
    expect(instance.atomicDecorations.size).toBe(2)
  })

  it('★ 一行里两个高亮各自独立', () => {
    const { instance } = mount('==a== 与 ==b==\n\n尾部')

    expect(spans(read(instance), 'mark', 'nd-highlight')).toEqual([
      [2, 3],
      [10, 11],
    ])
    expect(instance.atomicDecorations.size).toBe(4)
  })
})

describe('highlight —— 揭示态', () => {
  it('★ 光标落在这一行 → 保留源码、定界符变淡（.nd-mark），不产生 replace', () => {
    const { instance } = mount('a ==高亮== b\n\n尾部', 4)
    const ds = read(instance)

    expect(spans(ds, 'replace')).toHaveLength(0)
    expect(instance.atomicDecorations.size).toBe(0)
    expect(spans(ds, 'mark', 'nd-mark')).toEqual([
      [2, 4],
      [6, 8],
    ])
    // 内容仍然高亮
    expect(spans(ds, 'mark', 'nd-highlight')).toEqual([[4, 6]])
  })
})

describe('highlight —— 与渲染侧同一套边界', () => {
  it('★ `====`（内容为空）不算高亮', () => {
    const { instance } = mount('====\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })

  it('★ `==a=b==` 算高亮（渲染侧的正则是 `[\\s\\S]+?`，不是 `[^=]+`）', () => {
    const { instance } = mount('==a=b==\n\n尾部')
    expect(spans(read(instance), 'mark', 'nd-highlight')).toEqual([[2, 5]])
  })

  it('★ `==a ==`（内容以空格结尾）算高亮（不做 flanking）', () => {
    const { instance } = mount('==a ==\n\n尾部')
    expect(spans(read(instance), 'mark', 'nd-highlight')).toEqual([[2, 4]])
  })

  it('★ lazy：`==a==b==` 只认第一对', () => {
    const { instance } = mount('==a==b==\n\n尾部')
    expect(spans(read(instance), 'mark', 'nd-highlight')).toEqual([[2, 3]])
  })

  it('没有 `==` 的段落不产生任何装饰', () => {
    const { instance } = mount('普通段落\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })
})

describe('highlight —— 跳过行内代码', () => {
  it('★ `` `==x==` `` 不装饰，代码外的 `==y==` 正常装饰', () => {
    const { instance } = mount('`==x==` 和 ==y==\n\n尾部')

    expect(spans(read(instance), 'mark', 'nd-highlight')).toEqual([[12, 13]])
    expect(spans(read(instance), 'replace')).toEqual([
      [10, 12],
      [13, 15],
    ])
  })
})
