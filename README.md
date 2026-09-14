# nexusdown

基于 Tiptap 的双视图富文本与 Markdown 编辑器。核心会话保持纯 TypeScript，Vue 3 组件作为独立适配层。

## Vue 用法

```ts
import NexusdownEditor from 'nexusdown/vue'
import 'nexusdown/style.css'
```

在应用中直接使用 `NexusdownEditor`、`v-model` 和 `contentType="markdown"`。组件提供共享工具栏、富文本面板和带语法高亮的 Markdown 面板。

组件支持 `theme="light"`、`theme="dark"` 或默认的 `theme="system"`，并且可以把 Tiptap 扩展注入编辑会话：

```vue
<NexusdownEditor
  v-model="value"
  theme="dark"
  :width="960"
  height="70vh"
  :sync-scroll="true"
  :extensions="[MyExtension]"
  :extension-resolver="extensions => extensions"
/>
```

面板顺序默认是「左侧富文本、右侧 Markdown」（`layout="rich-left"`）。需要「左侧 Markdown、右侧富文本」时传入 `layout="markdown-left"`：

```vue
<NexusdownEditor
  v-model="value"
  layout="markdown-left"
  :sync-scroll="true"
/>
```

未知的 `layout` 值会安全回退到默认的 `rich-left`。编辑器默认高度为 `420px`、宽度为 `100%`，内容较长时会在两侧编辑区内部滚动，不会撑高外框；`width` 和 `height` 支持数字（像素）或 CSS 尺寸字符串，`syncScroll` 默认开启，可按需关闭双栏联动滚动。通过根节点的 `class` / `style` 可以覆盖边框、圆角、间距等外观，颜色主题使用稳定的 CSS 变量（`--nexus-bg`、`--nexus-panel`、`--nexus-border`、`--nexus-text`、`--nexus-muted`、`--nexus-accent`）作为换肤入口。

## 核心用法

```ts
import { createNexusdownEditor } from 'nexusdown/core'
const editor = createNexusdownEditor({ content: '# Hello', contentType: 'markdown' })
editor.setMarkdown('# Updated')
```

默认扩展已包含文字颜色、高亮、下划线、上下标、Typography、Placeholder、字符统计、任务列表、表格和图片节点；工具栏支持表格插入、图片 URL/替代文本弹窗以及链接编辑，光标进入表格后还会在表格底部和右侧提供增加行列的控件。文字颜色优先使用可解析的 `[color color="#2563eb"]文本[/color]` 短代码语法，无法安全表达的复杂 CSS 颜色才回退为 `<span style="color: ...">...</span>`，右侧镜像会按实际颜色显示。工具栏模型可通过 `createDefaultToolbarItems()` 继续扩展。发布前运行 `npm run pack:check`。

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
