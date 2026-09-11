# Nexusdown 扩展、主题与 Markdown 语法高亮设计

## 目标

在保留现有 Tiptap 双视图编辑体验的基础上，补齐可发布编辑器需要的扩展体系、常用内置格式、明暗主题和 VS Code 风格的 Markdown 语法高亮。核心层继续保持纯 TypeScript，Vue 仅负责渲染与生命周期。

## 设计决策

### 核心扩展体系

- `createNexusdownExtensions` 默认注册 StarterKit、Link、TaskList、TaskItem、Markdown，以及 TextStyle、Color、Highlight、Underline、Superscript、Subscript、Typography、Placeholder、CharacterCount、Image。
- 会话选项接收 `extensions?: AnyExtension[]` 与 `extensionResolver?: (extensions: AnyExtension[]) => AnyExtension[]`，自定义扩展追加到内置扩展之后，resolver 可排序、过滤或替换扩展。
- `src/core/extensions/`、`src/core/session/`、`src/core/toolbar/` 承担实现；原有 `src/core/extensions.ts`、`session.ts`、`toolbar.ts` 保留为兼容转出入口。

### 工具栏

新增下划线、上标、下标、文字颜色和高亮命令。颜色与高亮使用独立的小型选择面板，颜色值由调用方或原生 color input 提供，不把上传、远程资源或业务状态耦合进核心。

### Markdown 编辑器

右侧仍保留真实 textarea 作为输入和无障碍表面，下面叠加由 `highlight.js` Markdown grammar 生成的安全 HTML 镜像。输入、选择、滚动仍由 textarea 控制，镜像只负责视觉 token 着色，避免引入重量级 IDE 运行时并保持跨框架可迁移。

文字颜色没有统一的 CommonMark/GFM 语法，因此默认使用可解析的 `[color color="..."]文本[/color]` 短代码；复杂 CSS 颜色或未声明语法的扩展回退为可编辑的 inline HTML，镜像层同时识别两种形式并按实际颜色显示。

### 主题

Vue 组件支持 `theme: 'light' | 'dark' | 'system'`，默认 `system`。主题状态通过根元素 `data-nexusdown-theme` 传递，CSS 变量、编辑区、工具栏、弹层和 Markdown token 使用同一套局部变量；核心层不感知主题。

### 兼容性

现有根级 Vue SFC、核心入口和测试选择器继续可用。新目录只承载实现模块，公开入口通过 re-export 维持旧导入路径。

## 验收

- 常用内置扩展已注册，颜色/高亮/下划线/上下标命令可用。
- 自定义扩展和 resolver 能通过核心会话与 Vue props 注入。
- Markdown 输入仍是 textarea，可同步更新、滚动，并能看到标题、强调、链接、代码等 token 颜色。
- light/dark/system 三种主题在同一编辑器内一致生效。
- 旧测试、类型检查、构建、Vue 示例构建和 npm pack 检查全部通过。
