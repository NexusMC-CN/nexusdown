/*
 * `@nexusmc-cn/nexusdown/editor` 的**运行时入口**。
 *
 * ⚠️ **必须是 `.js`，不能是 `.ts`。**
 *
 * 纯 Node 的工具（`require.resolve('@nexusmc-cn/nexusdown/editor')`、打包器配置解析、
 * `scripts/check-exports.mjs`）解析不了 `.ts` 子路径导出 ——
 * Node 不会在 `node_modules` 里剥类型，`.ts` 目标会让 `require.resolve` 直接失败。
 *
 * 类型在同目录的 `index.d.ts`；运行时导出与公开声明需要同步维护。
 */
export { default as NexusdownEditor } from './Editor.vue'
export { default as NexusdownToolbar } from './Toolbar.vue'
export { defaultToolbarGroups } from './toolbar.ts'
