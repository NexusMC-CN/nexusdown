# Nexusdown 可视化 Markdown 编辑器设计规格

## 目标

构建一个可发布为单个 npm 包 `nexusdown` 的 TypeScript 编辑器，基于 Tiptap 内核提供富文本编辑和 Markdown 编辑双视图。Vue 3 是首个 UI 适配层，核心 API 不绑定 Vue，后续可以迁移到其他框架。

首版聚焦稳定的双向编辑体验：左侧为富文本编辑器，右侧为 Markdown 编辑器，两个编辑器共用一个顶部工具栏。工具栏采用分组单行布局，视觉上参考 Tiptap 官方 Simple Editor 模板，并使用 Iconify 渲染图标。

## 范围

首版支持：

- 标题、段落和分隔线；
- 粗体、斜体、删除线、行内代码；
- 链接；
- 引用；
- 无序列表、有序列表和任务列表；
- 代码块；
- 撤销和重做；
- Markdown 初始化、编辑、解析和序列化；
- HTML、Markdown、Tiptap JSON 三种内容读取方式；
- 自定义工具项和扩展入口。

首版不包含图片上传、表格、评论、协作、目录、搜索替换、持久化服务和后端接口。它们必须通过扩展点接入，而不是隐藏在基础实现中。

## 参考与许可

视觉和交互参考 Tiptap 官方 [Simple Editor 模板](https://tiptap.dev/docs/ui-components/templates/simple-editor) 以及其公开的 [tiptap-ui-components 仓库](https://github.com/ueberdosis/tiptap-ui-components)。参考内容包括响应式编辑器容器、顶部工具栏分组、按钮 active/disabled 状态、编辑区排版层级和明暗主题变量。

实现不复制与本项目无关的 React 组件或模板业务逻辑，只移植可解释的视觉结构和交互约定。若直接复用 MIT 许可代码，必须保留原作者版权和许可声明，并在项目 `NOTICE` 中记录来源。Tiptap 官方开源代码使用 MIT 许可证，项目自身也采用 MIT 许可证。

## 架构

### 单包与内部边界

发布物只有一个包 `nexusdown`，通过子路径导出保持边界清晰：

```text
nexusdown/core   纯 TypeScript 会话与命令 API
nexusdown/vue    Vue 3 双视图组件与工具栏
nexusdown/style.css
```

核心依赖 `@tiptap/core`、`@tiptap/starter-kit`、`@tiptap/markdown` 及首版所需的官方扩展。Vue 绑定放在 `@tiptap/vue-3`，Iconify 使用 `iconify-icon` Web Component。核心模块不能导入 Vue、DOM 组件或 Iconify。

### 核心会话

核心导出 `createNexusdownEditor(options)`，返回一个 `NexusdownEditorSession`：

```ts
interface NexusdownEditorSession {
  getMarkdown(): string
  getHTML(): string
  getJSON(): JSONContent
  setMarkdown(markdown: string): void
  setContent(content: ContentValue, contentType?: ContentType): void
  focus(): void
  undo(): boolean
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean
  subscribe(listener: NexusdownUpdateListener): () => void
  destroy(): void
}
```

`ContentValue` 支持 HTML、Markdown 字符串和 Tiptap JSON。`ContentType` 明确标记输入类型，不依赖字符串猜测。

### 内容数据流

Tiptap JSON 是内部规范化状态，Markdown 是用户可直接编辑的外部表示。

```text
富文本输入
  -> Tiptap transaction
  -> JSON / HTML / Markdown snapshot
  -> update 事件和右侧 Markdown

Markdown 输入
  -> Markdown.parse
  -> Tiptap setContent
  -> 富文本渲染和 update 事件
```

每次更新带来源 `rich-text` 或 `markdown`。更新桥使用来源标记和当前快照去重，避免两个编辑器互相触发无限循环。Markdown 输入更新采用轻量 debounce，失焦或显式提交时立即刷新；解析错误不会覆盖用户原文，会触发 `parse-error` 事件并保留上一份有效 Tiptap 文档。

### Vue 组件

Vue 入口提供 `NexusdownEditor` 组件：

```vue
<NexusdownEditor
  v-model:markdown="markdown"
  :content-type="'markdown'"
  @update="handleUpdate"
  @parse-error="handleParseError"
/> 
```

组件内部只负责 DOM 生命周期、双栏布局、textarea 输入和工具栏渲染。编辑命令通过核心会话暴露，不在模板中直接操作 ProseMirror 状态。卸载时必须调用 `destroy()` 并移除所有订阅。

## 工具栏

工具栏由可配置的 `ToolbarItem` 描述驱动，每项包含稳定的 `id`、分组、Iconify 图标名、无障碍标签、active/disabled 计算和执行函数。

默认分组如下：

1. 历史：撤销、重做；
2. 块级：标题、引用、无序列表、有序列表、任务列表、代码块、分隔线；
3. 行内：粗体、斜体、删除线、行内代码、链接；
4. 扩展：预留插槽，不默认渲染未实现功能。

单行工具栏在容器宽度不足时允许低频分组进入溢出菜单，但不改变命令模型。按钮必须具备键盘焦点、tooltip、active 态、disabled 态和稳定尺寸。

## 样式

样式参考 Simple Editor 的中性白底、细边框、紧凑工具栏和清晰内容排版，但使用项目自己的 CSS 变量，避免依赖 Tiptap 模板的 React、Tailwind 或应用级路径。

- 工具栏固定在双视图顶部；
- 双视图在桌面端左右各占 50%，窄屏降为上下布局；
- 富文本区使用可读的内容宽度和段落间距；
- Markdown 区使用等宽字体、行号可选但首版不默认添加；
- 支持明暗主题变量，不把主题逻辑写入核心会话；
- Iconify 图标只在 UI 层加载，并为 Web Component 设置稳定宽高，避免布局跳动。

## 错误处理

- Markdown 解析失败：保留原始 Markdown，触发 `parse-error`，富文本保持上一份有效文档；
- 空链接或无效链接：不执行命令，触发可观察的命令失败事件；
- 已销毁会话：公开方法返回明确错误或安全短路，不访问已释放的 Tiptap 实例；
- 不支持的 Markdown 节点：依照 Tiptap schema 降级为纯文本或段落，并在序列化测试中固定结果。

## 测试验收

核心测试必须覆盖：

- Markdown 初始化后富文本和 Markdown 快照一致；
- 富文本变更能更新 Markdown；
- Markdown 变更能更新富文本；
- 连续同步不会产生循环更新；
- 解析错误保留原文并发出错误事件；
- 撤销和重做返回正确状态；
- `destroy()` 后订阅和编辑器资源被清理。

Vue 测试必须覆盖：

- 左右两个编辑表面和共享工具栏都能渲染；
- 工具栏点击调用对应命令并更新 active/disabled 状态；
- 两侧输入同步且不会覆盖正在编辑的 Markdown 文本；
- 组件卸载不会留下更新监听器。

发布验收必须运行类型检查、单元测试、构建、`npm pack --dry-run` 和最小 Vue 消费示例，确认包内包含 ESM、CJS、类型声明、CSS 和许可说明。

## 非目标

本规格不承诺协作编辑、服务端持久化、图片存储、富媒体上传、权限控制、评论或生产环境的文档管理。上述能力只能在后续规格中单独设计。
