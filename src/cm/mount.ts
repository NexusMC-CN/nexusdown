/**
 * 建一个 Nexusdown 编辑器视图 —— **CM6 的一切都发生在这里**。
 *
 * ## ★ 为什么要有这个文件（而不是让 `.vue` 自己建）
 *
 * `@nexusmc-cn/nexusdown/editor` 的 `.vue` 是**以原始源码发给消费方**的，它的 import 由
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
import { defaultKeymap, historyField } from '@codemirror/commands'
import { Compartment, EditorState, StateEffect, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

import type { MentionCandidate } from './commands.js'
import type { MathRenderer } from './features/math.js'
import type { MentionResolutions } from './features/mention.js'
import { nexusdown } from './index.js'
import { setEditingBlock, setEditingRange } from './plugin.js'

export interface MountEditorOptions {
  /** CM6 往这个容器里塞 DOM。 */
  parent: HTMLElement
  /** 初始文档。 */
  doc: string
  /**
   * 文档变化时回调（对应 `v-model` 的原值回填）。
   * 组字期间若有外部全文替换等待生效，该替换优先，暂不回流旧稿的后续组字变化；
   * 组字结束应用新稿后再回调。不要借此在组字过程中逐步规范化并替换全文。
   */
  onDocChange?: (value: string) => void
  /**
   * 数学渲染函数（可选）—— 注入后块级 ` ```math ` 围栏在编辑器里就显示成公式。
   *
   * 形状与渲染侧 `KatexLike` 一致，消费方可以把**同一个 katex 对象**喂给两侧。
   * 不传时**不报错**：块级公式退回普通代码块（见 `features/math.ts`）。
   */
  mathRenderer?: MathRenderer
  /**
   * 提及解析结果（可选）—— 注入后编辑器里的提及卡片和**发布侧同构**
   * （标题 / 图标 / 角标 / 缩略图）。
   *
   * ★ 形状就是渲染侧 `RenderData.mentions`（`ReadonlyMap<string, MentionResolution>`），
   * 消费方把算好的那份**原样传进来**即可。不传时**不报错**：卡片只显示 slug。
   */
  mentions?: MentionResolutions
  /**
   * 提及候选（可选）—— 注入后在正文里打 `@` 会就地弹出候选列表
   * （工具栏的「提及」按钮是另一个入口，两者共用**这个**函数）。
   *
   * ⚠️ 必须能异步：候选要查库 / 发请求。不传时**不挂自动补全**。
   */
  mentionCandidates?: () => Promise<MentionCandidate[]>
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
 * 因为 `undo` / `syntaxTree` 这些也是从**同一个构建产物**（`@nexusmc-cn/nexusdown/cm`）
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
         * `mathRenderer` / `mentions` 一路透传下去，最终进 math 功能与 mention 功能。
         * 不传时 `nexusdown()` 的行为与没有这些参数时**一字不变**。
         */
        nexusdown({
          mathRenderer: options.mathRenderer,
          mentions: options.mentions,
          mentionCandidates: options.mentionCandidates,
        }),

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
          // 外部换稿等待组字结束时，旧稿的组字更新不能回填并覆盖这个请求。
          // flush 会先清除等待值，再发布新稿，所以新稿仍只回调一次。
          if (u.docChanged && !pendingSync.has(u.view)) options.onDocChange?.(u.state.doc.toString())
        }),

        /*
         * ★ **组字结束时，补上组字期间欠下的那次同步** ✓。
         *
         * 组字期间 `setEditorValue` 会**主动让路**（见那里的注释 ✓），
         * 但"让路"不能变成"丢掉" ✗ —— 外部真的改了内容时（比如切草稿 ✓），
         * 组字一结束就该补上 ✓。
         */
        EditorView.domEventHandlers({
          compositionend: (_e, view) => {
            // 交给微任务：让 CM6 先把 composition 的收尾做完 ✓
            queueMicrotask(() => flushPendingSync(view))
            return false
          },
        }),
      ],
    }),
    parent: options.parent,
  })

  return view
}

/** 全文换稿要丢弃旧稿的 undo 和 redo；同值 v-model 回填不会走到这里。 */
const emptyHistory = EditorState.create({ extensions: [historyField] }).field(historyField)
const historyResets = new WeakMap<EditorView, Compartment>()

function resetHistoryOnReplacement(view: EditorView): StateEffect<unknown> | null {
  if (view.state.field(historyField, false) === undefined) return null

  let compartment = historyResets.get(view)
  if (!compartment) {
    compartment = new Compartment()
    // 首次换稿时才安装，以免每次普通输入都多带一个动态配置。
    view.dispatch({ effects: StateEffect.appendConfig.of(compartment.of([])) })
    historyResets.set(view, compartment)
  }

  // historyField 没有清空 effect；重新配置 init provider 会重建它的值。
  return compartment.reconfigure(historyField.init(() => emptyHistory))
}

/**
 * 从外部换掉整篇内容。
 *
 * 内容相同时不产生编辑事务，避免「回填 → onDocChange → 再回填」循环。
 * 组字期间延迟应用最后一次全文替换，并暂停旧稿的后续 onDocChange 回流；
 * 外部换稿优先于这些旧稿输入。本接口不支持组字中逐步自动规范化全文，
 * 调用方应在组字结束后再做这类替换。实际换稿清除旧文档的源码编辑意图与撤销栈。
 */
export function setEditorValue(view: EditorView, value: string): void {
  // 每次调用都是最新外部值，值相同时也要取消已经过期的待同步内容。
  pendingSync.delete(view)
  if (view.state.doc.toString() === value) return

  /*
   * ⚠️⚠️ **输入法正在组字时，绝对不能 dispatch** ✗✗
   *
   * 中文/日文输入时浏览器会进入 composition 状态 ✓，此时**拼音还没进文档** ✗，
   * 但**已经在 DOM 里了** ✓（CM6 就是这么设计的，不然会打断输入法 ✓）。
   *
   * 这时候一旦 dispatch：
   * - composition 被打断 ✓
   * - 光标被重新映射 ✓ → **跳到别处** ✓（实测：用户在第一行打字 ✓，
   *   字跑到了文档末尾的新行 ✓）
   *
   * 所以组字期间**只记下"欠一次同步"** ✓，等 `compositionend` 再补 ✓
   * （见下面的 `compositionend` 监听 ✓）。
   */
  // `composing` 要等第一次 DOM 改动才为 true；compositionstart 后就必须让路。
  if (view.compositionStarted) {
    pendingSync.set(view, value)
    return
  }

  const historyReset = resetHistoryOnReplacement(view)
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    effects: [
      setEditingRange.of(null),
      setEditingBlock.of(null),
      ...(historyReset ? [historyReset] : []),
    ],
    annotations: Transaction.addToHistory.of(false),
  })
}

/**
 * 待同步值属于各自的编辑器；WeakMap 不阻止已销毁的实例回收。
 * `undefined` 表示没有等待值，空字符串仍然是有效的同步内容。
 */
const pendingSync = new WeakMap<EditorView, string>()

/**
 * 补上组字期间欠下的同步。
 *
 * ⚠️ 必须等 `compositionend` **之后**再补 ✓ —— 组字一结束，文档就完整了 ✓，
 * 这时候比对才有意义 ✓（组字中途比对一定不相等 ✗）。
 */
export function flushPendingSync(view: EditorView): void {
  const value = pendingSync.get(view)
  if (value === undefined) return
  setEditorValue(view, value)
}
