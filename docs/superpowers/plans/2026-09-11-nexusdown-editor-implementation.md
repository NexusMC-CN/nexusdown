# Nexusdown 编辑器实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建一个单包 `nexusdown`，提供基于 Tiptap 的纯 TypeScript 编辑会话、Vue 3 双视图编辑器、Iconify 分组工具栏和可发布的 npm 产物。

**架构：** `src/core` 管理 Tiptap 会话、Markdown 解析序列化和更新事件；`src/vue` 管理 Vue 生命周期、左右编辑表面和工具栏；`src/styles` 提供独立 CSS 变量和 Simple Editor 风格。根入口只导出稳定公共 API，`core` 不导入 Vue 或 DOM。

**技术栈：** TypeScript、Tiptap 3、`@tiptap/markdown`、Vue 3、`@tiptap/vue-3`、Iconify `iconify-icon`、Vitest、Vue Test Utils、jsdom、tsup、npm。

---

## 文件结构

创建以下文件和目录：

- `package.json`：npm 包元数据、子路径 exports、依赖和脚本。
- `tsconfig.json`、`tsconfig.build.json`：源码与构建类型边界。
- `vitest.config.ts`：Node 核心测试和 jsdom Vue 测试环境。
- `tsup.config.ts`：ESM、CJS、类型声明和 CSS 产物配置。
- `src/core/session.ts`：Tiptap 会话和内容读写 API。
- `src/core/extensions.ts`：首版 StarterKit、Link、TaskList/TaskItem、Markdown 扩展集合。
- `src/core/toolbar.ts`：框架无关的工具项描述和命令执行器。
- `src/core/index.ts`：核心公开导出。
- `src/vue/NexusdownEditor.vue`：左右双视图组件和生命周期桥接。
- `src/vue/EditorToolbar.vue`：共享分组工具栏和 Iconify 图标元素。
- `src/vue/index.ts`：Vue 公开导出。
- `src/style.css`：编辑器容器、工具栏、内容区和主题变量。
- `src/index.ts`：根入口。
- `tests/core/session.test.ts`：核心同步、内容格式、错误和生命周期测试。
- `tests/core/toolbar.test.ts`：工具项状态和命令行为测试。
- `tests/vue/NexusdownEditor.test.ts`：Vue 双视图和工具栏行为测试。
- `tests/fixtures/markdown.ts`：手工核对的 Markdown fixture。
- `examples/vue-demo/`：最小 Vue 消费示例和验证脚本。
- `README.md`、`LICENSE`、`NOTICE`：中文使用文档、项目许可证和 Simple Editor 参考归属。

### 任务 1：初始化 npm 包与测试基础设施

**文件：**
- 创建：`package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`tsup.config.ts`、`.gitignore`
- 创建：`src/core/index.ts`、`src/vue/index.ts`、`src/index.ts`
- 创建：`tests/fixtures/markdown.ts`

- [ ] **步骤 1：写包元数据和空入口**

```json
{
  "name": "nexusdown",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./core": { "types": "./dist/core/index.d.ts", "import": "./dist/core/index.js", "require": "./dist/core/index.cjs" },
    "./vue": { "types": "./dist/vue/index.d.ts", "import": "./dist/vue/index.js", "require": "./dist/vue/index.cjs" },
    "./style.css": "./dist/style.css"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc -p tsconfig.json --noEmit", "build": "tsup", "pack:check": "npm run build && npm pack --dry-run" }
}
```

导出入口先只包含可编译的空类型，确保后续任务可以逐步添加实现。

- [ ] **步骤 2：安装锁定的运行时和开发依赖**

运行：`npm install @tiptap/core@^3 @tiptap/starter-kit@^3 @tiptap/markdown@^3 @tiptap/extension-link@^3 @tiptap/extension-task-list@^3 @tiptap/extension-task-item@^3 @tiptap/vue-3@^3 vue@^3 iconify-icon`

运行：`npm install -D typescript vitest jsdom @vue/test-utils tsup vue-tsc`

预期：生成 `package-lock.json`，所有 `@tiptap/*` 依赖保持同一主版本，Vue 作为 peer dependency 声明而不打包进产物。

- [ ] **步骤 3：运行基础检查确认脚手架可用**

运行：`npm run typecheck`

预期：PASS，空入口无类型错误。

运行：`npm test -- --passWithNoTests`

预期：PASS，Vitest 启动成功。

- [ ] **步骤 4：Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts tsup.config.ts .gitignore src tests/fixtures/markdown.ts
git commit -m "chore: initialize nexusdown package"
```

### 任务 2：实现 Tiptap 核心会话和 Markdown 同步

**文件：**
- 测试：`tests/core/session.test.ts`、`tests/fixtures/markdown.ts`
- 创建：`src/core/extensions.ts`、`src/core/session.ts`
- 修改：`src/core/index.ts`、`src/index.ts`

- [ ] **步骤 1：编写失败测试，先固定可观察行为**

```ts
import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

describe('NexusdownEditorSession', () => {
  it('parses initial markdown and serializes the same writing structure', () => {
    const session = createNexusdownEditor({
      content: '# Hello\n\nThis is **bold**.',
      contentType: 'markdown',
    })

    expect(session.getMarkdown()).toBe('# Hello\n\nThis is **bold**.')
    expect(session.getHTML()).toContain('<h1>Hello</h1>')
    expect(session.getHTML()).toContain('<strong>bold</strong>')
    session.destroy()
  })

  it('updates markdown once when rich text content changes', () => {
    const session = createNexusdownEditor({ content: '<p>Hello</p>', contentType: 'html' })
    const updates: string[] = []
    const unsubscribe = session.subscribe((snapshot) => updates.push(snapshot.markdown))

    session.setMarkdown('# Updated')

    expect(session.getMarkdown()).toBe('# Updated')
    expect(updates).toEqual(['# Updated'])
    unsubscribe()
    session.destroy()
  })

  it('keeps the previous document and reports parse errors', () => {
    const session = createNexusdownEditor({ content: '# Good', contentType: 'markdown' })
    const errors: string[] = []
    session.onError((error) => errors.push(error.message))

    session.setMarkdown('\u0000')

    expect(session.getMarkdown()).toBe('# Good')
    expect(errors).toHaveLength(1)
    session.destroy()
  })
})
```

- [ ] **步骤 2：运行测试确认失败原因是 API 尚未实现**

运行：`npm test -- tests/core/session.test.ts`

预期：FAIL，报错集中在 `createNexusdownEditor` 或会话方法不存在，而不是测试环境启动错误。

- [ ] **步骤 3：实现最小会话和扩展集合**

在 `src/core/extensions.ts` 创建 `createNexusdownExtensions()`，返回 `StarterKit`、`Link`、`TaskList`、`TaskItem`、`Markdown`；在 `src/core/session.ts` 创建 `NexusdownEditorSession`，内部持有一个 Tiptap `Editor`，用手工定义的 `ContentType` 选择初始化和更新入口。

监听 Tiptap `update` 事件，生成 `{ markdown, html, json, source }` 快照；`setMarkdown` 解析成功后只发出一次来源为 `markdown` 的更新，解析异常时恢复上一个 JSON 并调用错误监听器。

- [ ] **步骤 4：运行核心测试确认通过**

运行：`npm test -- tests/core/session.test.ts`

预期：PASS，所有 Markdown、HTML、JSON 和错误行为通过。

- [ ] **步骤 5：补充撤销、重做、销毁和去重边界测试**

测试 `undo()`、`redo()`、`canUndo()`、`canRedo()`；测试同一 Markdown 快照不会重复通知；测试 `destroy()` 后调用 `subscribe` 返回可安全调用的取消函数且不会再触发更新。

- [ ] **步骤 6：运行全部核心测试并 Commit**

运行：`npm test -- tests/core`

预期：PASS。

```bash
git add src/core tests/core tests/fixtures/markdown.ts
git commit -m "feat: add tiptap markdown editor session"
```

### 任务 3：实现框架无关工具栏命令模型

**文件：**
- 测试：`tests/core/toolbar.test.ts`
- 创建：`src/core/toolbar.ts`
- 修改：`src/core/index.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { createDefaultToolbarItems } from '../../src/core/toolbar'

describe('default toolbar', () => {
  it('groups supported commands and exposes stable icon names', () => {
    const items = createDefaultToolbarItems()
    expect(items.map((item) => item.id)).toEqual([
      'undo', 'redo', 'heading', 'blockquote', 'bullet-list', 'ordered-list',
      'task-list', 'code-block', 'horizontal-rule', 'bold', 'italic',
      'strike', 'code', 'link',
    ])
    expect(items.find((item) => item.id === 'bold')).toMatchObject({
      group: 'inline',
      icon: 'lucide:bold',
      label: '粗体',
    })
  })
})
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/core/toolbar.test.ts`

预期：FAIL，默认工具栏工厂尚不存在。

- [ ] **步骤 3：实现最小 ToolbarItem 模型**

定义 `ToolbarGroup`、`ToolbarItem` 和 `ToolbarContext` 类型。每个默认项只调用 `context.session` 的公开命令；active/disabled 通过 Tiptap `can()` 和 `isActive()` 读取，但 UI 不直接依赖具体按钮组件。

- [ ] **步骤 4：运行工具栏测试确认通过**

运行：`npm test -- tests/core/toolbar.test.ts`

预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/core/toolbar.ts src/core/index.ts tests/core/toolbar.test.ts
git commit -m "feat: add extensible toolbar command model"
```

### 任务 4：实现 Vue 双视图编辑器和 Iconify 工具栏

**文件：**
- 测试：`tests/vue/NexusdownEditor.test.ts`
- 创建：`src/vue/NexusdownEditor.vue`、`src/vue/EditorToolbar.vue`
- 修改：`src/vue/index.ts`、`src/index.ts`

- [ ] **步骤 1：编写失败的 Vue 行为测试**

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'

describe('NexusdownEditor', () => {
  it('renders rich text, markdown, and one shared toolbar', () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '# Hello', contentType: 'markdown' },
    })

    expect(wrapper.find('[data-nexusdown="rich-text"]').exists()).toBe(true)
    expect(wrapper.find('[data-nexusdown="markdown"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-nexusdown="toolbar"]').length).toBe(1)
    expect(wrapper.findAll('iconify-icon').length).toBeGreaterThan(0)
  })

  it('emits markdown updates from the markdown surface', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '# Hello' } })
    const textarea = wrapper.get('[data-nexusdown="markdown"]')

    await textarea.setValue('# Updated')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['# Updated'])
  })
})
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npm test -- tests/vue/NexusdownEditor.test.ts`

预期：FAIL，组件和工具栏尚不存在。

- [ ] **步骤 3：实现 Vue 组件生命周期和双视图布局**

在 `setup` 中创建或接收核心 session，使用 `EditorContent` 渲染富文本表面，使用受控 `textarea` 渲染 Markdown 表面。session 更新时同步 `markdownValue`，textarea 输入调用 `session.setMarkdown()`；当解析错误时将用户原文保留在 textarea 并发出 `parse-error`。

为组件定义 `modelValue`、`contentType`、`toolbarItems`、`readonly` 和 `class` props，以及 `update:modelValue`、`update`、`parse-error` emits。

- [ ] **步骤 4：实现共享工具栏和 Iconify 元素**

`EditorToolbar.vue` 接收 session 和 `ToolbarItem[]`，按 `history`、`block`、`inline`、`extension` 分组渲染单行按钮。按钮内部使用 `<iconify-icon :icon="item.icon" />`，同时提供 `aria-label`、`title`、active class 和 disabled 属性。注册 `iconify-icon` 不得改变核心入口。

- [ ] **步骤 5：运行 Vue 测试确认通过**

运行：`npm test -- tests/vue/NexusdownEditor.test.ts`

预期：PASS。

- [ ] **步骤 6：Commit**

```bash
git add src/vue tests/vue src/index.ts
git commit -m "feat: add vue dual-view editor"
```

### 任务 5：实现 Simple Editor 风格样式和最小示例

**文件：**
- 创建：`src/style.css`、`examples/vue-demo/package.json`、`examples/vue-demo/index.html`、`examples/vue-demo/src/main.ts`、`examples/vue-demo/src/App.vue`
- 创建：`README.md`、`LICENSE`、`NOTICE`

- [ ] **步骤 1：先写样式验收清单对应的浏览器测试页面**

在示例中固定可观察标记：工具栏只有一个、左右编辑区在宽屏并列、窄屏上下排列、按钮拥有 active/disabled 状态、Markdown 区使用等宽字体。

- [ ] **步骤 2：运行示例前确认当前样式缺失**

运行：`npm run build`，再通过本地 Vite 示例打开页面。

预期：组件能加载但无项目样式或样式文件尚不存在，作为实现前的失败基线。

- [ ] **步骤 3：实现样式**

使用 CSS 变量定义背景、边框、文本、muted 文本、强调色和暗色主题；实现固定高度工具栏、分组分隔线、可滚动编辑区、`.is-active` 和 `:disabled` 状态；使用 `@media (max-width: 760px)` 将左右布局切换为上下布局。为 `iconify-icon` 设置 `display:inline-block;width:1em;height:1em` 防止布局跳动。

- [ ] **步骤 4：完成示例和文档**

示例展示初始 Markdown、双向同步和基础工具栏；README 提供安装、Vue 用法、纯核心用法、扩展工具项和 npm 发布命令；NOTICE 记录 Tiptap Simple Editor 参考链接和 MIT 许可归属。

- [ ] **步骤 5：运行构建和示例类型检查**

运行：`npm run typecheck`

运行：`npm run build`

运行：`npm --prefix examples/vue-demo install && npm --prefix examples/vue-demo run build`

预期：全部 PASS，示例能解析根包和样式入口。

- [ ] **步骤 6：Commit**

```bash
git add src/style.css examples/vue-demo README.md LICENSE NOTICE
git commit -m "feat: add simple editor styling and vue demo"
```

### 任务 6：发布产物验收和回归验证

**文件：**
- 修改：`package.json`、`tsup.config.ts`、README 或测试中发现的必要边界
- 测试：`tests/core/session.test.ts`、`tests/core/toolbar.test.ts`、`tests/vue/NexusdownEditor.test.ts`

- [ ] **步骤 1：运行完整测试和类型检查**

运行：`npm test`

运行：`npm run typecheck`

预期：全部 PASS，输出不包含未处理异常或 Vue teardown 警告。

- [ ] **步骤 2：构建发布产物**

运行：`npm run build`

预期：`dist/index.js`、`dist/index.cjs`、`dist/core/*`、`dist/vue/*`、类型声明和 `dist/style.css` 均生成。

- [ ] **步骤 3：检查 npm 包内容**

运行：`npm pack --dry-run`

预期：只包含 `dist`、README、LICENSE、NOTICE 和必要 package 元数据，不包含测试、`.superpowers`、示例依赖缓存或源码临时文件。

- [ ] **步骤 4：执行最小真实消费验证**

在临时目录运行：`npm pack`，安装生成的 tarball 和 Vue 3，编译一个导入 `nexusdown/vue`、`nexusdown/core`、`nexusdown/style.css` 的最小 TypeScript 示例。

预期：子路径 exports、类型声明和 CSS 入口都能被真实消费者解析。

- [ ] **步骤 5：检查差异和提交最终修复**

运行：`git diff --check`

运行：`git status --short`

发现问题时补充对应测试，再修复实现；确认工作区只剩预期的 `.superpowers` 原型目录后提交：

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts tsup.config.ts src tests examples README.md LICENSE NOTICE
git commit -m "chore: verify nexusdown npm package"
```
