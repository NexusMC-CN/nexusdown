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

  it('★ 装的是 nexusdown() 的扩展（语法着色与装饰挂上了）', () => {
    const el = host()
    const view = mountEditor({ parent: el, doc: '```js\nconst a = 1\n```' })
    /*
     * 断言"扩展真的装上了"最稳的抓手是**围栏代码块的行 class** ——
     * 它由 `nexusdown()` 里的装饰产出 ✓。
     *
     * ⚠️ 别拿 emoji 的短代码当抓手 ✗ —— emoji 是 **widget**，
     * 而且有"光标在附近就揭示源码"的行为，`textContent` 里可能根本没有字形 ✓
     * （踩过：断言 `:smile:` 变成 😄 会失败 ✓）。
     */
    expect(el.querySelector('.nd-code-block')).toBeTruthy()
    view.destroy()
    el.remove()
  })

  /*
   * 数学渲染函数的**整条透传链**：`mountEditor` → `nexusdown()` →
   * `createEditorFeatureMap()` → math 功能的块级公式装饰。
   *
   * ⚠️ 围栏**不能放在文档开头**：`EditorState.create` 不传 selection 时光标落在
   * 位置 0，也就是第一行 —— 那正好是开围栏行，会被判成**揭示态**、不渲染公式。
   * 所以前面垫一段 `前言`。
   */
  it('★ 传了 mathRenderer → ```math 围栏渲染成公式（不是代码块）', () => {
    const el = host()
    const view = mountEditor({
      parent: el,
      doc: '前言\n\n```math\nx^2\n```',
      mathRenderer: {
        renderToString: (tex) => `<span class="katex-stub" data-tex="${tex}"></span>`,
      },
    })

    expect(el.querySelector('.katex-stub')).toBeTruthy()
    expect(el.querySelector('.nd-code-block')).toBeNull()
    view.destroy()
    el.remove()
  })

  it('★ 没传 mathRenderer → ```math 仍降级成普通代码块（不报错）', () => {
    const el = host()
    const view = mountEditor({ parent: el, doc: '前言\n\n```math\nx^2\n```' })

    expect(el.querySelector('.nd-code-block')).toBeTruthy()
    view.destroy()
    el.remove()
  })
})
