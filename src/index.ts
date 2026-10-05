/**
 * 主入口 —— 「引擎」的聚合。
 *
 * ## ⚠️ 这里以前导出的是**上一代（Tiptap）编辑器的 API**
 *
 * `createNexusdownEditor` / `NexusdownEditorSession` / `ContentType` / `PasteMode`…
 * 那一整套（`src/core/` + `src/vue/` + `src/style.css`）**已经删了**。
 *
 * 删的理由：它和现在这套（CM6 + markdown-it）**是两套方言、两套实现**，
 * 留着只会让"nexusdown 到底是什么"永远说不清 —— 而且它的默认入口占着 `.`，
 * 让新用户一 `import 'nexusdown'` 就拿到一套已经没人维护的东西。
 *
 * ## 现在是什么
 *
 * > **开箱即用的 Markdown 编辑器，以及保证「编辑时看到的 = 发布出来的」的渲染器。**
 *
 * 三个入口，**不是三选一**：
 *
 * | 入口 | 给谁 | 内容 |
 * | --- | --- | --- |
 * | `nexusdown`（这里） | 想要引擎的人 | `cm` + `render` 的聚合 |
 * | `nexusdown/render` | 只要渲染（docs 站、帖子详情页） | markdown → HTML，**不背 UI** |
 * | `nexusdown/cm` | 要引擎、想自己写 UI | CM6 扩展 + 命令 + 主题 |
 * | `nexusdown/editor` | **要成品编辑器** | 工具栏 + 外壳 + 正文排版 |
 *
 * ⚠️ `nexusdown/editor` 不在这里 re-export —— 它是 `.vue`，拉进来会让
 * **只要引擎的人也被迫处理 SFC**。想要 UI 就显式引 `nexusdown/editor`。
 */
export * from './cm/index.js'
export * from './render/index.js'
