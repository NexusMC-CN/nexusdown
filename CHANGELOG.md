# Changelog

本文件记录本项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> 说明：`0.0.0` 及其之前的历史以「初始开发」集中记录，未按版本细分。

## [Unreleased]

### 新增

- **Markdown 感知粘贴**：粘贴模式新增 `'markdown'`，把剪贴板中的 Markdown 源码解析为富文本（标题、列表、表格、行内标记等），而不是作为字面文本插入。工具栏按钮改为在 `plain` → `structured` → `markdown` 之间循环切换。
- **`insertMarkdown(markdown)` 命令**：把 Markdown 解析后插入到当前选区。
- **纯文本导出 API**：新增 `session.getText()`，返回块级以换行分隔的纯文本，图片取 `alt` 文本。适合字数统计、搜索摘要、复制为纯文本等场景。
- **文本对齐**：新增 `setTextAlign(alignment?)` 命令与工具栏分组，支持左/中/右/两端对齐，不传参时清除对齐。Markdown 本身无对齐语法，因此以带内联样式的 HTML 块持久化，可在 `getMarkdown()` → `setMarkdown()` 往返中保留。
- **缩进**：新增 `indent()` / `outdent()` 命令与工具栏分组。列表内下沉/提升列表项，列表外调整段落与标题的缩进层级（上限 8 级），同样支持 Markdown 往返。
- 新增导出类型 `TextAlignment`。

### 变更

- `PasteMode` 类型从 `'plain' | 'structured'` 扩展为 `'plain' | 'structured' | 'markdown'`。
- 段落与标题节点新增 `indent` 属性。
- 工具栏新增 `align` 与 `indent` 分组，以及 `align-left`、`align-center`、`align-right`、`align-justify`、`indent`、`outdent` 六个默认条目。
- 工具栏按钮新增 `data-nexusdown-command` 属性，便于测试与自动化选择。

### 修复

- **打包缺陷**：`nexusdown/vue` 之前指向裸 `.vue` 文件，任何真实安装都无法解析（`ERR_PACKAGE_PATH_NOT_EXPORTED` / `ERR_UNKNOWN_FILE_EXTENSION`）。现在指向 `src/vue/entry.js`（由 `entry.ts` 生成），并提供 `types` 与 `default` 条件。
- **样式分叉**：`public/style.css` 与 `src/style.css` 曾各自演进并丢失 38 条规则；现在 `src/style.css` 为唯一真源，`npm run build` 自动同步，并有测试逐字节锁定。
- **查找替换索引残留**：删除全部匹配后 `currentIndex` 保留陈旧值（如 `matches: 0, currentIndex: 2`），现无条件钳制。
- **标题菜单无法关闭**：`HeadingPicker` 缺少外部点击与 `Escape` 处理，弹出后只能再次点击触发器关闭；同时修复关闭后未解绑的全局监听器。
- **移动端适配**：输入框提升到 16px（避免 iOS 聚焦缩放）、触控目标 ≥44px、小屏高度自适应、`env(safe-area-inset-bottom)` 安全区、禁用触屏粘滞 `:hover`。
- **菜单定位**：链接/图片/标题菜单与查找面板改用 `visualViewport`，避免软键盘弹出后与触发器脱节或被遮挡。
- **切换布局后富文本区空白**：切换 `layout` 会经过不同的 `v-if` 分支，Vue 丢弃了 Tiptap 挂载的 DOM 节点，导致富文本区变空且无法编辑。现在在布局变化后重新挂载到当前节点，文档内容保持不变。（issue #1）
- **编辑已有链接时文字被拆分**：光标位于链接内部时设置链接会直接插入新文字，把原链接切成 `[d]新文字[ocs]`。现在会扩展到整段链接后整体替换，选中部分链接时同样覆盖完整链接。（issue #1）
- **无效初始 JSON 导致组件无法挂载**：`contentType="json"` 且值非法时，`JSON.parse` 在 setup 阶段抛出，组件不会渲染，声明的 `parse-error` 事件也永远不会触发。现在回退为空文档并正常抛出 `parse-error`。（issue #1）
- **Markdown 侧选区未同步给工具栏**：在 Markdown 面板选中文字后，共享工具栏仍读取富文本侧选区，格式命令会作用到错误的一侧。现在 `MarkdownEditor` 会上报选区，工具栏优先采用它，选区折叠时回退到富文本选区。（issue #1）
- **每次按键的冗余序列化**：编辑器 `update` 不再无条件执行 Markdown + HTML + JSON 三次全量序列化。
- **能力探测副作用**：移除 `can()` 内部无意义的 `.focus()` 调用。
- **死代码**：清理 `MarkdownEditor.vue` 中恒真的注册守卫与 `useNexusdownTheme.ts` 未使用的导入。

### 工程

- 新增 GitHub Actions CI：多 Node 版本（20/22/24）执行 typecheck、lint、测试、构建，并校验构建产物已提交。
- 新增消费者冒烟测试（`npm run test:consumer`）：真实 `npm pack` → 隔离安装 → 校验全部子路径可解析 → 用 Vite 构建真实应用（16 项检查）。这是唯一能捕获打包类回归的检查。
- 接入 ESLint（flat config，含 `typescript-eslint` 与 `eslint-plugin-vue`，0 error / 0 warning）与 commitlint（Conventional Commits，允许中文 subject，当前为提示性检查）。
- 新增 `CONTRIBUTING.md`，记录架构约束、开发须知、发布流程与易踩的坑。
- 新增 `.gitattributes`：统一按 LF 检出。此前在 `core.autocrlf=true` 的 Windows 上会检出为 CRLF，而构建脚本始终写 LF，会让 CI 的「构建产物已提交」检查在部分机器上误报。
- 移除 `.gitignore` 中的 `package-lock.json` 规则：该文件其实一直被 git 跟踪，而 CI 的 `npm ci` 依赖它，保留规则会造成「已忽略但仍被跟踪」的困惑状态。
- 新增 `scripts/generate-vue-entry.mjs`，由 TypeScript 源生成可被 Node 解析的入口 shim，并有测试锁定一致性。

## [0.0.0] - 初始开发

### 新增

- 基于 Tiptap 3 的双视图编辑器：核心会话保持纯 TypeScript，Vue 3 作为独立适配层。
- 格式能力：标题、引用、有序/无序/任务列表、代码块（Lowlight 高亮 + 语言选择）、表格（增删行列、拖拽列宽、合并/拆分单元格）、图片（URL / 本地上传 / base64 回退）、链接、颜色、高亮、下划线、上下标、Typography。
- 查找替换面板（`Ctrl/Cmd+F`）、粘贴模式切换、字符与行数状态栏。
- 主题支持：`light` / `dark` / `system`，通过 CSS 变量换肤。
- 可配置布局：`layout`（`rich-left` / `markdown-left`）、`width` / `height`、`syncScroll`。
- 自定义 Markdown 语法扩展点：`markdownTokenName` / `markdownTokenizer` / `parseMarkdown` / `renderMarkdown`。

[Unreleased]: https://github.com/NexusMC-CN/nexusdown/commits/main
[0.0.0]: https://github.com/NexusMC-CN/nexusdown/releases
