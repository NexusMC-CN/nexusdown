/**
 * `attrs`（属性行 chip）测试。
 *
 * 两层：
 * 1. `src/shared/attrs.ts` 的纯解析/生成/标签；
 * 2. 编辑器功能：只有「独占一行 + 紧贴前一个非空块」才变 chip，
 *    光标进入该行时露出源码。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { AttrsChipWidget, attrsFeature } from '../../src/cm/features/attrs.js'
import { nexusdownLivePreview, type LivePreviewPluginValue } from '../../src/cm/plugin.js'
import { attrLabel, formatAttrLine, parseAttrLine } from '../../src/shared/attrs.js'

type Kind = 'line' | 'mark' | 'replace' | 'widget'

interface Deco {
  from: number
  to: number
  cls: string | undefined
  kind: Kind
  widget?: AttrsChipWidget
}

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

function mount(doc: string, cursor: number = doc.length) {
  const plugin = nexusdownLivePreview({
    features: new Map([['Paragraph', attrsFeature]]),
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
    out.push({
      from,
      to,
      cls: spec.class,
      kind,
      widget: spec.widget instanceof AttrsChipWidget ? spec.widget : undefined,
    })
  })
  return out
}

describe('attrs —— 解析 / 生成 / 标签', () => {
  it('★ 类、id、键值、布尔四种 token', () => {
    expect(parseAttrLine('{.steps}')).toEqual([{ kind: 'class', name: 'steps' }])
    expect(parseAttrLine('{#eq-1 label="(1)"}')).toEqual([
      { kind: 'id', name: 'eq-1' },
      { kind: 'key', name: 'label', value: '(1)' },
    ])
    expect(parseAttrLine('{title="a.ts" lines=1-20 full-width}')).toEqual([
      { kind: 'key', name: 'title', value: 'a.ts' },
      { kind: 'key', name: 'lines', value: '1-20' },
      { kind: 'key', name: 'full-width' },
    ])
  })

  it('★ 引号里的空格不切分', () => {
    expect(parseAttrLine('{caption="配置 项"}')).toEqual([
      { kind: 'key', name: 'caption', value: '配置 项' },
    ])
  })

  it('★ 空行 / 非法 token / 缺引号 → null（调用方当普通文本）', () => {
    expect(parseAttrLine('{}')).toBeNull()
    expect(parseAttrLine('{.}')).toBeNull()
    expect(parseAttrLine('{name!}')).toBeNull()
    expect(parseAttrLine('{caption="没闭合}')).toBeNull()
    expect(parseAttrLine('普通段落')).toBeNull()
  })

  it('★ format 与 parse 语义互逆（引号只在必要时加）', () => {
    for (const line of ['{.steps}', '{#eq-1 label="(1)"}', '{title="a.ts" lines=1-20}']) {
      expect(parseAttrLine(formatAttrLine(parseAttrLine(line)!))).toEqual(parseAttrLine(line))
    }
  })

  it('★ 标签：已知属性映射，未知回退原文', () => {
    expect(attrLabel(parseAttrLine('{.steps}')!)).toBe('步骤')
    expect(attrLabel(parseAttrLine('{.cards}')!)).toBe('卡片')
    expect(attrLabel(parseAttrLine('{.fields}')!)).toBe('参数表')
    expect(attrLabel(parseAttrLine('{title="a.ts" lines=1-20}')!)).toBe('代码标题 · 行号')
    expect(attrLabel(parseAttrLine('{#eq-1}')!)).toBe('锚点')
    expect(attrLabel(parseAttrLine('{foo="bar"}')!, '{foo="bar"}')).toBe('foo="bar"')
  })
})

describe('attrs —— 编辑器 chip', () => {
  it('★ 列表后空一行 + 属性行 → 整行换成 chip，标签是语义', () => {
    const doc = '- a\n- b\n\n{.steps}\n\n尾部'
    const { instance } = mount(doc)
    const ds = read(instance)

    const chip = ds.find((d) => d.kind === 'widget')
    expect(chip).toBeTruthy()
    expect([chip!.from, chip!.to]).toEqual([doc.indexOf('{.steps}'), doc.indexOf('{.steps}') + 8])
    expect(chip!.widget?.label).toBe('步骤')
    expect(chip!.widget?.raw).toBe('{.steps}')
    // 属性行保持正常行高，只把内容换成 chip（不再压成 0 高）
    expect(ds.some((d) => d.kind === 'line' && d.cls === 'nd-attrs-line')).toBe(false)
  })

  it('★ 光标进入属性行 → 露出源码，只加一条淡化行装饰', () => {
    const doc = '- a\n- b\n\n{.steps}\n\n尾部'
    const { instance } = mount(doc, doc.indexOf('{.steps}') + 2)
    const ds = read(instance)

    expect(ds.filter((d) => d.kind === 'replace')).toHaveLength(0)
    expect(ds.filter((d) => d.kind === 'line' && d.cls === 'nd-attrs-line')).toHaveLength(1)
  })

  it('★ 列表后不空行 → 被当成列表项续行，不装饰（契约 §0.1）', () => {
    const { instance } = mount('- a\n- b\n{.steps}\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })

  it('★ 前一个块是普通段落 → 不是属性行（不装饰）', () => {
    const { instance } = mount('普通段落\n\n{.steps}\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })

  it('★ 散文里的 `{a b}` 不装饰（语法能解析，但不是块后缀）', () => {
    const { instance } = mount('普通段落\n\n{a b}\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })

  it('★ 围栏后的代码块参数 → chip 标签是「代码标题 · 行号」', () => {
    const doc = '```ts\nx\n```\n{title="a.ts" lines=1-20}\n\n尾部'
    const { instance } = mount(doc)
    const ds = read(instance)

    expect(ds.filter((d) => d.kind === 'widget')).toHaveLength(1)
    expect(ds.find((d) => d.kind === 'widget')?.widget?.label).toBe('代码标题 · 行号')
  })

  it('★ 文档第一行的属性行不装饰（没有前一个块）', () => {
    const { instance } = mount('{.steps}\n\n- a')
    expect(read(instance)).toHaveLength(0)
  })

  it('★ 跨行段落里的 `{…}` 不装饰（不是独占一行）', () => {
    const { instance } = mount('第一行\n{.steps}\n\n尾部')
    expect(read(instance)).toHaveLength(0)
  })
})
