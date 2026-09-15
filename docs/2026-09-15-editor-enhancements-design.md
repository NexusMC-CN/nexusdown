# 编辑器增强六功能设计

> 日期：2026-09-15
> 状态：已批准（用户已通过选择题确认六项功能方案）

## 背景

nexusdown 是基于 Tiptap 3 的双视图（富文本 + Markdown 高亮）编辑器。在布局/样式配置（layout、CSS 变量换肤）落地后，本次为编辑器补齐六项常用编辑能力。全部改动必须保持核心会话与框架无关的既有架构，并同步 `src/style.css` 与 `public/style.css`。

## 功能清单

1. 表格增强：删除行列、拖拽列宽、删除表格、合并/拆分单元格
2. 图片上传能力：base64 内嵌回退 + 可选上传回调
3. 查找替换：底部浮动面板 + Ctrl/Cmd+F
4. 纯粘贴 / 粘贴转 Markdown：默认纯文本 + 可切换结构化
5. 代码块语言选择 + 语法高亮
6. 字数统计展示：底部独立状态栏

---

## ① 表格增强

### 架构
核心会话 + Vue 浮层控件两部分，沿用现有 `TableControls.vue` 模式。

### 方案
- `NexusdownEditorSession` 新增命令（映射 @tiptap/extension-table 已内置命令）：
  - `deleteTableRow(): boolean`
  - `deleteTableColumn(): boolean`
  - `deleteTable(): boolean`
  - `mergeCells(): boolean`
  - `splitCell(): boolean`
- `builtins.ts`：`TableKit.configure({ resizable: true })` 启用列宽拖拽（自带把手 DOM）
- `TableControls.vue`：现有"增加行/列"浮层补齐五个按钮（删除行、删除列、删除表格、合并单元格、拆分单元格）；复用现有定位/刷新逻辑与 `refresh()` 调度
- CSS：补充 resizable 表格的把手样式（`table .column-resize-handle`）；`src/style.css` 与 `public/style.css` 同步
- 错误处理：命令返回 false 时静默忽略，不抛错
- 测试：增删行列后表格结构断言；合并/拆分单元格断言；按钮在 readonly 下禁用

## ② 图片上传能力

### 架构
Vue 适配层 prop + 核心图片命令，沿用现有 ImagePicker 弹窗。

### 方案
- 新增 prop `imageUpload?: (file: File) => Promise<string>`
  - 未传入 → 本地文件经 FileReader 转 base64 DataURL 内嵌（Image 扩展开启 `allowBase64: true`）
  - 传入 → 调用回调得 URL 后插入
- `ImagePicker.vue` 增加"本地上传"文件选择入口（`<input type="file" accept="image/*">`），上传完成后自动插入
- 核心新增 `insertImageFromFile(file: File): Promise<boolean>`：读取 →（回调或 base64）→ `insertImage(src)`
- 顺带支持**粘贴/拖拽图片文件**：`createNexusdownExtensions` 或 session 构造时挂 `editorProps.handlePaste`/`handleDrop` 拦截文件事件（经 imageUpload 回调或 base64 插入）——成本低、编辑器自然行为，纳入
- 错误处理：imageUpload 抛错/返回空 → 面板显示错误提示，不插入；base64 超大文件由调用方 `maxFileSize`（可选 prop，默认不限制）自行控制，本次不做大小限制
- 测试：jsdom 模拟 File/FileReader；回调返回 URL 断言；base64 回退断言；粘贴图片文件断言

## ③ 查找替换

### 架构
自研轻量 Tiptap 扩展（Tiptap 无官方 search 包，`@tiptap/extension-search` 不存在）。

### 方案
- 核心新增 `FindReplace` 扩展（`src/core/extensions/find-replace.ts`）：
  - DecorationSet 高亮全部匹配（非侵入式，只读装饰）
  - 命令：`findNext(term)`、`findPrev(term)`、`replaceCurrent(replaceTerm)`、`replaceAll(term, replaceTerm)`（遍历 `doc.textBetween` 定位，transaction 替换）
  - 支持大小写敏感开关（`caseSensitive?: boolean`）
  - 无匹配时高亮清空、光标不动
- Vue 新增 `FindReplacePanel.vue`：**编辑器底部浮动面板**
  - 查找输入框、上一个/下一个按钮、替换输入框、替换/全部替换按钮、大小写开关、关闭按钮
  - 键入防抖（300ms）触发查找；替换后重新查找
  - `Ctrl/Cmd+F` 打开并聚焦查找框（经 EditorToolbar 或根组件监听 keydown）
  - 面板放在 `.nexusdown-editor` 根内底部（position: absolute），不破坏双栏 grid
- 错误处理：无匹配显示"无结果"提示，替换操作不生效
- 测试：多次匹配高亮数量断言；replaceCurrent/replaceAll 断言；无匹配行为断言；大小写开关断言

## ④ 纯粘贴 / 结构化粘贴

### 架构
会话级粘贴策略 + Vue 工具栏开关。

### 方案
- `NexusdownEditorSession` 构造时传 `editorProps.handlePaste`：
  - 默认 **纯文本**：仅保留剪贴板 text/plain，丢弃 HTML（抑制自动链接等副作用）
  - 新增 `setPasteMode('plain' | 'structured')` 切换：structured 走 Tiptap 默认 HTML 粘贴（保留富文本结构）
  - 默认值 plain；状态存于 session（`getPasteMode()`）
- 工具栏加**粘贴模式切换按钮**（纯文本/富文本，图标区分，readonly 下禁用）
- 错误处理：剪贴板空 → 静默返回
- 测试：模拟 paste 事件断言纯文本插入（无 `<b>` 标签）；切 structured 后保留 HTML；readonly 不响应

## ⑤ 代码块语言选择 + 语法高亮

### 架构
替换 StarterKit 的普通 CodeBlock 为 Lowlight 版（新增依赖，与现有 highlight.js 同源）。

### 方案
- 新增依赖 `@tiptap/extension-code-block-lowlight`（v3.31.3）+ `lowlight`（v3.3.0）
- `builtins.ts`：`StarterKit.configure({ codeBlock: false })` 后追加
  `CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext', languages })`
- 语言子集（完整注册 lowlight 后挑选常用）：js/javascript、ts/typescript、python、bash/shell、html、css、json、markdown、yaml、sql、java、c、cpp、rust、go、php；另有 plaintext
- 语言选择 UI：点击代码块时在代码块顶部显示语言下拉（`code-block-language-picker`），会话命令 `setCodeBlockLanguage(lang)` 写 `language` 属性；Markdown 往返输出 ` ```lang ` 标记保住语言
- CSS：代码块圆角、高亮配色（复用现有 hljs 变量，dark/light 适配）
- 测试：```ts 往返解析断言；切换语言后 DOM 类名/高亮 span 断言；language 属性持久化

## ⑥ 字数统计展示

### 架构
Vue 底部状态栏组件（用户选定独立状态栏）。

### 方案
- 新增 `EditorStatusBar.vue` 在编辑器底部（`.nexusdown-editor__status-bar`）：
  - 字符数（含空格）、字符数（不含空格）、行数
  - 数据来源：`CharacterCount` storage（`editor.storage.characterCount.characters()`）+ `editor.state.doc` 遍历数行
- 数据流：会话 `update`/`selectionChange` 事件驱动刷新（复用现有订阅）
- readonly 下正常显示；状态栏不占编辑区高度（flex 布局最后一行）
- 测试：不同内容断言统计值；readonly 显示断言

---

## 依赖变更

```bash
npm i @tiptap/extension-code-block-lowlight lowlight
```

查找替换自研，不上新包；其余复用现有包（@tiptap/extension-table、Image、CharacterCount、StarterKit）。

## 全局验证

每个功能完成后分别跑：
- `npx vitest run --no-file-parallelism --maxWorkers=1`（全量）
- `npm run typecheck`
- `npm exec -- vue-tsc --noEmit`
- `npm run build`
- `npm --prefix examples/vue-demo run build`
- `npm pack --dry-run --json`
- `git diff --check`

样式改动必须同步 `src/style.css` 与 `public/style.css`（`tests/vue/NexusdownEditor.test.ts` 已有双文件断言模式可沿用）。

## 测试计划

- `tests/vue/NexusdownEditor.test.ts`：新增六个功能的集成测试（覆盖上述断言）
- `tests/core/session.test.ts`：新增命令（表格、粘贴模式、图片文件、查找替换核心命令）单元测试
- `tests/core/extensions.test.ts`：FindReplace 扩展、CodeBlockLowlight 往返测试