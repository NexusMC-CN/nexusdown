# 方言接入工单 · 阶段 0 + 阶段 1

> 给实现代理（subagent）的工作单。**先读这份，再读两份规范**：
> `docs/dialect-extensions.md`（契约，含新增的 §0 属性行规范）
> `docs/2026-10-19-dialect-vs-oink.md`（为什么做这些、四层模型）
>
> 本次只做**阶段 0 + 阶段 1**。阶段 2（属性行基础设施 + Steps/Cards/…）不在本次范围。

---

## 0. 硬约束（违反即返工）

1. **不换引擎**：不引入 ProseMirror/Tiptap，不改 CM6 + markdown-it 架构。
2. **不引入 shortcode**（`{{< … >}}`）。等价能力用围栏 + 属性行。
3. **不碰** `src/editor/Toolbar.vue`、`src/editor/Editor.vue` —— 另一条线在做打磨。
4. **不 commit**。工作区留改动即可。
5. 现有 447 个测试必须全绿；`npm run typecheck` / `lint` / `build` / `check:exports` 必须通过。
6. 注释风格跟仓库一致（中文、`⚠️` 标坑、写"为什么"不写"是什么"）。

---

## 1. 阶段 0：方言画廊 + 基线

### 1.1 playground 画廊

在 `playground/` 里把现有 fixtures 扩成**方言画廊**：

- `playground/src/fixtures.ts`：每个语法一个 fixture（至少覆盖：标题/强调/高亮/删除线/行内码/链接/引用/列表/任务/表格/围栏代码/行内数学/块级数学/提及/embed/自动链接/图片/轮播）。
- `playground/src/App.vue`：加一个"当前 fixture 覆盖语法"的显示（可复用底部状态栏），让一眼看出哪条语法还没被样例覆盖。
- 不改 playground 的既有交互（编辑/预览/HTML/Markdown 三 tab、状态栏）。

### 1.2 parity 脚手架

新建 `tests/dialect/`：

- `tests/dialect/gallery.test.ts`：遍历 fixtures，断言 `renderMarkdown()` 产出包含关键结构（`<h1>`、`<table>`、`<mark>`、`<pre>` 等），并输出快照。
- 目的：以后每个组件只需加一个 fixture + 一条断言，就能同时锁住渲染侧。

### 1.3 基线

在 `docs/2026-10-19-dialect-vs-oink.md` 末尾追加一节「基线」，记录：
- 120 段压力 fixture 的 `renderMarkdown` 耗时（取 5 次中位数）；
- 大文档滚动/折叠是否有可见跳变（人工观察，写结论即可）。

> 不做微基准测试（易脆）。数字写进文档即可。

---

## 2. 阶段 1：三个 P0 语法

### 2.1 `$$` 块级数学（正典）

**目标**：`$$ … $$` 成为块级数学正典；` ```math ` 保留为**别名**；行内 `$…$` 不变。

- **渲染侧**（`src/render/`）：
  - 新增 markdown-it block rule：行首 `$$` 开、行首 `$$` 闭（支持单行 `$$x$$` 与多行）；
  - 产出与 ` ```math ` **逐字节一致**的 HTML（复用现有 math 渲染路径，含无 KaTeX 时的降级形态）；
  - 边界：`$$` 后不能紧跟非空白的普通文本（避免把 `$$5` 当公式）；`$` 与价格规则写进文档：开 `$` 后非空白、闭 `$` 前非空白。
- **编辑器侧**（`src/cm/`）：
  - ⚠️ **已知冲突**：`mention` 功能已认领 `Paragraph`，`indexFeatures` 会拒绝第二个认领者。
  - 二选一，**优先 A**：
    - **A**：给 `EditorFeature` 加可选 `priority`，把 `indexFeatures` 的 `Map<string, EditorFeature>` 改成 `Map<string, EditorFeature[]>`（或组合装饰器），`plugin.ts` 遍历全部；两个功能各自按文本前缀 no-op。改完补测试：重复认领不再抛错，但顺序稳定。
    - **B**：`$$` 块走独立的 `StateField`（类似 `foldedBlocks`），不进功能注册表；`blockDecorations` 之外再提供一份装饰。
  - 块级替换 + 「点开才揭示」（沿用 `editingBlock`）。
- **文档**：更新 `docs/dialect-extensions.md` §2 的「为什么块级用围栏而不是 `$$`」——改成「`$$` 正典、围栏别名」，并写清边界规则。

### 2.2 Callouts

**语法**：`> [!NOTE]` 作为引用块第一行。10 种类型：
`note` / `tip` / `important` / `warning` / `caution` / `danger` / `info` / `success` / `question` / `example`。

- **渲染侧**：`blockquote` 规则识别首段 `[!TYPE]` →
  `<div class="nd-callout nd-callout--note"><p class="nd-callout__title">…</p>…</div>`；
  未知类型 → **退回普通 `<blockquote>`**（不报错、不吞内容）。
- **编辑器侧**：引用块首行标记替换为小徽章（图标 + 类型名），整块加 `nd-callout--*` 样式；
  揭示态显示源码 `[!NOTE]`。
- **样式**：写进 `src/shared/dialect.css`（两侧共用），颜色一律
  `var(--nd-*, var(--站令牌, 字面量))` 两级回退；10 类型 = 色板 + 图标。
- **测试**：`tests/render/callout.test.ts` + `tests/cm/callout.test.ts`（含未知类型、嵌套引用、首行不是标记的普通引用）。

### 2.3 Embed URL 形式

**目标**：` ```embed <url> ` 成为正典，复用 `parseEmbedUrl()`；三 token 形式保留为 legacy。

- 渲染侧 `src/render/features/embed.ts` 的围栏解析加 URL 分支；
- 编辑器侧 `src/cm/features/embed.ts` 同步（占位卡标题、provider 图标）；
- 非法 URL / 未知平台 → 按普通代码块处理（**不要**输出空 iframe）；
- 测试：URL 形式、legacy 形式、非法输入、与长链自动识别的一致性。

### 2.4 收尾

- `docs/dialect-extensions.md`：更新 §2（数学）、§4（embed），新增 §9（callout）。
- 跑全套验证：

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run check:exports
```

---

## 3. 交付报告格式

1. **改了什么**：按文件列（一句话说明）。
2. **关键决策**：`$$` 编辑器侧选了 A 还是 B、为什么；callout 10 类型的映射表。
3. **测试结果**：数字（文件数/用例数）+ 四个命令的通过情况。
4. **未决问题**：需要人拍板的点。
5. **不要**贴大段 diff。
