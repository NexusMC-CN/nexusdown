/**
 * 建一个 Nexusdown 编辑器视图 —— **CM6 的一切都发生在这里**。
 *
 * ## ★ 为什么要有这个文件（而不是让 `.vue` 自己建）
 *
 * `nexusdown/editor` 的 `.vue` 是**以原始源码发给消费方**的，它的 import 由
 * **消费方的打包器**解析。只要那个文件里出现 `EditorState` / `EditorView` /
 * `keymap` 这类 **CM6 对象**，就会出现这种情况：
 *
 * - `EditorState` 来自**消费方打包器**解析出的一份 CM6
 * - `nexusdown()` 返回的扩展来自**另一份**
 * - CM6 的 facet / StateField 按**模块标识**比较 → `instanceof` 对不上
 *   → `Unrecognized extension value in extension set ([object Object])`
 *
 * 而**扩展数组本身每一项都是合法的** —— 这个"矛盾组合"就是两份实例的铁证。
 * （实测踩过：在 Nuxt 下必现，同样的包在纯 Vite 下正常。）
 *
 * **光改 import 路径治不了根** ✗ —— 只要还有"跨模块边界传 CM6 对象"这件事，
 * 就永远取决于消费方打包器怎么解析。
 *
 * 所以把**整个建视图的动作**收进这个文件：`.vue` 只传 `parent` / `doc` / 回调，
 * 拿到一个**不透明的句柄**。CM6 对象**从头到尾不跨模块边界** ✓
 * —— 无论消费方那边有几份 CM6，都不可能冲突。
 *
 * ## 依赖方向
 *
 * 这个文件会被 `tsup` 打进 `dist/cm/index.js` ✓，里面的 `@codemirror/*`
 * 是 **external**（peer）✓ → 由消费方提供，且**只在一个模块图里** ✓。
 */
import { defaultKeymap } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

import type { MathRenderer } from './features/math.js'
import { nexusdown } from './index.js'

export interface MountEditorOptions {
  /** CM6 往这个容器里塞 DOM。 */
  parent: HTMLElement
  /** 初始文档。 */
  doc: string
  /** 文档变化时回调（对应 `v-model` 的回填）。 */
  onDocChange?: (value: string) => void
  /**
   * 数学渲染函数（可选）—— 注入后块级 ` ```math ` 围栏在编辑器里就显示成公式。
   *
   * 形状与渲染侧 `KatexLike` 一致，消费方可以把**同一个 katex 对象**喂给两侧。
   * 不传时**不报错**：块级公式退回普通代码块（见 `features/math.ts`）。
   */
  mathRenderer?: MathRenderer
}

/**
 * ★ **返回 `EditorView` 本身**，不做包装。
 *
 * 工具栏要用它（`undo(view)` / `syntaxTree(view.state)` …），所以它必须能传出去。
 *
 * ⚠️ **允许"持有并传递"，不允许"创建"**：
 * - 调用方（`.vue`）可以拿到这个 view、递给工具栏 ✓
 * - 但**绝不能自己 `new EditorView` / `EditorState.create` / `keymap.of`** ✗
 *
 * 因为 `undo` / `syntaxTree` 这些也是从**同一个构建产物**（`nexusdown/cm`）
 * 来的 ✓ → **创建者和消费者同源** ✓ → 无论消费方打包器把 CM6 解析成几份，
 * 这条链上的对象标识都是自洽的 ✓。
 *
 * 一旦 `.vue` 自己建一个 view（或自己 `import('@codemirror/view')`），
 * 那条链就断了 —— 这就是之前 `Unrecognized extension value` 的来源。
 */
export function mountEditor(options: MountEditorOptions): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        /*
         * `nexusdown()` 返回的是**一个 Extension 数组**，里面已经有：
         * 语言（GFM markdown）→ live preview 装饰 → 自动换行 → 多光标
         * （`allowMultipleSelections` —— 命令的多光标安全靠它）→ 链接点击 →
         * Markdown 快捷键 → 撤销栈 → `drawSelection()`（**光标就是它画的**）
         * → 当前行高亮 → 基础语法着色 → baseTheme。
         *
         * `mathRenderer` 一路透传下去，最终进 math 功能的块级公式装饰。
         * 不传时 `nexusdown()` 的行为与没有这个参数时**一字不变**。
         */
        nexusdown({ mathRenderer: options.mathRenderer }),

        /*
         * `nexusdown()` **故意不含** `defaultKeymap`（它只带 `historyKeymap`
         * 和 Markdown 快捷键），补上是为了 `Mod-a` / `Mod-Backspace` / `Escape`
         * 这些通用键。
         *
         * ⚠️ **顺序**：放在 `nexusdown()` **之后**，优先级低于它 ——
         * 保证 `Mod-b` 不会被通用键抢走。
         *
         * 不加 `indentWithTab`：那会把 Tab 吃掉（键盘用户再也跳不出编辑器）。
         */
        keymap.of(defaultKeymap),

        /*
         * 唯一的出口：把文档同步回去。
         *
         * ⚠️ 只在 `docChanged` 时回填 —— 光标移动、选区变化也会触发
         * `updateListener`，不加判断的话每动一下光标就重算整篇字符串。
         */
        EditorView.updateListener.of((u) => {
          if (u.docChanged) options.onDocChange?.(u.state.doc.toString())
        }),
      ],
    }),
    parent: options.parent,
  })

  return view
}

/**
 * 从外部换掉整篇内容。
 *
 * ⚠️ 内容相同就**什么都不做** —— 不比对的话会「回填 → 触发 `onDocChange` →
 * 再 `setEditorValue`」死循环。
 */
export function setEditorValue(view: EditorView, value: string): void {
  if (view.state.doc.toString() === value) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
}
