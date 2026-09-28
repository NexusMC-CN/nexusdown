# nexusdown

基于 Tiptap 的双视图富文本与 Markdown 编辑器。核心会话保持纯 TypeScript，Vue 3 组件作为独立适配层。

## 渲染 Markdown：请用 `nexusdown/render`

**nexusdown 是编辑器，不是 Markdown 渲染器。** 它产出 Markdown，但不负责把 Markdown 显示成 HTML。需要显示时请使用同包的 `nexusdown/render`，**不要再另外安装 markdown-it、marked 之类的 Markdown 库**：`renderMarkdown` 与编辑器共用**同一套 Tiptap 扩展**，编辑器认识的语法渲染端一定认识，反之亦然，两者永不脱节；换成第二个解析器则会立刻分叉——编辑器写出的语法渲染端读不懂，渲染端接受的语法编辑器又写不出。

```ts
import { renderMarkdown } from 'nexusdown/render'

const html = renderMarkdown('# Hello **world**')
// => '<h1>Hello <strong>world</strong></h1>'
```

`renderMarkdown(markdown, options?)` 同步执行、不依赖 DOM（不碰 `window` / `document`），因此可以直接在 Nuxt / Astro 的服务端渲染阶段调用。空字符串或纯空白输入返回 `''`，而不是一个空段落。

需要额外语法时，把与编辑器相同的扩展传进来即可：

```ts
import { renderMarkdown } from 'nexusdown/render'
import { Badge } from './badge'

const html = renderMarkdown('!!新语法!!', { extensions: [Badge] })
```

`extensions` 的语义与编辑器的 `extensions` 选项完全一致，注册给编辑器的语法无需任何额外接线就能在这里解析。请传入**稳定的数组引用**：解析/渲染管线按数组身份缓存，每次调用都新建数组会不断重建内部的 Markdown 管理器。

### 方言契约：只产标准 Markdown + GFM

nexusdown 的编辑器**只产出标准 Markdown + GFM**，也只接受同样的方言：

- **不产 BBCode**：`[color color="#2563eb"]…[/color]` 之类的短代码已彻底移除。
- **不产 HTML 标签**：没有 `<br>`、没有 `<span style="color: ...">`。硬换行使用 Markdown 自身的行尾双空格语法。

支持的语法：

- 标题（`#` ～ `######`）
- 粗体、斜体、删除线、行内代码
- 代码块（围栏式，带语言标注）
- 引用（`>`）
- 有序列表、无序列表
- 任务列表（`- [ ]` / `- [x]`）
- 链接、图片
- GFM 表格（管道表）
- 水平线（`---`）
- 硬换行

没有标准 Markdown 语法的格式——**文字颜色、高亮、对齐、下划线、上标、下标**——已被移除：编辑器不再提供入口，也不会把它们偷偷写成 HTML 或短代码。

### ⚠️ 安全声明：`renderMarkdown` 不做 HTML 消毒

`renderMarkdown` **不对输出做 HTML 消毒**。返回的字符串就是可直接插入页面的 HTML（例如通过 Vue 的 `v-html`），因此**只对可信输入安全**：

- **可信**：nexusdown 编辑器自己产出的 Markdown，或由站点运营方撰写的内容。
- **不可信**：终端用户粘贴的任意 Markdown 或原始 HTML。链接会原样保留其 `href`（包括 `javascript:`），任何由用户控制属性值的扩展也会原样输出。

`@tiptap/static-renderer` 受 schema 约束，只输出各扩展 `renderHTML` 声明的标签，所以输入中的原始 HTML 不会被渲染器透传；但输入仍能影响**属性值**（URL、图片地址、标题）。`@tiptap/markdown` 在没有 `DOMParser` 时（服务端）把原始 HTML 降级为转义后的字面文本，有 `DOMParser` 时（浏览器）则按 schema 解析——两条路径都**不是**消毒器。如果要接受不可信输入，请在插入前用消毒器（如 DOMPurify）处理结果。

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

编辑器的 Tiptap 实例和浏览器事件会在客户端挂载阶段完成初始化，服务端阶段保留可渲染的编辑器结构。完整示例位于 `examples/nuxt-ssr`，可运行 `npm run build:nuxt-example` 验证 Nuxt SSR 生产构建。CI 会在 Node 20、22、24 上构建该示例并检查 `.output/server/index.mjs`；该检查验证 SSR 构建链，不包含浏览器交互 E2E。

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
