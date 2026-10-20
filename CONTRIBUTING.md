# 贡献指南

## 环境要求

- Node.js 20 及以上（CI 覆盖 20 / 22 / 24）
- pnpm 10.34.7（由 `package.json#packageManager` 固定）
- Astro 和 Nuxt 示例使用 Node.js 22 或 24

## 快速开始

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run verify   # typecheck + lint + test + build + exports
```

无 Corepack 的环境可先运行 `npm install -g pnpm@10.34.7`。提交根目录的 `pnpm-lock.yaml`，不要同时维护 npm lock。一次安装会处理根包和 `examples/*` 的依赖；示例通过 `workspace:*` 使用本地库，根包的 `prepare` 脚本会构建其发布入口。

workspace 允许构建器所需的 `esbuild` 和 Astro 图像处理所需的 `sharp` 安装脚本。新增依赖确实需要安装脚本时，应审查用途后更新 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm run playground` | 启动交互演示 |
| `pnpm test` | 运行单元测试（Vitest） |
| `pnpm run typecheck` | TypeScript 类型检查 |
| `pnpm run lint` | ESLint 检查（`pnpm run lint:fix` 自动修复） |
| `pnpm run build` | tsup 构建引擎与渲染器，Vite 编译 Vue 组件和样式 |
| `pnpm run verify` | 类型、lint、测试、构建与导出检查 |
| `pnpm run test:consumer` | 消费者冒烟测试（真实打包 + 隔离 pnpm 安装 + Vite 构建） |
| `pnpm run pack:check` | 构建并查看将要发布的文件清单 |
| `pnpm run build:vue-example` | 构建 Vue 示例 |
| `pnpm run build:astro-example` | 构建 Astro + Vue 示例 |
| `pnpm run build:nuxt-example` | 构建 Nuxt SSR 示例 |

## 项目结构

```
src/cm/        CodeMirror 6 编辑引擎、即时预览与主题
src/editor/    Vue 3 编辑器与工具栏组件
src/render/    支持 SSR 的 Markdown 渲染器
src/shared/    编辑侧与展示侧的共享代码及样式
scripts/       构建与校验脚本
tests/         单元与集成测试
examples/      Vue、Astro + Vue、Nuxt SSR 演示应用
```

渲染入口必须支持服务端执行；创建 CodeMirror 编辑视图需要浏览器 DOM。CodeMirror 与 Lezer 是 peer dependencies，构建时必须保持 external，避免消费端出现多个模块实例。

## 开发须知（易踩的坑）

### 1. 修改样式后必须构建

Vue 编辑器样式由 Vite 输出到 `dist/editor/nexusdown.css`。修改组件或样式后运行 `pnpm run build`，再构建依赖发布入口的示例。

### 2. Vue 组件通过编译后的入口发布

`src/editor/index.js` 是源码入口，`/editor` 导出指向 Vite 生成的 `dist/editor/index.js`。不要让消费方直接解析组件源码；发布类型由 `src/editor/index.d.ts` 提供。

### 3. 新增导出子路径时同步更新多处

修改 `package.json#exports` 时，请一并检查：

- `files[]` 是否包含对应目录
- `pnpm run test:consumer` 是否通过（它会解析所有非通配导出键）

### 4. 组件测试使用 jsdom，存在已知限制

jsdom 未实现浏览器的完整布局和输入行为。光标坐标、滚动、输入法及 CSS 裁剪需要真实浏览器验证；状态和文档变化可用 CodeMirror API 做单元回归。

### 5. 测试必须能证伪

新增回归测试后，请临时还原被修复的代码确认测试**会失败**。
否则测试可能只是摆设——本项目已有多个测试通过这种方式验证过。

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat: 新增 Markdown 感知粘贴
fix: 修正查找替换索引残留
docs: 补充移动端适配说明
test: 补充消费者冒烟测试
chore: 升级 ESLint 到 10
```

允许的类型：`feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`。
subject 可自由使用中文。commitlint 目前为**提示性**检查（`continue-on-error: true`），
因为历史提交中存在不符合规范的记录。

## 发布流程

1. 确认 `pnpm run verify` 与 `pnpm run test:consumer` 全部通过。
2. 更新 `CHANGELOG.md`，把 `[Unreleased]` 的内容整理到新的版本号下。
3. 更新 `package.json` 的 `version`（遵循语义化版本）。
4. 提交并打标签：

   ```bash
   git commit -am "chore: release v0.1.0"
   git tag v0.1.0
   git push origin main --tags
   ```

5. 发布前做最后一次真实校验：

   ```bash
   pnpm run test:consumer
   pnpm run pack:check
   ```

任何 `exports` / `files` 的改动都可能破坏消费者的安装。发版前运行 `pnpm run test:consumer`，验证真实 tarball 中的入口、类型和样式。

## 破坏性变更

以下改动属于破坏性变更，必须提升主版本号并在 CHANGELOG 中明确说明：

- 修改或移除 `package.json#exports` 中的现有子路径
- 移除或重命名已有的具名导出
- 修改公开编辑 API 或组件 props、事件的签名
- 修改公开 CSS 变量名（例如 `--nd-bg`）
