# 视觉对拍审计（编辑器 vs 渲染器）

> 方法：Playwright（puppeteer-core + 本机 Chrome）打开 playground，
> **逐样例截图 + 逐行点击截图 + 计算样式对拍**。
> 产物：`.local/qa-shots/`（125 张）、`scripts/qa-shots.mjs`、`scripts/qa-bottom.mjs`、`scripts/qa-styles.mjs`。
>
> 原则：只修「同一份内容、两侧应该一样」的差异；**刻意不同**的记进「已知差异」，
> 不硬凑。

---

## 1. 修掉的问题

| # | 问题 | 证据 | 修复 |
| --- | --- | --- | --- |
| 1 | **`==高亮==` 编辑器完全不渲染**（显示字面量） | 截图 `highlight.png`；`src/cm` 无高亮实现 | 新增 `src/cm/features/highlight.ts`：认领 `Paragraph`、正则与 `render/mark.ts` 逐字一致、内容挂 `.nd-highlight`、定界符揭示/隐藏、跳过行内代码；注册进 `EDITOR_FEATURES`；补 9 条测试 |
| 2 | **轮播在渲染侧没样式**：显示成项目符号列表 + 「1. 1 / 2. 2」 | 截图 `carousel.png`（修复前） | `src/shared/dialect.css` 补 `.nd-carousel*`：`track` 去列表符号 + `scroll-snap`，`dots` 去序号 + 圆点，零 JS |
| 3 | **`div.nd-callout` 误伤编辑器**：`.cm-line` **就是** `<div>`，于是每行吃到 `margin: 0.8em` / 纵向 padding / 圆角 → 行距撑开、背景一段段圆角色块，且 margin 不进 CM6 高度表 | 计算样式 `calloutLine` margin 11.6px（=0.8em）、`border-radius: 6px`；截图 `full.png`（修复前） | 选择器改 `div.nd-callout:not(.cm-line)`，并把错误注释改正 |
| 4 | **表格行高两侧不一致**（预览 54px/行 vs 编辑器 37px/行） | `qa-styles` 输出 | 根因是 playground 自己的 `.nd-preview p { margin }` 盖过了 `blocks.css` 的 `td > p { margin: 0 }`；playground 改为**只设容器字体**，块级排版全部交给 `blocks.css`。修复后 `th` 的 padding / 背景 / 字号逐项相同 |
| 5 | **代码块标题栏字号不一致**（预览 14.5px vs 编辑器 13.34px） | `qa-styles` | `blocks.css` 加 `.nd-code-fence > .nd-code-header { font-size: 0.92em }`（只命中显示侧），padding 也随之对齐 |
| 6 | **标题字号不一致**：`blocks.css` 用 2/1.6/1.35em，编辑器实际是 1.5/1.3/1.15em（`Editor.vue` scoped 覆盖） | `qa-styles` h2：25.6 vs 18.85 | `blocks.css` 对齐到编辑器实际值，并写明「以编辑器实际渲染为准」 |
| 7 | **图片全是裂图**（`example.com`） | 截图 `carousel.png` / `image.png` | playground 加 `public/img-a.svg`、`img-b.svg`，fixtures 改用本地占位图 |
| 8 | **数学两侧都不渲染**（playground 没注入 KaTeX） | 截图 `block-math.png`（修复前是 `pre` 原文） | playground 装 `katex`，**同一份** `katexRenderer(katex)` 喂给 `renderMarkdown` 和 `<NexusdownEditor :math-renderer>`；截图 `full-math.png` 两侧公式一致 |
| 9 | 提及在 playground 永远是降级态 | 截图 `mention.png` | playground 注入演示用 `RenderData.mentions`，两侧都拿到同一条解析结果 |

---

## 2. 已知差异（刻意保留，不是 bug）

| 差异 | 原因 | 结论 |
| --- | --- | --- |
| 行内提及：编辑器显示 `@slug`，渲染侧显示解析后的标题 | 编辑器里它是「你写的语法」的提示；渲染侧才换成显示名 | 保留（`dialect-extensions.md` §8 已写） |
| 轮播：编辑器是逐张 `ImageWidget`，没有轮播外壳 | 跨行 widget 在 CM6 里做不到；契约只要求「静态提示」 | 保留 |
| 块间距：编辑器靠源码空行（一整行 26.1px），渲染侧靠 `margin`（1em） | 结构不同，只能保证同一档 | 保留（render-contract 未决 #3） |
| Callout：编辑器行没有上下 margin（CM6 高度表），渲染侧有 `0.8em` | 行上写 margin 会让光标浮起来 | 保留（`dialect.css` 注释已写） |
| 任务列表：复选框都是 15px，但文字基线/间距略有差异 | 编辑器 widget 与渲染侧 `<label>` 结构不同 | 可继续微调（低优先） |
| 标题里的 `==高亮==`：编辑器不渲染 | `highlight` 只认 `Paragraph`（同 mention） | 记为已知覆盖差异 |

---

## 3. 复现方式

```bash
# 1. 起 playground（5199）
npm run playground

# 2. 全量截图（每个样例 + 每行点击）
node scripts/qa-shots.mjs

# 3. 文末渲染态（代码块 / 数学 / embed / 图片）
node scripts/qa-bottom.mjs full

# 4. 计算样式对拍（输出 .local/qa-shots/styles.json）
node scripts/qa-styles.mjs
```

## 4. 改动文件

- `src/cm/features/highlight.ts`（新）、`src/cm/features/index.ts`
- `src/shared/dialect.css`（callout 选择器、carousel 样式）
- `src/shared/blocks.css`（标题字号、代码头字号）
- `playground/src/App.vue`（容器字体、KaTeX、RenderData、blocks.css）
- `playground/src/fixtures.ts`（本地图片）
- `playground/public/img-a.svg`、`img-b.svg`（新）
- `tests/cm/highlight.test.ts`（新）、`tests/dialect/fixtures.ts`（highlight 翻 contracted）、快照
- `scripts/qa-shots.mjs`、`qa-bottom.mjs`、`qa-styles.mjs`（新，QA 工具）
