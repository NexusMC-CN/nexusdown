/**
 * `nexusdown/editor` —— **开箱即用的编辑器 UI**。
 *
 * ## 这一层是干什么的
 *
 * 引擎（`nexusdown/cm` + `nexusdown/render`）只保证「编辑时看到的 = 发布出来的」；
 * **怎么操作**是另一回事。这一层就是"怎么操作"：
 *
 * - **工具栏**：按钮、图标、悬停演示动画
 * - 它**只吃 `--nd-*` 令牌**，不依赖任何站点框架
 *   → 站点把 `--nd-*` 映射到自己的设计令牌，编辑器 UI 就自动跟随主题
 *   （机制见 `src/cm/theme.css` 的 `:root`，那里全是两级回退）
 *
 * ## 为什么单独一个入口，而不是塞进 `nexusdown/cm`
 *
 * **只要渲染的消费者不该背 UI**。docs 站、帖子详情页只需要 `nexusdown/render`；
 * 想自己写 UI 的用 `nexusdown/cm`；要成品编辑器的才装 `nexusdown/editor`。
 * 一个包、三个入口 —— 不是三选一。
 *
 * ## 边界（判据：这个东西换个场景还有用吗？）
 *
 * - **有** → `@nexusmc/annexus`（按钮、卡片、布局、动效曲线、令牌）
 * - **只对编辑器有意义** → 这里（工具栏、浮动菜单、代码块 chrome）
 *
 * ⚠️ 所以这里**不许**依赖 annexus 的组件 —— 只用它的**令牌**（通过 `--nd-*` 间接）。
 * 反过来，annexus 也不该认识 Markdown。
 *
 * ## 消费方要做什么
 *
 * 这个入口发的是**原始 `.vue`**（和 `nexusdown/vue` 一样的模式），所以：
 * - Nuxt：加进 `build.transpile`（参考 `core-next-web/nuxt.config.ts`）
 * - 其它打包器：确认它处理 node_modules 里的 `.vue`
 */
export { default as NexusdownEditor } from './Editor.vue'
export { default as NexusdownToolbar } from './Toolbar.vue'
