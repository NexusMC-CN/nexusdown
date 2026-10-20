/**
 * `tabs` 编辑器侧：整组围栏换成一个块 widget（源码来自 renderMarkdown）。
 *
 * 纯函数层：直接调 `tabsFeature.decorate`（它认领 `Document`），读块级 replace。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { TabsWidget, tabsFeature } from '../../src/cm/features/tabs.js'

function collect(doc: string, cursor = doc.length) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, addKeymap: false })],
  })
  const ranges: { from: number; to: number; value: Decoration }[] = []
  const atomic: typeof ranges = []
  tabsFeature.decorate(ranges, atomic, syntaxTree(state).topNode, state.doc, state.selection)
  return ranges
}

const GROUP = [
  '```bash',
  'a',
  '```',
  '{tab="Ubuntu"}',
  '',
  '```bash',
  'b',
  '```',
  '{tab="macOS"}',
  '\n尾部',
].join('\n')

describe('tabs editor', () => {
  it('★ 两段相邻 tab 围栏 → 一个块级 replace + TabsWidget', () => {
    const ranges = collect(GROUP)
    const widgets = ranges
      .map((range) => (range.value.spec as { widget?: unknown }).widget)
      .filter((widget) => widget instanceof TabsWidget)
    expect(widgets).toHaveLength(1)
  })

  it('光标在组内 → 揭示态，不替换', () => {
    const ranges = collect(GROUP, GROUP.indexOf('a'))
    expect(ranges.filter((range) => (range.value.spec as { widget?: unknown }).widget instanceof TabsWidget)).toHaveLength(0)
  })

  it('只有一段 → 不组', () => {
    const ranges = collect('```bash\na\n```\n{tab="Ubuntu"}\n\n尾部')
    expect(ranges).toHaveLength(0)
  })
})
