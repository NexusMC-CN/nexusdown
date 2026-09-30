# nexusdown

基于 Tiptap 的双视图富文本与 Markdown 编辑器。核心会话保持纯 TypeScript，Vue 3 组件作为独立适配层。

## 渲染 Markdown：请用 `nexusdown/render`

**nexusdown 是编辑器，不是 Markdown 渲染器。** 它产出 Markdown，但不负责把 Markdown 显示成 HTML。需要显示时请使用同包的 `nexusdown/render`，**不要再另外安装 markdown-it、marked 之类的 Markdown 库**：`renderMarkdown` 内部就是**一份配置好的 markdown-it**，方言按编辑器实际产出的 Markdown 逐条对齐（包括 `==高亮==` 这类自定义语法），输出的 HTML 形状也与编辑器一致。

两边**不再是同一份实现**：编辑器的解析器是 Tiptap 扩展，渲染端是 markdown-it 插件。改方言时要同时改两处——`src/core/extensions/` 和 `src/render/`，`tests/render/` 里对应的用例就是防止漏改的那道闸。

```ts
import { renderMarkdown } from 'nexusdown/render'

const html = renderMarkdown('# Hello **world**')
// => '<h1>Hello <strong>world</strong></h1>'
```

`renderMarkdown(markdown, options?)` 同步执行、不依赖 DOM（不碰 `window` / `document`），因此可以直接在 Nuxt / Astro 的服务端渲染阶段调用。空字符串或纯空白输入返回 `''`，而不是一个空段落。

需要额外语法时，传一个 markdown-it 插件进来即可（插件在默认规则之后应用，所以可以覆盖任何内置规则）：

```ts
import { renderMarkdown, type MarkdownItPlugin } from 'nexusdown/render'

const badge: MarkdownItPlugin = (md) => {
  md.inline.ruler.before('emphasis', 'badge', (state, silent) => {
    const match = /^!!([^!]+)!!/.exec(state.src.slice(state.pos))
    if (!match) return false
    if (!silent) {
      state.push('badge_open', 'span', 1).attrSet('data-badge', '')
      state.push('text', '', 0).content = match[1]
      state.push('badge_close', 'span', -1)
    }
    state.pos += match[0].length
    return true
  })
}

const html = renderMarkdown('!!新语法!!', { plugins: [badge] })
```

自定义语法要在编辑器侧和渲染端各写一份（编辑器写 Tiptap 扩展，渲染端写 markdown-it 插件）。请传入**稳定的数组引用**：解析器按数组身份缓存，每次调用都新建数组会不断重建。

### 方言契约：只产标准 Markdown + GFM

nexusdown 的编辑器**只产出标准 Markdown + GFM**，也只接受同样的方言：

- **不产 BBCode**：`[color color="#2563eb"]…[/color]` 之类的短代码已彻底移除。
- **不产 HTML 标签**：没有 `<br>`、没有 `<span style="color: ...">`。硬换行使用 Markdown 自身的行尾双空格语法。

支持的语法：

- 标题（`#` ～ `######`）
- 粗体、斜体、删除线、行内代码
- 高亮（`==文字==`，Obsidian / `markdown-it-mark` 的写法，不是 GFM）
- 代码块（围栏式，带语言标注）
- 引用（`>`）
- 有序列表、无序列表
- 任务列表（`- [ ]` / `- [x]`，仅无序列表）
- 链接、图片
- GFM 表格（管道表）
- 水平线（`---`）
- 硬换行
- 自动链接（`https://…`、`www.…`、`a@b.com`；裸域名 `example.com` **不会**变成链接，因为 `.md`、`.sh`、`.zip` 都是真实 TLD，`README.md` 必须还是文件名）

没有标准 Markdown 语法的格式——**文字颜色、对齐、下划线、上标、下标**——已被移除：编辑器不再提供入口，也不会把它们偷偷写成 HTML 或短代码。

### ⚠️ 安全声明：`renderMarkdown` 不做 HTML 消毒

`renderMarkdown` **不对输出做 HTML 消毒**。返回的字符串就是可直接插入页面的 HTML（例如通过 Vue 的 `v-html`），因此**只对可信输入安全**：

- **可信**：nexusdown 编辑器自己产出的 Markdown，或由站点运营方撰写的内容。
- **不可信**：终端用户粘贴的任意 Markdown 或原始 HTML。图片的 `src`、链接的 `title` 等**属性值**会原样输出，只有引号会被转义。

两条防线值得记住，`tests/render/` 里有对应用例：

1. **`html: false`**——输入里的原始 HTML 一律转义成文本，不会被透传。`<script>alert(1)</script>` 出来是 `&lt;script&gt;alert(1)&lt;/script&gt;`。
2. **链接协议白名单**——`javascript:`、`vbscript:`、`data:` 由 markdown-it 自己的 `validateLink` 拦下。被拦下的链接**降级为字面文本**（`[x](javascript:alert(1))` 原样显示），不会变成 `<a>`。

这两条都不是消毒器。如果要接受不可信输入，请在插入前用消毒器（如 DOMPurify）处理结果。

## CodeMirror 6 引擎（`nexusdown/cm`）

`nexusdown` 有**两条并存的编辑器路线**，互不影响：

| 入口 | 引擎 | 数据模型 |
| --- | --- | --- |
| `nexusdown/vue` | Tiptap（ProseMirror） | 节点树，Markdown 只是导入/导出的往返格式 |
| `nexusdown/cm` | CodeMirror 6 | **Markdown 文本就是唯一真相**，装饰层只改显示 |

`nexusdown/cm` 是 **Live Preview**（类似 Obsidian）：文档始终是一份 Markdown 文本，光标所在行「揭示」原始标记（`**`、`#`、围栏），其余行把标记藏起来、把内容渲染成富文本外观。因为不存在节点树，它不会「导入即重排」，也不存在 Markdown 往返丢失。

### 最小可用示例

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { nexusdown } from 'nexusdown/cm'
import 'nexusdown/cm/theme.css'

const host = ref<HTMLDivElement | null>(null)
const model = ref('# Hello from CodeMirror\n\n试试 **加粗**、`行内代码`。')
let view: EditorView | null = null

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: model.value,
      // ★ nexusdown() 已经带上撤销栈、光标绘制、当前行高亮和基础语法着色，
      //   开箱即用；这里只需要再拼上自己的扩展。
      extensions: [
        nexusdown(),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) model.value = u.state.doc.toString()
        }),
      ],
    }),
  })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div ref="host" class="editor" />
</template>

<style scoped>
.editor { min-height: 320px; }
</style>
```

`nexusdown()` 返回一个 `Extension`（数组），可以和任何其它 CM6 扩展拼在一起。它**已经包含**：

- `history()` + `keymap.of(historyKeymap)` —— `Mod-z` / `Mod-y` / `Mod-Shift-z` 撤销重做（historyKeymap 排在自定义 keymap 之前）
- `drawSelection()` —— ⚠️ CM6 默认不画光标，正是这一条让插入点可见
- `highlightActiveLine()` —— 当前行高亮
- `syntaxHighlighting(defaultHighlightStyle, { fallback: true })` —— 代码块基础着色（**不需要** language-data）
- `EditorView.lineWrapping`、多选区、`markdownKeymap`（`Mod-b` / `Mod-i` / `` Mod-` `` / 列表内 `Enter`）、`Mod/Cmd + 点击`打开链接

**不必**再套一层 `basicSetup`：它会引入重复的 keymap 和整套搜索/折叠 UI（重复的 `history()` 本身是安全的，但没必要）。

### 必须引入的样式

`nexusdown/cm/theme.css` **必须**由宿主构建工具引入一次：

```ts
import 'nexusdown/cm/theme.css'
```

它提供标题、代码块、引用、链接、widget 的视觉规则，以及 `:root` 上的颜色变量（`--nd-text`、`--nd-brand`、`--nd-caret`、`--nd-active-line` …）。每个颜色都是 `var(--nd-*, var(--站点令牌, 字面量))` 的两级回退：站点在 `:root` 定义 `--ink-1` / `--border` / `--surface` / `--brand-ink` 就会自动跟随主题，也可以直接覆盖 `--nd-*`。

> ⚠️ **不要用 `caret-color` 改光标颜色。** `drawSelection()` 会注入 `.cm-content { caret-color: transparent !important }` 并自绘 `.cm-cursor`，光标颜色只能改 `border-left-color` —— `theme.css` 已经用 `--nd-caret` 接管了这条规则。

### 可选依赖：`@codemirror/*` 与 `@lezer/*`

`@codemirror/commands`、`@codemirror/lang-markdown`、`@codemirror/language`、`@codemirror/state`、`@codemirror/view`、`@lezer/common`、`@lezer/markdown` 都是 **peerDependencies（optional）**，由消费方自己安装：

```bash
pnpm add @codemirror/state @codemirror/view @codemirror/language @codemirror/commands @codemirror/lang-markdown @lezer/common @lezer/markdown
```

> ⚠️ **必须是同一份实例。** CM6 的 facet / StateField 按**模块标识**比较（即「同一个 `@codemirror/state` 导出的对象」）。如果依赖树里存在两份 `@codemirror/state`，facet 会**静默失配**：装饰不渲染、配置不生效，而且**不报任何错**。请确保 `nexusdown` 和宿主应用解析到同一份 `@codemirror/*`（pnpm 下通常用 `pnpm dedupe`，或把它们放进宿主的 `dependencies`）。

代码块语言高亮是**可选**的：不传 `codeLanguages` 也能正常解析围栏、隐藏围栏标记，只是没有注释/字符串这类高级 token 的颜色。要按语言着色再额外装 `@codemirror/language-data` 并传进去：

```ts
import { languages } from '@codemirror/language-data'
import { nexusdown } from 'nexusdown/cm'

nexusdown({ codeLanguages: languages })
```

### ⚠️ Vite / Nuxt 的坑：`optimizeDeps.include`

**实测踩到。** 当 `nexusdown` 是 pnpm 的 `file:` 软链包（`"nexusdown": "file:../nexusdown"`）时，Vite 把这个包当**源码**处理、不预构建它；但它的 peer 依赖 `@codemirror/*` 走的是**预构建**（`optimizeDeps`）。于是同一个 `@codemirror/language` 一份在预构建产物里、一份在源码图里 —— **两份实例**。

现象：编辑器能显示、能打字，但 **`syntaxHighlighting` 和装饰层全部静默失效**，控制台**没有任何报错**（就是上面「facet 静默失配」在 Vite 下的具体形态）。

修法是把 `@codemirror/language` 显式拉进预构建，让两边指向同一份：

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    include: ['@codemirror/language'],
  },
})
```

Nuxt 写进 `nuxt.config.ts`：

```ts
export default defineNuxtConfig({
  vite: {
    optimizeDeps: {
      include: ['@codemirror/language'],
    },
  },
})
```

若仍有装饰不渲染，把 `@codemirror/state`、`@codemirror/view` 也一并加进 `include`；或改用打包产物（`pnpm pack` / 从 registry 安装）绕开软链。

### 和 Tiptap 路线的区别

- **`nexusdown/vue`（Tiptap）**：文档是 ProseMirror 节点树，Markdown 是导入/导出的往返格式；具备斜杠菜单、块拖拽、表格 widget 这类**结构化**能力。
- **`nexusdown/cm`（CodeMirror 6）**：文档**就是** Markdown 文本，Markdown 是唯一真相；没有导入导出转换，不存在往返丢失。代价是**纯文本模型做不了结构操作**。

按需选一个入口即可，不必同时用。

### 已知缺口

CM6 是文本模型，以下能力**做不到**，属于设计边界而非 bug：

- 列表符号**不会**被替换成 `•`（`-` / `*` 原样保留，只调整缩进与样式）；
- 表格**没有 widget**，GFM 管道表就是普通文本；
- **没有斜杠菜单、没有块拖拽** —— 这些需要节点树，只有 Tiptap 路线（`nexusdown/vue`）具备。

## Vue 用法

### 基础导入

```ts
import NexusdownEditor from 'nexusdown/vue'
import 'nexusdown/style.css'
```

`nexusdown/vue` 会默认导出 `NexusdownEditor`，同时具名导出 `EditorToolbar`、`HeadingPicker`、`LinkPicker`、`ImagePicker`、`MarkdownEditor`、`TableControls`、`CodeBlockLanguage`、`FindReplacePanel`、`EditorStatusBar` 和 `useNexusdownTheme`。

该入口以未编译的 SFC 源码发布，需要由**宿主项目的构建工具**（Vite、webpack + vue-loader 等）连同宿主自己的 Vue 运行时一起编译，以保证只存在一份 Vue 实例。因此它不能直接被 Node 的 `require`/`import` 加载，也无法脱离打包器使用——这是有意为之，请不要在纯 Node 环境中 `import 'nexusdown/vue'`。核心逻辑（`nexusdown/core`）则是预编译产物，可在 Node 中直接使用。

在应用中直接使用 `NexusdownEditor`、`v-model` 和 `contentType="markdown"`。组件提供共享工具栏、富文本面板和带语法高亮的 Markdown 面板。

默认共享工具栏会测量编辑器容器宽度，将放不下的尾部工具收进「更多工具」，始终保持单行。`toolbarItems` 在各分组内的排列顺序也是显示优先级；自定义工具与分组会自动参与，无需针对设备单独配置。

组件支持 `theme="light"`、`theme="dark"` 或默认的 `theme="system"`，并且可以把 Tiptap 扩展注入编辑会话：

```vue
<NexusdownEditor
  v-model="value"
  theme="dark"
  :width="960"
  height="70vh"
  :sync-scroll="true"
  :show-status-bar="false"
  :extensions="[MyExtension]"
  :extension-resolver="extensions => extensions"
  paste-mode="plain"
  :image-upload="uploadImage"
  :max-file-size="5 * 1024 * 1024"
/>
```

`imageUpload(file)` 返回最终图片 URL；未提供时，本地图片会以内嵌 base64 保存。`maxFileSize` 以字节为单位，默认不限制；图片文件也可以直接粘贴或拖入富文本编辑区。`pasteMode` 默认是 `plain`，只保留剪贴板纯文本；工具栏可切换到 `structured`，保留剪贴板中的富文本结构。底部字符和行数状态栏默认显示，传入 `:show-status-bar="false"` 可隐藏它。

## Astro 用法

Nexusdown 可以通过 Astro 官方的 Vue 集成使用。`nexusdown/vue` 是宿主构建工具编译的 Vue SFC，因此 Astro 项目需要安装 `@astrojs/vue`，并为编辑器选择一个客户端 hydration 指令：

```bash
npx astro add vue
npm install nexusdown vue
```

在 Astro 页面中导入组件和样式，并使用 `client:load` 让编辑器在页面加载时 hydration：

```astro
---
import NexusdownEditor from 'nexusdown/vue'
import 'nexusdown/style.css'
---

<NexusdownEditor
  client:load
  modelValue="# Hello from Astro"
  contentType="markdown"
/>
```

编辑器依赖浏览器端的 Tiptap EditorView 和交互事件，不能在 Astro 服务端阶段直接操作。需要延迟加载时可以使用 `client:visible`，编辑器进入视口后再 hydration：

```astro
<NexusdownEditor
  client:visible
  modelValue="# Loaded when visible"
  contentType="markdown"
/>
```

需要双向绑定时，把 `NexusdownEditor` 放在 Vue `.vue` 组件中，在组件内使用 `ref` 和 `v-model`，然后由 Astro 页面以 `client:load` 或 `client:visible` 挂载该 Vue 组件。完整示例位于 `examples/astro-vue`，可运行 `npm run build:astro-example` 验证 Astro SSR 和 hydration bundle 构建。

## Nuxt SSR 用法

Nuxt 可以直接编译 `nexusdown/vue` 的 Vue SFC，并支持服务端渲染。Nuxt 页面中直接导入组件和样式即可，不需要用 `ClientOnly` 包裹：
```vue
<script setup lang="ts">
import { ref } from 'vue'
import NexusdownEditor from 'nexusdown/vue'
import 'nexusdown/style.css'

const value = ref('# Hello from Nuxt SSR')
</script>

<template>
  <NexusdownEditor v-model="value" content-type="markdown" />
</template>
```

编辑器会话在**客户端挂载阶段**创建 —— Tiptap 的 `Editor` 构造函数需要 `window`，所以它在服务端不存在。**服务端渲染的是编辑器外壳**：外层 `<section>`、两栏面板、Markdown 面板都会输出，而**工具栏、状态栏和富文本挂载点要等客户端挂载后才出现**（它们依赖会话）。

这对使用者是透明的：页面照常 SSR，不需要 `ClientOnly`，客户端挂载后编辑器自己起来。**展示已存的 Markdown 请不要用编辑器** —— 那是 `nexusdown/render` 的活，它不依赖 DOM，能在服务端跑。

> ⚠️ 如果要在单元测试里断言工具栏或 `[data-nexusdown="toolbar"]`，`mount()` 之后需要 `await nextTick()` —— 会话晚一帧建立。

完整示例位于 `examples/nuxt-ssr`，可运行 `npm run build:nuxt-example` 验证 Nuxt SSR 生产构建。CI 会在 Node 20、22、24 上构建该示例并检查 `.output/server/index.mjs`；该检查验证 SSR 构建链，不包含浏览器交互 E2E。

面板顺序默认是「左侧富文本、右侧 Markdown」（`layout="rich-left"`）。需要「左侧 Markdown、右侧富文本」时传入 `layout="markdown-left"`：

```vue
<NexusdownEditor
  v-model="value"
  layout="markdown-left"
  :sync-scroll="true"
/>
```

未知的 `layout` 值会安全回退到默认的 `rich-left`。编辑器默认高度为 `420px`、宽度为 `100%`，内容较长时会在两侧编辑区内部滚动，不会撑高外框；`width` 和 `height` 支持数字（像素）或 CSS 尺寸字符串，`syncScroll` 默认开启，可按需关闭双栏联动滚动。通过根节点的 `class` / `style` 可以覆盖边框、圆角、间距等外观，颜色主题使用稳定的 CSS 变量（`--nexus-bg`、`--nexus-panel`、`--nexus-border`、`--nexus-text`、`--nexus-muted`、`--nexus-accent`）作为换肤入口。

## 多设备与移动端

样式表内置了移动端适配，无需额外配置即可在手机和平板上使用：

- **双栏在 `760px` 以下自动堆叠为上下两栏**，并在此时放宽桌面端的 `min-height`，避免小屏上内容被强行撑高。
- **所有视口宽度都保留配置的编辑器高度**，包括 `480px` 以下的小屏；较长内容在编辑区内部滚动。
- **输入框在触控设备上使用 16px 字号**：低于 16px 时 iOS Safari 会在聚焦时强制缩放页面，且不易还原，因此这是正确性要求而非样式偏好。Markdown 高亮层的 `<pre>` 与 `<textarea>` 字号始终一致，保证高亮不错位。
- **`pointer: coarse` 设备上控件放大到 ≥44×44 CSS px**（WCAG 2.5.5 / Apple HIG 建议值），桌面端保持紧凑布局。
- **下拉菜单与查找面板跟随 `visualViewport`**：软键盘弹出时 iOS 常常不触发 `window.resize`，因此链接/图片/标题菜单与查找面板监听 `visualViewport` 并重新定位，避免与触发器脱节或被键盘遮挡。
- **底部条适配 `env(safe-area-inset-bottom)`**，避免落入 iPhone 底部手势区；触屏设备上的 `:hover` 样式被禁用，防止点击后高亮状态被“粘住”。

建议宿主页面使用以下 viewport 声明（`viewport-fit=cover` 用于刘海屏）；**不要**添加 `maximum-scale=1` 或 `user-scalable=no`：

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

拖拽插入图片依赖 HTML5 拖放事件，移动端浏览器不会由触摸手势触发，因此该能力在触屏设备上不生效；此时请使用工具栏的「上传本地图片」或图片地址输入框。

## 核心用法

```ts
import { createNexusdownEditor } from 'nexusdown/core'
const editor = createNexusdownEditor({ content: '# Hello', contentType: 'markdown' })
editor.setMarkdown('# Updated')
```

默认扩展已包含 Typography、Placeholder、字符统计、任务列表、可调列宽表格、图片节点和 Lowlight 代码块。编辑器内置以下能力：

- 表格增加/删除行列、删除整表、合并/拆分单元格和拖拽列宽（合并单元格在 Markdown 中没有对应语法，导出为 GFM 管道表时会被摊平）
- 图片 URL、本地上传、base64 回退、粘贴与拖拽插入
- `Ctrl/Cmd+F` 查找替换、上下一个结果、大小写敏感和全部替换
- 纯文本/结构化粘贴模式切换
- 常用代码语言选择、Markdown fenced code 往返和语法高亮
- 字符数、不含空格字符数和文本行数状态栏

工具栏模型可通过 `createDefaultToolbarItems()` 继续扩展。发布前运行 `npm run pack:check`。

## 自定义 Markdown 语法

传入的 Tiptap 扩展会自动交给 Markdown 管理器注册；扩展可以实现 `markdownTokenName`、`markdownTokenizer`、`parseMarkdown` 和 `renderMarkdown` 来定义自己的语法，复杂或未定义的内容仍可由 HTML 回退承载。相关字段类型可从 `NexusdownMarkdownExtensionConfig` 获取，扩展仍通过 `extensions` 传入编辑器。

⚠️ 这些钩子**只作用于编辑器**。`nexusdown/render` 走的是自己的 markdown-it 实例，要让自定义语法在展示端也生效，需要另写一个 markdown-it 插件并通过 `renderMarkdown(md, { plugins: [...] })` 传入——见上文「渲染 Markdown」。

```ts
const Badge = Mark.create({
  name: 'badge',
  markdownTokenName: 'badge',
  markdownTokenizer: { /* 识别 !!文本!! */ },
  parseMarkdown: (token, helpers) => helpers.applyMark('badge', helpers.parseInline(token.tokens ?? [])),
  renderMarkdown: (node, helpers) => `!!${helpers.renderChildren(node)}!!`,
})

createNexusdownEditor({ content: '!!新语法!!', contentType: 'markdown', extensions: [Badge] })
```
