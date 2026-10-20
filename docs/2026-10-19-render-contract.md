# 渲染契约 · 阶段 1（一份 spec、两个投影器）

> 上游：`docs/2026-10-19-dialect-vs-oink.md`（四层语法模型）、`docs/dialect-extensions.md` §0（属性行）。
> 本阶段交付：本文件、`src/shared/blocks.css`、`tests/dialect/{fixtures,parity.test}.ts`、
> `src/render/mark.ts` 的契约类名。
>
> ⚠️ **不**统一解析器、**不**改渲染规则、**不**碰 `renderer.ts` / `features/**` ——
> 那些是 phase 2（另一个代理正在同时改，见 `2026-10-19-render-contract-work-order.md` §3）。

---

## 0. 一句话

**不是「共用 DOM」，是：原子节点共用 HTML 投影器，可编辑节点共用语义（类名 / 标签）。**

```
一份 lezer AST
   ├─ HTML 投影器（渲染侧，src/render/**）      ← 原子节点共用「同一段字符串」
   └─ CM6 投影器（编辑器装饰，src/cm/**）       ← 可编辑节点共用「同一套类名 / 标签」
```

两侧**永远**不会产出同一棵 DOM 树：编辑器里是 `contenteditable` 的文本行，渲染侧是干净的
语义标签。所以「长得一样」必须靠下面两样东西，而不是靠「DOM 结构一致」：

| 靠什么 | 原子节点 | 可编辑节点 |
| --- | --- | --- |
| **结构** | 同一个投影器函数产出的**同一段 HTML** | 各产各的 DOM（CM6 的文本行 vs 语义标签） |
| **视觉** | 同一段 HTML + 同一份 CSS | **同一套类名 / 标签** + 同一份 CSS |

---

## 1. 轴：原子 vs 可编辑

> ★ **这条轴不是「行级 vs 块级」。** 行级/块级是**排版**维度，跟「共享什么」无关；
> 拿它当轴会得出「代码围栏是块级所以该共用 DOM」这种错误结论（代码文本恰恰是可编辑的）。

### 1.1 判据（一句话）

**非揭示态下，这段内容在编辑器里还是不是「可编辑的字符」？**

| 答案 | 判为 | 共享什么 | DOM 谁产 | 编辑器的职责 |
| --- | --- | --- | --- | --- |
| 不是（被 widget 替换，或结构由渲染侧决定） | **原子** | HTML 投影器（同一段字符串） | 渲染侧 | 把 HTML 塞进 widget + 「点开才揭示」 |
| 是（CM6 的文本节点，用户能直接改字） | **可编辑** | 语义（类名 / 标签）+ CSS | CM6 | mark / line 装饰 + 揭示 + `atomicRanges` |

### 1.2 用判据过一遍（含反例）

| 节点 | 行内/块级 | 非揭示态是字符吗 | 判为 | 为什么容易判错 |
| --- | --- | --- | --- | --- |
| 标题 / 段落 | 块级 | **是** | 可编辑 | 块级 ≠ 原子 |
| 粗 / 斜 / 删 / 高亮 / 行内码 | 行内 | **是** | 可编辑 | 行内 ≠ 一定原子 |
| 链接 | 行内 | **是**（文字可改） | 可编辑 | 只有 Cmd/Ctrl+点击才跳转 |
| 引用 / 列表 | 块级 | **是** | 可编辑 | 符号被淡化/替换，正文仍是字符 |
| **任务列表复选框** | 行内 | 不是（widget） | **原子** | 列表项本身是可编辑的，**只有复选框**是原子 |
| 代码围栏 | 块级 | **是**（代码行可改） | 可编辑 | ★ 唯一的例外：**标题栏**是原子部件 |
| 表格 | 块级 | 不是（整块 widget） | **原子** | ★ 单元格在编辑器里**改不了**，所以是原子 |
| 图片 | 行内 | 不是（widget） | **原子** | alt 只在揭示态可改 |
| 分割线 `---` | 块级 | 不是（整行字符被藏） | **原子** | DOM 不是 `<hr>` 而是「行 + CSS 边框」 |
| 行内数学 `$…$` | 行内 | 不是（widget） | **原子** | 行内但被 replace |
| 块级数学 ` ```math ` | 块级 | 不是（block widget） | **原子** | 和表格同一条块级通道 |
| mention 胶囊 / 卡片 | 行内 / 块级 | 不是（widget） | **原子** | 源码只在揭示态可编辑 |
| embed | 块级 | 不是（占位卡 widget） | **原子** | 绝不加载真 iframe |

> ⚠️ **「原子」不等于「共用同一棵 DOM」**：mention 胶囊在编辑器里是 `<span class="nd-mention">`，
> 渲染侧是 `<a class="nd-mention">` —— **类名共用、标签不同**，而且这是刻意的
> （编辑器里它不是链接，点它是定位光标）。原子节点共用的是**投影器 / 契约**，
> 不是结构；结构能不能共用，看「内容是不是同一段字符串」。

### 1.3 两种「原子」的成色（决定 phase 2 怎么补）

| 成色 | 含义 | 现状 |
| --- | --- | --- |
| **共用投影器**（最强） | 编辑器**调用**渲染侧的函数拿 HTML | 表格（`renderMarkdown`）、代码围栏标题栏（`renderCodeHeaderHtml`）、块级公式（同一个 KaTeX 渲染函数） |
| **契约同构**（次强） | 两侧各自搭 DOM，但**类名 + 结构逐字约定** | mention（`dialect.css`）、图片（`img` 标签） |
| **分叉**（待补） | 两侧各有一套类名 / 结构 | embed（`nd-embed` vs `nd-embed-card`）、行内数学（渲染侧没有 `.nd-math` 外壳） |

---

## 2. 契约表

> 状态：**已有** = 两侧都按契约产出；**待补** = 一侧还没实现（parity 里是 `pending`），
> **就是 phase 2 的活**（§6 有逐项清单）；**结构决定** = 两侧 DOM 必然不同，
> 契约只到「语义 + 视觉」。
>
> `tests/dialect/fixtures.ts` 里每条 fixture 的 `block` 必须出现在这张表里 ——
> 覆盖率由 `parity.test.ts` 的第一条测试守着。

| 块 | 轴 | 编辑器 DOM / 类 | 渲染侧 DOM / 类 | 共享 CSS | 状态 |
| --- | --- | --- | --- | --- | --- |
| **标题** h1–h6 | 可编辑 | `.cm-line.nd-h1`…`.nd-h6`（`Decoration.line`）；`# ` 定界符 HIDE / 变淡 | `<h1>`…`<h6>`（**无类**） | `blocks.css`：`h1, .nd-h1` … | 编辑器**已有** / 渲染侧**待补** `.nd-h*` |
| **段落** | 可编辑 | `.cm-line`（**无类**，CM6 的行就是段落） | `<p>`（无类） | `blocks.css`：`p` 只给段间距 | 排版层**已有**；`.nd-p` **待定**（见 §6） |
| **粗 / 斜 / 删** | 可编辑 | `.nd-strong` / `.nd-em` / `.nd-strike`（`Decoration.mark` 覆盖整节点含定界符） | `<strong>` / `<em>` / `<s>`（无类） | `blocks.css`：`strong, .nd-strong` 等 | 编辑器**已有** / 渲染侧**待补** |
| **高亮** `==…==` | 可编辑 | ★ **未实现**（lezer 不产节点，需行内正则扫描） | `<mark class="nd-highlight">` | `blocks.css`：`mark, .nd-highlight` | 渲染侧**已有**（阶段 1 唯一渲染改动）/ 编辑器**待补** |
| **行内码** | 可编辑 | `.nd-code`（`Decoration.mark`） | `<code>`（无类） | `blocks.css`：`code, .nd-code` | 编辑器**已有** / 渲染侧**待补** |
| **链接** | 可编辑 | `.nd-link` mark + `data-href`；`[`、`](url)` HIDE / 变淡 | `<a target="_blank" rel="noopener noreferrer nofollow" href>` | `blocks.css`：`a, .nd-link` | 编辑器**已有** / 渲染侧**待补** |
| **引用** | 可编辑 | `.cm-line.nd-blockquote`；`>` 淡化 | `<blockquote>` | `blocks.css`：`blockquote, .nd-blockquote` | 编辑器**已有** / 渲染侧**待补** |
| **列表** | 可编辑 | `.cm-line.nd-list-item` + `.nd-list-marker` widget（`•` / `1.`） | `<ul>` / `<ol>` / `<li><p>`（**恒有 `<p>`**） | `blocks.css`：`ul, ol, .nd-list` | 编辑器**已有** / 渲染侧**待补** `.nd-list` |
| **任务列表** | 文本可编辑 / **复选框原子** | `input.nd-task-checkbox`（可交互 widget，**永远渲染**） | `<li data-type="taskItem"><label><input type="checkbox"/><span/></label><div><p>` | `blocks.css` 用 `li[data-type='taskItem']` + **同数值**对齐 | 编辑器**已有** / 渲染侧**待补** `.nd-task-checkbox` |
| **表格** | **原子** | `TableWidget` → `div.nd-table` 内层 = `renderMarkdown()` 的输出 | `<table><tbody><tr><th><p>`（**没有 `<thead>`**） | `blocks.css`：`table/th/td` + `.nd-table` 外壳 | ★ **已契约**（共用投影器，parity 逐字比对 innerHTML） |
| **分割线** | **原子** | `.cm-line.nd-hr`（整行字符藏掉，线由 `border-top` 画） | `<hr/>`（无类） | `blocks.css`：`hr, .nd-hr` | 编辑器**已有** / 渲染侧**待补** `.nd-hr` |
| **代码围栏** | 代码文本可编辑 / **标题栏原子** | 一组 `.cm-line.nd-code-block*` + `CodeFenceHeaderWidget`（`.nd-code-header`） | `div.nd-code-fence > .nd-code-header + pre > code.language-*` | `theme.css` 的标题栏部件（两侧共用）；`blocks.css` 补 `pre` / `.nd-code-fence` | ★ **标题栏已契约**；容器**结构决定** |
| **图片** | **原子** | `ImageWidget` → `img.nd-image-widget`（`Decoration.replace`） | `<img src alt/>`（无类） | `blocks.css`：`img`（共享的是**标签**不是类名） | ★ **已契约**（语义层） |
| **mention** | **原子** | 行内 `span.nd-mention`；独占一段 `span.nd-mention-card` | `<a class="nd-mention">` / `<a class="nd-mention-card">` | `dialect.css`（两侧同一份） | ★ **已契约** |
| **embed** | **原子** | `div.nd-embed-card.nd-embed-card--<provider>` + 行级 `.nd-embed-open` / `.nd-embed-hidden` | `div.nd-embed.nd-embed--<provider> > details > iframe` | **没有**（`dialect.css` 明确还没做） | ✗ **两侧分叉**（**待补** · phase 2） |
| **数学** | **原子**（行内 / 块级） | 行内 `span.nd-math`（注入渲染函数时内联 KaTeX）；块级 `div.nd-math.nd-math-block` | 行内：KaTeX 的 `<span class="katex">` 或 `<code class="nd-math-source">`（**没有 `.nd-math` 外壳**）；块级 `div.nd-math.nd-math-block` | 块级：`features/math.css`；行内：无 | 块级 ★ **已契约** / 行内 **待补** 外壳 |

### 2.1 三条容易看漏的约定

1. **渲染侧 `<li>` / `<td>` / `<th>` 里恒有 `<p>`**（`renderer.ts` 的 `paragraph_open`
   无条件发 `<p>`，为的是和「列表项内容就是段落」逐字一致）。
   → `blocks.css` 必须把 `li > p` / `th > p` / `td > p` 的 `margin` 压平，否则每项多一段行距。
2. **表格没有 `<thead>`**：`renderer.ts` 把 `thead_open` 改写成 `<tbody>` 了。
   → 别写 `thead` 选择器（这条坑 `features/table.css` 的文件头记过）。
3. **删除线的标签是 `<s>` 不是 `<del>`**（markdown-it 的 GFM 规则），而编辑器类叫
   `.nd-strike`。→ `blocks.css` 两个标签都写；phase 2 再决定要不要统一标签名。

---

## 3. spec 模型：节点 → 四件事

每个节点在契约里就是一条记录。**加一个块 = 加一条记录 + 两侧各实现一次**，
不是「编辑器一套、渲染器一套、各写各的」。

```ts
/** 一个节点（块级或行内）的渲染契约。 */
interface NodeSpec {
  /** 契约名，kebab-case，两侧同名（同 dialect-extensions.md 的「功能命名」）。 */
  name: string

  /** 轴：原子 = 共用 HTML 投影器；可编辑 = 共用语义（见 §1）。 */
  axis: 'atomic' | 'editable'

  /**
   * HTML 模板。
   *
   * - 原子节点：**这是唯一投影器** —— 编辑器不许手拼第二份，要么调这个函数，
   *   要么（跨不过去时）按这里的结构 + 类名逐字搭。
   * - 可编辑节点：这是**渲染侧**的形状；编辑器产不出它（CM6 拥有文本行），
   *   只承诺类名 / 标签对齐。
   */
  html: string | ((ctx: RenderContext) => string)

  /** CM6 策略：编辑器用哪种装饰表达这个节点。 */
  cm6:
    | { kind: 'mark'; class: string }      // 行内样式，覆盖整节点（含定界符）
    | { kind: 'line'; class: string }      // 行级：标题 / 引用 / 列表项 / hr
    | { kind: 'replace'; atomic: boolean } // 行内 widget（图片 / 行内数学 / 胶囊）
    | { kind: 'block-widget' }             // 块级 replace（表格 / 块级公式）
    | { kind: 'none' }                     // 段落：不加装饰

  /** 揭示策略：非揭示态是「所见即所得」，揭示态是「源码可编辑」。 */
  reveal:
    | { by: 'selection'; range: 'line' | 'node' } // 光标 / 选区碰到就露出源码
    | { by: 'click'; field: 'editingBlock' }      // 块级：点 widget 设意图标记
    | { by: 'always' }                            // 任务复选框：永远渲染（它是编辑入口）

  /** 降级策略：渲染不了时给什么，**绝不抛、绝不空白**。 */
  fallback: 'source-text' | 'plain-tag' | 'omit'
}
```

### 3.1 逐字段的「为什么」

| 字段 | 为什么必须写死 |
| --- | --- |
| `axis` | 决定**共享什么**。判错轴的直接后果：给可编辑节点写「共用 DOM」，下次改渲染结构就成了破坏性变更 |
| `html` | 原子节点的**唯一出处**。两份手写 HTML 一定会漂（`nd-embed` vs `nd-embed-card` 就是这么漂出来的） |
| `cm6` | 决定**能不能揭示**：`mark` / `line` 的字符始终可编辑；`replace` 必须登记 `atomicRanges`；`block-widget` 必须配「点开才揭示」（块级区间光标进不去） |
| `reveal` | 「编辑时看到的 = 发布出来的」的另一半是「想改的时候能改」。块级节点只能靠**意图**（`editingBlock`）而不是位置判据，见 `dialect-extensions.md` 的硬约束 3 |
| `fallback` | 渲染器是同步、DOM-free、零运行时的；公式没注入 KaTeX、表格渲染抛错、提及查不到 —— 一律降级，不报错、不空白 |

### 3.2 三条实例

```ts
// 可编辑 · 行级：标题
{
  name: 'heading',
  axis: 'editable',
  html: (ctx) => `<h${ctx.level}>${ctx.children}</h${ctx.level}>`,
  cm6: { kind: 'line', class: `nd-h${ctx.level}` },  // ← 类名按 level 取
  reveal: { by: 'selection', range: 'node' },        // `# ` 与整行一起揭示
  fallback: 'plain-tag',
}

// 原子 · 块级：表格
{
  name: 'table',
  axis: 'atomic',
  html: renderTableHtml,        // ← 编辑器 TableWidget 直接 innerHTML 这个函数的输出
  cm6: { kind: 'block-widget' },
  reveal: { by: 'click', field: 'editingBlock' },    // ← 块级只能靠意图判据
  fallback: 'source-text',      // 渲染抛错 → textContent 源码 + console.warn
}

// 原子 · 行内：行内数学
{
  name: 'math-inline',
  axis: 'atomic',
  html: (ctx) => `<span class="nd-math">${ctx.renderTex(ctx.tex)}</span>`,
  cm6: { kind: 'replace', atomic: true },            // ← 必须登记 atomicRanges
  reveal: { by: 'selection', range: 'node' },
  fallback: 'source-text',      // 没注入渲染函数 → `$x^2$` 源码
}
```

---

## 4. 共享 CSS（`src/shared/blocks.css`）的三条硬规则

### ① 双选择器：`标签, .nd-*`

```css
h1, .nd-h1 { font-size: 2em; font-weight: 700; line-height: 1.3; }
```

- 渲染侧**今天**还是裸标签 → `h1` 那一半先兜住，**立刻**和编辑器一致；
- phase 2 给渲染侧加上 `class="nd-h1"` → 类名那一半自动接上，**样式一行都不用改**；
- 消费方要单独调「发布出来的标题」→ 命中 `.nd-h1`，不会误伤编辑器。

### ② 共享类名上**绝不写垂直外边距**

编辑器里这些类挂在 `.cm-line` 或块 widget 上，而 CM6 的高度表按元素盒测量，
**不含垂直 margin**（`@codemirror/view` 的 `Decoration` 文档明确要求 block 装饰
「should not have vertical margins」）。写了就是「光标浮在文字上下」，**零报错**。

所以：**垂直节奏只写在标签选择器上**（`h1 { margin: … }`），共享类名只写
行内排版（字号 / 字重 / 行高 / 颜色 / 水平 padding / 左边线）。

> 这条同时解释了一个**结构性的不对称**：编辑器里块之间的留白是**源码里的空行**
> （一整行 `.cm-line`），渲染侧的空行被 markdown-it 吃掉了，只能靠 `margin` 还原。
> 所以「块间距」这一项永远无法逐像素对齐 —— 契约只保证**同一档**（`1em` ≈ 一个空行）。

### ③ 颜色一律 `var(--nd-*, var(--站令牌, 字面量))`，字面量必须写

1. 消费方覆盖 `--nd-*`；
2. 消费方在 `:root` 定义了站里的令牌（`--ink-1` / `--border` / `--surface` / `--brand-ink`）→ 跟随站点主题；
3. 都没有 → 字面量兜底。

⚠️ **每个字面量都要写**：渲染侧可能**只**引了 `blocks.css`（没引 `theme.css`，所以
`--nd-*` 一个都没定义）—— 少了兜底，`var()` 解析失败会让**整条声明失效**，而且零报错。

### ④ 本文件里**不许出现** `.cm-editor` 前缀

编辑器几何（`.cm-line` 的 padding、块 widget 的负 margin、光标、滚动条）留在
`theme.css` / `features/*.css`。`blocks.css` 是**显示侧**的规范样式，消费方只渲染不编辑
的页面也要能整份引走。

---

## 5. parity 测试怎么用（`tests/dialect/`）

### 5.1 结构

| 文件 | 内容 |
| --- | --- |
| `fixtures.ts` | `CONTRACT_BLOCKS`（契约表必须覆盖的块）+ `PARITY_CASES`（每条 fixture 声明两侧**当前**的标签 / 类名 + **契约类名** + 状态） |
| `parity.test.ts` | 覆盖率检查 + 逐条对拍 + **原子节点共用投影器**的两条硬证据 |

对拍方式：

- **渲染侧**：`renderMarkdown()` → jsdom 解析 → 收标签 / 类名；
- **编辑器侧**：`nexusdown()` 建 state、**挂真视图**（行内功能在 ViewPlugin 里，只建 state 拿不到），
  遍历 `EditorView.decorations` facet 的**每一个** `DecorationSet`（块级功能走 StateField，
  从插件实例上读不到），连同 widget 的 `toDOM()` 一起收标签 / 类名；
- 光标一律落在 fixture 末尾垫的「尾段」里 —— 保证所有块是**非揭示态**。

### 5.2 `pending` 是**棘轮**，不是「跳过」

phase 2 之前很多块只有一侧有契约类名。这些行标 `pending`，测试断言的是「**缺口还在**」：

- 缺口还在 → 绿；
- 哪天有人给渲染侧补上 `.nd-h1` → **这一行会红**，提示把 `status` 翻成 `contracted`。

于是「改了一个块」和「更新契约」永远发生在同一次提交里。

> ⚠️ **不要**为了让测试变绿去删 `contract` —— 那等于把棘轮拆了。

### 5.3 phase 2 每改一个块的标准动作

1. 渲染侧加类名（或编辑器侧补实现）；
2. 把该行 `status` 改成 `contracted`；
3. 把两侧的 `classes` 补齐（缺的会立刻红，正好当验收）；
4. 如果 `contract` 是空数组（原子节点），确认它被 §5.4 的两条之一覆盖。

### 5.4 原子节点的硬证据

| 测试 | 断言 |
| --- | --- |
| 表格 | `TableWidget` 的 `.nd-table` **innerHTML 逐字等于** `renderMarkdown(表格源码)` |
| 块级公式 | 编辑器 widget 的内层 HTML **逐字等于** 渲染侧同一个 KaTeX 渲染函数的输出 |

这两条比「类名一致」强得多：它们证明**编辑器没有自己拼第二份 HTML**。

---

## 6. phase 2 清单（按优先级）

### P0 · 渲染侧加契约类名（纯加 `class`，风险最低，parity 立刻翻绿）

> 只动 `src/render/renderer.ts`（+ `features/**` 里已有的自定义规则），**不新增规则逻辑**。

| # | 块 | 改哪 | 目标 |
| --- | --- | --- | --- |
| 1 | 标题 | 新 `heading_open` 规则 | `<h1 class="nd-h1">` … `<h6 class="nd-h6">` |
| 2 | 粗 / 斜 / 删 / 行内码 | `strong_open` / `em_open` / `s_open` / `code_inline` | `.nd-strong` / `.nd-em` / `.nd-strike` / `.nd-code` |
| 3 | 链接 | 已有的 `rules.link_open`（改一行） | `<a class="nd-link" …>` |
| 4 | 引用 / 列表 | `blockquote_open` / `bullet_list_open` / `ordered_list_open` | `.nd-blockquote` / `.nd-list` |
| 5 | 分割线 / 图片 | `rules.hr` / `rules.image` | `<hr class="nd-hr"/>` / `<img class="nd-image-widget">`（先定名，见 P1） |
| 6 | 任务列表 | `rules.list_item_open` 里那个 `<input>` | `<input class="nd-task-checkbox">` |

> 每改完一条，把 `tests/dialect/fixtures.ts` 里对应行的 `status` 翻成 `contracted`
> 并补齐 `render.classes` —— **同一次提交**。

### P1 · 命名 / 结构决策（改之前先写进契约）

| # | 问题 | 现状 | 建议 |
| --- | --- | --- | --- |
| 1 | 图片类名 | 编辑器 `nd-image-widget` | 统一成 `.nd-image`（`nd-image-widget` 是编辑器实现细节，不该出现在发布侧）；或明确「只共享 `img` 标签」并把 contract 清空 |
| 2 | 删除线标签 | 渲染 `<s>`、编辑器 `.nd-strike` | 渲染侧改用 `<del>`（语义更准），类名不变；或保持 `<s>` 并写进契约 |
| 3 | 行内数学外壳 | 渲染侧没有 `.nd-math` | 给行内公式包一层 `<span class="nd-math">`（和编辑器、和块级一致） |
| 4 | embed 类名 | `nd-embed` vs `nd-embed-card` | 定一套：建议渲染侧容器 `nd-embed` + 编辑器占位卡也 `nd-embed`（形态差异用修饰类 `--placeholder`） |
| 5 | 表格外壳 | 编辑器 `.nd-table`、渲染侧无 | **不加**（原子节点共用投影器、不共用 DOM）；写进契约即可 |
| 6 | 段落 | 两侧都没有 `.nd-p` | 二选一：给段落行加 `.nd-p`（每段一条 line 装饰）或明确「段落不共享类名」 |

### P2 · 抽共享 CSS（把「显示侧」从编辑器主题里拆出来）

| # | 做什么 | 为什么 |
| --- | --- | --- |
| 1 | `theme.css` 里删掉**显示侧**重复规则（`.nd-h1`–`.nd-h6`、`.nd-strong`、`.nd-em`、`.nd-strike`、`.nd-code`、`.nd-blockquote`、`.nd-hr`、`.nd-link`、`.nd-code-fence`、`.nd-code-fence > pre`） | 阶段 1 只许加 `@import`，所以 `blocks.css` 里先抄了一份（值逐字相同）。两份并存 = 下次改一边漏一边 |
| 2 | `dialect.css` 补 embed / carousel / link-card | 那三个的类名两侧都产，但**一个 `.css` 都没有**（`dialect.css` 文件头明确写着「本次只做 mention」） |
| 3 | `package.json#exports` 加 `"./blocks.css": "./src/shared/blocks.css"` | 阶段 1 被文件所有权挡住（`package.json` 归另一个代理）。**在那之前消费方只能引 `./dialect.css` 或 `./cm/theme.css`** |
| 4 | 删掉 `render/index.ts` / `render/task-list.ts` 注释里对 `src/style.css` 的引用 | 那个文件**不存在**（Tiptap 时代的遗留），文档在骗人 |

### P3 · 编辑器侧补实现

| # | 块 | 缺什么 |
| --- | --- | --- |
| 1 | **高亮 `==…==`** | 编辑器**完全没实现**（lezer 不产节点）。要按 `emoji` / `link` 的路子做行内正则扫描：非揭示态 → `.nd-highlight` mark + 隐藏定界符（登记 `atomicRanges`），揭示态 → 保留源码 |
| 2 | 行内数学 | 两侧类名对齐（P1-3 的渲染侧改完，编辑器侧已经是对的） |
| 3 | embed | 占位卡与渲染侧同构（类名统一后，`dialect.css` 才能写一份样式） |
| 4 | 任务列表 | 编辑器复选框与渲染侧共用一条样式（渲染侧带上 `.nd-task-checkbox` 之后） |

---

## 7. 未决问题

| # | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| 1 | **`blocks.css` 还没有导出入口** | 消费方无法 `import '@nexusmc-cn/nexusdown/blocks.css'`（`package.json#exports` 只有 `./dialect.css` / `./cm/theme.css`） | phase 2 P2-3。在那之前渲染侧要么引 `./dialect.css`（只有 mention），要么引 `./cm/theme.css`（背上整套编辑器主题） |
| 2 | **高亮的编辑器侧没实现** | 编辑器里 `==高亮==` 是**字面量**，渲染侧是黄底 —— 这是目前最明显的「所见 ≠ 所得」 | phase 2 P3-1。`dialect-extensions.md` 1.2 表把它写成「行内 mark + 揭示」，那是 Tiptap 时代的描述，**文档与代码不一致** |
| 3 | **块间距无法逐像素对齐** | 编辑器靠源码空行（一整行），渲染侧靠 `margin`（1em） | 接受「同一档」；要更准只能让渲染侧也输出空行占位（不值得） |
| 4 | **embed 的短链在编辑器里降级** | 编辑器拿不到 `RenderData.links`，`b23.tv` 这类短链在编辑器里显示成代码块，发布出去（带数据时）是播放器 | 已在 `features/embed.ts` 注释里记为刻意降级；契约上应写明「编辑器只认长链」 |
| 5 | **原子节点的「揭示」语义不统一** | 表格/公式靠 `editingBlock`（点 widget），图片/行内数学靠选区 | 两种都合理（块级区间光标进不去），但契约里要写清「哪个节点用哪种」，否则以后加块级组件会挑错 |
| 6 | **`<s>` vs `<del>`、`nd-image-widget` 这类历史命名** | 影响 P1 的决策成本（改名 = 消费方 CSS 跟着改） | 一次性在 P1 定死，之后不再改 |
| 7 | **Callouts（`> [!NOTE]`）是并行落地的，不在本阶段契约表内** | 两侧已经共用 `nd-callout` / `nd-callout--<type>` 类名（`shared/dialect.css`），是现成的「已契约」候选；但表里没有它，parity 也就没在守 | phase 2 补一行：按 §1 判为**可编辑**（正文可编辑）+ 一个**原子部件**（首行 `[!NOTE]` 徽章是 replace widget） |
