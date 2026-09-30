/**
 * 列表符号 widget —— `-` / `*` / `+` → `•`，`1.` → 淡化的 `1.`（参考文档 4.4 节）。
 *
 * 为什么**必须**是 widget（CSS 伪元素做不到）：
 *   - 无序列表要把 `-` 换成**另一个字符** `•`，伪元素改不了文本；
 *   - 有序列表要保留数字，而伪元素拿不到「这一项是几」（`9.` / `10.` 宽度还不一样）。
 *
 * ⚠️ 两个类都实现了 `eq()`。基类的 `eq` 恒返回 `false`，不覆盖的话每次重建装饰
 *    都会新建 DOM —— 列表一多就是持续的重排（参考 ImageWidget 的同一条坑）。
 */
import { WidgetType } from '@codemirror/view'

/** 无序列表的三种写法统一渲染成这个圆点。 */
const BULLET_TEXT = '•'

/** 无序列表符号：`-` / `*` / `+` 都是圆点，渲染结果与源码里的符号无关。 */
export class BulletMarkerWidget extends WidgetType {
  /** 渲染出来的文本是常量，所以同类之间**永远等价** → DOM 直接复用。 */
  override eq(other: BulletMarkerWidget): boolean {
    return other instanceof BulletMarkerWidget
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nd-list-marker nd-list-marker-bullet'
    span.textContent = BULLET_TEXT
    return span
  }
}

/**
 * 有序列表符号：**保留数字**（`3.` 就是 `3.`），只是按「标记」淡化，不当正文。
 *
 * 数字由调用方从源码的 `ListMark` 区间取（见 `decorate/list.ts`），所以 `start` 非 1
 * 的列表、嵌套列表、`9.` → `10.` 的宽度变化全都自然成立。
 */
export class OrderedMarkerWidget extends WidgetType {
  constructor(private readonly text: string) {
    super()
  }

  /** ★ 比较**渲染出来的文本**：`1.` 和 `2.` 必须各自重建 DOM，否则数字不会更新。 */
  override eq(other: OrderedMarkerWidget): boolean {
    return other instanceof OrderedMarkerWidget && other.text === this.text
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    // `nd-mark` 是既有的「标记淡化」class（theme.ts 的 baseTheme 用
    // `--nd-mark-opacity` 把它变淡，并中和继承来的粗体/斜体）。
    // 有序列表的数字是**标记**而不是正文，复用它就不必往 theme.css 里再加一条规则。
    span.className = 'nd-list-marker nd-list-marker-ordered nd-mark'
    span.textContent = this.text
    return span
  }
}
