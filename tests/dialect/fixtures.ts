/**
 * parity 测试的 fixture —— **同一份 Markdown，两侧各投影一次**。
 *
 * ## 这个文件在守什么
 *
 * 本库的承诺是「编辑时看到的 = 发布出来的」。阶段 1 把它拆成两条可执行的契约
 * （见 `docs/2026-10-19-render-contract.md`）：
 *
 * - **原子节点**（表格 / 块级公式 / 图片 / 提及卡片 …）→ 两侧共用**同一段 HTML**
 *   （同一个投影器函数产出的字符串）；
 * - **可编辑节点**（标题 / 段落 / 行内标记 / 链接 …）→ 两侧共用**语义**
 *   （类名 / 标签），DOM 各由各的投影器产出。
 *
 * 于是「对拍」也分两层：
 *
 * 1. 每条 fixture 声明两侧**当前**各自产出的标签 / 类名（`render` / `editor`）——
 *    这一层是「两侧都真的画了东西」，防的是 fixture 写错、功能没注册；
 * 2. 声明**契约类名**（`contract`）—— 这一层才是「长得一样」。
 *
 * ## ⚠️ `pending` 是**棘轮**，不是「跳过」
 *
 * phase 2 之前，很多块只有一侧有契约类名（编辑器产 `.nd-h1`，渲染侧还是裸 `<h1>`）。
 * 这些行标 `pending`，测试断言的是「**缺口还在**」：
 *
 * - 缺口还在 → 绿；
 * - 哪天有人给渲染侧补上 `.nd-h1` → **这一行会红**，提示把 `status` 翻成
 *   `contracted`（同时把 `render.classes` / `editor.classes` 补上）。
 *
 * 这样「改了一个块」和「更新契约」永远发生在同一次提交里，不会出现
 * 「类名加了、parity 表忘了翻」的静默漂移。
 *
 * ⚠️ 所以**不要**为了让测试变绿去删 `contract` —— 那等于把棘轮拆了。
 */
import type { MentionResolution } from '../../src/render/feature.js'

/**
 * 契约表（`docs/2026-10-19-render-contract.md` §2）必须覆盖的块。
 *
 * 加一行契约 = 这里加一个名字 + 下面加一条 fixture。**测试会检查覆盖率** ——
 * 漏了哪一块，`fixture 覆盖了契约表里的每一个块` 那条会点名。
 */
export const CONTRACT_BLOCKS = [
  '标题',
  '段落',
  '粗/斜/删/高亮',
  '行内码',
  '链接',
  '引用',
  '列表',
  '任务列表',
  '表格',
  '分割线',
  '代码围栏',
  '图片',
  'mention',
  'embed',
  '数学',
] as const

/** 一侧投影出来的「标签 + 类名」摘要。 */
export interface ProjectionFacts {
  /** 必须出现的标签名（小写）。 */
  readonly tags: readonly string[]
  /** 必须出现的类名（不含前导 `.`）。 */
  readonly classes: readonly string[]
}

/**
 * 一条对拍用例。
 *
 * 命名用 kebab-case，和功能名对齐（`table` / `embed` / `math` / `mention`）。
 */
export interface ParityCase {
  readonly id: string
  /** 契约表里的块名 —— 必须是 `CONTRACT_BLOCKS` 的成员。 */
  readonly block: (typeof CONTRACT_BLOCKS)[number]
  /**
   * 轴：**原子 vs 可编辑**（不是行级 vs 块级）。
   *
   * 判据见契约文档 §1：非揭示态下这段内容在编辑器里**还是不是可编辑的字符**。
   * - `atomic`：不是 → 两侧应当共用同一段 HTML（同一个投影器）；
   * - `editable`：是 → 两侧只共用语义（类名 / 标签），DOM 各产各的。
   */
  readonly axis: 'atomic' | 'editable'
  /** 喂给两侧的同一份 Markdown。 */
  readonly markdown: string
  /** 渲染侧**当前**必须产出的标签 / 类名。 */
  readonly render: ProjectionFacts
  /** 编辑器侧**当前**必须产出的标签 / 类名（来自 DecorationSet + widget DOM）。 */
  readonly editor: ProjectionFacts
  /**
   * 契约类名：`contracted` 时两侧都必须有；`pending` 时用来判定「缺口还在」。
   *
   * ⚠️ 原子节点可以是空数组 —— 它们靠「同一段 HTML」对拍（见 `parity.test.ts`
   * 的「原子节点」一节），不是靠类名。
   */
  readonly contract: readonly string[]
  readonly status: 'contracted' | 'pending'
  /** `pending` 时写清楚**怎么翻成 contracted**；`contracted` 时写共享的是什么。 */
  readonly note: string
  /**
   * 两侧**共用**的外部数据（库不查库：同一个对象喂两侧）。
   *
   * `mentions` 给 `RenderData.mentions` 与 `mountEditor({ mentions })`；
   * `math` 同时喂 `katexRenderer()` 和 `nexusdown({ mathRenderer })`。
   */
  readonly data?: {
    readonly mentions?: ReadonlyMap<string, MentionResolution>
    readonly math?: FakeKatex
  }
}

/** 假 KaTeX —— 形状就是渲染侧的 `KatexLike`，不引真 katex（那有 1.3 MB）。 */
export interface FakeKatex {
  renderToString(tex: string, options?: Record<string, unknown>): string
}

/**
 * 两侧共用的假渲染器。
 *
 * 输出里带 `katex-stub` 类是为了让测试能看出「公式真的走了注入的渲染器」，
 * 而不是退化成源码。
 */
export const FAKE_KATEX: FakeKatex = {
  renderToString(tex, options) {
    const display = options?.displayMode === true
    return `<span class="katex-stub" data-display="${display ? 'block' : 'inline'}">${tex}</span>`
  },
}

/**
 * 提及解析结果 —— 形状就是 `RenderData.mentions`（`slug → MentionResolution`）。
 *
 * ★ 同一份对象喂两侧：`renderMarkdown(src, { data: { mentions } })` 与
 * `nexusdown({ mentions })`。这正是「库不查库」那条边界的用法示范。
 */
export const MENTIONS: ReadonlyMap<string, MentionResolution> = new Map([
  [
    'nexus-optimizer',
    {
      title: 'Nexus 优化器',
      href: '/resources/nexus-optimizer',
      kind: 'resource',
      summary: '把整合包压到 4 GB 以内',
      byline: 'NexusMC',
      badges: ['v1.2.0'],
    },
  ],
])

/**
 * 每段 fixture 后面都垫一段 `尾段`，光标落在它的末尾 —— 也就是**所有块的非揭示态**。
 *
 * ⚠️ 两个坑叠在一起：
 *
 * 1. `EditorState.create({ doc })` 的默认选区是 **0**（不是末尾），所以测试里
 *    必须显式 `selection: { anchor: doc.length }` —— 否则**第一个块**是揭示态；
 * 2. 光标停在**文档末尾**时，最后一个块很容易正好落在揭示判据里
 *    （块级 widget 的 `from - 1` / `to + 1` 门口，见 `tests/cm/table.test.ts` 文件头）。
 *
 * 垫一段 `尾段` 就同时解决两件事：光标落在正文里，既不在开头也不贴着任何块。
 */
const TAIL = '\n\n尾段\n'

/** 把「块本身」拼成「块 + 尾段」的完整文档。 */
function doc(block: string): string {
  return block + TAIL
}

export const PARITY_CASES: readonly ParityCase[] = [
  /* =====================================================================
   * 标题 / 段落 —— 可编辑：内容是可编辑字符，两侧只共享语义
   * =================================================================== */
  {
    id: 'heading-h1',
    block: '标题',
    axis: 'editable',
    markdown: doc('# 标题'),
    // 渲染侧现在是裸 `<h1>`（markdown-it 默认规则）。
    render: { tags: ['h1'], classes: [] },
    // 编辑器侧是 `Decoration.line` 落在 `.cm-line` 上。
    editor: { tags: [], classes: ['nd-h1'] },
    contract: ['nd-h1'],
    status: 'pending',
    note: '渲染侧补 `heading_open` 规则加 class（renderer.ts，phase 2 P0）',
  },
  {
    id: 'paragraph',
    block: '段落',
    axis: 'editable',
    markdown: doc('一段正文。'),
    render: { tags: ['p'], classes: [] },
    // 编辑器里段落就是 `.cm-line`，**没有类名**。
    editor: { tags: [], classes: [] },
    contract: ['nd-p'],
    status: 'pending',
    note: 'phase 2 二选一：给段落行加 `.nd-p`（每段一条 line 装饰），或明确「段落不共享类名」后清空 contract',
  },

  /* =====================================================================
   * 行内标记 —— 可编辑：`**` 里的字是能直接改的，mark 只是视觉
   * =================================================================== */
  {
    id: 'strong',
    block: '粗/斜/删/高亮',
    axis: 'editable',
    markdown: doc('**粗体**'),
    render: { tags: ['strong'], classes: [] },
    editor: { tags: [], classes: ['nd-strong'] },
    contract: ['nd-strong'],
    status: 'pending',
    note: '渲染侧补 inline 规则加 class（renderer.ts，phase 2 P0）',
  },
  {
    id: 'emphasis',
    block: '粗/斜/删/高亮',
    axis: 'editable',
    markdown: doc('*斜体*'),
    render: { tags: ['em'], classes: [] },
    editor: { tags: [], classes: ['nd-em'] },
    contract: ['nd-em'],
    status: 'pending',
    note: '渲染侧补 inline 规则加 class（renderer.ts，phase 2 P0）',
  },
  {
    id: 'strikethrough',
    block: '粗/斜/删/高亮',
    axis: 'editable',
    markdown: doc('~~删除~~'),
    // ⚠️ markdown-it 的 GFM 删除线产出的是 `<s>`，不是 `<del>`。
    render: { tags: ['s'], classes: [] },
    editor: { tags: [], classes: ['nd-strike'] },
    contract: ['nd-strike'],
    status: 'pending',
    note: '渲染侧补 inline 规则加 class；顺带定标签（`<s>` 还是 `<del>`）',
  },
  {
    id: 'highlight',
    block: '粗/斜/删/高亮',
    axis: 'editable',
    markdown: doc('==高亮=='),
    // ★ 阶段 1 唯一允许的渲染侧改动：`<mark class="nd-highlight">`（render/mark.ts）。
    render: { tags: ['mark'], classes: ['nd-highlight'] },
    // ★ 已补齐：`src/cm/features/highlight.ts` 扫描 `Paragraph`，内容挂同一个类名。
    editor: { tags: [], classes: ['nd-highlight'] },
    contract: ['nd-highlight'],
    status: 'contracted',
    note: '编辑器侧 `==` 行内扫描已实现（features/highlight.ts），两侧共用 .nd-highlight',
  },

  /* =====================================================================
   * 行内码 —— 可编辑：反引号里的字能直接改
   * =================================================================== */
  {
    id: 'inline-code',
    block: '行内码',
    axis: 'editable',
    markdown: doc('`code`'),
    render: { tags: ['code'], classes: [] },
    editor: { tags: [], classes: ['nd-code'] },
    contract: ['nd-code'],
    status: 'pending',
    note: '渲染侧补 code_inline 规则加 class（renderer.ts，phase 2 P0）',
  },

  /* =====================================================================
   * 链接 —— 可编辑：链接文字是真实可编辑文本（不是 widget）
   * =================================================================== */
  {
    id: 'link',
    block: '链接',
    axis: 'editable',
    markdown: doc('[链接](https://example.com)'),
    // 渲染侧是 `<a target="_blank" rel="noopener noreferrer nofollow">`（renderer.ts）。
    render: { tags: ['a'], classes: [] },
    editor: { tags: [], classes: ['nd-link'] },
    contract: ['nd-link'],
    status: 'pending',
    note: '渲染侧补 `rules.link_open` 里的 class（那个规则已经是自定义的，改一行即可）',
  },

  /* =====================================================================
   * 引用 / 列表 / 任务列表 —— 可编辑：内容是可编辑文本
   * =================================================================== */
  {
    id: 'blockquote',
    block: '引用',
    axis: 'editable',
    markdown: doc('> 引用'),
    render: { tags: ['blockquote'], classes: [] },
    editor: { tags: [], classes: ['nd-blockquote'] },
    contract: ['nd-blockquote'],
    status: 'pending',
    note: '渲染侧给 `<blockquote>` 加 class（renderer.ts，phase 2 P0）',
  },
  {
    id: 'bullet-list',
    block: '列表',
    axis: 'editable',
    markdown: doc('- 一\n- 二'),
    // ⚠️ 渲染侧恒有 `<li><p>…</p></li>`（renderer.ts 的 paragraph_open 无条件发 `<p>`）。
    render: { tags: ['ul', 'li', 'p'], classes: [] },
    // 编辑器里列表项是**逐行**的 `.nd-list-item`（CM6 的行包不出一个 `<ul>`）。
    editor: { tags: [], classes: ['nd-list-item'] },
    contract: ['nd-list'],
    status: 'pending',
    note: '渲染侧给 `<ul>` / `<ol>` 加 `.nd-list`；编辑器侧**产不出**（结构决定），契约只约束渲染侧',
  },
  {
    id: 'task-list',
    block: '任务列表',
    axis: 'editable',
    markdown: doc('- [ ] 待办\n- [x] 完成'),
    // 渲染侧形状对齐 Tiptap：`<li data-type="taskItem"><label><input/><span/></label><div>`。
    render: { tags: ['ul', 'li', 'label', 'input', 'div'], classes: [] },
    // 编辑器侧是**可交互**的复选框 widget（原子！见契约文档 §1 的例外说明）。
    editor: { tags: ['input'], classes: ['nd-task-checkbox'] },
    contract: ['nd-task-checkbox'],
    status: 'pending',
    note: '渲染侧给复选框加同一个 class（renderer.ts 的 list_item_open），两侧就能共用一条规则',
  },

  /* =====================================================================
   * 表格 —— 原子：单元格在编辑器里**不可编辑**（整块 widget）
   * =================================================================== */
  {
    id: 'table',
    block: '表格',
    axis: 'atomic',
    markdown: doc('| a | b |\n| - | - |\n| c | d |'),
    // 渲染侧：没有 `<thead>`（renderer.ts 把 thead 改写成 tbody 了），单元格里恒有 `<p>`。
    render: { tags: ['table', 'tbody', 'th', 'td', 'p'], classes: [] },
    // 编辑器侧：`TableWidget` 内层就是 renderMarkdown() 的输出，外面套 `.nd-table` 外壳。
    editor: { tags: ['table', 'th', 'td'], classes: ['nd-table'] },
    // ★ 原子节点靠「同一段 HTML」对拍，不靠类名（`.nd-table` 是编辑器外壳，结构决定）。
    contract: [],
    status: 'contracted',
    note: '共用 HTML 投影器：TableWidget 的 innerHTML 逐字等于 renderMarkdown(表格源码)',
  },

  /* =====================================================================
   * 分割线 —— 原子：整行字符被藏掉，线由 CSS 边框画
   * =================================================================== */
  {
    id: 'hr',
    block: '分割线',
    axis: 'atomic',
    markdown: doc('---'),
    render: { tags: ['hr'], classes: [] },
    // ⚠️ 编辑器侧**没有 `<hr>` 元素**：`.nd-hr` 挂在 `.cm-line` 上，线是 border-top。
    editor: { tags: [], classes: ['nd-hr'] },
    contract: ['nd-hr'],
    status: 'pending',
    note: '渲染侧改 `rules.hr` 输出 `<hr class="nd-hr"/>`（一行，phase 2 P0）',
  },

  /* =====================================================================
   * 代码围栏 —— 可编辑：代码文本是能直接改的行；**标题栏**是原子部件
   * =================================================================== */
  {
    id: 'fence',
    block: '代码围栏',
    axis: 'editable',
    markdown: doc('```js\nconst a = 1\n```'),
    render: {
      tags: ['div', 'pre', 'code'],
      classes: ['nd-code-fence', 'nd-code-header', 'language-js'],
    },
    editor: {
      tags: [],
      // 编辑器里代码块是「一组 .cm-line」，标题栏是 replace 出来的 widget。
      classes: ['nd-code-block', 'nd-code-header'],
    },
    // ★ 唯一一个两侧**已经**共用类名的地方：标题栏（`renderCodeHeaderHtml` 同一个函数）。
    contract: ['nd-code-header'],
    status: 'contracted',
    note: '标题栏部件共用投影器；容器不同（.cm-line 组 vs .nd-code-fence）是结构决定，不是抄漏',
  },

  /* =====================================================================
   * 图片 —— 原子：alt 不可编辑（非揭示态是 widget）
   * =================================================================== */
  {
    id: 'image',
    block: '图片',
    axis: 'atomic',
    markdown: doc('![图](a.png)'),
    render: { tags: ['img'], classes: [] },
    // 编辑器侧是 `ImageWidget`（`<img class="nd-image-widget">`）。
    editor: { tags: ['img'], classes: ['nd-image-widget'] },
    // 共享的语义是 **`img` 标签本身**（不是类名）：`.nd-image-widget` 是 widget 几何。
    contract: [],
    status: 'contracted',
    note: '共享 `img` 语义 + blocks.css 的 img 排版；widget 几何留在 theme.css',
  },

  /* =====================================================================
   * mention —— 原子：非揭示态是 widget（源码只在揭示态可编辑）
   * =================================================================== */
  {
    id: 'mention-inline',
    block: 'mention',
    axis: 'atomic',
    markdown: doc('提到 @nexus-optimizer 一句。'),
    render: { tags: ['a'], classes: ['nd-mention'] },
    // ⚠️ 编辑器里是 `<span class="nd-mention">`（不是链接），类名相同、DOM 不同。
    editor: { tags: [], classes: ['nd-mention'] },
    contract: ['nd-mention'],
    status: 'contracted',
    note: '同一个 token 两种形态（行内胶囊）：类名共用，标签不同是刻意（编辑器里不是链接）',
    data: { mentions: MENTIONS },
  },
  {
    id: 'mention-card',
    block: 'mention',
    axis: 'atomic',
    markdown: doc('@nexus-optimizer'),
    render: { tags: ['a'], classes: ['nd-mention-card'] },
    editor: { tags: [], classes: ['nd-mention-card'] },
    contract: ['nd-mention-card'],
    status: 'contracted',
    note: '独占一段 → 卡片：类名共用，样式在 shared/dialect.css',
    data: { mentions: MENTIONS },
  },

  /* =====================================================================
   * embed —— 原子：编辑器里是占位卡（绝不加载真 iframe）
   * =================================================================== */
  {
    id: 'embed',
    block: 'embed',
    axis: 'atomic',
    markdown: doc('```embed bilibili video BV1xx411c7mD\n```'),
    render: {
      tags: ['div', 'iframe'],
      classes: ['nd-embed', 'nd-embed--bilibili'],
    },
    // ⚠️ 编辑器侧是另一套类名（`nd-embed-card*`）—— 两侧**没有**共享契约。
    editor: { tags: [], classes: ['nd-embed-card', 'nd-embed-card--bilibili'] },
    contract: ['nd-embed'],
    status: 'pending',
    note: '两侧类名分叉（nd-embed vs nd-embed-card）：先定一套名字，再让占位卡和播放器同构（phase 2）',
  },

  /* =====================================================================
   * 数学 —— 行内是原子（`$…$` 被 widget 替换），块级也是原子
   * =================================================================== */
  {
    id: 'math-inline',
    block: '数学',
    axis: 'atomic',
    markdown: doc('$x^2$'),
    // ⚠️ 渲染侧行内公式**没有** `.nd-math` 外壳：注入 KaTeX 时直接是它的 `<span class="katex">`，
    // 没注入时是 `<code class="nd-math-source">` 降级。
    render: { tags: ['span'], classes: ['katex-stub'] },
    editor: { tags: [], classes: ['nd-math'] },
    contract: ['nd-math'],
    status: 'pending',
    note: '渲染侧给行内公式包一层 `.nd-math`（和块级、和编辑器一致），phase 2',
    data: { math: FAKE_KATEX },
  },
  {
    id: 'math-block',
    block: '数学',
    axis: 'atomic',
    markdown: doc('```math\nx^2\n```'),
    render: { tags: ['div'], classes: ['nd-math', 'nd-math-block', 'katex-stub'] },
    // 编辑器侧是块级 widget（`MathBlockWidget`），类名和渲染侧逐字相同。
    editor: { tags: ['div'], classes: ['nd-math', 'nd-math-block', 'katex-stub'] },
    contract: ['nd-math', 'nd-math-block'],
    status: 'contracted',
    note: '同一个 KaTeX 渲染函数喂两侧；外壳类名逐字相同',
    data: { math: FAKE_KATEX },
  },
]
