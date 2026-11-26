# 贡献指南

## 环境与安装

推荐使用 Node.js 24；CI 验证 Node.js 20 / 22 / 24，Astro 和 Nuxt 示例使用 22 / 24。pnpm 版本由 `package.json#packageManager` 固定为 10.34.7。

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run verify
```

没有 Corepack 时可先运行 `npm install -g pnpm@10.34.7`。workspace 安装覆盖根包和 `examples/*`；示例通过 `workspace:*` 使用本地包，根包的 `prepare` 会构建发布入口。依赖变更提交根目录的 `pnpm-lock.yaml`；需要新增依赖安装脚本时，检查 `pnpm-workspace.yaml#onlyBuiltDependencies`（目前允许 `esbuild`、`sharp`）。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `pnpm run playground` | 启动交互演示 |
| `pnpm test` | 运行 Vitest 单元与集成测试 |
| `pnpm run typecheck` | TypeScript 类型检查 |
| `pnpm run lint` / `pnpm run lint:fix` | ESLint 检查 / 自动修复 |
| `pnpm run build` | 构建引擎、渲染器、Vue 组件与样式 |
| `pnpm run verify` | 类型、lint、测试、构建、导出及包类型检查 |
| `pnpm run test:consumer` | 真实打包、隔离 pnpm 安装、类型与 Vite 消费者验证 |
| `pnpm run test:editor:browser` | 真实浏览器编辑器回归，需先构建并安装 Chromium 浏览器 |
| `pnpm run pack:check` | 预览待发布文件清单（`npm pack --dry-run`） |
| `pnpm run build:vue-example` | 构建 Vue 示例 |
| `pnpm run build:astro-example` | 构建 Astro + Vue 示例 |
| `pnpm run build:nuxt-example` | 构建 Nuxt SSR 示例 |

浏览器回归读取 `dist/editor`，修改组件或样式后先运行 `pnpm run build`。脚本会尝试常见 Chrome、Edge、Chromium 安装路径；未找到时，将 `CHROME_PATH` 环境变量设为浏览器可执行文件的路径。结果与截图保存在 `.local/editor-browser/`。`verify` 不包含浏览器回归、消费者冒烟或示例构建；按改动范围补充运行。

jsdom 适合验证状态与文档变化；光标坐标、滚动、输入法与 CSS 裁剪需要真实浏览器验证。CI 会检查安装和构建是否改写已跟踪的输入文件。

## 开发约定

`src/cm/` 是 CodeMirror 编辑引擎，`src/editor/` 是 Vue 组件，`src/render/` 是 Markdown 渲染器，`src/shared/` 存放共享代码和样式。测试、校验脚本和示例分别位于 `tests/`、`scripts/`、`examples/`。

- 渲染入口保持可在服务端执行；创建 CodeMirror 编辑视图需要浏览器 DOM。
- CodeMirror 与 Lezer 是 peer dependencies，构建时保持 external，组合扩展时确保消费端解析到同一份模块实例。
- Vue `/editor` 入口指向编译后的 `dist/editor/index.js`，样式是 `dist/editor/nexusdown.css`，公开类型来自 `src/editor/index.d.ts`。
- `extensions`、`codeLanguages` 等引擎配置在组件挂载时读取；需要更换时通过 Vue `key` 重新挂载。工具栏与布局配置支持响应更新。
- 新增 Markdown 语法时，同时考虑编辑侧扩展、组件 `previewPlugins` 和阅读侧 `renderMarkdown` 插件的一致性。
- 修改公开入口时核对 `package.json#exports`、`files` 和类型声明，并运行 `test:consumer` 验证真实 tarball。

## 提交与 PR

从独立分支提交 PR，说明问题、改动后的行为和实际运行的验证；界面改动可附截图，公开 API 或行为变化同步更新文档与 `CHANGELOG.md`。

提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，例如 `feat: 新增工具栏动作`、`fix: 修正光标滚动`、`docs: 更新贡献指南`。标题可使用中文；当前 CI 的 commitlint 为提示性检查。

## 版本与发布

根据对既有调用方的兼容性选择版本：新增可选参数、属性或导出通常是兼容功能；移除或重命名已有导出、改变必填参数或返回约定、删除公开 CSS 变量、使既有导出路径无法使用则属于不兼容变化。

- `1.x` 及以后：不兼容变化升 major，兼容功能升 minor，兼容修复升 patch。
- `0.x` 阶段：不兼容变化与新增功能升 minor，兼容修复升 patch。不兼容变化仍需在 `CHANGELOG.md` 明确列出影响和迁移方法；跨版本重大迁移应提供完整迁移说明。

发布由维护者操作；以下 `N.N.N` 统一替换为本次 `package.json` 中的版本。

1. 查询 npm 已有版本，确认目标版本未发布；更新 `package.json#version` 和 `CHANGELOG.md`，通过 PR 审核并合入。
2. 在待发布提交上运行以下检查，确认入口、类型、样式及第三方声明随包发布，并等待该提交的 CI 通过：

   ```bash
   pnpm run verify
   pnpm run test:consumer
   pnpm run pack:check
   ```

   检查文件差异，确保发布提交与通过校验的源码一致。

3. 有 npm 发布权限的维护者从该提交单独发布并核对结果：

   ```bash
   npm publish --access public --registry=https://registry.npmjs.org/
   npm view @nexusmc-cn/nexusdown@N.N.N version --registry=https://registry.npmjs.org/
   ```

4. 确认 npm 发布后，在同一发布提交创建并推送匹配包版本的标签：

   ```bash
   git tag vN.N.N
   git push origin vN.N.N
   ```

   标签工作流接受 `N.N.N` 或 `vN.N.N`，会检查其与包版本一致，然后构建、校验导出、打包 `.tgz` 并上传到 GitHub Release。它不会发布 npm；GitHub Release 和 npm 发布结果需分别确认。
