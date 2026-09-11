# Nexusdown 扩展、主题与 Markdown 高亮实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为现有 Nexusdown 双视图编辑器增加可扩展的 Tiptap 内置扩展、常用格式工具栏、Markdown 语法高亮、明暗主题和清晰的 core/vue 目录边界，同时保持旧入口兼容。

**验证策略：** 每个任务先补行为测试并运行针对性失败测试，再实现最小代码；最后运行全套测试、类型检查、构建、示例构建、打包预览和差异检查。

## 任务 1：重组 core 并实现扩展注册表

**边界：** `src/core/extensions/**`、`src/core/session/**`、旧 core 转出文件、`tests/core/extensions.test.ts` 及必要的 session 测试；不要修改 Vue。

- [x] 写测试：内置扩展名称齐全；自定义扩展会进入 Editor extensionManager；resolver 可过滤/替换；非法 resolver 返回值有明确错误。
- [x] 创建 `extensions/types.ts`、`extensions/builtins.ts`、`extensions/create.ts`、`extensions/index.ts`，安装并注册 Tiptap 常用扩展。
- [x] 将会话实现移入 `session/`，为 `NexusdownEditorOptions` 增加 `extensions` 和 `extensionResolver`，旧 `src/core/session.ts` 继续 re-export。
- [x] 运行 `npm test -- tests/core/extensions.test.ts tests/core/session.test.ts` 与 `npm run typecheck`。

## 任务 2：扩展工具栏命令和颜色面板模型

**边界：** `src/core/toolbar/**`、旧 toolbar 转出文件、`tests/core/toolbar.test.ts`；只在必要时修改会话命令类型。

- [x] 写测试：默认项包含 underline/superscript/subscript/color/highlight，active/can 状态和执行函数稳定。
- [x] 增加对应 EditorCommand、NexusdownEditorCommands 和 toolbar item，保持现有命令 ID 不变。
- [x] 增加颜色/高亮值的无框架上下文接口，UI 可用同一命令模型接入。
- [x] 运行工具栏与核心测试、类型检查。

## 任务 3：Markdown 镜像编辑器与主题 composable

**边界：** `src/vue/components/MarkdownEditor.vue`、`src/vue/composables/**`、`src/vue/theme/**`、对应 Vue 测试；不要修改核心扩展注册表。

- [x] 写测试：Markdown textarea 保持原选择器；`# heading`、`**bold**` 等产生高亮 token；输入和滚动同步；light/dark/system 输出主题属性。
- [x] 安装 `highlight.js`，实现一次注册 Markdown grammar 的高亮镜像组件，输入仍由 textarea 发出 `update:modelValue`。
- [x] 实现 `useNexusdownTheme`，处理 system 的 matchMedia 变化并在 SSR/测试环境安全降级。
- [x] 增加镜像和 token 的局部样式变量。
- [x] 运行 Vue 定向测试和类型检查。

## 任务 4：整合 Vue 编辑器、内置格式 UI 和目录兼容层

**边界：** `src/vue/NexusdownEditor.vue`、`src/vue/components/**`、`src/vue/index.ts`、`src/style.css`、`public/style.css`、Vue 测试。

- [x] 写测试：extensions/extensionResolver/theme props 传入会话；工具栏颜色/高亮与上下标按钮可见；Markdown 镜像和双向更新保持原行为。
- [x] 保留根级 EditorToolbar、HeadingPicker、LinkPicker 兼容入口，并新增 components 目录承载 MarkdownEditor/ColorPicker。
- [x] 在真实 Tiptap EditorView 上承载富文本视图，避免隐藏 EditorView 与可见 DOM 脱节；外部内容更新按 contentType 解析。
- [x] 接入 ColorPicker、MarkdownEditor、主题属性和扩展 props，保留任务列表、链接弹窗、heading picker 行为；颜色优先使用短代码语法，复杂值回退 inline HTML，并在 Markdown 镜像正文中还原。
- [x] 统一 Simple Editor 风格下的 light/dark CSS 和弹层层级，修复 hover 文本颜色回退。
- [x] 运行完整 Vue 测试与示例构建。

## 任务 5：包入口与发布验收

**边界：** `package.json`、锁文件、`README.md`、示例和入口声明。

- [x] 为新增扩展和 `highlight.js` 补依赖、exports 和类型导出，确保 `nexusdown/core`、`nexusdown/vue` 旧路径仍可消费。
- [x] 更新 README 的扩展、主题和 Markdown 高亮用法，说明自定义 extension resolver。
- [x] 运行：`npm test -- --run --no-file-parallelism --maxWorkers=1`、`npm run typecheck`、`npm exec -- vue-tsc --noEmit`、`npm run build`、`npm --prefix examples/vue-demo run build`、`npm pack --dry-run --json`、`git diff --check`。
- [x] 检查打包内容包含 dist、src/vue、src/core、样式和新增组件，不包含测试或临时文件。
