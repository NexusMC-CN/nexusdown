/**
 * `mountEditor` —— 建视图的唯一入口。
 *
 * ⚠️ 这个测试守的是**跨模块边界**那条线：UI 层（`.vue`）不许自己建 CM6 对象，
 * 只能调这个函数。所以这里必须证明：**光调它就能得到一个能用的编辑器**。
 */
import { mountEditor, setEditorValue } from '../../src/cm/mount.js'

function host() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('mountEditor', () => {
  it('建出一个能用的编辑器（DOM 里有 .cm-editor）', () => {
    const el = host()
    const view = mountEditor({ parent: el, doc: 'hello' })
    expect(el.querySelector('.cm-editor')).toBeTruthy()
    expect(view.state.doc.toString()).toBe('hello')
    view.destroy()
    el.remove()
  })

  it('文档变化会回调（v-model 的回填）', () => {
    const el = host()
    const seen: string[] = []
    const view = mountEditor({ parent: el, doc: 'a', onDocChange: (v) => seen.push(v) })
    view.dispatch({ changes: { from: 1, insert: 'b' } })
    expect(seen).toEqual(['ab'])
    view.destroy()
    el.remove()
  })

  it('setEditorValue 换内容', () => {
    const el = host()
    const view = mountEditor({ parent: el, doc: 'old' })
    setEditorValue(view, 'new')
    expect(view.state.doc.toString()).toBe('new')
    view.destroy()
    el.remove()
  })

  it('★ setEditorValue 内容相同则不动（防"回填 → 回调 → 再回填"死循环）', () => {
    const el = host()
    let calls = 0
    const view = mountEditor({ parent: el, doc: 'same', onDocChange: () => calls++ })
    setEditorValue(view, 'same')
    expect(calls).toBe(0)
    view.destroy()
    el.remove()
  })

  it('★ 装的是 nexusdown() 的扩展（表格有 nd-table 行 class）', () => {
    const el = host()
    const view = mountEditor({ parent: el, doc: '| a | b |\n| --- | --- |\n| 1 | 2 |' })
    expect(el.querySelector('.nd-table')).toBeTruthy()
    view.destroy()
    el.remove()
  })
})
