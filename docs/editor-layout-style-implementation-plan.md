# 编辑器布局与样式配置实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `subagent-driven-development` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 Vue 编辑器增加可切换的双栏顺序，并保留标准 `class` / `style` 与 CSS 变量样式定制能力。

**架构：** `NexusdownEditor.vue` 继续持有唯一的 Tiptap 会话和滚动同步状态，通过 `layout` 计算面板渲染顺序；两个面板仍复用同一工具栏、表格控件和 Markdown 子组件。尺寸、主题和宿主样式只在 Vue 根节点与 CSS 层处理，不向纯 TypeScript 核心引入 Vue 或 DOM 依赖。

**技术栈：** Vue 3 `<script setup>`、TypeScript、Vitest、Vue Test Utils、CSS grid areas、npm build/pack。

---

## 文件职责

- 修改：`src/vue/NexusdownEditor.vue`，增加 `layout` 类型、默认值、面板顺序渲染和样式属性兼容。
- 修改：`src/style.css`，为两种布局声明 grid areas，并保证窄屏上下顺序与桌面顺序一致。
- 修改：`public/style.css`，同步发布目录的手写压缩样式。
- 修改：`tests/vue/NexusdownEditor.test.ts`，覆盖默认顺序、反向顺序、未知值回退和 class/style 透传。
- 修改：`README.md`，记录 `layout`、标准样式属性和 CSS 变量用法。

### 任务 1：建立布局和样式契约的失败测试

**文件：**
- 修改：`tests/vue/NexusdownEditor.test.ts`

- [ ] **步骤 1：编写失败的测试**

新增测试：默认挂载时 `[data-nexusdown="rich-text"]` 在 `[data-nexusdown="markdown-editor"]` 前；`layout="markdown-left"` 时 DOM 顺序反转；未知布局值回退为 `rich-left`；挂载时传入 `class="custom-editor"` 和 `style="--nexusdown-accent: #7c3aed"` 后根节点保留 class、style 和尺寸 CSS 变量。

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
npm test -- --run tests/vue/NexusdownEditor.test.ts -t "layout|style" --no-file-parallelism --maxWorkers=1
```

预期：因 `layout` 尚未声明，反向顺序、回退和样式断言失败。

### 任务 2：实现 Vue 面板顺序和样式透传

**文件：**
- 修改：`src/vue/NexusdownEditor.vue`

- [ ] **步骤 1：增加公开类型和默认值**

定义 `EditorLayout = 'rich-left' | 'markdown-left'`，在组件 props 中增加 `layout?: EditorLayout`，默认值设为 `'rich-left'`。通过计算值将运行时未知字符串归一化到 `'rich-left'`，并将归一化结果写入 `data-nexusdown-layout`。

- [ ] **步骤 2：按归一化布局渲染面板**

使用 `paneOrder` 计算值和回调 ref 保持 `richPane`、`richContent`、`richElement`、`markdownEditor` 的单实例引用；在 `<template v-for>` 中按 `paneOrder` 输出富文本和 Markdown 面板，确保视觉顺序、DOM 顺序和键盘顺序一致。共享工具栏保持在面板之前，Markdown 的输入、组合输入和滚动事件绑定保持不变。

- [ ] **步骤 3：保留标准样式属性**

继续把 `class` 应用到根节点；不把 `style` 从 `$attrs` 中消费，让 Vue 将调用方的标准 `style` 属性与 `editorStyle` CSS 变量合并到同一根节点。不要复制宿主 style 对象，也不要把样式配置下沉到核心会话。

- [ ] **步骤 4：运行针对性测试**

运行：

```bash
npm test -- --run tests/vue/NexusdownEditor.test.ts -t "layout|style" --no-file-parallelism --maxWorkers=1
```

预期：任务 1 的四类断言全部通过。

### 任务 3：实现桌面和窄屏布局样式

**文件：**
- 修改：`src/style.css`
- 修改：`public/style.css`

- [ ] **步骤 1：声明桌面 grid areas**

让 `.nexusdown-editor__pane--rich` 和 `.nexusdown-editor__pane--markdown` 分别占据 `rich`、`markdown` 区域；`data-nexusdown-layout="markdown-left"` 时交换两个区域。默认布局不增加额外边框或滚动层。

- [ ] **步骤 2：声明窄屏 grid areas**

在 `max-width: 760px` 下改为两行 `minmax(0, 1fr)`，默认顺序为富文本在上、Markdown 在下，反向布局则交换上下区域；保持固定根节点高度和面板内部滚动。

- [ ] **步骤 3：同步发布样式**

将同样的选择器和规则同步到 `public/style.css`，确保直接引用发布目录样式时与源码样式一致。

- [ ] **步骤 4：运行 CSS 和完整测试**

运行：

```bash
git diff --check
npm test -- --run --no-file-parallelism --maxWorkers=1
```

预期：无 diff 空白错误，现有测试与新增布局测试全部通过。

### 任务 4：文档和发布验证

**文件：**
- 修改：`README.md`

- [ ] **步骤 1：补充 Vue 用法**

在示例中加入 `layout="markdown-left"` 的反向布局示例说明，并明确 `class` / `style` 可直接定制根节点、CSS 变量可覆盖主题色，`layout` 默认是 `rich-left`。

- [ ] **步骤 2：运行类型和构建验证**

运行：

```bash
npm run typecheck
npm exec -- vue-tsc --noEmit
npm run build
npm --prefix examples/vue-demo run build
npm pack --dry-run --json
git diff --check
```

预期：命令全部以退出码 0 完成；Vue 示例如出现已有的 chunk 大小提示，只记录为 warning，不作为失败。

- [ ] **步骤 3：检查发布内容**

确认 dry-run 包含 `dist/style.css`、`src/vue/NexusdownEditor.vue`、`README.md` 和新的类型产物，并且不包含 `.superpowers` 或 `docs/superpowers`。
