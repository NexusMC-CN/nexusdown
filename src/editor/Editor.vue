<script setup lang="ts">
/**
 * `<NexusdownEditor>` —— **成品编辑器**：CM6 宿主 + 工具栏 + 正文排版。
 *
 * ## 它负责什么
 *
 * | 负责 | 不负责 |
 * | --- | --- |
 * | 挂载 / 销毁编辑器 | 页面布局（标题、标签、提交按钮 —— 那是应用的） |
 * | 把 view 递给工具栏 | 数据来源（草稿、校验、提交） |
 * | **正文排版**（下面那段 CSS） | 站点主题（靠 `--nd-*` 令牌桥接） |
 * | `v-model` 双向同步 | |
 *
 * ## ★★ 最重要的一条：**这个文件不许创建任何 CM6 对象**
 *
 * 它是**以原始 `.vue` 形式发给消费方**的，import 由**消费方的打包器**解析。
 * 一旦这里出现 `new EditorView(...)` / `EditorState.create(...)` / `keymap.of(...)`，
 * 就会变成：**`EditorState` 来自消费方解析出的一份 CM6，而 `nexusdown()` 的扩展
 * 来自另一份** → CM6 的 facet / StateField 按**模块标识**比较 → `instanceof` 对不上
 * → 报
 *
 * > `Unrecognized extension value in extension set ([object Object])`
 *
 * 而**扩展数组本身每一项都是合法的** —— 这个"矛盾组合"就是两份实例的铁证。
 * （实测：Nuxt 下必现，同样的包在纯 Vite 下正常。**改 import 路径治不了根** ✗ ——
 *   只要还有"跨模块边界创建 CM6 对象"，就永远取决于消费方打包器怎么解析。）
 *
 * **正解**：建视图的动作整个收进 `mountEditor()`（`src/cm/mount.ts`，
 * 会被打进 `dist/` ✓）。这个文件只传 `parent` / `doc` / 回调，
 * 拿到一个 view 再递给工具栏 —— **创建者和消费者同源** ✓，
 * 无论消费方那边有几份 CM6 都不会冲突。
 *
 * ⚠️ **允许"持有并传递" view，不允许"创建"** —— 工具栏要用它
 * （`undo(view)` / `syntaxTree(view.state)`），而 `undo` / `syntaxTree`
 * 也是从同一个 `nexusdown/cm` 来的 ✓。
 */
import type { EditorView, MentionCandidate, MentionResolutions } from 'nexusdown/cm'
/*
 * ⚠️ **只 import type**（同上一行的 `EditorView`）—— `KatexLike` 是纯类型，
 * 编译期就被擦掉，不会变成运行时 import，也就不会把"第二份 CM6 / markdown-it"
 * 引回来。`nexusdown/render` 与 `nexusdown/cm` 共用同一个 `KatexLike` 定义，
 * 保证这个 prop 的渲染函数能**原样**同时喂给编辑器和渲染器。
 */
import type { KatexLike } from 'nexusdown/render'
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
  /**
   * 数学渲染函数（可选）—— 注入后块级 ` ```math ` 围栏在编辑器里就显示成公式。
   *
   * 形状与渲染侧 `KatexLike` 一致，消费方可以把**同一个 katex 对象**同时喂给
   * 编辑器和渲染器（见 `mount.ts` / `features/math.ts`）。不传时**不报错**：
   * 块级公式退回普通代码块。
   *
   * ```vue
   * <NexusdownEditor v-model="text" :math-renderer="katex" />
   * ```
   */
  mathRenderer?: KatexLike
  /**
   * 提及候选（可选）—— 注入后工具栏的「提及」按钮会打开一个可搜索的选择器。
   *
   * **必须能异步**（返回 Promise）：候选可能要发请求去查库，而**库不查库**
   * （同 `mathRenderer` / 渲染侧的 `RenderData`）—— 「有哪些 slug 可提及」
   * 是消费方的事，库只认 `@slug` 这个语法。
   *
   * 不传时**不报错**：「提及」按钮照样在，只是降级成"落一个 `@`"
   * （编辑器侧的提及是纯语法的，打 `@slug` 就渲染成胶囊，不依赖候选）。
   *
   * ```vue
   * <NexusdownEditor v-model="body" :mention-candidates="loadMentionCandidates" />
   * ```
   */
  mentionCandidates?: () => Promise<MentionCandidate[]>
  /**
   * 提及解析结果（可选）—— 注入后编辑器里的提及卡片和**发布侧长得一样**
   * （标题 / 图标 / 角标 / 缩略图）。
   *
   * ★ 形状和渲染侧 `RenderData.mentions` **完全一致**
   * （`ReadonlyMap<string, MentionResolution>`），消费方把同一份数据喂给两侧即可：
   *
   * ```vue
   * <NexusdownEditor v-model="body" :mentions="renderData.mentions" />
   * ```
   *
   * **和 `mentionCandidates` 是两件事**：那个是工具栏选择器的候选（异步、可搜索），
   * 这个是**卡片显示用的解析结果**（同步、按 slug 查）。库不查库，两个都由消费方给。
   *
   * 不传时**不报错**：卡片只显示源码 slug（**不画空的图标方块**）。
   */
  mentions?: MentionResolutions
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
 */
const view = shallowRef<EditorView | null>(null)

/** 挂载失败时给用户看的话。 */
const error = ref('')

/**
 * 缓存的引擎模块。
 *
 * ⚠️ 只动态 import 一次、之后复用 —— 不要在 `watch` 里反复 `await import()`：
 * 那样每次都要过一次模块解析，而且会让同步逻辑变成异步竞态。
 */
let engine: typeof import('nexusdown/cm') | null = null

/**
 * 挂载。
 *
 * ⚠️ **依赖是动态 `import()`** —— 这个组件在 SSR 阶段会被求值（模板要渲染），
 * 而 CM6 需要 DOM（`@codemirror/view` 在模块顶层就建样式表）。
 * 动态 import 保证 Node 侧一行都不执行，也顺带把它拆出主包。
 * SSR 渲染出来的是一个空容器，挂载后才长出来 —— **不会有 hydration 警告**。
 *
 * ★ **建视图的动作在 `mountEditor()` 里**，这个文件不碰 CM6 的任何构造器。
 */
async function mount(): Promise<void> {
  const el = host.value
  if (!el) return

  try {
    engine = await import('nexusdown/cm')
    view.value = engine.mountEditor({
      parent: el,
      doc: props.modelValue,
      onDocChange: (value) => emit('update:modelValue', value),
      mathRenderer: props.mathRenderer,
      mentions: props.mentions,
    })
  } catch (e) {
    /*
     * ⚠️ **先打原始报错**。
     *
     * 顺序很重要：曾经把诊断信息放前面，结果从控制台复制时只拿到诊断，
     * **原始报错在页面文字里**（`error.value`）没被带上 —— 白排查一轮。
     * 让最容易漏的东西排在**第一行**。
     */
    console.error('[nexusdown] 编辑器初始化失败：', e)
    error.value = `编辑器没能加载：${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * 外部改 `modelValue`（比如载入草稿）→ 同步进编辑器。
 *
 * `setEditorValue` 内部会**比对内容**再决定要不要 dispatch ——
 * 不比对就会「回填 → 触发 onDocChange → 再同步」死循环。
 *
 * 有了这条，消费方**不用再管"先恢复草稿还是先挂载编辑器"**那个隐式顺序约定。
 */
watch(
  () => props.modelValue,
  (next) => {
    if (!engine || !view.value) return
    engine.setEditorValue(view.value, next)
  },
)

onMounted(mount)

onBeforeUnmount(() => {
  /*
   * ⚠️ **必须 destroy**：CM6 挂了一堆 DOM 监听（resize / selectionchange / 滚轮），
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
    <NexusdownToolbar :view="view" :mention-candidates="mentionCandidates" />

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
 */
.nd-editor :deep(.cm-content) {
  font-family: var(--nd-font-body, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  font-size: var(--nd-font-size, 14.5px);
  padding: 18px 28px 28px;
}

.nd-editor :deep(.cm-scroller) {
  line-height: var(--nd-line-height, 1.8);
}

/* 标题字号 —— 和显示侧一致 */
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
