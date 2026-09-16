# nexusdown

基于 Tiptap 的双视图富文本与 Markdown 编辑器。核心会话保持纯 TypeScript，Vue 3 组件作为独立适配层。

## Vue 用法

```ts
import NexusdownEditor from 'nexusdown/vue'
import 'nexusdown/style.css'
```

`nexusdown/vue` 会默认导出 `NexusdownEditor`，同时具名导出 `EditorToolbar`、`HeadingPicker`、`LinkPicker`、`ColorPicker`、`ImagePicker`、`MarkdownEditor`、`TableControls`、`CodeBlockLanguage`、`FindReplacePanel`、`EditorStatusBar` 和 `useNexusdownTheme`。

该入口以未编译的 SFC 源码发布，需要由**宿主项目的构建工具**（Vite、webpack + vue-loader 等）连同宿主自己的 Vue 运行时一起编译，以保证只存在一份 Vue 实例。因此它不能直接被 Node 的 `require`/`import` 加载，也无法脱离打包器使用——这是有意为之，请不要在纯 Node 环境中 `import 'nexusdown/vue'`。核心逻辑（`nexusdown/core`）则是预编译产物，可在 Node 中直接使用。

在应用中直接使用 `NexusdownEditor`、`v-model` 和 `contentType="markdown"`。组件提供共享工具栏、富文本面板和带语法高亮的 Markdown 面板。

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
- **`480px` 以下编辑器高度自动收缩**（`height: auto` + `max-height`），横屏小视口也能完整显示。
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

默认扩展已包含文字颜色、高亮、下划线、上下标、Typography、Placeholder、字符统计、任务列表、可调列宽表格、图片节点和 Lowlight 代码块。编辑器内置以下能力：

- 表格增加/删除行列、删除整表、合并/拆分单元格和拖拽列宽
- 图片 URL、本地上传、base64 回退、粘贴与拖拽插入
- `Ctrl/Cmd+F` 查找替换、上下一个结果、大小写敏感和全部替换
- 纯文本/结构化粘贴模式切换
- 常用代码语言选择、Markdown fenced code 往返和语法高亮
- 字符数、不含空格字符数和文本行数状态栏

文字颜色优先使用可解析的 `[color color="#2563eb"]文本[/color]` 短代码语法，无法安全表达的复杂 CSS 颜色才回退为 `<span style="color: ...">...</span>`，右侧镜像会按实际颜色显示。工具栏模型可通过 `createDefaultToolbarItems()` 继续扩展。发布前运行 `npm run pack:check`。

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
