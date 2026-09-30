/**
 * 任务列表复选框 —— **可交互** widget（参考文档 4.9 节）。
 *
 * 四个动作**缺一不可**，少任何一个都会坏：
 *
 * 1. 构造时把 `[ ]` 在源码里的坐标 `from` / `to` 存下来 ——
 *    这样 `change` 里可以直接精确 dispatch，不用反查选区。
 * 2. `ignoreEvent` **白名单放行** `mousedown` / `click` ——
 *    widget 默认「吃掉所有事件」，反着写（默认返回 false）的话 CM 会把点击
 *    当成普通点击处理，复选框根本点不动。
 * 3. `mousedown` 上 `preventDefault()` —— 阻止 `<input>` 抢焦点，
 *    也阻止 CM 借这次 mousedown 把光标挪到 widget 上（否则整行变 active、
 *    复选框被揭示态的源码盖掉）。
 * 4. `change` 里按存下来的坐标替换 `[ ]` ↔ `[x]`。
 *
 * ⚠️ `change` 的 dispatch **不带 `userEvent`**：这一条是刻意的 ——
 * 勾选/取消勾选自成一个 undo step，和输入（`input.*`）分开。
 *
 * ⚠️ 复选框**永远渲染**，不检查「揭示态」：它本身就是编辑入口，
 * 和「标记在活动行才揭示」的规则是**故意背离**的。
 */
import { WidgetType, type EditorView } from '@codemirror/view'

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    /** `[ ]` 在源码里的起点。 */
    private readonly from: number,
    /** `[ ]` 在源码里的终点（排他）。 */
    private readonly to: number,
  ) {
    super()
  }

  /**
   * ★ 必须实现：不实现的话 CM 每次重建装饰都会新建 DOM ——
   * 复选框会闪、正在进行的点击会被打断。
   */
  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to
  }

  override toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'nd-task-checkbox'
    input.checked = this.checked

    // 动作 ③：不让 input 抢焦点，也不让 CM 把光标挪过来。
    input.addEventListener('mousedown', (event) => event.preventDefault())

    // 动作 ④：用构造时存下的坐标精确替换。
    // `this.checked` 是**旧**值，所以取反就是新值（input 自己的 checked 已被浏览器翻转）。
    input.addEventListener('change', () => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' },
      })
    })

    return input
  }

  // 动作 ②：白名单放行 mousedown / click，其余（keydown、input…）交给 CM。
  override ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}
