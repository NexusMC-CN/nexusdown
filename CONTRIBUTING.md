# 贡献指南

## 环境要求

- Node.js 20 及以上（CI 覆盖 20 / 22 / 24）
- npm 10 及以上

## 快速开始

```bash
npm ci
npm run verify   # typecheck + lint + test + build
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm test` | 运行单元测试（vitest） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 检查（`npm run lint:fix` 自动修复） |
| `npm run build` | 同步样式、生成 Vue 入口 shim、执行 tsup 构建 |
| `npm run verify` | 上面四项的完整校验 |
| `npm run test:consumer` | 消费者冒烟测试（真实打包 + 隔离安装 + Vite 构建） |
| `npm run pack:check` | 查看将要发布的文件清单 |

## 项目结构

```
src/core/      框架无关的核心会话（纯 TypeScript，无 Vue / 无浏览器依赖）
src/vue/       Vue 3 适配层（SFC 组件 + composables）
src/style.css  唯一真源样式表
public/        构建输入目录（style.css 由 src/ 同步而来）
scripts/       构建与校验脚本
tests/         单元与集成测试
examples/      Vue 演示应用
```

架构约束：**核心会话必须保持框架无关**。新增能力优先落在 `src/core/`，Vue 层只做适配；不要把 Vue 或 DOM 依赖引入 `src/core/`。

## 开发须知（易踩的坑）

### 1. 修改样式后必须构建

`src/style.css` 是唯一真源，但 tsup 实际从 `public/style.css` 拷贝到 `dist/`。
`npm run build` 会先执行 `sync:style` 完成同步。

> 如果绕过 build 直接改 CSS，`dist/style.css`（即发布的 `nexusdown/style.css`）不会更新。
> 测试 `keeps src and public stylesheets byte-identical` 会捕获这种分叉。

### 2. Vue 入口 shim 是生成产物

`src/vue/entry.ts` 是唯一真源；`src/vue/entry.js` 由 `scripts/generate-vue-entry.mjs` 生成。
**不要直接编辑 `entry.js`**，它在文件头标注了 `GENERATED FILE`。

之所以需要一个 `.js` 版本：Node 无法对 `node_modules` 内的文件做类型剥离，
若 `exports` 的 `import` 条件直接指向 `.ts`，`require.resolve('nexusdown/vue')` 会失败。
测试会校验两者一致。

### 3. 新增导出子路径时同步更新多处

修改 `package.json#exports` 时，请一并检查：

- `files[]` 是否包含对应目录
- `npm run test:consumer` 是否通过（它会解析所有非通配导出键）

### 4. 组件测试使用 jsdom，存在已知限制

jsdom 未实现 `ClipboardEvent`、`scrollIntoView` 的部分行为与 CSS `overflow` 裁剪。
涉及剪贴板或真实布局的断言，请改用驱动底层 API（如直接调用 `view.someProp('handlePaste', ...)`）的方式，
而不是依赖 jsdom 的合成事件。

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

1. 确认 `npm run verify` 与 `npm run test:consumer` 全部通过。
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
   npm run test:consumer
   npm pack --dry-run
   ```

> **重要**：由于本项目通过 `exports` 直接发布未编译的 `.vue` 源码，
> 任何 `exports` / `files` 的改动都可能破坏消费者的安装。
> 发版前务必运行 `npm run test:consumer`——单元测试无法发现这类问题。

## 破坏性变更

以下改动属于破坏性变更，必须提升主版本号并在 CHANGELOG 中明确说明：

- 修改或移除 `package.json#exports` 中的现有子路径
- 移除或重命名已有的具名导出
- 修改 `NexusdownEditorSession` 上公开方法的签名
- 修改 CSS 变量名（`--nexus-bg` 等为稳定换肤接口）
- 修改工具栏扩展点的 `ToolbarItem` 结构
