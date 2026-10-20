/**
 * `{.steps}` 的编辑器侧：ListMark 换成序号圆点。
 *
 * 做法同 `emoji.test.ts`：只挂 `decorateListItem` 这个装饰器，
 * 直接读 `DecorationSet` 里的 widget，不依赖 DOM 渲染。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { decorateListItem } from '../../src/cm/decorate/list.js'
import { nexusdownLivePreview, type LivePreviewPluginValue } from '../../src/cm/plugin.js'
import { StepMarkerWidget } from '../../src/cm/widgets/list.js'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

function mount(doc: string) {
  const plugin = nexusdownLivePreview({ decorators: { listItem: decorateListItem } })
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [markdown({ base: markdownLanguage, addKeymap: false }), plugin] as Extension[],
  })
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({ state, parent })
  views.push(view)

  const instance = view.plugin(plugin as unknown as ViewPlugin<LivePreviewPluginValue>)
  if (!instance) throw new Error('插件没有挂上')
  return instance
}

function steps(instance: LivePreviewPluginValue): number[] {
  const out: number[] = []
  instance.decorations.between(0, 1e9, (_from, _to, value) => {
    const widget = (value.spec as { widget?: unknown }).widget
    if (widget instanceof StepMarkerWidget) out.push(widget.index)
  })
  return out
}

describe('list steps', () => {
  it('★ `{.steps}` 后的列表按顺序给 1 / 2', () => {
    expect(steps(mount('- a\n- b\n\n{.steps}'))).toEqual([1, 2])
  })

  it('有序列表 + `{.steps}` 也用序号圆点（序号从 1 重新数）', () => {
    expect(steps(mount('1. a\n2. b\n\n{.steps}'))).toEqual([1, 2])
  })

  it('没有属性行 → 不产生序号 widget', () => {
    expect(steps(mount('- a\n- b'))).toEqual([])
  })

  it('属性行前没有空行（被当续行）→ 不生效', () => {
    expect(steps(mount('- a\n- b\n{.steps}'))).toEqual([])
  })
})
