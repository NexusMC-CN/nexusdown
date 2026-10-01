<script setup lang="ts">
/**
 * `<NexusdownEditor>` —— **成品编辑器**：CM6 宿主 + 工具栏 + 生命周期。
 *
 * ## 它负责什么
 *
 * | 负责 | 不负责 |
 * | --- | --- |
 * | 建/销毁 `EditorView` | 页面布局（标题、标签、提交按钮 —— 那是应用的） |
 * | 挂工具栏、把 `view` 递过去 | 数据来源（草稿、校验、提交） |
 * | **正文排版**（下面那段 CSS） | 站点主题（靠 `--nd-*` 令牌桥接，见下） |
 * | `v-model` 双向同步文档 | |
 *
 * ## 为什么正文排版在这里，而不是应用里
 *
 * 因为它是**这个库存在的理由**：换掉「源码 / 预览」切换的前提就是
 * **编辑器里看到的就是发出去的样子**。排版放在应用里，每个消费者都会自己写一份，
 * 写完就和渲染侧漂移了 —— 那正是 `nexusdown/render` 要消灭的问题。
 *
 * ## 主题怎么跟随站点（不用依赖任何设计系统）
 *
 * 这个组件的 CSS **只吃 `--nd-*` 令牌**。站点在自己的容器上桥接一次即可：
 *
 * ```css
 * .my-editor-frame {
 *   --nd-text: var(--ink-1);
 *   --nd-border: var(--border);
 *   --nd-editor-height: min(62vh, 560px);   // 想调高度也走令牌
 * }
 * ```
 *
 * `theme.css` 的 `:root` 里每个令牌都是 `var(--站令牌, 字面量)` 两级回退，
 * 所以**不桥接也能跑**，桥接只是把"跟随主题"这件事显式化。
 *
 * ## ⚠️ 这里不许依赖 `@nexusmc/annexus`
 *
 * 判据：**这个东西换个场景还有用吗？** 有 → annexus；只对编辑器有意义 → 这里。
 * 所以只用 annexus 的**令牌**（经 `--nd-*` 间接），不用它的组件。
 */
import type { EditorView } from 'nexusdown/cm'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import NexusdownToolbar from './Toolbar.vue'

/*
 * ★ **自己引主题**，消费方不用记得。
 *
 * `theme.css` 里有 CM6 的整套外观（`--nd-*` 令牌、光标、当前行、代码块、
 * 各种装饰的样式）。少了它编辑器是**能跑但难看** —— 那种"少了什么"最难查。
 *
 * 消费方重复引一次没关系（打包器会去重）。
 */
import '../cm/theme.css'

const props = defineProps<{
  /** 文档内容。配 `v-model` 用。 */
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

/** CM6 往这个容器里塞 DOM。 */
const host = ref<HTMLElement | null>(null)

/**
 * 编辑器实例。
 *
 * ⚠️ **必须 `shallowRef`**：`EditorView` 是个巨大的对象（state / DOM / 插件表），
 * 用 `ref` 会被 Vue **深度代理**，而 CM6 内部大量依赖 `===` 比较对象身份 ——
 * 那些比较会全部失效，而且是**静默**失效（不报错，就是行为不对）。
 * `shallowRef` 只代理 `.value` 这一层。
 *
 * 传给工具栏的也是它 —— 工具栏只读不写，不会有响应式陷阱。
 */
const view = shallowRef<EditorView | null>(null)

/** 挂载失败（动态 import 失败、扩展初始化抛错）时给用户看的话。 */
const error = ref('')

/**
 * 挂载。
 *
 * ⚠️ **依赖全是动态 `import()`** —— 这个组件在 SSR 阶段会被求值（模板要渲染），
 * 而 CM6 需要 DOM。动态 import 保证 Node 侧一行都不执行，也顺带把它拆出主包。
 * SSR 渲染出来的就是一个空容器，挂载后才长出来 —— **不会有 hydration 警告**。
 */
async function mount(): Promise<void> {
  const el = host.value
  if (!el) return

  /*
   * ⚠️ **必须在 `try` 外面声明。**
   *
   * 一开始写成了 `const extensionList = [...]` 在 `try` 里 —— `const` 是**块作用域**，
   * `catch` 看不见它，于是诊断代码自己抛 `ReferenceError`，
   * **把真正的报错盖掉了**（实测踩过：控制台只看到 `extensionList is not defined`）。
   *
   * 诊断代码**绝不能自己崩** —— 它的全部价值就是告诉你别处为什么崩。
   */
  let extensionList: unknown[] = []

  try {
    /*
     * ★ **只 import 一次，而且只 import 引擎。**
     *
     * 以前这里对 `@codemirror/state` / `view` / `commands` 各做了一次动态 import ——
     * 那是**四条独立的解析路径**，而 `nexusdown()` 来自第五条。
     * 只要有一条落到不同的模块实例上（pnpm 的隔离布局很容易造成），
     * 就会炸 `Unrecognized extension value in extension set`，
     * 或者更糟：**装饰静默失效**（不报错，就是不渲染）。
     *
     * ⚠️⚠️ **必须 import 构建产物（`nexusdown/cm`），不能 import 原始源码
     * （`../cm/index`）。**
     *
     * 这个文件是**以原始 `.vue` 形式发给消费方**的，它的 import 会由**消费方的
     * 打包器**解析 —— 解析权不在我们手里。实测：直接 import `@codemirror/*`
     * 或原始源码，在 Nuxt 里会拿到**第二份 `@codemirror/state`**
     * （报 `Unrecognized extension value in extension set`，
     * 而扩展数组本身每一项都是合法的 —— 这个组合本身就是"两个模块实例"的铁证）。
     *
     * 走 `nexusdown/cm` 之后：
     * - 解析权回到**包的 `exports`**（`dist/cm/index.js`，CM6 在里面是 external）
     * - 这个文件里**一个 `@codemirror/*` 都没有**，消费方的打包器无从分裂
     *
     * ⚠️ 仍然必须是**动态** import：`@codemirror/view` 在模块顶层就会碰 `document`
     * （建样式表），SSR 阶段静态 import 会直接崩。
     */
    const { EditorState, EditorView: View, keymap, defaultKeymap, nexusdown } =
      await import('nexusdown/cm')

    extensionList = [
      /*
       * ★ `nexusdown()` 返回的是**一个 Extension 数组**，里面已经有：
       * 语言（GFM markdown）→ live preview 装饰 → 自动换行 → 多光标
       * （`allowMultipleSelections` —— 命令的多光标安全靠它，见 `commands.ts`）
       * → 链接点击 → Markdown 快捷键 → 撤销栈 → `drawSelection()`
       * （**光标就是它画的**，没有它 `.cm-cursor` 这个元素根本不存在）
       * → 当前行高亮 → 基础语法着色 → baseTheme。
       *
       * 所以这里**不需要**再补 `history()` / `drawSelection()`。
       */
      nexusdown(),

      /*
       * `nexusdown()` **故意不含** `defaultKeymap`（它只带 `historyKeymap`
       * 和 Markdown 快捷键），补上是为了 `Mod-a` / `Mod-Backspace` / `Escape`
       * 这些编辑器里本该有的通用键。
       *
       * ⚠️ **顺序**：放在 `nexusdown()` **之后**，优先级低于它 ——
       * 保证 `Mod-b` 不会被通用键抢走。
       *
       * 不加 `indentWithTab`：那会把 Tab 吃掉（键盘用户再也跳不出编辑器）。
       */
      keymap.of(defaultKeymap),

      /*
       * 唯一的出口：把文档同步回 `v-model`。
       *
       * ⚠️ 只在 `docChanged` 时回填 —— 光标移动、选区变化也会触发
       * `updateListener`，不加判断的话每动一下光标就重算整篇字符串。
       */
      View.updateListener.of((u) => {
        if (u.docChanged) emit('update:modelValue', u.state.doc.toString())
      }),
    ]

    view.value = new View({
      state: EditorState.create({ doc: props.modelValue, extensions: extensionList }),
      parent: el,
    })

    /*
     * 只给开发环境留的抓手：验证脚本要读 `view.state.doc.toString()`。
     *
     * ⚠️ 必须挂到 window 上 —— CDP 的 `Runtime.evaluate` 摸不到 Vue 的闭包变量。
     * `import.meta.dev` 在生产构建里是常量 `false`，整段会被摇掉，不留到线上。
     */
    if (import.meta.dev) {
      ;(window as unknown as Record<string, unknown>).__cmView = view.value
    }
  } catch (e) {
    const original = e instanceof Error ? e.message : String(e)
    error.value = `编辑器没能加载：${original}`
    /*
     * ★ **把扩展数组逐项打出来。**
     *
     * CM6 那句 `Unrecognized extension value in extension set ([object Object])`
     * 只说"有个东西不是扩展"，**不说是什么** —— 而它的提示（"多个 @codemirror/state
     * 实例"）只是**猜测**，很容易把人带偏（本项目就被带偏过一次）。
     *
     * 所以这里自己解剖：每项的类型 + 有没有 CM6 的 `extension` 标记。
     * 控制台里一眼能看出是哪一项、是什么。
     */
    /*
     * ⚠️ **先打原始报错，再打解剖。**
     *
     * 顺序很重要：上一版把解剖放前面，结果用户复制控制台时只拿到解剖，
     * **原始报错在页面文字里**（`error.value`）没被带上 —— 白排查一轮。
     * 让最容易漏的东西排在**第一行**。
     */
    console.error('[nexusdown] 编辑器初始化失败：', e)
    console.error('[nexusdown] 扩展数组逐项（每项都该有 extension 标记）：')
    const walk = (items: unknown[], depth = 0) => {
      for (const item of items) {
        const pad = '  '.repeat(depth + 1)
        if (Array.isArray(item)) {
          console.error(`${pad}[Array(${item.length})]`)
          walk(item, depth + 1)
          continue
        }
        if (item === null || item === undefined) {
          console.error(`${pad}${String(item)}   ← 不是扩展`)
          continue
        }
        const ctor = (item as { constructor?: { name?: string } }).constructor
        const name = ctor?.name ?? typeof item
        const isExt = 'extension' in (item as object)
        console.error(`${pad}${name}${isExt ? '' : '   ← 不是扩展'}`)
      }
    }
    walk(extensionList)
  }
}

/**
 * 外部改 `modelValue`（比如载入草稿）→ 同步进编辑器。
 *
 * ⚠️ 必须比对当前内容再决定要不要 dispatch：`updateListener` 回填时
 * `modelValue` 也会变，不比对就会「回填 → 触发 watch → 再 dispatch」死循环。
 * 内容相同就直接返回。
 */
watch(
  () => props.modelValue,
  (next) => {
    const v = view.value
    if (!v || v.state.doc.toString() === next) return
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } })
  },
)

onMounted(mount)

onBeforeUnmount(() => {
  /*
   * ⚠️ **必须 destroy**：它挂了一堆 DOM 监听（resize / selectionchange / 滚轮），
   * 不销毁的话页面切走之后它们还在跑，而且持有着已经脱离文档的 DOM。
   */
  view.value?.destroy()
  view.value = null
})

/** 想直接操作编辑器（聚焦、读选区…）时用。 */
defineExpose({ view })
</script>

<template>
  <div class="nd-editor">
    <NexusdownToolbar :view="view" />

    <!--
      CodeMirror 自己往这个容器里塞 DOM。
      SSR 阶段这里是空的（编辑器是动态 import 的），挂载后才长出来。
    -->
    <div ref="host" class="nd-editor__content" />

    <p v-if="error" class="nd-editor__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.nd-editor {
  display: flex;
  flex-direction: column;
  /* 高度由内容区自己定（见下），这里不设 —— 免得和工具栏抢 */
  min-height: 0;
}

/* ---------------------------------------------------------------- 内容区 */

.nd-editor__content {
  /*
   * ⚠️ 高度走令牌，**不写死**：站点用 `--nd-editor-height` 调（比如 `min(62vh, 560px)`）。
   * 写死的话每个消费者都要用 `:deep()` 伸进组件内部改 —— 那是耦合。
   */
  height: var(--nd-editor-height, 420px);
  background: var(--nd-editor-bg, #fff);
  /* 编辑器不画自己的框 —— 外框由消费方的「纸 / 卡片」提供 */
  overflow: hidden;
}

.nd-editor :deep(.cm-editor) {
  height: 100%;
  background: var(--nd-editor-bg, #fff);
}

/* CM6 默认给聚焦的编辑器画一圈 outline，在纸/卡片里是多余的（外框已经有了） */
.nd-editor :deep(.cm-editor.cm-focused) {
  outline: none;
}

/*
 * ---------------------------------------------------------------- 正文排版
 *
 * ⚠️⚠️ **改这里等于改 WYSIWYG 的保真度。**
 *
 * 换掉「源码 / 预览」切换的前提就是**编辑器里看到的就是发出去的样子**。
 * CM6 默认是 `font-family: monospace` + `line-height: 1.4`、标题 `2em/1.6em/1.35em`，
 * 而渲染侧（`nexusdown/render`）产出的是普通正文 —— 两边对不上的话，
 * "不用切预览"就成了错觉。
 *
 * 所以这几条要**和显示侧的排版一起改**，别单独动。
 * （消费方通常还有自己的 `.md` 排版；两边对齐是消费方的责任，
 *   但编辑器这一侧的基准在这里。）
 */
.nd-editor :deep(.cm-content) {
  font-family: var(--nd-font-body, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  font-size: var(--nd-font-size, 14.5px);
  padding: 18px 28px 28px;
}

.nd-editor :deep(.cm-scroller) {
  line-height: var(--nd-line-height, 1.8);
}

/* 标题字号 —— 和显示侧一致（`theme.css` 里 `--nd-h*` 是编辑器装饰用的那套） */
.nd-editor :deep(.nd-h1) {
  font-size: 1.5em;
}

.nd-editor :deep(.nd-h2) {
  font-size: 1.3em;
}

.nd-editor :deep(.nd-h3) {
  font-size: 1.15em;
}

/* ---------------------------------------------------------------- 错误 */

.nd-editor__error {
  margin: 8px 0 0;
  color: var(--nd-danger, #cf222e);
  font-size: 0.9em;
}
</style>
