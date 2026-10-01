/**
 * `table` 编辑器侧扩展的测试。
 *
 * 做法：挂一个**真实编辑器**，通过 `LivePreviewOptions.features` 直接把
 * `tableFeature` 注入骨架（功能还没进注册表，见 `features/index.ts`），
 * 再从插件实例的 `decorations` 里读回装饰做断言。
 *
 * 断言的是**区间与种类**（line / mark / replace），不是「跑起来了」：
 * - `nd-table`           —— 表格每一行都有的行级 class
 * - `nd-table-header`    —— 表头行的行级 class（加粗）
 * - `nd-table-delimiter` —— 分隔行（`| --- | --- |`）的行级 class
 * - `nd-mark`            —— 共享的淡化 mark（`MUTED_MARK`），用来淡化 `|` 和分隔行
 *
 * ⚠️ 选区默认落在**文档末尾**，避免单行文档的光标本身落在表格里。
 *    （表格的淡化与揭示无关，但同一个视图里跑的 inline 装饰器有揭示态，
 *      所以统一按「光标在末尾」来定基线。）
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type Decoration } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { decorateInline } from '../../src/cm/decorate/inline.js'
import { tableFeature } from '../../src/cm/features/table.js'
import {
  nexusdownLivePreview,
  type LivePreviewPluginValue,
} from '../../src/cm/plugin.js'
import type { LivePreviewDecorators } from '../../src/cm/types.js'

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

/** 挂一个真编辑器，并把 `tableFeature` 注入 features。 */
function mount(doc: string, decorators: Partial<LivePreviewDecorators> = {}) {
  const plugin = nexusdownLivePreview({
    features: new Map([['Table', tableFeature]]),
    decorators,
  })
  const state = EditorState.create({
    doc,
    // 光标放末尾（非揭示态基线），理由见文件头。
    selection: { anchor: doc.length },
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

/** 读回当前全部装饰，按种类标注。 */
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

const lineSpans = (ds: Deco[], cls: string): number[][] =>
  ds.filter((d) => d.kind === 'line' && d.cls === cls).map((d) => [d.from, d.to])

const markSpans = (ds: Deco[], cls: string): number[][] =>
  ds.filter((d) => d.kind === 'mark' && d.cls === cls).map((d) => [d.from, d.to])

/** 装饰值本身（用来断言 widget 的字段）。 */
function values(instance: LivePreviewPluginValue): Decoration[] {
  const out: Decoration[] = []
  instance.decorations.between(0, 1e9, (_f, _t, value) => {
    out.push(value)
  })
  return out
}

const DOC = '| a | b |\n| --- | --- |\n| 1 | 2 |'

describe('table —— 表头 / 分隔行 / 管道', () => {
  it('实测树：表头行 + 分隔行 + 数据行各拿到正确的 line class', () => {
    const { instance } = mount(DOC)

    // 表格每一行（含分隔行）都有 `nd-table`。
    expect(lineSpans(read(instance), 'nd-table')).toEqual([
      [0, 0],
      [10, 10],
      [24, 24],
    ])
    // 表头行加粗；分隔行单独一个 class。
    expect(lineSpans(read(instance), 'nd-table-header')).toEqual([[0, 0]])
    expect(lineSpans(read(instance), 'nd-table-delimiter')).toEqual([[10, 10]])
  })

  it('★ 淡化：表头/数据行的每个 `|` 各一段，分隔行是**整行一段**', () => {
    const { instance } = mount(DOC)

    /*
     * 实测（@lezer/markdown 1.7.2）：
     *   TableHeader [0,9) 里的 `|` 在 [0,1) [4,5) [8,9)
     *   TableDelimiter [10,23) 是**整条分隔行**（不是单个管道！）
     *   TableRow [24,33) 里的 `|` 在 [24,25) [28,29) [32,33)
     */
    expect(markSpans(read(instance), 'nd-mark')).toEqual([
      [0, 1],
      [4, 5],
      [8, 9],
      [10, 23],
      [24, 25],
      [28, 29],
      [32, 33],
    ])
  })

  it('★ 分隔行不会被误当成单个管道：不存在 [10,11) 这种一段', () => {
    const { instance } = mount(DOC)

    const marks = markSpans(read(instance), 'nd-mark')
    // 若把分隔行当管道处理，就会冒出一堆 1 字符的段 —— 这条守着那个坑。
    expect(marks).not.toContainEqual([10, 11])
    // 分隔行只有一段，且正好覆盖整条分隔行。
    expect(marks.filter(([from]) => from === 10)).toEqual([[10, 23]])
  })

  it('★ 不 replace 整块、也不登记 atomic —— 方向键必须能进表格', () => {
    const { instance } = mount(DOC)
    const ds = read(instance)

    expect(ds.filter((d) => d.kind === 'replace')).toHaveLength(0)
    expect(ds.filter((d) => d.kind === 'widget')).toHaveLength(0)
    // 一个字符都没藏 → 没有任何原子区间。
    expect(instance.atomicDecorations.size).toBe(0)
  })

  it('无外框的管道表（`a | b`）同样被认领', () => {
    // 实测树：TableHeader [0,5) / TableDelimiter [6,15) / TableRow [16,21)
    const { instance } = mount('a | b\n--- | ---\n1 | 2')

    expect(lineSpans(read(instance), 'nd-table-header')).toEqual([[0, 0]])
    expect(lineSpans(read(instance), 'nd-table-delimiter')).toEqual([[6, 6]])
    expect(markSpans(read(instance), 'nd-mark')).toContainEqual([6, 15])
  })

  it('普通段落不会被误装饰', () => {
    const { instance } = mount('普通段落\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })
})

describe('table —— 认领 Table 不吞掉子树', () => {
  it('★ 单元格里的 `**a**` 仍被 inline 装饰器处理（feature 分支不 return false）', () => {
    // `| **a** | b |` → StrongEmphasis 落在 [2,7)
    const { instance } = mount('| **a** | b |\n| --- | --- |', { inline: decorateInline })
    const ds = read(instance)

    // 行内粗体 mark 仍然产出。
    expect(markSpans(ds, 'nd-strong')).toEqual([[2, 7]])
    // 光标在末尾 → 非揭示态：两个 `**` 被藏掉。
    expect(ds.filter((d) => d.kind === 'replace').map((d) => [d.from, d.to])).toEqual([
      [2, 4],
      [5, 7],
    ])
    // 同时表格自己的 line class 也在。
    expect(lineSpans(ds, 'nd-table-header')).toEqual([[0, 0]])
  })

  it('widget 值里不含任何图片 widget（表格不产生 widget）', () => {
    const { instance } = mount(DOC)
    expect(values(instance).some((v) => (v.spec as { widget?: unknown }).widget !== undefined)).toBe(
      false,
    )
  })
})
