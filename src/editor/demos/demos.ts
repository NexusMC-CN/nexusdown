/**
 * 演示注册表 —— 工具栏悬停卡片和 Motion Lab **共用的一份**。
 *
 * ## 为什么要有这个文件
 *
 * 在这之前，18 段演示的 DOM 写在 `Toolbar.vue` 的模板里、样式写在同一个
 * `<style scoped>` 里。于是「审片」只能靠肉眼看工具栏 —— 你没法暂停、没法逐帧、
 * 没法同时看 19 条语法。**演示的 DOM/CSS 必须只有一份，且不依赖 EditorView**
 * （`render()` 是纯函数：不读 props、不碰编辑器），这样 Lab 才能把它单独拎出来
 * 一帧一帧放。
 *
 * ## 四条硬约定（改演示之前先读）
 *
 * 1. **只动合成属性**：`transform` / `opacity` / `clip-path` / `background-size` /
 *    `stroke-dashoffset`。动 `width` / `height` / `font-size` / `font-weight` /
 *    `margin` / `grid-template-rows` 会让整块重新排版 —— 逐帧看就是"抖一下"。
 *    需要"字变粗 / 字变等宽"这类**离散**变化时，用**第二份副本交叉淡入**
 *    （`bold` / `inlineCode` / `codeBlock` / `blockMath` 都是这么做的），
 *    不动字重也不切字体。
 * 2. **时间语言统一**：`duration` 一律 2400ms（`DEMO_DURATION`），拍点一律
 *    `[0, 22, 44, 66, 100]`（`DEMO_BEATS`）。CSS 里的百分比都落在这五拍上 ——
 *    逐帧审片时"第 3 拍"在哪里是**可预测**的，不用每条动画各算一遍。
 * 3. **缓动只用三条**：进场 `--nd-motion-snap`、退场/机械 `--nd-motion-mech`、
 *    普通 `--nd-motion-ease`（见 `src/shared/motion.css`）。
 * 4. **演示结束停在终态**（`animation-fill-mode: forwards`），不循环；
 *    `prefers-reduced-motion: reduce` 时**直接呈现终态**，不是回到初始态。
 *
 * ## `id` / `syntax` 的关系
 *
 * - `id` 是演示自己的名字（工具栏按钮的 `demo` 字段指向它）；
 * - `syntax` 是它教的方言语法（`playground/src/fixtures.ts` 的 `DIALECT_SYNTAXES`
 *   里的 id）。**一个语法可以有多条演示**（`heading` 有三条、`emphasis` 有两条），
 *   但每条语法**至少要有一条**演示 —— 这条由 `registry.test.ts` 锁死。
 * - 例外：`undo` / `redo` **没有语法可教**（它们是工具栏动作），`syntax` 记作
 *   `ACTION_SYNTAX`。这不是漏写，是它们的性质。
 */
import { h, type VNode } from 'vue'

/*
 * ⚠️ 两个 CSS **在这里** import，而不是在 Toolbar.vue / Lab 的 main.ts 里。
 *
 * 理由：`demos.css` 是**全局**样式（见那个文件头部的说明 —— 演示的 DOM 由本文件
 * 的 `h()` 造出来，拿不到任何组件的 `data-v-*` 作用域标记，scoped 样式一条都命中不了）。
 * 既然它必须是全局的，就得保证"谁 import 注册表，谁就拿到样式"——
 * 否则 Lab 会画出一堆没有样式的裸 div。
 */
import '../../shared/motion.css'
import './demos.css'

/* -------------------------------------------------------------------------
 * 类型
 * ---------------------------------------------------------------------- */

export interface DemoSpec {
  /** 演示 id。工具栏按钮的 `demo` 字段指向它；也是 Motion Lab 深链的 `?demo=`。 */
  id: DemoId
  /** 对应 `DIALECT_SYNTAXES` 的 id；工具栏动作演示用 `ACTION_SYNTAX`。 */
  syntax: string
  /** 人看的名字（Lab 画廊里显示）。 */
  label: string
  /** 时长（ms）。教学演示统一 `DEMO_DURATION`。 */
  duration: number
  /** 拍点百分比。统一 `DEMO_BEATS`。 */
  beats: readonly number[]
  /** 演示画面。**纯展示**：不读 props、不碰 `EditorView`。 */
  render: () => VNode
  /**
   * 已知会动 layout 的属性。
   *
   * 默认空 —— 空的含义是"**审计里一条 layout 属性都不该出现**"。
   * 真有必要动（比如以后某个演示必须演高度变化），写在这里，Motion Lab 会把它
   * 标成"已声明"而不是"违规"，同时逼你在 `docs/motion-audit.md` 里解释为什么。
   */
  layoutProps?: readonly string[]
}

/** 时长与拍点 —— 全套演示共用一份，改这里就是改全部。 */
export const DEMO_DURATION = 2400
export const DEMO_BEATS = [0, 22, 44, 66, 100] as const

/**
 * 「不是方言语法」的语法槽 —— 给撤销 / 重做用。
 *
 * ⚠️ 不要把它加进 `DIALECT_SYNTAXES`：那 19 条是**方言**（渲染器认的语法），
 * 撤销 / 重做是**编辑器动作**。混进去会让"19/19 覆盖"这个指标失去意义。
 */
export const ACTION_SYNTAX = 'action'

/* -------------------------------------------------------------------------
 * 属性分类（Motion Lab 的属性审计 + registry.test.ts 的静态检查共用）
 * ---------------------------------------------------------------------- */

/**
 * 动这些属性会**重新排版**（浏览器必须重算几何），逐帧看就是"抖"。
 * 审片里标红。
 */
export const LAYOUT_PROPS: readonly string[] = [
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'top', 'right', 'bottom', 'left', 'inset', 'inset-block', 'inset-inline',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block', 'margin-inline', 'padding', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'padding-block', 'padding-inline',
  'font-size', 'font-weight', 'line-height', 'letter-spacing', 'word-spacing',
  'grid-template-rows', 'grid-template-columns', 'flex-basis', 'flex-grow',
  'border-width', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'gap', 'row-gap', 'column-gap',
]

/**
 * 动这些属性**不排版**，但要重绘（光栅化）。审片里标黄 —— 不是错误，
 * 但比合成属性贵，用之前得知道自己在付什么。
 */
export const PAINT_PROPS: readonly string[] = [
  'color', 'background-color', 'background-size', 'background-position',
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'outline-color',
  'box-shadow', 'text-shadow', 'fill', 'stroke', 'stroke-dashoffset',
  'stroke-dasharray', 'clip-path', 'font-family', 'font-style',
  'visibility', 'filter', 'backdrop-filter',
]

export type PropKind = 'layout' | 'paint' | 'composited'

/**
 * 给一条关键帧属性分类。
 *
 * ⚠️ 前缀匹配只对 `LAYOUT_PROPS` / `PAINT_PROPS` 里**逐条列出的**名字做精确比较，
 * 不做模糊前缀 —— 比如 `padding-left` 列了，`padding-inline-start` 没列就是
 * `composited`，那是**错的分类**而不是"宽松的分类"。宁可漏判也不要误判：
 * 误判会让审计变成噪声，然后所有人都开始无视它。
 */
export function classifyProp(prop: string): PropKind {
  const name = prop.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  if (LAYOUT_PROPS.includes(name)) return 'layout'
  if (PAINT_PROPS.includes(name)) return 'paint'
  return 'composited'
}

/* -------------------------------------------------------------------------
 * 小工具
 * ---------------------------------------------------------------------- */

/** `cls('demo-bold', ['syntax', 'l'])` → `demo-bold__syntax demo-bold__syntax--l` 的写法太啰嗦，只留拼前缀。 */
function sub(base: string, name: string, mod?: string) {
  return mod ? `${base}__${name} ${base}__${name}--${mod}` : `${base}__${name}`
}

/**
 * 代码块演示标题栏里的文件图标。
 *
 * ⚠️ **故意不用 `codeIconSvg('yaml')`**（真标题栏用的是那个）。理由有两条，
 * 都和"注册表要能被独立 import"有关：
 *
 * 1. `codeIconSvg` 住在 `@nexusmc-cn/nexusdown/cm` 里。本文件被
 *    `registry.test.ts`（vitest，没有 alias）和 `motion-lab`（审片页）import ——
 *    前者会去解析包自引用、拿到 `dist/` 里的**旧构建**，后者会为了一个 8px 的
 *    图标把整个 CM6 引擎拉进审片页。
 * 2. 就算能解析，`src/editor/` 里出现 `../cm/` 的相对 import 会把 CM6 **打进
 *    editor 产物**，造出第二份 `@codemirror/state` —— 那是 `Toolbar.vue` 头部
 *    那条长注释里写死的坑（facet 按模块标识比较，装饰静默失效）。
 *
 * 所以这里画一个**中性**的「文档 + 折角」字形：形状和真标题栏的文件徽章同一路，
 * 颜色走 `--nd-text-3`，不冒充 yaml 品牌色。
 */
const FILE_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M9.2 1.9H4.5a1 1 0 0 0-1 1v10.2a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.2z"/>'
  + '<path d="M9.2 1.9v3.3h3.3"/></svg>'

/** 图片 / 轮播的占位字形（山 + 太阳）。纯装饰，`--nd-text-4`。 */
const PIC_ICON_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="1.7" y="3.3" width="12.6" height="9.4" rx="1.3"/>'
  + '<circle cx="5.3" cy="6.4" r="1.05"/>'
  + '<path d="M2.3 11.4 6.1 8l2.5 2.1 2.3-1.9 2.8 2.7"/></svg>'

/** 撤销 / 重做的图标路径（和工具栏图标同源同值，`Toolbar.vue` 的 `ICONS` 里各一份）。 */
const UNDO_PATH = 'M6 9.3 2.7 6l3.3-3.3M2.7 6h7a3.65 3.65 0 0 1 3.65 3.65 3.65 3.65 0 0 1-3.65 3.65H7.3'
const REDO_PATH = 'M10 9.3 13.3 6l-3.3-3.3M13.3 6h-7a3.65 3.65 0 0 0-3.65 3.65 3.65 3.65 0 0 0 3.65 3.65H8.7'

/* -------------------------------------------------------------------------
 * 演示
 * ---------------------------------------------------------------------- */

/**
 * 演示 id 的**字面量联合**。
 *
 * 写成 `as const` 数组而不是从 `DEMOS` 推导：`DEMOS` 的 `id` 字段要靠这个联合类型
 * 才能"写错就编译报错"，反过来推会变成循环引用。两张表的一致性由
 * `registry.test.ts` 锁（长度 + 集合相等，不是"看着像"）。
 */
export const DEMO_IDS = [
  'bold', 'italic', 'inlineCode', 'inlineMath',
  'h1', 'h2', 'h3',
  'bullet', 'ordered', 'quote', 'callout', 'table',
  'link', 'autolink', 'mention',
  'highlight', 'strike',
  'taskList',
  'codeBlock', 'blockMath', 'embed',
  'image', 'carousel',
  'undo', 'redo',
] as const

export type DemoId = (typeof DEMO_IDS)[number]

export const DEMOS: readonly DemoSpec[] = [
  /* ------------------------------------------------------------ 强调 */
  {
    id: 'bold',
    syntax: 'emphasis',
    label: '加粗',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * ★ **粗体副本交叉淡入，不动 `font-weight`。**
     *
     * 原来直接动画 `font-weight: 400 → 700`。字重一变，字形的**度量**就变
     * （粗体更宽），整行要重新排版 —— 逐帧看是文字在变粗的同时**往右长**，
     * 而且每一帧都在改行盒宽度。
     *
     * 现在：正体那一份留在流里（它决定盒子宽度），粗体副本**绝对定位叠在上面**，
     * 只淡入淡出。两份都在 `__box` 里居中，所以字的**中心不动**、只有墨迹变重。
     */
    render: () =>
      h('div', { class: 'demo-bold' }, [
        h('span', { class: 'demo-bold__box' }, [
          h('span', { class: 'demo-bold__text' }, '文字'),
          h('span', { class: 'demo-bold__copy' }, '文字'),
          h('span', { class: sub('demo-bold', 'syntax', 'l') }, '**'),
          h('span', { class: sub('demo-bold', 'syntax', 'r') }, '**'),
        ]),
      ]),
  },
  {
    id: 'italic',
    syntax: 'emphasis',
    label: '斜体',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * 不用 `font-style: italic`（`font-style` 是离散属性、插值不了，而且中文
     * 没有真斜体、浏览器只能伪斜体），改用 `transform: skewX()` —— 对**已经排好版
     * 的同一份字形**做几何变换，全程可插值，也不改任何度量。
     */
    render: () =>
      h('div', { class: 'demo-italic' }, [
        h('span', { class: 'demo-italic__box' }, [
          h('span', { class: 'demo-italic__text' }, '文字'),
          h('span', { class: sub('demo-italic', 'syntax', 'l') }, '*'),
          h('span', { class: sub('demo-italic', 'syntax', 'r') }, '*'),
        ]),
      ]),
  },

  /* ------------------------------------------------------------ 行内码 / 行内公式 */
  {
    id: 'inlineCode',
    syntax: 'inline-code',
    label: '行内代码',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * ★ **等宽副本交叉淡入，不切 `font-family`。**
     *
     * 原来是 `steps(1, end)` 在 44% / 66% 硬切字体。硬切不算"动 layout"，但两套
     * 字体下同一串字符的**宽度不同** → 切的那一帧文字左右横跳（仓库里记着用户
     * 原话"文字会鬼畜"）。`font-family` 也不是合成属性，切一次要重排整段文字。
     *
     * 现在两份文字（比例 / 等宽）都在一个**固定宽度**的 chip 里居中，只交叉淡入 ——
     * 尺寸只由终态决定，切换时没有任何一帧在重排。
     */
    render: () =>
      h('div', { class: 'demo-inline-code' }, [
        h('span', { class: 'demo-inline-code__chip' }, [
          h('span', { class: 'demo-inline-code__box' }, [
            h('span', { class: 'demo-inline-code__text' }, 'code'),
            h('span', { class: 'demo-inline-code__mono' }, 'code'),
            h('span', { class: sub('demo-inline-code', 'syntax', 'l') }, '`'),
            h('span', { class: sub('demo-inline-code', 'syntax', 'r') }, '`'),
          ]),
        ]),
      ]),
  },
  {
    id: 'inlineMath',
    syntax: 'inline-math',
    label: '行内公式',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * `x^2` → `$x^2$` → `x²`。
     *
     * ⚠️ `2` 的"贴回 `x`"用 `translateX`，**不用 `margin-left`**（那是 layout 属性，
     * 而且改它会让整个 `__box` 变窄 → 居中的文字整体右移，逐帧看是"字被推了一下"）。
     * 位移量 8px 和原来 `margin-left: 8px` 的留白一致。
     */
    render: () =>
      h('div', { class: 'demo-inline-math' }, [
        h('span', { class: 'demo-inline-math__box' }, [
          h('span', { class: 'demo-inline-math__base' }, [
            'x',
            h('span', { class: 'demo-inline-math__caret' }, '^'),
          ]),
          h('span', { class: 'demo-inline-math__sup' }, '2'),
          h('span', { class: sub('demo-inline-math', 'syntax', 'l') }, '$'),
          h('span', { class: sub('demo-inline-math', 'syntax', 'r') }, '$'),
        ]),
      ]),
  },

  /* ------------------------------------------------------------ 标题 */
  /*
   * ★ **三档标题都改成 `transform: scale()`，字号固定为终值。**
   *
   * 原来动画 `font-size: 13 → 22/18/15px`。改字号会让行盒高度、换行位置、基线
   * 全部重算 —— 这是 4 个"抖动"演示里最明显的一个。
   *
   * 现在字号**从一开始就是终值**（22/18/15），初始 `scale = 13 / 终值`，
   * `transform-origin: left center` —— 字从自己的左边缘长出来。
   * ⚠️ 已知观感代价：盒子宽度是终态宽度，所以 0% 时字形贴在盒子左侧
   * （视觉偏左），到 66% 才正好落在正中。这是 `left center` 的必然结果，
   * 不是穿帮 —— 见 `docs/motion-audit.md` 里 h1 那一条。
   */
  {
    id: 'h1',
    syntax: 'heading',
    label: '一级标题',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () => headingDemo('h1', 1),
  },
  {
    id: 'h2',
    syntax: 'heading',
    label: '二级标题',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () => headingDemo('h2', 2),
  },
  {
    id: 'h3',
    syntax: 'heading',
    label: '三级标题',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () => headingDemo('h3', 3),
  },

  /* ------------------------------------------------------------ 列表 */
  {
    id: 'bullet',
    syntax: 'list',
    label: '无序列表',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () => listDemo('bullet', false),
  },
  {
    id: 'ordered',
    syntax: 'list',
    label: '有序列表',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () => listDemo('ordered', true),
  },

  /* ------------------------------------------------------------ 引用 / Callout */
  {
    id: 'quote',
    syntax: 'blockquote',
    label: '引用',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () =>
      h('div', { class: 'demo-quote' }, [
        h('span', { class: 'demo-quote__box' }, [
          h('span', { class: 'demo-quote__text' }, '引用一段话'),
          h('span', { class: 'demo-quote__bar' }),
          h('span', { class: 'demo-quote__syntax' }, '>'),
        ]),
      ]),
  },
  {
    id: 'callout',
    syntax: 'callout',
    label: 'Callout',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * `> [!NOTE]` —— 引用块的首行是"类型标记"，渲染成带色条和标题的提示块。
     *
     * 三样东西**各自动画、都不动布局**：
     * - 色条 `scaleY(0) → 1`（和引用那条同源，`transform-origin` 在中间）；
     * - 卡片底色 / 描边换颜色（1px 边框常驻透明，尺寸不变）；
     * - 标题淡入 + 变品牌色（`opacity` / `color`）。
     *
     * 首行标记 `> [!NOTE]` 走通用的 `__syntax`（第 3 拍露出、第 4 拍被"消化"）。
     */
    render: () =>
      h('div', { class: 'demo-callout' }, [
        h('span', { class: sub('demo-callout', 'syntax', 'open') }, '> [!NOTE]'),
        h('span', { class: 'demo-callout__card' }, [
          h('span', { class: 'demo-callout__bar' }),
          h('span', { class: 'demo-callout__title' }, '注意'),
          h('span', { class: 'demo-callout__text' }, '这是一条提示'),
        ]),
      ]),
  },

  /* ------------------------------------------------------------ 表格 */
  {
    id: 'table',
    syntax: 'table',
    label: '表格',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () =>
      h('div', { class: 'demo-table' }, [
        h('span', { class: 'demo-table__box' }, [
          h('span', { class: 'demo-table__cell' }, '列一'),
          h('span', { class: 'demo-table__cell' }, '列二'),
          h('span', { class: sub('demo-table', 'syntax', 'l') }, '|'),
          h('span', { class: sub('demo-table', 'syntax', 'm') }, '|'),
          h('span', { class: sub('demo-table', 'syntax', 'r') }, '|'),
        ]),
      ]),
  },

  /* ------------------------------------------------------------ 链接 / 自动链接 */
  {
    id: 'link',
    syntax: 'link',
    label: '链接',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () =>
      h('div', { class: 'demo-link' }, [
        h('span', { class: 'demo-link__box' }, [
          h('span', { class: 'demo-link__text' }, '链接文字'),
          h('span', { class: sub('demo-link', 'syntax', 'l') }, '['),
          h('span', { class: sub('demo-link', 'syntax', 'r') }, '](url)'),
        ]),
      ]),
  },
  {
    id: 'autolink',
    syntax: 'autolink',
    label: '自动链接',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * 裸 URL → 自动成为链接。**没有语法标记**（裸 URL 本来就不带定界符），
     * 所以第 3 拍换成"识别"：一条 `--nd-text-4` 的扫描线从左划到右，
     * 第 4 拍它退场、真正的品牌色下划线接管、文字变蓝。
     *
     * 这和 `mention` 是同一种处理：**没有"标记被消化"这一拍时，不要硬演一个
     * 不存在的标记**，换一个诚实的信号（那里是 `@` 亮成品牌色，这里是扫描线）。
     */
    render: () =>
      h('div', { class: 'demo-autolink' }, [
        h('span', { class: 'demo-autolink__box' }, [
          h('span', { class: 'demo-autolink__text' }, 'nexusmc.cn'),
          h('span', { class: 'demo-autolink__scan' }),
        ]),
      ]),
  },

  /* ------------------------------------------------------------ 提及 */
  {
    id: 'mention',
    syntax: 'mention',
    label: '提及',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * ⚠️ 和别的演示最大的不同：**没有"标记消失"那一拍** —— 胶囊里装的就是
     * `@slug`，`@` 在源码态和渲染态里都在。所以 `__at` 用自己那条 keyframes
     * （先亮成品牌色 = "这个字符让后面那串变成提及"），不吃通用的 `demo-syntax`。
     */
    render: () =>
      h('div', { class: 'demo-mention' }, [
        h('span', { class: 'demo-mention__pill' }, [
          h('span', { class: 'demo-mention__at' }, '@'),
          h('span', { class: 'demo-mention__text' }, 'nexus'),
        ]),
      ]),
  },

  /* ------------------------------------------------------------ 高亮 / 删除线 */
  {
    id: 'highlight',
    syntax: 'highlight',
    label: '高亮',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * `==高亮==` → `<mark>`。
     *
     * 高亮底色画在 `__box::before` 上（**绝对定位、不参与布局**），用
     * `transform: scaleX(0) → 1` + `transform-origin: left` 从左边"刷"过去 ——
     * 这是记号笔的动作，也正好是 `mech`（慢起硬停）该干的活。
     * 不用 `background-color` 过渡：那样是"整块同时变黄"，读不出"划过去"。
     */
    render: () =>
      h('div', { class: 'demo-highlight' }, [
        h('span', { class: 'demo-highlight__box' }, [
          h('span', { class: 'demo-highlight__text' }, '高亮'),
          h('span', { class: sub('demo-highlight', 'syntax', 'l') }, '=='),
          h('span', { class: sub('demo-highlight', 'syntax', 'r') }, '=='),
        ]),
      ]),
  },
  {
    id: 'strike',
    syntax: 'strikethrough',
    label: '删除线',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * `~~删除线~~` → `<s>`。
     *
     * 删除线用 `background-size` 画（`linear-gradient` 铺 1.5px 高的一条），
     * **不用 `text-decoration: line-through`** —— 后者是离散的，画不出"划过去"，
     * 而且一旦加上就立刻影响字形（有些字体会为了避开删除线调整字形）。
     * `background-size` 在 Endfield 那份"允许动"的清单里。
     */
    render: () =>
      h('div', { class: 'demo-strike' }, [
        h('span', { class: 'demo-strike__box' }, [
          h('span', { class: 'demo-strike__text' }, '删除线'),
          h('span', { class: sub('demo-strike', 'syntax', 'l') }, '~~'),
          h('span', { class: sub('demo-strike', 'syntax', 'r') }, '~~'),
        ]),
      ]),
  },

  /* ------------------------------------------------------------ 任务列表 */
  {
    id: 'taskList',
    syntax: 'task-list',
    label: '任务列表',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * 两行，正好把两种写法演完：`- [ ]` 落成空框、`- [x]` 落成打了勾的框。
     *
     * - 复选框**绝对定位**在文字左侧（和列表标记同一个槽位），所以框出现时
     *   文字一格都不动；
     * - 勾用 `stroke-dashoffset` 描出来（Endfield 允许的合成属性之一），
     *   120ms 量级的手感，不是"弹出来"；
     * - 第二行整体延后 `--nd-motion-stagger-row`（38ms）—— 错开只有这一档。
     *
     * ⚠️ 两行包在一个 `.demo-task__list` 里、**行内左对齐**：两行文字长度不同
     * （「待办」2 字、「已完成」3 字），如果各自居中，两个复选框会落在两条
     * 竖线上 —— 截图里一眼就能看出"列表没对齐"。包一层之后列宽取最宽那行，
     * 复选框就都在同一条线上了。
     */
    render: () =>
      h('div', { class: 'demo-task' }, [
        h('span', { class: 'demo-task__list' }, [
          taskLine('待办', '- [ ]', false),
          taskLine('已完成', '- [x]', true),
        ]),
      ]),
  },

  /* ------------------------------------------------------------ 围栏：代码 / 公式 / 嵌入 */
  {
    id: 'codeBlock',
    syntax: 'fenced-code',
    label: '代码块',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * ★ **标题栏用 `clip-path: inset()` 揭开，不动 `height`。**
     *
     * 原来动画 `height: 0 → 11px`。高度一变，外层 `justify-content: center`
     * 就要重新居中整摞内容（围栏、代码、下围栏一起往上挪）—— 仓库里记着用户
     * 原话"直接给他挤上去了"。
     *
     * 现在标题栏**高度恒为 11px、绝对定位**（不参与布局），用
     * `clip-path: inset(0 0 100% 0) → inset(0)` 从上往下"快门"揭开。
     * `clip-path` 是 Endfield 清单里的合成属性，也不影响任何兄弟节点。
     */
    render: () =>
      h('div', { class: 'demo-code-block' }, [
        h('span', { class: 'demo-code-block__win' }, [
          h('span', { class: sub('demo-code-block', 'syntax', 'open') }, '```yaml ci.yml'),
          h('span', { class: 'demo-code-block__bar' }, [
            h('span', { class: 'demo-code-block__dots' }, [h('i'), h('i'), h('i')]),
            h('span', {
              class: 'demo-code-block__icon',
              innerHTML: FILE_ICON_SVG,
              'aria-hidden': 'true',
            }),
            h('span', { class: 'demo-code-block__file' }, 'ci.yml'),
            h('span', { class: 'demo-code-block__lang' }, 'yaml'),
          ]),
          h('span', { class: 'demo-code-block__code' }, [
            h('span', { class: 'demo-code-block__code-text' }, 'name: build'),
            h('span', { class: 'demo-code-block__code-mono' }, 'name: build'),
          ]),
          h('span', { class: sub('demo-code-block', 'syntax', 'close') }, '```'),
        ]),
      ]),
  },
  {
    id: 'blockMath',
    syntax: 'block-math',
    label: '块级公式',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * 公式的"变数学字体"同样是**副本交叉淡入**（`__formula` 正体留在流里、
     * `__formula--math` 叠在上面），不再用 `steps(1, end)` 切 `font-family`。
     * 切字体要重排文字，而且 `font-style: italic` 还会改变字形度量。
     */
    render: () =>
      h('div', { class: 'demo-block-math' }, [
        h('span', { class: sub('demo-block-math', 'syntax', 'open') }, '```math'),
        h('span', { class: 'demo-block-math__formula' }, [
          h('span', { class: 'demo-block-math__formula-text' }, 'E = mc²'),
          h('span', { class: 'demo-block-math__formula-math' }, 'E = mc²'),
        ]),
        h('span', { class: sub('demo-block-math', 'syntax', 'close') }, '```'),
      ]),
  },
  {
    id: 'embed',
    syntax: 'embed',
    label: '嵌入',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () =>
      h('div', { class: 'demo-embed' }, [
        h('span', { class: sub('demo-embed', 'syntax', 'open') }, '```embed bilibili'),
        h('span', { class: 'demo-embed__card' }, [
          h('span', { class: 'demo-embed__icon', 'aria-hidden': 'true' }, '▶'),
          h('span', { class: 'demo-embed__label' }, '哔哩哔哩 · 视频'),
        ]),
        h('span', { class: sub('demo-embed', 'syntax', 'close') }, '```'),
      ]),
  },

  /* ------------------------------------------------------------ 图片 / 轮播 */
  {
    id: 'image',
    syntax: 'image',
    label: '图片',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * 图片和上面所有演示都不同：**源码和结果是两块完全不同的东西**（一行
     * `![封面](cover.png)` → 一张带边框的图），不存在"同一段文字长出外壳"。
     *
     * 所以走**交叉淡入**：源码那一层绝对居中（第 3 拍露出、第 4 拍退场），
     * 图片卡在第 4 拍**接上**（`opacity` + `scale(0.98 → 1)`，snap）。
     * 两层都绝对定位 → 全程零布局。时序上刻意错开 2%（源码 66% 退干净、
     * 卡片 68% 才开始），避免任何一帧两层叠在一起。
     */
    render: () =>
      h('div', { class: 'demo-image' }, [
        h('span', { class: 'demo-image__syntax' }, '![封面](cover.png)'),
        h('span', { class: 'demo-image__card' }, [
          h('span', { class: 'demo-image__pic', innerHTML: PIC_ICON_SVG, 'aria-hidden': 'true' }),
          h('span', { class: 'demo-image__alt' }, '封面'),
        ]),
      ]),
  },
  {
    id: 'carousel',
    syntax: 'carousel',
    label: '轮播',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    /*
     * 同段连续两张图片 → 一条可横滑的轨道 + 一排圆点。
     *
     * 源码两行（`![a](1.png)` / `![b](2.png)`）走通用 `__syntax` 淡入淡出；
     * 第 4 拍三张卡片"扇"进来：中间那张 0 偏移，左右各 `translateX(±22px)` +
     * `scale(0.86)`，按 `--nd-motion-stagger-row`（38ms）依次进 ——
     * 错开只有三档（38 / 45 / 100ms），这里用最小那档。
     * 圆点最后进（+100ms，`--nd-motion-stagger-block`）。
     */
    render: () =>
      h('div', { class: 'demo-carousel' }, [
        h('span', { class: 'demo-carousel__syntax' }, [
          h('span', { class: 'demo-carousel__src' }, '![a](1.png)'),
          h('span', { class: 'demo-carousel__src' }, '![b](2.png)'),
        ]),
        h('span', { class: 'demo-carousel__track' }, [
          h('span', { class: 'demo-carousel__slide demo-carousel__slide--l', innerHTML: PIC_ICON_SVG, 'aria-hidden': 'true' }),
          h('span', { class: 'demo-carousel__slide demo-carousel__slide--m', innerHTML: PIC_ICON_SVG, 'aria-hidden': 'true' }),
          h('span', { class: 'demo-carousel__slide demo-carousel__slide--r', innerHTML: PIC_ICON_SVG, 'aria-hidden': 'true' }),
        ]),
        h('span', { class: 'demo-carousel__dots' }, [h('i'), h('i'), h('i')]),
      ]),
  },

  /* ------------------------------------------------------------ 工具栏动作 */
  {
    id: 'undo',
    syntax: ACTION_SYNTAX,
    label: '撤销',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () => undoDemo('undo'),
  },
  {
    id: 'redo',
    syntax: ACTION_SYNTAX,
    label: '重做',
    duration: DEMO_DURATION,
    beats: DEMO_BEATS,
    render: () => undoDemo('redo'),
  },
]

/* -------------------------------------------------------------------------
 * 模板片段（几条演示共用骨架，抽出来免得三份 DOM 各写一遍）
 * ---------------------------------------------------------------------- */

/**
 * 标题演示。三档**只有目标字号不同**，节奏/原点/曲线完全一致 ——
 * 并排看才像一级阶梯，而不是三个各演各的动画。
 *
 * `transform: scale(13 / 终值)`：正文是 13px，标题是 22/18/15px，
 * 所以"从正文长到标题"= 从 `13/终值` 放大到 1。字号本身**全程是终值**。
 */
function headingDemo(id: 'h1' | 'h2' | 'h3', level: 1 | 2 | 3): VNode {
  return h('div', { class: `demo-${id}` }, [
    h('span', { class: `demo-${id}__box` }, [
      h('span', { class: `demo-${id}__word` }, '你好'),
      h('span', { class: `demo-${id}__syntax` }, '#'.repeat(level)),
    ]),
  ])
}

/**
 * 列表演示（无序 / 有序共用）。
 *
 * 两行才读得出"这是一组列表"，一行看起来只是"加了个点"。
 * 标记（`-` / `1.`）和渲染后的圆点（`•` / `1.`）**占同一个槽位**（都是绝对定位
 * 在文字左侧），所以它们交替换位时文字一格都不动。
 */
function listDemo(id: 'bullet' | 'ordered', ordered: boolean): VNode {
  const lines = ['文字一', '文字二']
  return h('div', { class: `demo-${id}` }, lines.map((text, i) =>
    h('span', { class: `demo-${id}__line`, key: text }, [
      h('span', { class: `demo-${id}__box` }, [
        h('span', { class: `demo-${id}__text` }, text),
        h('span', { class: `demo-${id}__syntax` }, ordered ? `${i + 1}.` : '-'),
        h('span', { class: `demo-${id}__marker` }, ordered ? `${i + 1}.` : '•'),
      ]),
    ]),
  ))
}

/**
 * 任务列表的一行。
 *
 * `done` 决定第 4 拍是"空框"还是"打了勾的框"—— 一个类，两种终态，
 * 不给两种行各写一套 DOM（它们除了终态完全一样）。
 */
function taskLine(text: string, marker: string, done: boolean): VNode {
  return h('span', { class: `demo-task__line${done ? ' demo-task__line--done' : ''}` }, [
    h('span', { class: 'demo-task__box' }, [
      h('span', { class: 'demo-task__text' }, text),
      h('span', { class: 'demo-task__syntax' }, marker),
      h('span', { class: 'demo-task__check' }, [
        h('svg', {
          viewBox: '0 0 10 10',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '1.6',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true',
        }, [h('path', { class: 'demo-task__tick', d: 'M2.2 5.2 4.1 7.1 7.8 3.1' })]),
      ]),
    ]),
  ])
}

/**
 * 撤销 / 重做 —— 这两个**没有语法可教**，所以演的是**按键本身**：
 * 文字先变，下方浮出工具条上的按键被按下去，给出"是谁干的"这个答案。
 *
 * ⚠️ **不许有过冲。** 原来这里有一条 `scale(1.06)` 的"弹起"，观感是果冻 ——
 * 禁令清单里写着不许。现在按下去是 `scale(0.84)`，松开就是 `scale(1)`，
 * 用 `mech` 硬停，不回头。
 */
function undoDemo(id: 'undo' | 'redo'): VNode {
  return h('div', { class: `demo-${id}` }, [
    h('div', { class: `demo-${id}__stage` }, [
      h('span', { class: `demo-${id}__text` }, '你好'),
      h('span', { class: `demo-${id}__word` }, '世界'),
    ]),
    h('div', { class: `demo-${id}__key` }, [
      h('svg', {
        class: `demo-${id}__ico`,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.5',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      }, [h('path', { d: id === 'undo' ? UNDO_PATH : REDO_PATH })]),
    ]),
  ])
}

/* -------------------------------------------------------------------------
 * 查询
 * ---------------------------------------------------------------------- */

const BY_ID = new Map<string, DemoSpec>(DEMOS.map((demo) => [demo.id, demo]))

/** 按 id 取演示。找不到返回 `undefined` —— 调用方自己决定降级策略。 */
export function getDemo(id: string): DemoSpec | undefined {
  return BY_ID.get(id)
}
