/**
 * 代码块的「窗口标题栏」widget。
 *
 * 把 Markdown 的围栏行（` ```ts app.vue `）在**非揭示态**渲染成 IDE 代码窗口的标题栏：
 * 左边三个小圆点（模拟窗口按钮），中间是**文件图标 + 文件名**，右边是语言名。
 *
 *     ┌────────────────────────────────┐
 *     │ ● ● ●   [TS] app.vue      ts   │   ← 这行是 widget
 *     ├────────────────────────────────┤
 *     │ const a = 1                     │
 *     └────────────────────────────────┘
 *
 * ## 围栏信息怎么解析
 *
 * CommonMark 里开围栏的 info string 是**自由文本**，约定俗成写成 `语言 文件名`。
 * 这里按空白切成两段：第一段当语言，剩下的当文件名/标题。
 *
 *     ```ts app.vue        → lang=ts    title=app.vue
 *     ```ts src/a.ts       → lang=ts    title=src/a.ts
 *     ```js                → lang=js    title=（空）
 *     ```                  → lang=（空）title=（空）
 *     ```ts title=app.vue  → lang=ts    title=title=app.vue（不特殊处理，原样显示）
 *
 * ⚠️ **只在非揭示态用**。光标进入代码块时 `fence.ts` 会原样显示围栏行
 * （用户要能改语言标记），那时不能挂 widget。
 *
 * ⚠️ 这是 `Decoration.replace` 的**行内**替换（不是 block widget）——
 * CM6 里 `block: true` 的替换区间**方向键永远进不去**，会让围栏行彻底无法编辑。
 */
import { WidgetType, type EditorView } from '@codemirror/view'

import { toggleFold } from '../fold.js'
import { renderCodeHeaderHtml } from './code-header-parts.js'


export class CodeFenceHeaderWidget extends WidgetType {
  constructor(
    private readonly info: string,
    /** 这个代码块当前折叠了吗（决定按钮画哪个箭头）。 */
    private readonly folded = false,
    /** 开围栏的文档位置 —— 折叠状态用它当 key（见 `fold.ts`）。 */
    private readonly from = -1,
  ) {
    super()
  }

  /**
   * ⚠️ 必须实现。不实现的话每次装饰重建都会 `toDOM()` 重建 DOM，
   * 标题栏会闪、徽章会重新画。
   *
   * 三个字段都要比：`folded` 变了要换箭头，`from` 变了按钮会 dispatch 到错的位置。
   */
  override eq(other: CodeFenceHeaderWidget): boolean {
    return other.info === this.info && other.folded === this.folded && other.from === this.from
  }

  override toDOM(view?: EditorView): HTMLElement {
    /*
     * ★ **结构一律由 `code-header-parts.ts` 产出。**
     *
     * 这里是「编辑器」这一个渲染者：多一个折叠按钮（`interactive`）。
     * 显示侧的 `render/renderer.ts` 用的是**同一个函数**，只是不带按钮 ——
     * 两边长得一样是**结构性保证**，不是靠人工同步注释。
     */
    const interactive = Boolean(view) && this.from >= 0
    const holder = document.createElement('div')
    holder.innerHTML = renderCodeHeaderHtml(this.info, {
      interactive,
      folded: this.folded,
    })
    const header = holder.firstElementChild as HTMLElement
    if (interactive && view) this.wireToggle(header, view)
    return header
  }

  /**
   * 折叠按钮。
   *
   * ⚠️ 四个动作缺一不可（和 `widgets/task.ts` 的复选框是同一套）：
   *
   * 1. `mousedown` 上 `preventDefault()` —— 阻止按钮抢焦点、阻止 CM 把光标挪走。
   *    少了它，点一下按钮会**先把光标移到这一行**（于是代码块变成揭示态、
   *    围栏原样显示出来），再切换折叠 —— 两个动作打架。
   * 2. `click` 里 `preventDefault()` + `stopPropagation()` —— 别让事件冒到编辑器。
   * 3. dispatch 一个**带 effect 的事务**，不碰文档（`toggleFold` 是纯视图状态）。
   * 4. `ignoreEvent` 放行 `mousedown`/`click`，否则事件根本到不了按钮。
   */
  private wireToggle(header: HTMLElement, view: EditorView): void {
    const button = header.querySelector<HTMLButtonElement>('.nd-code-toggle')
    if (!button) return

    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      view.dispatch({ effects: toggleFold.of(this.from) })
    })
  }

  /**
   * 让 CM6 接管事件 —— 点标题栏就是普通的光标定位，
   * 落进这一行后 `fence.ts` 会把围栏原样显示出来，用户就能改语言了。
   *
   * ⚠️ 但 `mousedown` / `click` 要**放行**，否则折叠按钮收不到事件。
   */
  override ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}
