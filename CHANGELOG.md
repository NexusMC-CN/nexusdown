# Changelog

本文件记录本项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

发布日期采用 npm registry 记录的 UTC 日期。仓库版本、GitHub 标签和 npm 发布分别记录；尚未发布到 npm 的版本标为“待发布”。发布记录可在 [npmjs](https://www.npmjs.com/package/@nexusmc-cn/nexusdown?activeTab=versions) 与 [registry](https://registry.npmjs.org/@nexusmc-cn%2Fnexusdown) 核对。

## [Unreleased]

### 修复

- 挂到独立容器的块变体菜单与操作提示继承所属编辑器的主题变量、字体、方向和皮肤标记；不同编辑器保持主题隔离，打开期间跟随祖先主题、系统明暗和减少动态效果的变化。
- 菜单关闭、提示到期、编辑器销毁或相关节点移除时，释放主题观察器、媒体监听及关闭事件，避免残留浮层与监听。

## [0.3.0] - 待发布

### 新增

- 成品编辑器支持按稳定动作 ID 配置工具栏分类、顺序与显示入口；常用动作平铺，扩展动作默认放入分类下拉，可添加自定义按钮和 Vue 图标。
- 自定义工具栏动作支持选区状态、禁用状态、异步执行和取消信号，并发出 `action-error`；程序交易也会刷新按钮状态。
- Vue 编辑器支持挂载额外 CodeMirror 扩展和预览插件；提供固定高度内部滚动与页面自然增高两种模式，以及有边界的工具栏吸顶和顶部偏移。

### 变更

- 编辑侧要求 `@codemirror/view` 6.26.0 及以上的 6.x 版本，以使用公开的滚动扩展接口。

## [0.2.1] - 待发布

### 新增

- 内置脚注、受控的 note/tip/info/warning/danger/details 容器、定义列表与 [TOC]；标题支持显式锚点及按需编号，普通标题默认保持原输出。
- RenderMarkdownOptions 增加 idPrefix 与 headingNumbers；标题、脚注和图片轮播使用每次渲染独立的命名空间与计数，服务端与客户端可复现。
- 导出 analyzeMarkdownBlocks，为编辑器返回同一解析器生成的源码范围与预览 HTML，不引入 DOM 或网络。
- 正文图片增加 data-nd-image 标记，供独立灯箱入口激活；卡片缩略图保持普通链接行为。新增图片灯箱接入说明。

### 修复

- 链接面板不再创建嵌套表单；点击确认或按 Enter 插入链接时不会触发宿主表单提交，输入法组词时保留 Enter 的原本行为。
- 代码页签使用已有的 `idPrefix` 隔离同页多篇正文的控件 ID、radio 分组与标签目标，并避免与标题和目录锚点冲突。
- 普通链接和自动链接中的提及保持原始文字与目标，不再生成嵌套链接；链接上下文采用单次扫描，避免大量提及时出现平方复杂度。
- 编辑器对链接、图片与源码引用目标采用与阅读侧一致的 Markdown 解码和 URI 规范化，再执行 URL 策略；自动链接和已解析引用不重复解码。
- 根入口及 `/render`、`/cm`、`/embed`、`/lightbox` 分别提供 ESM 与 CommonJS 类型声明，修复 CommonJS 消费项目的 TS1479；导出检查支持嵌套条件。
- 补充编辑器快速卸载、正常销毁、宿主表单交互和真实安装包的回归验证，覆盖 Node16、NodeNext 两种 TypeScript 解析模式。

### 兼容性提示

- 表格三向对齐、226 个常用 Emoji shortcode 与 GFM 删除线继续保持；代码中的语法标记仍按原文显示。
- 接受用户内容的应用仍需按自身策略消毒 HTML，并允许所需的语义标签、受控对齐和图片标记。默认不开放原始 HTML。
- 同页显示多个 Markdown 片段时，需要分别提供不同的稳定 `idPrefix`；服务端渲染与客户端使用同一值。省略时继续保持单篇文档的确定性输出。

## [0.2.0] - 2026-11-15

### 新增

- 编辑器加入“链接与媒体”面板，可插入和编辑普通链接、链接卡片及播放器；宿主可通过 `resolveLinks` 提供短链解析与元数据。
- 新增独立 `/embed` 入口及 `mountEmbeds(container)`，在正文挂载后启用播放器，并通过返回的清理函数释放事件和实例。

### 变更

- 阅读侧嵌入默认显示占位与原站链接，读者点击后才创建受控播放器；Markdown 渲染阶段保持无 DOM、无网络。

## [0.1.2] - 2026-11-02

### 修复

- 高亮 token 切开 UTF-16 代理对时回退为纯文本，避免 Emoji 等辅助平面 Unicode 字符损坏。

## [0.1.1] - 2026-11-02

### 新增

- 阅读侧新增同步的围栏代码高亮接入接口，可通过 `codeHighlighter` 返回文本 token 与类名，并保留代码块标题、行号和高亮行结构。
- 编辑器组件和 `mountEditor` 支持透传 `codeLanguages`，接入所需的 CodeMirror 代码语言高亮。

## [0.1.0] - 2026-10-28

### 新增

- `mermaid` 围栏现在可通过 Pele 预览为 SVG，并可点击进入源码编辑；渲染侧也支持服务端输出图表。新增 `RenderMarkdownOptions.diagramIdPrefix` 以隔离同页图表 ID。
- 编辑器加入块级变体、页签组、块属性操作与代码块行号；新增相关 CodeMirror 命令及查询 API。

### 改进与修复

- 行内 Markdown 标记按当前光标所在节点揭示；改进列表回车退出、空任务项复选框、表格单元格点击定位、多选区格式切换和换稿后的撤销历史。
- 修复输入法组合期间的编辑回归、源码定位错行、块变体判定与菜单遮挡内容等问题。
- 依赖安装与 CI 改用 pnpm；打包预演使用 npm，以匹配 npmjs 发布时的打包路径。随包附带 Pele 的第三方许可声明。

### 兼容性提示

- 有效的 `mermaid` 围栏现在渲染为图表 SVG；语法错误时仍回退为代码块。需要始终展示源码的内容应使用其他语言标记。
- `> [!NOTE]` 等 callout 标记会渲染为提示卡片，而不是普通引用块；使用扩展属性与页签语法的文档也会得到对应的结构化 HTML。
- 包仍导出根入口、`./render`、`./cm`、`./editor` 及原有 CSS 子路径；本版未删除这些入口。

## [0.0.2] - 2026-10-16

### 变更

- 清除已不再使用的 Tiptap、lowlight、highlight.js、iconify-icon 和 lodash 等历史硬依赖，保留当前 CodeMirror 与 markdown-it 接入路径。
- 补充 npm 关键词及内联代码图标的离线分发说明；与 0.0.1 相比，编译后的运行时产物保持相同。

## [0.0.1] - 2026-10-16

### 新增

- 首个正式发布的 scoped 包 `@nexusmc-cn/nexusdown`，提供 CodeMirror 6 编辑引擎、Vue 3 编辑器组件和可在服务端执行的 Markdown 渲染器。
- 提供 `/cm`、`/render`、`/editor` 及编辑器/正文样式入口，随包发布编译后的 Vue 组件与公开类型。

## [0.0.0-stage] - 2026-10-16

- 临时占位包，仅含元数据与 README，没有编辑器实现；与仓库里的 `v0.0.0` GitHub 标签分别记录。

## 历史开发记录

Tiptap 阶段的详细研发记录保留在 [历史文档](docs/history/tiptap-development.md)。这些条目未按 npm 版本发布，不作为当前 CodeMirror 编辑器的 API 说明。

[Unreleased]: https://github.com/NexusMC-CN/nexusdown/commits/main
[0.3.0]: https://github.com/NexusMC-CN/nexusdown/pull/14
[0.2.1]: https://github.com/NexusMC-CN/nexusdown/pull/13
[0.2.0]: https://www.npmjs.com/package/@nexusmc-cn/nexusdown/v/0.2.0
[0.1.2]: https://www.npmjs.com/package/@nexusmc-cn/nexusdown/v/0.1.2
[0.1.1]: https://www.npmjs.com/package/@nexusmc-cn/nexusdown/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/@nexusmc-cn/nexusdown/v/0.1.0
[0.0.2]: https://www.npmjs.com/package/@nexusmc-cn/nexusdown/v/0.0.2
[0.0.1]: https://www.npmjs.com/package/@nexusmc-cn/nexusdown/v/0.0.1
[0.0.0-stage]: https://www.npmjs.com/package/@nexusmc-cn/nexusdown/v/0.0.0-stage
