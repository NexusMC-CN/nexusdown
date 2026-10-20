/**
 * `{.fields}` 的编辑器侧：`TableWidget.fields` 决定外层类名 `nd-table--fields`。
 *
 * 同 `table.test.ts` 的纯函数层：在真语法树里找 `Table`，直接调 `tableFeature.decorate`，
 * 不依赖视图（块级装饰走 StateField，读不到 ViewPlugin 的 decorations）。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState, type Range } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { TableWidget, tableFeature } from '../../src/cm/features/table.js'

const TABLE = '| 参数 | 类型 |\n| --- | --- |\n| timeout | number |'

function widgetOf(doc: string, cursor = doc.length): TableWidget | null {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, addKeymap: false })],
  })
  const ranges: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'Table') {
        tableFeature.decorate(ranges, atomic, ref.node, state.doc, state.selection)
      }
    },
  })

  for (const range of ranges) {
    const widget = (range.value.spec as { widget?: unknown }).widget
    if (widget instanceof TableWidget) return widget
  }
  return null
}

describe('table fields', () => {
  it('★ 表格后紧跟 `{.fields}` → fields = true', () => {
    const widget = widgetOf(`${TABLE}\n{.fields}\n\n尾部`)
    expect(widget?.fields).toBe(true)
  })

  it('没有属性行 → fields = false', () => {
    expect(widgetOf(`${TABLE}\n\n尾部`)?.fields).toBe(false)
  })

  it('别的属性（`{.steps}`）不会误开 fields', () => {
    expect(widgetOf(`${TABLE}\n{.steps}\n\n尾部`)?.fields).toBe(false)
  })

  it('★ 空一行再写（正典）→ 也生效', () => {
    expect(widgetOf(`${TABLE}\n\n{.fields}\n\n尾部`)?.fields).toBe(true)
  })
})
