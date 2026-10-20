/**
 * `applyBlockAttrs` / `blockKindAt` 测试。
 *
 * 锁住「插入位置」这条契约：
 * - 列表 / 段落：块后**空一行**（否则 CommonMark 把 `{…}` 当续行）；
 * - 表格 / 围栏：紧跟块后；
 * - 已有属性行：**合并**，不新开一行。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { applyBlockAttrs, blockKindAt } from '../../src/cm/commands.js'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

function mount(doc: string, cursor = doc.length) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, addKeymap: false })] as Extension[],
  })
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({ state, parent })
  views.push(view)
  return view
}

function run(doc: string, attr: string, cursor = doc.length) {
  const view = mount(doc, cursor)
  const ok = applyBlockAttrs(attr)(view)
  return { ok, text: view.state.doc.toString() }
}

describe('blockKindAt', () => {
  it('识别列表 / 表格 / 围栏 / 段落', () => {
    expect(blockKindAt(mount('- a\n- b', 3).state)).toBe('list')
    expect(blockKindAt(mount('| a | b |\n| --- | --- |\n| 1 | 2 |', 5).state)).toBe('table')
    expect(blockKindAt(mount('```ts\nx\n```', 7).state)).toBe('fence')
    expect(blockKindAt(mount('普通段落', 2).state)).toBe('paragraph')
  })

  it('引用块里返回 null（渲染侧不认 level > 0 的属性行）', () => {
    expect(blockKindAt(mount('> 引用', 3).state)).toBeNull()
  })
})

describe('applyBlockAttrs', () => {
  it('★ 列表：块后空一行插入', () => {
    expect(run('- a\n- b', '{.steps}')).toEqual({ ok: true, text: '- a\n- b\n\n{.steps}' })
  })

  it('★ 表格：块后空一行插入（否则 markdown-it 会把 `{.fields}` 当表格行）', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    expect(run(doc, '{.fields}').text).toBe(`${doc}\n\n{.fields}`)
  })

  it('★ 围栏：紧跟闭围栏插入', () => {
    const doc = '```ts\nx\n```'
    // `a.ts` 不含空白，`formatAttrLine` 不加引号（语义等价，往返稳定）。
    expect(run(doc, '{title="a.ts"}').text).toBe(`${doc}\n{title=a.ts}`)
  })

  it('★ 段落：块后空一行插入', () => {
    expect(run('普通段落', '{.card}').text).toBe('普通段落\n\n{.card}')
  })

  it('★ 已有属性行 → 合并，不新开一行', () => {
    expect(run('- a\n\n{.steps}', '{.cards}', 2).text).toBe('- a\n\n{.steps .cards}')
  })

  it('★ 已有属性行里重复的类不重复追加', () => {
    expect(run('- a\n\n{.steps}', '{.steps}', 2).text).toBe('- a\n\n{.steps}')
  })

  it('没有可挂的块 → 返回 false，文档不变', () => {
    expect(run('', '{.steps}')).toEqual({ ok: false, text: '' })
  })

  it('光标在块内任意位置都能找到宿主', () => {
    expect(run('- a\n- b', '{.steps}', 0).text).toBe('- a\n- b\n\n{.steps}')
  })
})
