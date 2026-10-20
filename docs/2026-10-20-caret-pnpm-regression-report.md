# 点击定位与 pnpm 迁移验证

## 点击定位

全功能样例中，页签后面的“提及与图片”标题位于第 92 行。修复前点击标题会选中下一空行，浏览器实测正文与行号相差 29px。

原因与修复：

- 页签内部 `.nd-tabs` 的上下 `1em` 外边距穿透 widget 外壳，CodeMirror 测量到的高度少了 `14.5 × 2 = 29px`。外壳改用 `display: flow-root`，将间距包含在可测量高度内。
- 展开块源码后，旧 `mousedown` 处理器先收起源码，再让 CodeMirror 根据已经变化的布局定位。现在在 `select.pointer` 选区事务中收起源码，保留原生点击、Shift 扩选和拖动行为。
- 懒加载图片改变了行高，但固定高度的滚动容器不会因此触发 ResizeObserver。图片 `load/error` 时请求重新测量，并在销毁时清理事件。

浏览器复核：

1. 打开 playground 的全功能样例，滚动到文末，点击第 92 行标题。
2. 确认光标仍在标题内，输入“定位”进入标题；撤销后内容恢复。
3. 点击页签代码展开源码，再点击后面的标题；源码收起，选区仍在所点击的标题。
4. 图片完成加载后，不再点击正文，确认图片行的行号高度自动变为 200px，后续行号与正文对齐。
5. 在 1280px 桌面和 390px 移动视口复测。第 92 行文字、行号、光标顶部坐标一致；移动端没有页面横向溢出。

新增 5 项回归测试：点击、Shift 点击、拖动退出源码，以及图片加载变高、加载失败变矮时更新后续行坐标。测试在旧实现上失败，修复后通过。CSS 外边距问题由真实浏览器验证；jsdom 不具备真实 CSS 布局能力。

## pnpm

- 固定 `pnpm@10.34.7`，根包和三个框架示例使用单一 workspace 与 `pnpm-lock.yaml`。
- 保持 tsup/Vite 构建入口，迁移本地命令、消费者测试、CI 和 Release 的依赖安装及打包命令。
- 根包直接依赖版本及 Nuxt 4.5.2 保持不变；示例 Vue 统一为根包已有的 3.5.42。
- 各框架自行解析 peer 依赖，避免 Nuxt 使用根包的 Vite 6；允许 esbuild、sharp 的安装脚本。
- 本机 Codex 的 fallback pnpm 会忽略固定版本。验证使用 Corepack 的 10.34.7，并在脚本 PATH 前置本地 Corepack shim，确保嵌套命令也使用固定版本；未修改全局安装。

## 提交前验证结果

| 检查 | 结果 |
| --- | --- |
| workspace `install --frozen-lockfile` | 通过 |
| 无旧 node_modules 的干净目录，按 CI 根包过滤安装 | 通过 |
| `pnpm run verify`，含干净目录复跑 | 48 个测试文件、698 项测试通过；类型、lint、构建及 15 个导出目标通过 |
| Vue SFC `vue-tsc --noEmit` | 通过 |
| `pnpm run test:consumer` | 实际打包、隔离安装、ESM/CJS/类型/Vite 等 7 项检查通过 |
| Vue、Astro、Nuxt 示例构建 | 通过 |
| Nuxt 构建产物启动 | HTTP 200；HTML 包含 SSR 示例内容及 `.nd-editor` 根节点 |
| `pnpm run pack:check` 与 Release 打包命令 | 通过 |
| 独立代码审查与 `git diff --check` | 无阻塞问题 |

以上是本地验证记录，远端 CI 结果以对应提交的 GitHub Actions 为准；未发布 npm 版本。
