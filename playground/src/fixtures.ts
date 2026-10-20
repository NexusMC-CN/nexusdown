/**
 * Playground 的**方言画廊**。
 *
 * 两个用途，一份数据：
 *
 * | 谁 | 用哪几个字段 |
 * | --- | --- |
 * | `playground/src/App.vue` | `label` / `markdown` / `covers` —— 选样例、显示「这条语法有没有样例」 |
 * | `tests/dialect/gallery.test.ts` | `markdown` / `expects` —— 逐条断言渲染产出并拍快照 |
 *
 * ## 为什么 `covers` / `expects` 写在数据里，而不是写进测试
 *
 * 任务书要的脚手架是「**以后每个组件只需加一个 fixture + 一条断言**」。把断言
 * 写在 fixture 旁边（`expects`）而不是写在 `describe` 里，就只需要改**一个文件**：
 * 加一条语法 → 在 `DIALECT_SYNTAXES` 里加一行、写一个 fixture、写它该有的结构。
 * 测试只负责「遍历 + 断言」，永远不用改。
 *
 * ⚠️ `expects` 是**渲染侧的产出**（`renderMarkdown()` 的 HTML 片段），不是编辑器侧。
 * 编辑器侧的行为由 `tests/cm/*.test.ts` 各自守着。
 *
 * ## 约定
 *
 * - 一个 fixture **只讲一条语法**（`minimal` / `full` / `stress` / `empty` 除外）——
 *   这样「哪条语法坏了」一眼能看出来，不用在一大坨输出里找。
 * - 画廊里的内容**不依赖外部数据**（`RenderData`）：playground 没有数据源，
 *   测试也用同一份输入。所以提及显示成源码、短链 embed 降级成代码块 ——
 *   那本身就是契约的一部分（「取不到就降级」），一起锁住。
 */

/** 一条方言语法（画廊目录里的一格）。 */
export interface DialectSyntax {
  /** 稳定 id，`Fixture.covers` 用它。 */
  id: string
  /** 状态栏上显示的名字。 */
  label: string
}

/**
 * 画廊目录 —— **有样例的语法**，也是状态栏那排徽章的来源。
 *
 * 顺序按「行内 → 块级 → 组件」排，和 `docs/dialect-extensions.md` 的章节顺序接近，
 * 这样文档和画廊能对着看。
 */
export const DIALECT_SYNTAXES: readonly DialectSyntax[] = [
  { id: 'heading', label: '标题' },
  { id: 'emphasis', label: '强调' },
  { id: 'highlight', label: '==高亮==' },
  { id: 'strikethrough', label: '~~删除线~~' },
  { id: 'inline-code', label: '行内码' },
  { id: 'link', label: '链接' },
  { id: 'autolink', label: '自动链接' },
  { id: 'blockquote', label: '引用' },
  { id: 'callout', label: 'Callout' },
  { id: 'list', label: '列表' },
  { id: 'task-list', label: '任务列表' },
  { id: 'table', label: '表格' },
  { id: 'fenced-code', label: '围栏代码' },
  { id: 'diagram', label: '图表（Pele）' },
  { id: 'inline-math', label: '行内数学' },
  { id: 'block-math', label: '块级数学' },
  { id: 'mention', label: '提及' },
  { id: 'embed', label: 'embed' },
  { id: 'image', label: '图片' },
  { id: 'carousel', label: '轮播' },
]

export interface Fixture {
  id: string
  label: string
  markdown: string
  /** 这个样例覆盖了哪些语法（`DIALECT_SYNTAXES` 的 id）。 */
  covers: readonly string[]
  /**
   * 渲染产出里**必须出现**的 HTML 片段。
   *
   * 只挑「这条语法独有的结构」：`<mark>` 之于高亮、`<table>` 之于表格。
   * 别写整段 HTML —— 那是快照的活，写在这里会让「换个类名」变成改十处断言。
   */
  expects: readonly string[]
  /**
   * 要不要给这份样例拍 HTML 快照（默认 `true`）。
   *
   * 压力样例设 `false`：它的意义是**体量与耗时**（见 `docs/2026-10-19-dialect-vs-oink.md`
   * 的「基线」），不是形状 —— 给它拍一张 120 段的快照只会让任何一处排版改动
   * 变成几千字符的 diff。
   */
  snapshot?: boolean
}

/* -------------------------------------------------------------------------
 * 单语法样例
 * ---------------------------------------------------------------------- */

const heading = `# 一级标题

## 二级标题

### 三级标题`

const emphasis = `**加粗**、*斜体*、***粗斜体***`

const highlight = `这句话里有 ==高亮== 的部分。`

const strikethrough = `这句话里有 ~~删除线~~ 的部分。`

const inlineCode = '行内代码 `const answer = 42` 不会被当成语法。'

const link = `[nexusdown 仓库](https://github.com/NexusMC-CN/nexusdown)`

const autolink = `直接贴链接：https://github.com/NexusMC-CN/nexusdown`

const blockquote = `> 引用第一行
> 引用第二行`

const callout = `> [!NOTE]
> 这是一个提示块。类型可以是 note / tip / warning / danger 等 10 种。`

const list = `- 无序项
- 第二项
  - 嵌套项

1. 有序项
2. 第二项`

const taskList = `- [ ] 待办
- [x] 已完成`

const table = `| 左对齐 | 居中 | 右对齐 |
| :--- | :---: | ---: |
| 1 | 2 | 3 |
| **粗** | \`code\` | ==高亮== |`

const fencedCode = `\`\`\`ts
export function hello(name: string) {
  return \`hello \${name}\`
}
\`\`\``

const inlineMath = `勾股定理：$a^2 + b^2 = c^2$。`

const blockMath = `$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$`

const mention = `这句话里提到 @nexusdown 很好用。

@nexusdown`

const embed = `\`\`\`embed https://www.bilibili.com/video/BV1xx411c7mD
\`\`\``

const image = `![示例图](/img-a.svg)`

const carousel = `![图一](/img-a.svg)
![图二](/img-b.svg)`

/* -------------------------------------------------------------------------
 * 综合样例
 * ---------------------------------------------------------------------- */

/** 全功能：19 条语法各来一次（新加语法记得补进这里，状态栏会显示覆盖率）。 */
/**
 * 属性行 —— **不是 19 条方言语法之一**，是「块的后缀」这一层
 * （`docs/dialect-extensions.md` §0）。
 *
 * 编辑器侧已经显示成 chip（`src/cm/features/attrs.ts`）；渲染侧阶段 2 才接，
 * 所以预览里会看到 `{.steps}` 原文 —— 这是**当前真实状态**，不是 bug。
 */
const attrs = `- 第一步
- 第二步
- 第三步

{.steps}`

const fenceAttrs = `\`\`\`ts
export function hello(name: string) {
  return \`hello \${name}\`
}
\`\`\`
{lines highlight="2-3"}`

const tableCaption = `| 参数 | 类型 | 默认值 |
| --- | --- | --- |
| timeout | number | 30 |
| retries | number | 3 |

{.fields caption="配置项"}`

const tabs = `\`\`\`bash
apt install nginx
\`\`\`
{tab="Ubuntu"}

\`\`\`bash
brew install nginx
\`\`\`
{tab="macOS"}

尾部`

const diagram = `## 流程图

\`\`\`mermaid
flowchart LR
  A[编写 Markdown] --> B{预览图表}
  B --> C[点击修改源码]
  B --> D[发布 SVG]
\`\`\`

## 时序图

\`\`\`mermaid
sequenceDiagram
  participant U as 用户
  participant E as 编辑器
  U->>E: 输入 Mermaid 源码
  E-->>U: 显示 Pele 图表
\`\`\`

图表仍以 Markdown 源码保存。`

const full = `# nexusdown 方言画廊

这是 **加粗**、*斜体*、***粗斜体***、~~删除线~~、\`行内代码\`、==高亮== 的混排。

[链接](https://example.com) 和自动链接 https://github.com/NexusMC-CN/nexusdown。

> 普通引用块。

> [!TIP]
> 提示块（callout）也是引用块，首行是 \`[!TYPE]\`。

## 列表

- 无序项
- 第二项
  - 嵌套项

1. 有序项
2. 第二项

- [ ] 待办
- [x] 已完成

## 表格

| 左对齐 | 居中 | 右对齐 |
| :--- | :---: | ---: |
| 1 | 2 | 3 |
| ==高亮== | \`code\` | **粗** |

## 代码

\`\`\`ts
export function hello(name: string) {
  return \`hello \${name}\`
}
\`\`\`

## 数学

行内 $a^2 + b^2 = c^2$，块级：

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## 嵌入

\`\`\`embed https://www.bilibili.com/video/BV1xx411c7mD
\`\`\`

## 变体（属性行）

### 步骤

- 准备
- 安装
- 验证

{.steps}

### 参数表

| 参数 | 类型 | 默认值 |
| --- | --- | --- |
| timeout | number | 30 |
| retries | number | 3 |

{.fields caption="配置项"}

### 行号与高亮

\`\`\`ts
export function hi(name) {
  return name
}
\`\`\`
{lines highlight="2"}

### 页签

\`\`\`bash
apt install nginx
\`\`\`
{tab="Ubuntu"}

\`\`\`bash
brew install nginx
\`\`\`
{tab="macOS"}

## 提及与图片

@nexusdown 是一个 Markdown 编辑器。

![图一](/img-a.svg)
![图二](/img-b.svg)

## 图表

\`\`\`mermaid
flowchart LR
  A[编写] --> B[预览] --> C[发布]
\`\`\``

const minimal = `# 最小样例

一段普通文字，带 **加粗** 和 \`行内代码\`。`

/**
 * 压力样例：120 段。
 *
 * ⚠️ 它同时是 `docs/2026-10-19-dialect-vs-oink.md`「基线」那一节的测量对象 ——
 * 改它的形状（段数、每段长度）就等于换了基准，得重新测。
 */
const stress = Array.from(
  { length: 120 },
  (_, i) =>
    `## 段落 ${i + 1}\n\n这是第 ${i + 1} 段，包含 **加粗**、*斜体*、\`code\`、==高亮== 与 [链接](https://example.com/${i + 1})。\n`,
).join('\n')

export const fixtures: Fixture[] = [
  { id: 'heading', label: '标题', markdown: heading, covers: ['heading'], expects: ['<h1>', '<h2>', '<h3>'] },
  {
    id: 'emphasis',
    label: '强调（粗 / 斜 / 粗斜）',
    markdown: emphasis,
    covers: ['emphasis'],
    expects: ['<strong>', '<em>'],
  },
  { id: 'highlight', label: '==高亮==', markdown: highlight, covers: ['highlight'], expects: ['<mark class="nd-highlight">'] },
  {
    id: 'strikethrough',
    label: '~~删除线~~',
    markdown: strikethrough,
    covers: ['strikethrough'],
    expects: ['<s>'],
  },
  {
    id: 'inline-code',
    label: '行内代码',
    markdown: inlineCode,
    covers: ['inline-code'],
    expects: ['<code>const answer = 42</code>'],
  },
  {
    id: 'link',
    label: '链接',
    markdown: link,
    covers: ['link'],
    expects: ['<a target="_blank" rel="noopener noreferrer nofollow" href="https://github.com/NexusMC-CN/nexusdown">'],
  },
  {
    id: 'autolink',
    label: '自动链接',
    markdown: autolink,
    covers: ['autolink'],
    expects: ['href="https://github.com/NexusMC-CN/nexusdown"'],
  },
  {
    id: 'blockquote',
    label: '引用块',
    markdown: blockquote,
    covers: ['blockquote'],
    expects: ['<blockquote>'],
  },
  {
    id: 'callout',
    label: 'Callout（> [!NOTE]）',
    markdown: callout,
    covers: ['callout'],
    expects: ['<div class="nd-callout nd-callout--note">', '<p class="nd-callout__title">'],
  },
  { id: 'list', label: '列表', markdown: list, covers: ['list'], expects: ['<ul>', '<ol>', '<li>'] },
  {
    id: 'task-list',
    label: '任务列表',
    markdown: taskList,
    covers: ['task-list'],
    expects: ['<input type="checkbox"/>', 'checked="checked"'],
  },
  {
    id: 'table',
    label: '表格',
    markdown: table,
    covers: ['table'],
    expects: ['<table>', '<th style="text-align:left">', '<td style="text-align:left">'],
  },
  {
    id: 'fenced-code',
    label: '围栏代码',
    markdown: fencedCode,
    covers: ['fenced-code'],
    expects: ['<div class="nd-code-fence">', '<code class="language-ts">'],
  },
  {
    id: 'inline-math',
    label: '行内数学 $…$',
    markdown: inlineMath,
    covers: ['inline-math'],
    expects: ['<code class="nd-math-source">$a^2 + b^2 = c^2$</code>'],
  },
  {
    id: 'block-math',
    label: '块级数学 $$…$$',
    markdown: blockMath,
    covers: ['block-math'],
    expects: ['<div class="nd-math nd-math-block">', '<pre class="nd-math-source">'],
  },
  {
    id: 'mention',
    label: '提及 @slug',
    markdown: mention,
    covers: ['mention'],
    // 没注入 `RenderData.mentions` → 降级成源码文本（契约 §8 的降级路径）。
    expects: ['@nexusdown'],
  },
  {
    id: 'embed',
    label: 'embed（URL 形式）',
    markdown: embed,
    covers: ['embed'],
    expects: ['data-nd-embed="bilibili:video"', '<iframe class="nd-embed__frame"'],
  },
  {
    id: 'image',
    label: '图片',
    markdown: image,
    covers: ['image'],
    expects: ['<img src="/img-a.svg" alt="示例图"/>'],
  },
  {
    id: 'carousel',
    label: '轮播（连续图片）',
    markdown: carousel,
    covers: ['carousel'],
    expects: ['<div class="nd-carousel">', 'class="nd-carousel__track"', 'class="nd-carousel__dots"'],
  },
  {
    id: 'attrs',
    label: '属性行（编辑器 chip + 渲染侧类名）',
    markdown: attrs,
    covers: [],
    expects: ['class="nd-steps"'],
  },
  {
    id: 'fence-attrs',
    label: '代码块行号 / 行高亮',
    markdown: fenceAttrs,
    covers: [],
    expects: ['class="nd-code-lines"', 'nd-code-line--hl'],
  },
  {
    id: 'tabs',
    label: '页签组（相邻围栏）',
    markdown: tabs,
    covers: [],
    expects: ['class="nd-tabs"', 'class="nd-tabs__bar"'],
  },
  {
    id: 'table-caption',
    label: '参数表 + 标题',
    markdown: tableCaption,
    covers: [],
    expects: ['class="nd-fields"', '<caption>配置项</caption>'],
  },
  {
    id: 'full',
    label: '全功能样例',
    markdown: full,
    covers: DIALECT_SYNTAXES.map((syntax) => syntax.id),
    expects: [
      '<h1>',
      '<strong>',
      '<mark class="nd-highlight">',
      '<s>',
      '<blockquote>',
      'nd-callout--tip',
      '<ul>',
      '<ol>',
      'type="checkbox"',
      '<table>',
      'class="nd-code-fence"',
      'nd-math-source',
      'nd-math-block',
      '@nexusdown',
      'data-nd-embed="bilibili:video"',
      'nd-carousel__track',
      '<img ',
      'nd-steps',
      'nd-fields',
      'nd-code-lines',
      'class="nd-tabs"',
      'class="nd-diagram"',
    ],
  },
  {
    id: 'diagram',
    label: '图表（Pele · Mermaid 语法）',
    markdown: diagram,
    covers: ['diagram'],
    expects: ['class="nd-diagram"', '<svg', '编写 Markdown', '用户'],
  },
  { id: 'minimal', label: '最小样例', markdown: minimal, covers: ['heading', 'emphasis', 'inline-code'], expects: ['<h1>', '<strong>', '<code>'] },
  {
    id: 'stress',
    label: '压力测试（120 段）',
    markdown: stress,
    covers: ['heading', 'emphasis', 'highlight', 'inline-code', 'link'],
    expects: ['<h2>', '<mark class="nd-highlight">', '<a '],
    snapshot: false,
  },
  { id: 'empty', label: '空白', markdown: '', covers: [], expects: [] },
]
