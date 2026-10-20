# 渲染契约工单 · 阶段 1（共享投影器地基）

> 给实现代理（subagent）的工作单。先读：
> `docs/2026-10-19-dialect-vs-oink.md`（四层模型）、`docs/dialect-extensions.md` §0（属性行）、本工单。
>
> ⚠️ **另一个代理正在改 `src/render/renderer.ts` / `src/render/features/**` /
> `src/cm/features/**` / `src/cm/plugin.ts` / `playground/**`。本工单只做地基，
> 严禁碰这些文件（见 §3 文件所有权）。**

---

## 1. 目标

把「一份 spec、两个投影器」落成可执行的地基：

```
一份 lezer AST
   ├─ HTML 投影器（渲染侧）      ← 原子节点共用
   └─ CM6 投影器（编辑器装饰）   ← 可编辑节点用 mark/line
```

本阶段**不**统一解析器，**不**改渲染规则，只做：

1. 写清楚「原子 vs 可编辑」的契约（每个块的 DOM/类名/样式归属）；
2. 抽出一份**显示侧**规范样式 `src/shared/blocks.css`；
3. 建 parity 测试脚手架（同一 fixture，两侧类名对拍）；
4. 给渲染侧 `<mark>` 加契约类名（唯一的渲染侧改动）。

---

## 2. 交付物

### 2.1 `docs/2026-10-19-render-contract.md`

必须包含：

- **轴**：原子 vs 可编辑（明确写出「不是行级 vs 块级」），给判定标准；
- **契约表**：每个块一行 ——
  `块 | 编辑器 DOM / 类 | 渲染侧 DOM / 类 | 共享 CSS | 状态（已有 / 待补 / phase 2）`
  覆盖：标题、段落、粗/斜/删/高亮、行内码、链接、引用、列表、任务列表、表格、hr、代码围栏、图片、mention、embed、数学。
- **spec 模型**：节点 → `{ HTML 模板, CM6 策略(mark/line/block widget), 揭示策略, 降级策略 }`；
- **phase 2 清单**：哪些块需要改渲染侧类名、哪些需要抽共享 CSS、哪些需要编辑器补实现。

### 2.2 `src/shared/blocks.css`

显示侧规范样式（**只写排版**，不写编辑器几何）：

- 选择器：`h1`–`h6` / `p` / `blockquote` / `ul` / `ol` / `li` / `table` / `th` / `td` /
  `hr` / `mark` / `code` / `pre` / `a`，以及契约类名（`.nd-h1` … `.nd-highlight`、`.nd-blockquote`、`.nd-list`、`.nd-table`、`.nd-hr`）。
- 颜色一律 `var(--nd-*, var(--站令牌, 字面量))` **两级回退**，每个字面量都要写。
- **不要**出现 `.cm-editor` 前缀（编辑器几何留在 `theme.css`）。
- 在 `src/cm/theme.css` 顶部 `@import './../shared/blocks.css'`（只加这一行，别动别的）。
- 目标：消费方 `import '@nexusmc-cn/nexusdown/blocks.css'` 就能让渲染 HTML 和编辑器「长得一样」。

### 2.3 `tests/dialect/parity.test.ts` + `tests/dialect/fixtures.ts`

- fixture 覆盖 §2.1 契约表里的块；
- 渲染侧：`renderMarkdown()` → jsdom 解析 → 提取每个块的 tag + class；
- 编辑器侧：用现有 `nexusdownLivePreview` / `nexusdown()` 建 state → 取 `DecorationSet` → 提取 class；
- 契约表驱动断言；**尚未契约化的块标 `pending`（phase 2）**，测试必须绿；
- 目的：phase 2 每改一个块，就把对应行从 pending 翻成断言。

### 2.4 渲染侧 `<mark>` 类名

`src/render/mark.ts`：`<mark>` → `<mark class="nd-highlight">`（唯一允许的渲染侧改动）。
同步更新受影响的测试断言。

---

## 3. 文件所有权

**可改 / 新建**：

- `docs/2026-10-19-render-contract.md`
- `src/shared/blocks.css`
- `src/cm/theme.css`（仅加 `@import` 一行）
- `src/render/mark.ts`
- `tests/dialect/parity.test.ts`、`tests/dialect/fixtures.ts`

**禁止**（另一个代理正在改，phase 2 再动）：

- `src/render/renderer.ts`、`src/render/index.ts`、`src/render/features/**`
- `src/cm/features/**`、`src/cm/plugin.ts`、`src/cm/feature.ts`、`src/cm/decorate/**`
- `playground/**`、`docs/dialect-extensions.md`、`src/shared/dialect.css`
- `src/editor/**`、`package.json`

> 动手前先 `git status` 看一眼；看到别人新建的文件不要动。

---

## 4. 验证

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## 5. 报告格式

1. 改了什么（按文件，一句话）；
2. 契约表的关键决策（哪些块判为原子、哪些可编辑，为什么）；
3. 测试结果（数字 + 命令）；
4. phase 2 清单（按优先级）；
5. 未决问题。
