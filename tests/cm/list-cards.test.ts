/**
 * `{.cards}` 的编辑器侧：藏掉列表符号 + 整行挂 `.nd-card-item`。
 *
 * 纯函数层（同 `list-steps.test.ts`）：直接调 `decorateListItem`，读装饰。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState, type Range } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { decorateListItem } from '../../src/cm/decorate/list.js'
import { BulletMarkerWidget } from '../../src/cm/widgets/list.js'

function collect(doc: string, cursor = doc.length): Range<Decoration>[] {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, addKeymap: false })],
  })
  const ranges: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'ListItem') {
        decorateListItem(ranges, atomic, ref.node, state.doc, state.selection)
      }
    },
  })
  return ranges
}

const specs = (ranges: Range<Decoration>[]) =>
  ranges.map((range) => range.value.spec as { class?: string; widget?: unknown })

describe('list cards', () => {
  it('★ `{.cards}` 后的列表项：挂 .nd-card-item，且不再画圆点', () => {
    const ranges = collect('- a\n- b\n\n{.cards}')
    const classes = specs(ranges).map((spec) => spec.class)
    expect(classes.filter((cls) => cls === 'nd-card-item')).toHaveLength(2)

    const widgets = specs(ranges).map((spec) => spec.widget)
    expect(widgets.some((widget) => widget instanceof BulletMarkerWidget)).toBe(false)
  })

  it('没有属性行 → 正常圆点，没有卡片行', () => {
    const ranges = collect('- a\n- b')
    const classes = specs(ranges).map((spec) => spec.class)
    expect(classes).not.toContain('nd-card-item')
    expect(specs(ranges).some((spec) => spec.widget instanceof BulletMarkerWidget)).toBe(true)
  })

  it('嵌套列表不继承 `{.cards}`（只认顶层列表）', () => {
    const ranges = collect('- a\n  - b\n\n{.cards}')
    const cardLines = specs(ranges).filter((spec) => spec.class === 'nd-card-item')
    expect(cardLines).toHaveLength(1)
  })
})
