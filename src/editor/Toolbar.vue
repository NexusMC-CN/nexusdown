<script setup lang="ts">
defineOptions({ name: 'NexusdownToolbar' })

/**
 * 发帖页的 Markdown 工具栏（CodeMirror 6）。
 *
 * ## 为什么不是 `nexusdown/vue` 的 `EditorToolbar`
 *
 * 那个工具栏是 **Tiptap** 的：按钮跑的是 `editor.chain().focus().toggleBold()`，
 * 改的是 Tiptap 的**节点树**。CM6 这边根本没有节点树可改 —— 真相是文本，
 * 命令签名是 `(view: EditorView) => boolean`。**两边的抽象对不上，不能复用。**
 *
 * 命令本体在 `@nexusmc-cn/nexusdown/cm`（以前是本地的 `~/utils/cm-markdown`，
 * 已搬回库里 —— 它只改文档不画 UI，是纯方言知识；而且 `shortcuts.ts` 里
 * 曾经另有一份逐字相同的实现。行内标记那三条是
 * `nexusdown/src/cm/shortcuts.ts` 的移植，那个文件里有完整说明）。
 *
 * ## ⚠️ 点完必须把焦点还给编辑器
 *
 * 按钮是 `<button>`，点它浏览器会把焦点移到按钮上。不还焦点的话，
 * 用户点完「加粗」接着打字 —— **字打到按钮上，编辑器一个字都收不到**
 * （表现是"点完就没反应了"，很容易误判成命令没执行）。
 * 两道保险：
 * 1. `@mousedown.prevent` —— 从源头阻止焦点离开编辑器（连光标闪烁都不会断）；
 * 2. 命令跑完再 `view.focus()` —— 键盘操作（Tab 到按钮 + 回车）走不到 mousedown，
 *    这一条兜住那种情况。
 *
 * ## 链接为什么要一个内联输入框
 *
 * 本来 `window.prompt` 三行就能写完，但这个页面自己写明了
 * 「浏览器原生弹窗又烦又不可靠」（见 `new.vue` 草稿那段的取舍 1）。
 * 而且原生弹窗会**阻塞页面**，自动化验证里点一下整个 CDP 会话就卡死。
 * 所以做成工具栏下面一条内联的输入行。
 *
 * 打开输入框时**编辑器的选区不会丢** —— CM6 的 `state.selection` 是自己的状态，
 * 和 DOM 焦点无关。所以确认时直接用「当前选区」当链接文字是对的。
 *
 * ## 图标为什么是内联 SVG
 *
 * 上一版用 `B` / `H2` / `1.` 这些**文字短标签**当图标。代价是十几个按钮的
 * 视觉重量**全看字体**：`B` 是粗的、`I` 是斜的、`1.` 和 `H1` 宽度差一倍，
 * 摆在一起像"拼凑"（用户原话）。而且字号被锁死在 12.5px，想再精致也没余地。
 *
 * 换成手写的 16×16 内联 SVG：同一套 `stroke-width: 1.5` + 同样的圆头圆角，
 * 视觉重量是自己说了算的。**不引图标库**（`@iconify` / `lucide` / 图标字体都不引）——
 * 这个项目已经踩过"运行时从 CDN 拉图标、离线时静默变空标签"的坑，
 * 十几个路径写在文件里，离线、SSR、剪包都不会出问题。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
/*
 * ⚠️ **运行时依赖一律从引擎拿**（`../cm/index`），不要直接 import `@codemirror/*`。
 *
 * 直接 import 会让这个组件从**自己的解析路径**拿到一份模块，而 `nexusdown()`
 * 来自另一条 —— 两条路径一旦落到不同实例，CM6 的 facet / StateField
 * 按模块标识比较就会失败：`Unrecognized extension value`，
 * 或者更糟的**装饰静默失效**（不报错，就是不渲染）。
 *
 * 类型 import（`type`）是安全的 —— 编译期就擦掉了，不进运行时。
 */
import type { BlockKind, Command, EditorView, MentionCandidate, VariantItem } from '@nexusmc-cn/nexusdown/cm'
import {
  applyBlockAttrs,
  blockKindAt,
  redo,
  syntaxTree,
  undo,
  insertBlockMath,
  insertEmbed,
  insertInlineMath,
  insertLink,
  insertMention,
  insertTable,
  toggleBold,
  toggleBulletList,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
  variantItemsFor,
  blockAttrsAt,
  blockRangeAt,
  isTaskList,
  tabGroupAt,
  addTab,
  removeTab,
  type TabGroup,
  wrapCodeBlock,
} from '@nexusmc-cn/nexusdown/cm'
/*
 * 演示注册表 + 画布外壳。
 *
 * ⚠️ **演示的 DOM / CSS 只有一份**，在 `./demos/` 里（`demos.ts` / `demos.css`）。
 * 这个组件只负责"哪个按钮演哪一段"（`GROUPS` 的 `demo` 字段）。
 * 从前 18 段演示是写在本文件的模板和 `<style scoped>` 里的 —— 那样
 * Motion Lab 没法单独渲染它们，也就没法逐帧审片。
 */
import DemoStage from './demos/DemoStage.vue'
import { getDemo, type DemoId, type DemoSpec } from './demos/demos'

const props = defineProps<{
  /** 编辑器实例。还没挂上时是 `null` —— 那时所有按钮都禁用。 */
  view: EditorView | null
  /**
   * 提及候选（可选，**必须能异步**）—— 消费方可能要发请求去查库。
   *
   * 库**不查库**（同 `mathRenderer` / 渲染侧的 `RenderData`）：它只认 `@slug`
   * 这个语法，「有哪些 slug 可提及」是消费方的事。注入了 → 「提及」按钮打开
   * 一个可搜索的选择器；**没注入 → 按钮照样在**，只是降级成"落一个 `@`"
   * （理由见 `openMention`）。
   */
  mentionCandidates?: () => Promise<MentionCandidate[]>
}>()

/* ---------------------------------------------------------------- 图标 */

/**
 * 一个图标 = 一串图元。用数据描述而不是在模板里堆 12 段 `<svg>`，
 * 是为了让 `GROUPS` 那张表**仍然是一张表**（按钮和图标在同一个地方看得见）。
 *
 * - `p` 描边路径（继承 `<svg>` 上的 `stroke-width: 1.5` / 圆头圆角）
 * - `c` 实心圆点（列表符号。描边画圆点会变成小圆环，太轻）
 * - `r` 实心圆角条（引用的左侧竖条。和正文一样细的竖条撑不起"引用块"）
 * - `x` 小号文字（标题的 1/2/3、有序列表的序号）
 *
 * ⚠️ **所有图形都画在同一个 16×16 网格上，视觉重量靠"墨迹面积"对齐。**
 * 描边类图元统一落在 `y ∈ [2.7, 13.3]` 这一带，谁都不许比别人大一圈或小一圈。
 * 这不是靠眼睛估的：把每个图标逐个栅格化、扫像素算外框和墨迹面积，
 * 每个都要落在均值的 ±15% 以内（`italic` 是唯一例外，见下面那条注释）。
 * **改任何一个图标都要重新量一遍** —— 量法固化在 `scripts/measure-icons.mjs`，
 * 它直接从本文件里读 `ICONS` 表（不是手抄一份，否则量的是另一个东西），
 * 跑 `node scripts/measure-icons.mjs` 就出面积和比值。
 *
 * ⚠️ 序号用 `<text>` 而不是 path：5~7px 高的数字用 path 画，`stroke-width: 1.5`
 * 的笔画会把字腔糊死（"2"和"3"分不出来）。文字交给字体去渲染反而干净。
 * 图标整体带 `aria-hidden`，纯装饰，读屏读的是按钮上的 `aria-label`。
 */
type Shape =
  | { t: 'p'; d: string }
  | { t: 'c'; cx: number; cy: number; r: number }
  | { t: 'r'; x: number; y: number; w: number; h: number; rx: number }
  | { t: 'x'; x: number; y: number; v: string; size: number }

type IconName =
  | 'bold' | 'italic' | 'inlineCode' | 'inlineMath'
  | 'h1' | 'h2' | 'h3'
  | 'bullet' | 'ordered' | 'quote' | 'table'
  | 'link' | 'mention' | 'codeBlock' | 'blockMath' | 'embed'
  | 'undo' | 'redo' | 'attrs'

/** 列表三行的 y —— 无序和有序**共用同一组基准线**，两个图标才会像一对。 */
/*
 * ⚠️ 代码块演示里的文件图标**不在这里**了 —— 它跟着演示一起搬进了
 * `./demos/demos.ts`。那边的注释解释了为什么那段演示画的是中性字形、
 * 而不是 `codeIconSvg('yaml')`（注册表必须能被测试和 Lab 独立 import，
 * 一旦 import `../cm/` 就会把 CM6 打进 editor 产物、造出第二份实例）。
 */

const ROWS = [3.8, 8, 12.2]

/* 写成 `Record<IconName, Shape[]>` 而不是 `satisfies`：`satisfies` 这个项目里没别处用，
   而 `Record<IconName, ...>` 一样能拿到字面量键的联合类型（`keyof typeof ICONS`），
   还多一条 —— **少画一个图标就是编译错误**。 */
const ICONS: Record<IconName, Shape[]> = {
  /* B：左边一根竖干 + 上下两个碗。宽度天然比别的图标窄，靠 x 居中抵消。
     竖干收到 3.0–13.0（不是 2.6–13.4）：B 的笔画总长本来就最长，
     再拉高就比别的图标重一档（扫像素量出来面积是均值的 1.15 倍）。 */
  bold: [
    { t: 'p', d: 'M4.6 3V13M4.6 3h3a2.3 2.3 0 0 1 0 4.6H4.6M4.6 7.6h3.7a2.7 2.7 0 0 1 0 5.4H4.6' },
  ],
  /* I：上下两条衬线 + 斜干。斜干端点必须落在衬线范围内，不然会"脱节"。
     ⚠️ **这是全套里唯一超出 ±15% 的图标**（墨迹面积是均值的 0.68 倍）。
     但它就该轻：一个斜体 I 只有 3 笔，一个粗体 B 是一整圈轮廓 ——
     真实字体里 B 的墨就是比 I 多得多，硬凑平反而会让斜体胖得不像斜体。
     Lucide / Feather 的 bold 和 italic 也是同样的不对称。衬线做到 4.2 长
     （不是"够用就行"的 3.3）已经是在不动笔画数的前提下能补的极限。 */
  italic: [
    { t: 'p', d: 'M8.3 2.6h4.2M3.5 13.4h4.2M10.6 2.6 5.4 13.4' },
  ],
  /* 行内代码：一对尖括号（和代码块的 `</>` 是**一对**，区别只在中缝那条斜杠）。 */
  inlineCode: [
    { t: 'p', d: 'M6.4 3.2 2 8 6.4 12.8M9.6 3.2 14 8 9.6 12.8' },
  ],
  /* 行内公式：Σ（求和号）—— 一个**独立的数学符号**，正好对应"行内"这个尺寸感。
     四段笔画（顶横 / 斜下 / 斜上 / 底横）加起来 29.8，扫出来墨迹面积 **45.2**
     （均值的 0.97 倍）。
     和块级公式那个分式（三层结构）刻意拉开形状差，并排不会认错。 */
  inlineMath: [
    { t: 'p', d: 'M12.6 3.4H4.2l4.6 4.6-4.6 4.6h8.4' },
  ],
  /* H1 / H2 / H3：同一个 H，只有右下角的数字不同。 */
  h1: [{ t: 'p', d: 'M2.2 3.2v9.6M7.8 3.2v9.6M2.2 8h5.6' }, { t: 'x', x: 11.4, y: 12.7, v: '1', size: 7.2 }],
  h2: [{ t: 'p', d: 'M2.2 3.2v9.6M7.8 3.2v9.6M2.2 8h5.6' }, { t: 'x', x: 11.4, y: 12.7, v: '2', size: 7.2 }],
  h3: [{ t: 'p', d: 'M2.2 3.2v9.6M7.8 3.2v9.6M2.2 8h5.6' }, { t: 'x', x: 11.4, y: 12.7, v: '3', size: 7.2 }],
  bullet: [
    ...ROWS.map((y) => ({ t: 'c', cx: 3.1, cy: y, r: 1.15 }) as Shape),
    { t: 'p', d: `M6.3 ${ROWS[0]}h7.3M6.3 ${ROWS[1]}h7.3M6.3 ${ROWS[2]}h7.3` },
  ],
  /* 序号只有 4.4px —— 要和同排的无序列表圆点**一样大**，不能按标题那个 7.2 走。
     再大一点数字就会超过 4.2 的行距，1/2/3 上下互相顶住（放大 9 倍看得很明显）。 */
  ordered: [
    ...ROWS.map((y, i) => ({ t: 'x', x: 3.1, y: y + 1.8, v: String(i + 1), size: 4.4 }) as Shape),
    { t: 'p', d: `M6.3 ${ROWS[0]}h7.3M6.3 ${ROWS[1]}h7.3M6.3 ${ROWS[2]}h7.3` },
  ],
  /* 引用：左边一条**实心**竖条 + 三行文字。竖条比描边粗一档才撑得住。
     行基准线跟列表**共用 `ROWS`** —— 三个块级图标的横线落在同一条水平线上，
     并排看才像一套。
     不用 `❝`：那个字符不在系统字体里（上一版就是栽在这上面），而且
     "左边一条竖条"才是块引用的通用视觉。 */
  quote: [
    { t: 'r', x: 3, y: 3, w: 2, h: 10, rx: 1 },
    { t: 'p', d: `M7.4 ${ROWS[0]}h6.2M7.4 ${ROWS[1]}h6.2M7.4 ${ROWS[2]}h4.4` },
  ],
  /* 表格：外框 + 表头分隔线 + 表头下方一条竖分隔（两列）。
     ⚠️ 它是全套里**最宽扁**的一个（外框只占 y 3.9~12.1，别的图标都到 2.x~13.x）——
     这不是画小了，是**表格图形本身的性质**：外框越高，周长越大，
     墨迹面积会直接冲出 ±15% 带（试过 8.8×6.8 的外框，扫出来面积 60.2、比值 1.27，
     复现：`node scripts/measure-icons.mjs '{"t":[{"t":"p","d":"M3.6 4.6h8.8v6.8H3.6zM3.6 7.8h8.8M8 7.8v3.6"}]}'`）。
     所以它靠**面积**（51.2，均值的 1.09 倍）而不是外框和别的图标对齐。 */
  table: [
    { t: 'p', d: 'M4.6 4.6h6.8v6.8H4.6zM4.6 7.8h6.8M8 7.8v3.6' },
  ],
  /* 链接：两节链环，对角咬合。坐标是 Feather `link` 的 24 网格缩到 16 的，
     缩放系数 **0.55** 不是 2/3 = 0.667 —— 2/3 缩出来墨迹面积 58.4（均值的 1.27 倍），
     一排里明显"跳"出来。0.55 落到 52.3（1.12 倍），和其他图标齐平。
     （这个数不是拍脑袋：把每个图标逐个栅格化、扫像素算墨迹面积量出来的。） */
  link: [
    {
      t: 'p',
      d: 'M6.94 8.53a2.66 2.66 0 0 0 4.02.28l1.6-1.6a2.66 2.66 0 0 0-3.76-3.76L7.88 4.37'
        + 'M9.06 7.47a2.66 2.66 0 0 0-4.02-.28l-1.6 1.6a2.66 2.66 0 0 0 3.76 3.76l.91-.91',
    },
  ],
  /* 提及：一个 `@` —— 内圈（"a"的碗）+ 右侧竖干和尾巴 + 外圈，三段拼成
     （坐标是 Feather `at-sign` 的 24 网格缩到 16 的，缩放系数 **≈0.38** 不是 2/3）。
     ⚠️ **它是全套里"最重"的形状**：一个 `@` 天生是**内外两层环**，笔画总长
     比别的图标长得多 —— 2/3 缩出来墨迹面积 90.2（均值的 1.83 倍，一行里像块墨疙瘩）。
     一路收到 0.38 才落到 **52.1**（均值的 1.11 倍），代价是外框只有 9.4×9.4
     （别的图标约 11~12）—— 这不是画小了，是**双环形状本身的性质**，
     和 `table` 靠面积而不是外框对齐是同一条判断。
     （复现：`node scripts/measure-icons.mjs '{"x":[{"t":"p","d":"M9.5 6.5v1.9a1.1 1.1 0 0 0 2.2 0v-.4a3.95 3.95 0 1 0-1.6 3.18"},{"t":"p","d":"M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z"}]}'`） */
  mention: [
    { t: 'p', d: 'M9.5 6.5v1.9a1.1 1.1 0 0 0 2.2 0v-.4a3.95 3.95 0 1 0-1.6 3.18' },
    { t: 'p', d: 'M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z' },
  ],
  /* 代码块：`</>` —— 比行内代码多一条中缝斜杠，尖括号同时收小一圈。 */
  codeBlock: [
    { t: 'p', d: 'M5.8 5.2 2.6 8l3.2 2.8M10.2 5.2 13.4 8l-3.2 2.8M9.6 3.2 6.4 12.8' },
  ],
  /* 块级公式：**分式**（分子 / 分数线 / 分母）—— 三层结构，天然对应"块"。
     中间那条分数线（11.2）比上下两条（各 8）长，一眼和"三条等长的汉堡菜单"分开。
     扫出来墨迹面积 **46.1**（均值的 0.99 倍）。 */
  blockMath: [
    { t: 'p', d: 'M4 4.8h8M4 11.2h8M2.4 8h11.2' },
  ],
  /* 嵌入：一个**带播放三角的取景框**（第三方嵌入以视频为主，B站/抖音都是视频）。
     框 7.2×6.4 + 三角 3×2.4，面积 **52.6**（均值的 1.12 倍）。
     和表格图标同样是"宽扁的框"，但框里是三角而不是网格线，并排不会认错。 */
  embed: [
    { t: 'p', d: 'M4.4 4.8h7.2v6.4H4.4zM6.8 6.8l3 1.2-3 1.2z' },
  ],
  /* 撤销 / 重做：**镜像的一对**。重做的每个 x 都是 16 - 撤销的 x，
     手写两份而不是 `transform: scale(-1,1)` —— 负缩放会把圆头端点也翻过去，
     两个图标的笔画收尾会左右不对称。 */
  undo: [
    { t: 'p', d: 'M6 9.3 2.7 6l3.3-3.3M2.7 6h7a3.65 3.65 0 0 1 3.65 3.65 3.65 3.65 0 0 1-3.65 3.65H7.3' },
  ],
  redo: [
    { t: 'p', d: 'M10 9.3 13.3 6l-3.3-3.3M13.3 6h-7a3.65 3.65 0 0 0-3.65 3.65 3.65 3.65 0 0 0 3.65 3.65H8.7' },
  ],
  /*
   * 块变体：一对花括号。和演示里的「属性行」是同一个记号 ——
   * 用户看到 `{}` 就知道"这是块的参数"，不用记 `.steps` 这种写法。
   */
  attrs: [{ t: 'x', x: 8, y: 11.5, v: '{}', size: 7.6 }],
}

/* ---------------------------------------------------------------- 光标状态 */

/**
 * 「光标现在在什么里」。用来给按钮点灯 —— 这是工具栏"有反馈"的一半
 * （另一半是按下时的下沉，见样式里的 `:active`）。
 *
 * ⚠️ **不能靠 `View.updateListener`**：那个得作为 Extension 在 `EditorState.create()`
 * 时挂上，而 view 是在 `new.vue` 里建的（本组件只拿到一个只读的 `view`）。
 * CM6 也**没有**"给已存在的 view 追加 extension"的 API。
 * 所以退一步：在 `view.dom` 和 `document` 上挂几个原生事件，
 * 事件里直接读 `view.state`。**只读不写，不碰编辑器本体。**
 *
 * 触发点选得比较宽（`selectionchange` + `keyup`/`mouseup`/`input`/`focus`）：
 * 光标可能被键盘、鼠标、输入法、粘贴、撤销……任何一条路径改掉，
 * 少挂一个就会"点了加粗灯不亮"。重算本身是 O(树深)，很便宜；
 * 真正要防的是**无谓的 Vue 重渲染**，所以下面用 `lastKey` 挡一道。
 */
type Kind =
  | 'bold' | 'italic' | 'inlineCode'
  | 'h1' | 'h2' | 'h3'
  | 'bullet' | 'ordered' | 'quote' | 'codeBlock'

/** `@lezer/common` 不在本包的直接依赖里（pnpm 严格布局），所以不引它的 `SyntaxNode` 类型。 */
interface TreeNode { name: string; from: number; to: number; parent: TreeNode | null }

function detectActive(view: EditorView): Kind[] {
  const found = new Set<Kind>()
  const tree = syntaxTree(view.state)

  for (const range of view.state.selection.ranges) {
    /**
     * 每个选区只探**一个**位置，但空选区和有选区的判法不同：
     *
     * - 光标（空选区）：探 `head`，要求**严格**落在节点内部（`from < pos < to`）。
     *   不严格的话，光标停在 `**加粗**` 的**右括号之后**也会点亮「加粗」——
     *   可那时用户已经在写普通正文了。
     * - 有选区：探 `to`（节点结束的那一端 —— `resolveInner(pos, -1)` 返回的
     *   正是"结束于此"的那个节点，所以从这里往上走一定能碰到外层的行内标记），
     *   要求**整个选区被节点包住**。全选 `**加粗**`（连定界符一起）时两端都压在
     *   节点边界上，用严格判定会判成"不在加粗里"，可用户看到的明明是加粗。
     *
     * 块级节点（标题 / 列表 / 引用 / 代码块）**不做这个判定**：
     * 光标停在 `# 标题` 的行尾必须算在标题里，加了反而判不出来。
     */
    const pos = range.empty ? range.head : range.to
    const hit = range.empty
      ? (n: TreeNode) => n.from < pos && pos < n.to
      : (n: TreeNode) => n.from <= range.from && range.to <= n.to

    for (let node = tree.resolveInner(pos, -1) as TreeNode | null; node; node = node.parent) {
      switch (node.name) {
        case 'StrongEmphasis': if (hit(node)) found.add('bold'); break
        case 'Emphasis': if (hit(node)) found.add('italic'); break
        case 'InlineCode': if (hit(node)) found.add('inlineCode'); break
        case 'ATXHeading1': case 'SetextHeading1': found.add('h1'); break
        case 'ATXHeading2': case 'SetextHeading2': found.add('h2'); break
        case 'ATXHeading3': found.add('h3'); break
        case 'Blockquote': found.add('quote'); break
        case 'FencedCode': case 'CodeBlock': found.add('codeBlock'); break
        /* 列表要往上再看一层才知道是无序还是有序 —— `ListItem` 是两种共用的。 */
        case 'ListItem':
          if (node.parent?.name === 'BulletList') found.add('bullet')
          else if (node.parent?.name === 'OrderedList') found.add('ordered')
          break
      }
    }
  }
  return [...found]
}

const activeKinds = ref<Kind[]>([])
/**
 * 光标所在块的类型 —— 「＋ 变体」菜单按它决定给哪些选项。
 *
 * 和 `activeKinds` 分开：那个是"哪些按钮该点亮"，这个是"当前块能加什么属性"。
 * 光标从列表移到表格时 `activeKinds` 可能没变，但变体菜单必须变。
 */
const variantKind = ref<BlockKind | null>(null)
/** 上一次算出来的结果。相同就**不写 ref**，省掉一次整表重渲染。 */
let lastKey = ''

function refreshActive() {
  const view = props.view
  if (!view) return
  let next: Kind[]
  try {
    next = detectActive(view)
    variantKind.value = blockKindAt(view.state)
    variantApplied.value = new Set(blockAttrsAt(view.state)?.tokens.map((token) => token.name) ?? [])
  } catch {
    /* 语法树还没建好 / 解析中途 —— 点灯是锦上添花，绝不能让它把工具栏搞崩。 */
    return
  }
  const key = next.join(',')
  if (key === lastKey) return
  lastKey = key
  activeKinds.value = next
}

function isActive(kind: Kind | undefined) {
  return kind ? activeKinds.value.includes(kind) : false
}

/* ---------------------------------------------------------------- 块变体 */

/**
 * 当前块能加哪些变体 —— 和编辑器里的「＋ 变体」**共用同一份** `variantItemsFor`
 * （`src/cm/variants.ts`）。两处入口各写一个 switch 迟早漂移。
 */
const variantItems = computed<VariantItem[]>(() => variantItemsFor(variantKind.value))

/** 当前块已经应用的变体名（菜单打勾用）。 */
const variantApplied = ref<Set<string>>(new Set())

const variantOpen = ref(false)
const variantRoot = ref<HTMLElement | null>(null)
/**
 * 打开菜单时锁定的块起点。
 *
 * ⚠️ 之前 `applyVariant` 用 `applyBlockAttrs(attr)`（= 当前光标），
 * 用户打开菜单后点了别处、或光标本来就不在块里，属性会落到**错误的块**
 * （实测：`{lines}` 跑到了数学段后面）。打开菜单时把块位置记下来。
 */
const variantTarget = ref<number | null>(null)
/** 光标在页签组里时，菜单给的是「增加/删除页签」，不是 fence 变体。 */
const variantTabGroup = ref<TabGroup | null>(null)

function toggleVariants() {
  const view = props.view
  if (!view) return

  /*
   * ⚠️ 打开菜单时**重新按当前光标算一次块类型**，不能依赖 `refreshActive` 的缓存：
   * 光标从代码块移到段落后，缓存可能还是 fence，菜单就会给出一组对段落无效的
   * 选项，点下去属性落到错误的块（实测：`{lines}` 跑到数学段后面）。
   */
  /*
   * 页签组优先：光标在页签里时，工具栏也应该给「增加/删除页签」，
   * 而不是把它当普通 fence 给「代码标题/行号/高亮」。
   */
  const group = tabGroupAt(view.state, view.state.selection.main.head)
  variantTabGroup.value = group
  if (group) {
    variantOpen.value = true
    return
  }

  const kind = blockKindAt(view.state)

  // 任务列表（`- [ ]`）不提供步骤/卡片：和悬停菜单同一条判据。
  if (kind === 'list' && isTaskList(view.state, view.state.selection.main.head)) {
    variantOpen.value = false
    return
  }

  variantKind.value = kind
  variantApplied.value = new Set(blockAttrsAt(view.state)?.tokens.map((token) => token.name) ?? [])

  if (!variantItemsFor(kind).length) {
    variantOpen.value = false
    return
  }

  variantTarget.value = blockRangeAt(view.state)?.from ?? null
  variantOpen.value = !variantOpen.value
}

function addTabFromToolbar() {
  const view = props.view
  const group = variantTabGroup.value
  if (!view || !group) return
  variantOpen.value = false
  addTab(view, group)
}

function removeTabFromToolbar() {
  const view = props.view
  const group = variantTabGroup.value
  if (!view || !group) return
  variantOpen.value = false
  removeTab(view, group, 0)
}

function applyVariant(item: VariantItem) {
  variantOpen.value = false
  // 和悬停菜单同一套语义：互斥替换 + 已应用再点一次取消。
  runCommand(
    applyBlockAttrs(item.attr, variantTarget.value ?? undefined, {
      toggle: true,
      exclusive: item.exclusive,
    }),
  )
}

function onVariantPointerDown(event: PointerEvent) {
  if (!variantOpen.value) return
  const root = variantRoot.value
  if (root && !root.contains(event.target as Node)) variantOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', onVariantPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onVariantPointerDown))

/** 从 view 上摘监听。view 换了（正常只有一次）或组件卸载时调用。 */
let detach: (() => void) | null = null

watch(
  () => props.view,
  (view) => {
    detach?.()
    detach = null
    lastKey = ''
    activeKinds.value = []
    if (!view) return

    const onAny = () => refreshActive()
    const events = ['keyup', 'mouseup', 'input', 'focus'] as const
    for (const e of events) view.dom.addEventListener(e, onAny)
    /* 纯键盘移动光标（方向键）在 `keyup` 里能兜住，但输入法选词、粘贴、
       点空白处落光标这些**不产生按键**的路径只有 `selectionchange` 看得见。 */
    document.addEventListener('selectionchange', onAny)

    detach = () => {
      for (const e of events) view.dom.removeEventListener(e, onAny)
      document.removeEventListener('selectionchange', onAny)
    }
    refreshActive()
  },
  { immediate: true },
)

onUnmounted(() => detach?.())

/* ---------------------------------------------------------------- 命令 */

/**
 * 命令跑完把焦点还给编辑器。
 *
 * `cmd(view)` 的返回值是「这次改动成没成立」（`false` = 没改，比如解包时
 * 节点里没有定界符），这里**不看它** —— 焦点该还还是要还。
 */
function runCommand(cmd: Command) {
  const view = props.view
  if (!view) return
  cmd(view)
  view.focus()
  /* 立刻重算一次，不等 `selectionchange` —— 那是异步的，
     等它回来按钮会先闪一下旧状态再变，观感是"点了没反应"。 */
  refreshActive()
}

/* ---------------------------------------------------------------- 链接输入框 */

const linkOpen = ref(false)
const linkHref = ref('')
const linkInput = ref<HTMLInputElement | null>(null)

function openLink() {
  if (!props.view) return
  linkHref.value = ''
  linkOpen.value = true
  nextTick(() => linkInput.value?.focus())
}

function confirmLink() {
  const view = props.view
  linkOpen.value = false
  if (!view) return
  if (linkHref.value.trim()) insertLink(linkHref.value)(view)
  // 没填 URL 就只是关掉输入框，不往正文里插半截 `[](`
  view.focus()
}

function cancelLink() {
  linkOpen.value = false
  props.view?.focus()
}

/* ---------------------------------------------------------------- 提及选择器 */

/**
 * ## 为什么按钮**没有候选时也要在**
 *
 * 用户报的 bug 是"**没在编辑器里看到**这个功能" —— 所以入口必须**永远可见**，
 * 不能因为消费方没接线就整个消失（那正是当初"工具栏没看到表格/公式按钮"那类问题）。
 *
 * ## 没注入候选时为什么是"落一个 `@`"而不是"禁用 + tooltip"
 *
 * 编辑器侧的提及是**纯语法**的：`@slug` 由 `shared/mention.ts` 扫出来渲染成胶囊，
 * **根本不查库**（查库只在渲染侧、发布之后）。也就是说这个按钮的核心动作
 * （"给我一个提及"）**不依赖候选列表**，缺的只是"帮你挑 slug"这一步。
 * 所以禁用是在**说谎** —— 它会让用户以为功能不可用，而实际上打 `@rei` 照样出胶囊。
 * 退化成"落一个 `@`"更诚实：给出语法的开头，用户接着打 slug 即可
 * （悬停卡片里的演示正好教了 `@slug` 长什么样）。
 *
 * 同一条判断在 `insertInlineMath` 上：空白处点它也是落一对 `$`、光标居中，
 * 而不是"没选中内容就禁用"。
 *
 * ## 键盘 / 焦点 / Esc —— 和 `openLink` 那套一致
 *
 * - **打开即聚焦输入框**（`nextTick`）—— 否则用户得先点一下才能打字；
 * - **Esc 关掉**并**把焦点还给编辑器**（同 `cancelLink`）；
 * - 上下键移动高亮（**循环**，到底回到头）、回车选中、鼠标悬停也跟着高亮
 *   （`@mouseenter` 同步 `mentionActive`，不然键盘和鼠标两套高亮会打架）；
 * - 点面板**外面**关掉 —— 下拉面板和链接那条**内联输入行**不同：它浮在正文上，
 *   不关就会一直盖着编辑器。判定用"点是否落在工具栏根元素之外"，
 *   这样点工具栏上的**任何**按钮（包括再点一次「提及」）都不算"外面"，
 *   不会和按钮自己的 toggle 打架。
 */
const mentionOpen = ref(false)
const mentionQuery = ref('')
const mentionItems = ref<MentionCandidate[]>([])
const mentionActive = ref(0)
const mentionLoading = ref(false)
const mentionError = ref('')
const mentionInput = ref<HTMLInputElement | null>(null)
const mentionRoot = ref<HTMLElement | null>(null)

/**
 * 过滤后的候选。`slug` 和 `title` **都参与匹配**：用户可能记得显示名
 * （「REI 物品管理器」），也可能记得 slug（`rei`）。大小写不敏感 ——
 * slug 只收小写，但 title 是中文 / 混合大小写。
 *
 * 候选可能几十上百个，所以过滤放在**客户端**做（一次拉全、边打边筛），
 * 比每敲一个字发一次请求稳 —— 不会因为请求乱序而闪。
 */
const mentionFiltered = computed(() => {
  const q = mentionQuery.value.trim().toLowerCase()
  if (!q) return mentionItems.value
  return mentionItems.value.filter(
    (c) => c.slug.toLowerCase().includes(q) || c.title.toLowerCase().includes(q),
  )
})

/**
 * 竞态令牌：用户可能开了又关、又开，或者连点两下。
 * 只有**最后一次**打开的请求结果算数 —— 否则旧请求后回来会把列表覆盖掉。
 */
let mentionToken = 0

function openMention() {
  const view = props.view
  if (!view) return
  // 已经开着 → 再点一次就是关掉（开关语义，和链接按钮的"只开不关"不同，
  // 因为它是个浮层，用户会想用同一个按钮收起它）。
  if (mentionOpen.value) {
    closeMention()
    return
  }

  const load = props.mentionCandidates
  /*
   * 没注入候选 → 降级成"落一个 `@`"（理由见本节文件头注释）。
   * `insertMention('')` 落的就是一个裸 `@`，和注入了候选时走的是**同一条命令** ——
   * 不给降级路径单开一条分支，行为就不会和主路径漂。
   */
  if (!load) {
    runCommand(insertMention(''))
    return
  }

  mentionOpen.value = true
  mentionQuery.value = ''
  mentionActive.value = 0
  mentionItems.value = []
  mentionError.value = ''
  mentionLoading.value = true
  nextTick(() => mentionInput.value?.focus())

  const token = ++mentionToken
  load().then(
    (items) => {
      if (token !== mentionToken) return
      mentionItems.value = items
      mentionActive.value = 0
      mentionLoading.value = false
    },
    (e: unknown) => {
      if (token !== mentionToken) return
      mentionError.value = e instanceof Error ? e.message : String(e)
      mentionLoading.value = false
    },
  )
}

/** 选中一条候选：插 `@slug`、关面板、焦点还给编辑器。 */
function pickMention(c: MentionCandidate) {
  const view = props.view
  mentionOpen.value = false
  if (!view) return
  insertMention(c.slug)(view)
  view.focus()
  /* 立刻重算一次点亮状态，不等 `selectionchange`（同 `runCommand` 那条）。 */
  refreshActive()
}

function closeMention() {
  mentionOpen.value = false
  props.view?.focus()
}

/** 高亮上下移动。**循环** —— 到最后一条再按下回到第一条。 */
function moveMention(delta: number) {
  const n = mentionFiltered.value.length
  if (!n) return
  mentionActive.value = (mentionActive.value + delta + n) % n
}

function onMentionKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMention()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveMention(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveMention(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const hit = mentionFiltered.value[mentionActive.value]
    if (hit) pickMention(hit)
  }
}

/** 查询变了 → 高亮回到第一条（不然会停在一个跟新列表无关的下标上）。 */
watch(mentionQuery, () => {
  mentionActive.value = 0
})

/**
 * 点面板外面关掉。用 `pointerdown` 而不是 `click` —— 后者要等抬起，
 * 期间页面已经响应了那次点击（比如把光标落到正文里），观感是"先点了别处、面板才慢半拍地关"。
 */
function onDocPointerDown(event: PointerEvent) {
  if (!mentionOpen.value) return
  const root = mentionRoot.value
  const target = event.target
  if (root && target instanceof Node && root.contains(target)) return
  closeMention()
}

watch(mentionOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onDocPointerDown)
  else document.removeEventListener('pointerdown', onDocPointerDown)
})

onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))

/* ---------------------------------------------------------------- 按钮表 */

/**
 * 悬停卡片里播哪一段演示 —— 一个**演示 id**（`./demos/demos.ts` 的 `DEMO_IDS`）。
 *
 * 每个按钮的 `demo` 现在都和它的 `icon` 同名，但字段是分开的：它们回答的是
 * **两个不同的问题** —— `icon` 是"这个按钮长什么样"，`demo` 是"它教什么"。
 * 模板只认 `demo`，所以以后换图标不会连带动画，两个按钮也可以共用一段演示。
 *
 * ⚠️ 类型是注册表导出的 `DemoId`（字面量联合），**写错就编译报错** ——
 * 从前的 `DemoName` 是手抄的第二份清单，删掉一个演示不会有任何提示。
 */
type DemoName = DemoId

interface ToolButton {
  /** `ICONS` 里的键。纯装饰，可读的名字在 `title` / `aria-label` 上。 */
  icon: IconName
  /** 悬停卡片里放哪一段演示。见 `DemoName`。 */
  demo: DemoName
  /** 悬停提示 + `aria-label`。快捷键要写进去 —— 用户从提示里学会键盘操作。 */
  title: string
  act: () => void
  /** 有这一项 = 是个"开关"，光标进去时点亮，并且会写 `aria-pressed`。 */
  kind?: Kind
}

/**
 * 演示 id → `DemoSpec`。
 *
 * 查不到就**当场报错**而不是画一段空画布："某个按钮指向一个不存在的演示"
 * 是加载期该暴露的错，静默降级成别的演示只会让人以为演示本身写错了。
 * `registry.test.ts` 保证 `DEMO_IDS` 里每个 id 都能查到。
 */
function demoSpec(id: DemoId): DemoSpec {
  const spec = getDemo(id)
  if (!spec) throw new Error(`演示注册表里没有 "${id}"（见 src/editor/demos/demos.ts）`)
  return spec
}

const GROUPS: ToolButton[][] = [
  [
    { icon: 'bold', demo: 'bold', title: '加粗（Ctrl/⌘ + B）', act: () => runCommand(toggleBold), kind: 'bold' },
    { icon: 'italic', demo: 'italic', title: '斜体（Ctrl/⌘ + I）', act: () => runCommand(toggleItalic), kind: 'italic' },
    { icon: 'inlineCode', demo: 'inlineCode', title: '行内代码（Ctrl/⌘ + `）', act: () => runCommand(toggleInlineCode), kind: 'inlineCode' },
    /* 行内公式和上面三个同类（都是"一对定界符包住一段文字"），所以并在一组。
       它**没有** `kind` —— 插入类按钮不是开关，不点亮 `aria-pressed`。 */
    { icon: 'inlineMath', demo: 'inlineMath', title: '行内公式', act: () => runCommand(insertInlineMath) },
  ],
  [
    { icon: 'h1', demo: 'h1', title: '一级标题', act: () => runCommand(toggleHeading(1)), kind: 'h1' },
    { icon: 'h2', demo: 'h2', title: '二级标题', act: () => runCommand(toggleHeading(2)), kind: 'h2' },
    { icon: 'h3', demo: 'h3', title: '三级标题', act: () => runCommand(toggleHeading(3)), kind: 'h3' },
  ],
  [
    { icon: 'bullet', demo: 'bullet', title: '无序列表', act: () => runCommand(toggleBulletList), kind: 'bullet' },
    { icon: 'ordered', demo: 'ordered', title: '有序列表', act: () => runCommand(toggleOrderedList), kind: 'ordered' },
    { icon: 'quote', demo: 'quote', title: '引用', act: () => runCommand(toggleQuote), kind: 'quote' },
    /* 表格是**块级结构**（GFM 管道表），和列表 / 引用同类，所以并进这一组。 */
    { icon: 'table', demo: 'table', title: '插入表格', act: () => runCommand(insertTable) },
  ],
  [
    { icon: 'link', demo: 'link', title: '插入链接', act: openLink },
    /* 提及和链接一样是「插入一个指向」，所以并在一组、紧挨着放。
       它**没有** `kind` —— 插入类不是开关，不点亮 `aria-pressed`
       （和行内公式 / 表格 / 块级公式 / 嵌入同一条）。 */
    { icon: 'mention', demo: 'mention', title: '提及', act: openMention },
    { icon: 'codeBlock', demo: 'codeBlock', title: '插入代码块', act: () => runCommand(wrapCodeBlock), kind: 'codeBlock' },
    /* 块级公式 / 嵌入和代码块一样是**围栏**（```math / ```embed），并在一组。
       注意 `codeBlock` 有 `kind` 而这两个没有：前者会随光标进入代码块点亮，
       后两者是纯插入，编辑器侧也没有对应的"光标在里面"判定（`detectActive` 里没有它们）。 */
    { icon: 'blockMath', demo: 'blockMath', title: '块级公式', act: () => runCommand(insertBlockMath) },
    { icon: 'embed', demo: 'embed', title: '嵌入', act: () => runCommand(insertEmbed) },
  ],
  [
    /* 撤销 / 重做是**动作**不是**开关**，没有 `kind` —— 不给它们写 `aria-pressed`。 */
    { icon: 'undo', demo: 'undo', title: '撤销（Ctrl/⌘ + Z）', act: () => runCommand(undo) },
    { icon: 'redo', demo: 'redo', title: '重做（Ctrl/⌘ + Shift + Z）', act: () => runCommand(redo) },
  ],
]

/* ---------------------------------------------------------------- 卡片文案 */

/**
 * 卡片头上是「功能名 + 快捷键」，**两样都从 `title` 里切**，不另开字段。
 *
 * `title` 本来就是"给人看的名字"，卡片和 `aria-label` 共用同一份文案 ——
 * 改一处两边一起变，永远不可能出现"按钮写着 Ctrl+B、卡片写着别的"。
 * 约定很简单：`名字（快捷键）`，括号里就是快捷键；没有括号 = 这个功能没有快捷键
 * （比如「插入链接」，它开的是一个输入框）。
 *
 * 切法是取**第一对全角括号**，`行内代码（Ctrl/⌘ + `）` 这种括号里带反引号的
 * 也照样切得对 —— 全角括号在别处不会出现。
 */
function toolName(title: string) {
  return title.replace(/（[^）]*）/, '')
}
function toolKey(title: string) {
  return title.match(/（([^）]*)）/)?.[1] ?? ''
}

/**
 * ★ **悬停时把所有演示动画从头播一遍。**
 *
 * 为什么用 JS 而不是纯 CSS：
 *
 * 纯 CSS 的做法是"悬停时才把 `animation-name` 赋上去"，属性从无到有 → 从头播。
 * 但那样鼠标**移开**的瞬间属性就没了，画面会**立刻跳回初始态** ——
 * 而卡片还在淡出（220ms），于是能看到"内容先变回原样、卡片才慢慢消失"。
 * 用户原话："鼠标移开时那个动画会在整个画布消失的动画中变成初始态，会被看到"。
 *
 * 现在动画名**常驻声明**（见 `demos/demos.css` 的「播放机制」那一节），
 * 默认 `animation-play-state: paused`。移开时动画**停在最后一帧**，
 * 和卡片一起淡出，不会穿帮。
 *
 * `currentTime = 0` + `play()` 是重播的标准写法：
 * - 只 `play()` 的话，第二次悬停会从**上次暂停的位置**接着跑；
 * - 只设 `currentTime = 0` 不 `play()` 的话，它还是暂停的，不动。
 *
 * `Element.getAnimations()` 会**连同伪元素**（`::before` / `::after`）的动画一起返回，
 * 所以行内代码的灰底、链接的下划线、高亮的记号笔底色这几条也覆盖到了，
 * 不需要单独处理。
 *
 * ⚠️ 选择器是 `.demo-stage *` —— 演示的 DOM 由注册表用 `h()` 造出来，
 * 这一层壳（`DemoStage.vue`）是它和工具栏之间**唯一**约定的锚点。
 */
function positionDemo(wrap: HTMLElement) {
  const popup = wrap.querySelector<HTMLElement>('.demo-pop')
  if (!popup) return
  const anchor = wrap.getBoundingClientRect()
  const { width, height } = popup.getBoundingClientRect()
  const viewport = document.documentElement
  const left = Math.max(8, Math.min(anchor.left, viewport.clientWidth - width - 8))
  const top = anchor.bottom + height + 14 <= viewport.clientHeight
    ? anchor.bottom + 6
    : Math.max(8, anchor.top - height - 6)
  popup.style.setProperty('--nd-demo-left', `${left}px`)
  popup.style.setProperty('--nd-demo-top', `${top}px`)
}

function positionActiveDemos() {
  mentionRoot.value?.querySelectorAll<HTMLElement>('.tb-wrap:hover, .tb-wrap:focus-within').forEach(positionDemo)
}

onMounted(() => {
  window.addEventListener('resize', positionActiveDemos)
  window.addEventListener('scroll', positionActiveDemos, true)
})
onUnmounted(() => {
  window.removeEventListener('resize', positionActiveDemos)
  window.removeEventListener('scroll', positionActiveDemos, true)
})

function replayDemos(event: MouseEvent | FocusEvent) {
  const wrap = event.currentTarget as HTMLElement | null
  if (!wrap) return
  positionDemo(wrap)
  wrap.querySelectorAll('.demo-stage *').forEach((el) => {
    for (const anim of el.getAnimations()) {
      anim.currentTime = 0
      anim.play()
    }
  })
}
</script>

<template>
  <div ref="mentionRoot" class="cm-toolbar">
    <div class="row" role="toolbar" aria-label="正文格式">
      <template v-for="(group, gi) in GROUPS" :key="gi">
        <span v-if="gi" class="sep" aria-hidden="true" />

        <!--
          每个按钮包一层 `.tb-wrap`，是为了给悬停卡片一个定位基准。
          **不能**直接把卡片塞进 `<button>` 里：`<button>` 的内容模型只收
          短语内容（放 `<div>` 是非法 HTML），而且 `.tb:active` 的
          `transform: translateY(1px)` 会造出一个包含块，卡片会跟着按钮一起抖。

          卡片按按钮的实际位置定位，工具栏折行后也保持在视口内。
        -->
        <div
          v-for="b in group"
          :key="b.icon"
          class="tb-wrap"
          @mouseenter="replayDemos"
          @focusin="replayDemos"
        >
          <button
            type="button"
            class="tb"
            :class="{ on: isActive(b.kind) }"
            :aria-label="b.title"
            :aria-pressed="b.kind ? isActive(b.kind) : undefined"
            :disabled="!view"
            @mousedown.prevent
            @click="b.act()"
          >
            <!-- 图标纯装饰：名字在按钮的 aria-label 上，读屏不会读到它。 -->
            <svg
              class="ico"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <template v-for="(s, si) in ICONS[b.icon]" :key="si">
                <path v-if="s.t === 'p'" :d="s.d" />
                <circle v-else-if="s.t === 'c'" :cx="s.cx" :cy="s.cy" :r="s.r" fill="currentColor" stroke="none" />
                <rect
                  v-else-if="s.t === 'r'"
                  :x="s.x" :y="s.y" :width="s.w" :height="s.h" :rx="s.rx"
                  fill="currentColor" stroke="none"
                />
                <text v-else class="ico-t" :x="s.x" :y="s.y" :style="{ fontSize: `${s.size}px` }">{{ s.v }}</text>
              </template>
            </svg>
          </button>

          <!--
            悬停卡片。整块 `aria-hidden` —— 里面全是装饰（演示是给眼睛看的），
            功能名和快捷键按钮的 `aria-label` 上已经有了。

            ⚠️ 按钮上**没有** `title` 了。原生 tooltip 会在悬停约 1 秒后弹出来，
            正好压在这张卡片上，两个提示叠在一起。名字和快捷键卡片里都有。
          -->
          <div class="demo-pop" aria-hidden="true">
            <div class="demo-head">
              <span class="demo-name">{{ toolName(b.title) }}</span>
              <kbd v-if="toolKey(b.title)" class="demo-key">{{ toolKey(b.title) }}</kbd>
            </div>

            <!--
              演示画面由**注册表**画（`src/editor/demos/demos.ts`），这里只负责
              "这个按钮演哪一段"。

              ⚠️ **演示的 DOM 和 CSS 只有一份**，就在 `demos/` 里 —— 不再在这个模板里
              写 `v-if` 分支。Motion Lab 审片时渲染的是同一个 `<DemoStage>`，
              所以"卡片里看到的"和"逐帧审的"永远是同一帧。
            -->
            <DemoStage :spec="demoSpec(b.demo)" />
          </div>
        </div>
      </template>

      <!--
        「＋ 变体」—— 给**光标所在的块**补一行属性（`{.steps}` / `{.fields}` / `{title="…"}`）。

        为什么是一个独立按钮，而不是给列表/表格按钮各加一个下拉：
        变体是"当前块"的属性，不是"某个按钮"的属性 —— 光标在表格里时，
        列表按钮的下拉没有意义。一个按钮 + 按块过滤的菜单，用户只需要记住
        "变体在这里"。

        菜单项只列**两侧都已实现**的属性（见 `variantItems` 的注释）。
      -->
      <span class="sep" aria-hidden="true" />
      <div ref="variantRoot" class="tb-wrap variant-wrap">
        <button
          type="button"
          class="tb"
          :class="{ on: variantOpen }"
          aria-label="块变体"
          title="块变体：给当前块加步骤 / 卡片 / 参数表 / 代码标题"
          aria-haspopup="menu"
          :aria-expanded="variantOpen"
          :disabled="!view"
          @mousedown.prevent
          @click="toggleVariants"
        >
          <svg class="ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <text class="ico-t" x="8" y="11.5" :style="{ fontSize: '7.6px' }">{}</text>
          </svg>
        </button>

        <div v-if="variantOpen" class="variant-pop" role="menu" aria-label="块变体">
          <template v-if="variantTabGroup">
            <button
              type="button"
              class="variant-item"
              role="menuitem"
              @mousedown.prevent
              @click="addTabFromToolbar"
            >
              <span>增加页签</span>
            </button>
            <button
              type="button"
              class="variant-item"
              role="menuitem"
              @mousedown.prevent
              @click="removeTabFromToolbar"
            >
              <span>删除「{{ variantTabGroup.panels[0]?.label }}」</span>
            </button>
          </template>
          <template v-else>
            <button
              v-for="item in variantItems"
              :key="item.attr"
              type="button"
              class="variant-item"
              role="menuitem"
              @mousedown.prevent
              @click="applyVariant(item)"
            >
              <span>{{ variantApplied.has(item.name) ? '✓ ' : '' }}{{ item.label }}</span>
              <code>{{ item.attr }}</code>
            </button>
          </template>
        </div>
      </div>
    </div>

    <!--
      链接的 URL 输入行。内联而不是 `window.prompt`：原生弹窗会阻塞页面
      （自动化验证里一点就卡死），而且这个页面自己就写了「原生弹窗不可靠」。

      ⚠️ 用**常驻的 grid 容器**做展开动画，不是 `v-if` + `<Transition>`：
      高度从 `0fr` 过渡到 `1fr` 是纯 CSS 的，不需要 JS 去量 `scrollHeight`。
      收起后靠 `.link-clip` 的 `visibility: hidden` 摘掉焦点 —— 不这么做的话
      Tab 会跳进一个看不见的输入框（0 高度 + `overflow: hidden` 只是**看不见**，
      元素照样在 tab 序列里）。
    -->
    <div class="link-slot" :class="{ open: linkOpen }">
      <div class="link-clip">
        <div class="row link-row">
          <input
            ref="linkInput"
            v-model="linkHref"
            class="link-input"
            type="url"
            inputmode="url"
            placeholder="https://example.com"
            aria-label="链接地址"
            @keydown.enter.prevent="confirmLink"
            @keydown.esc.prevent="cancelLink"
          >
          <button type="button" class="tb txt primary" @mousedown.prevent @click="confirmLink">确定</button>
          <button type="button" class="tb txt" @mousedown.prevent @click="cancelLink">取消</button>
        </div>
      </div>
    </div>

    <!--
      提及选择器。**浮层**（不是链接那种内联输入行）：候选可能有几十上百个，
      内联展开会把正文整个推下去。所以它绝对定位在工具栏下方、盖在编辑器上。

      ⚠️ `v-if` 而不是"常驻 + visibility"：链接那条内联行需要常驻是为了
      展开动画（`0fr → 1fr`）；浮层不需要动画，用 `v-if` 反而顺手把
      "收起时 Tab 会跳进看不见的输入框"这个坑一起消掉了。

      ⚠️ 输入框**没有** `@mousedown.prevent`（链接那行也没有）：这里必须能点进输入框。
      面板本身靠 `pointerdown` 落点判断是否点在外面（见 `onDocPointerDown`）。
    -->
    <div v-if="mentionOpen" class="mention-pop" role="dialog" aria-label="插入提及">
      <input
        ref="mentionInput"
        v-model="mentionQuery"
        class="mention-input"
        type="text"
        autocomplete="off"
        placeholder="搜索资源…"
        aria-label="搜索提及候选"
        role="combobox"
        aria-expanded="true"
        aria-controls="mention-list"
        :aria-activedescendant="mentionFiltered.length ? `mention-opt-${mentionActive}` : undefined"
        @keydown="onMentionKeydown"
      >

      <p v-if="mentionLoading" class="mention-note">加载中…</p>
      <p v-else-if="mentionError" class="mention-note mention-note--err">候选加载失败：{{ mentionError }}</p>
      <p v-else-if="!mentionFiltered.length" class="mention-note">没有匹配的资源</p>
      <ul v-else id="mention-list" class="mention-list" role="listbox">
        <li
          v-for="(c, i) in mentionFiltered"
          :id="`mention-opt-${i}`"
          :key="c.slug"
          class="mention-item"
          :class="{ on: i === mentionActive }"
          role="option"
          :aria-selected="i === mentionActive"
          @mouseenter="mentionActive = i"
          @mousedown.prevent="pickMention(c)"
        >
          <span class="mention-item__slug">@{{ c.slug }}</span>
          <span class="mention-item__title">{{ c.title }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/**
 * 工具栏**不画外框**：它是那张纸的一部分，纸自己已经有 1px 边框和 12px 圆角
 * （见 `new.vue` 的 `.paper`）。再套一层框会变成"纸里还有一张纸"。
 *
 * 底边线 + 浅底色是唯一的分隔手段 —— 和站里 `.seg`（分段控件）的做法一致。
 *
 * ## 尺寸体系（改任何一个数字之前先读这段）
 *
 * | 量 | 值 | 为什么 |
 * | --- | --- | --- |
 * | 按钮 | 28 × 28 | 够大的点击区；一行排不下时 `.row` 的 `flex-wrap` 会折行 |
 * | 图标 | 16 × 16 | 28 里居中 → 左右各让出 6px，悬停底色不贴图标 |
 * | 行左右内边距 | 22 | 22 + 6 = **28**，图标正好落在纸上那条竖线上（见下） |
 * | 组内间距 | 2 | 同一组是"一个整体"，按钮之间几乎贴着 |
 * | 分隔线 | 1 × 16，左右各 6 | 组间距 = 2+6+1+6+2 = 17，明显大于组内 2 |
 *
 * ## 左右内边距对齐的是**编辑器的 28px**，不是 12.4px
 *
 * 原以为要对齐 nexusdown 的 `--nd-code-pad: 0.9em`（≈12.4px），**实测不是**：
 * 那个变量只作用在**代码块行**（`.cm-line.nd-code-block` 的 `padding-left`），
 * 正文的左右内边距是 `new.vue` 里的 `.cm-content { padding: 18px 28px 28px }`。
 * 在 900px 宽的纸上量出来（离线复刻 + 无头 Edge `getBoundingClientRect`）：
 *
 * ```
 * .paper 内边缘          → 标题文字 28px、字数 28px、.cm-content 内容盒 28px
 * 正文行(.cm-line)        → CM6 baseTheme 再给 6px，所以正文**字形**从 34px 起
 * 旧工具栏按钮            → 21px（比纸上的竖线靠左 7px，这就是"没对齐"的来源）
 * ```
 *
 * 标题、字数、正文内容盒**三个都在 28**，所以竖线取 28：图标左边缘 = 28px。
 * （正文字形多出的那 6px 是 CM6 自己的行内边距，跟着它走反而会让工具栏
 * 比标题还往右缩，视觉上更像"没对齐"。）
 */
.cm-toolbar {
  /* 提及选择器是绝对定位的浮层，要有定位基准（见 `.mention-pop`）。 */
  position: relative;
  border-top: 1px solid var(--nd-line);
  background: var(--nd-surface-2);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px 22px;
}

.tb {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  font: inherit;
  font-size: 12.5px;
  color: var(--nd-text-2);
  background: transparent;
  border: 0;
  border-radius: var(--nd-radius-sm);
  cursor: pointer;
  /**
   * ⚠️ 只过渡**颜色和位移**，不要写 `transition: all` ——
   * `all` 会把 `outline` 也算进去，键盘 Tab 过来时焦点环会淡入，看着像卡了一下。
   */
  transition:
    background-color var(--nd-dur-fast) var(--nd-ease),
    color var(--nd-dur-fast) var(--nd-ease),
    transform var(--nd-dur-fast) var(--nd-ease);
}

.ico {
  width: 16px;
  height: 16px;
  display: block;
}

/* 图标里的数字（H1/H2/H3 的序号、有序列表的 1/2/3）。
   `stroke: none` 是必须的 —— `<svg>` 根上的 `stroke="currentColor"` 会继承下来，
   数字会被描一圈边、糊成一团。字号由每个图元自己带（`Shape.x.size`）。 */
.ico-t {
  stroke: none;
  fill: currentColor;
  font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-weight: 600;
  text-anchor: middle;
}

/**
 * 悬停：**不能只把底色刷白**。工具栏底色是 `--surface-2`（#fbfbfc），
 * 白色叠上去几乎看不见（对比度 1.02）—— 上一版就是这么写的，等于没有悬停。
 * 用一层中性黑做 5.5% 的压暗，在浅底上看得见，又不引第二个色相。
 */
.tb:hover:not(:disabled) {
  background-color: rgb(22 24 28 / 5.5%);
  color: var(--nd-text);
}

/**
 * 按下：**下沉 1px + 压暗到 9%**。
 * 位移给"按到了实体"的手感，压暗负责在位移只有 1px 时也能看出来。
 *
 * ⚠️ **必须是整数像素。** 原来写 `0.5px`：非整数位移会让文字落在半个像素上，
 * 浏览器只能做亚像素抗锯齿 —— 按下时整排按钮的字**发虚**。
 * 时长用 `--nd-motion-dur-1`（60ms，即时反馈那一档），不再用 `--nd-dur-fast`。
 */
.tb:active:not(:disabled) {
  background-color: rgb(22 24 28 / 9%);
  color: var(--nd-text);
  transform: translateY(1px);
}

/**
 * 键盘焦点环。`:focus-visible` 而不是 `:focus` —— 鼠标点完不该留一圈蓝边。
 * 用 `--brand` 而不是 `--brand-soft-border`：后者是给输入框的浅描边用的，
 * 2px 的焦点环用它太淡，键盘用户会找不到自己在哪。
 */
.tb:focus-visible {
  outline: 2px solid var(--nd-brand);
  outline-offset: 1px;
  color: var(--nd-text);
}

.tb:disabled { color: var(--nd-text-4); cursor: default; }

/**
 * 点亮：光标当前就在这种块里（`detectActive` 算出来的）。
 * 只换底色和字色，**不加边框** —— 加边框会让按钮在点亮瞬间改变外廓，
 * 一排按钮跟着抖。
 */
.tb.on,
.tb.on:hover:not(:disabled) {
  background-color: var(--nd-brand-soft);
  color: var(--nd-brand);
}
.tb.on:active:not(:disabled) { background-color: var(--nd-brand-soft-border); }

/* 文字按钮（链接行里的「确定 / 取消」）：同一个高度，但宽度按内容走。 */
.tb.txt { width: auto; padding: 0 11px; }
.tb.primary { background-color: var(--nd-brand-soft); color: var(--nd-brand); font-weight: 500; }
.tb.primary:hover:not(:disabled) { background-color: var(--nd-brand-soft-border); }

/* 分隔线：细、短、不抢戏 —— 只是给一排按钮分组。16px 比按钮矮一截，
   一眼能看出是"分隔"而不是"两个按钮中间夹了个东西"。 */
.sep {
  flex: none;
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--nd-border);
}

/* ---------------------------------------------------------------- 链接输入行 */

/**
 * 展开动画：`grid-template-rows` 从 `0fr` 到 `1fr`。
 * 用 `height: auto` 是过渡不起来的（auto 不是可插值长度），
 * 而 `max-height` 那套又要拍一个够大的数字，展开速度前 90% 都是浪费的
 * （nexusdown 的代码块折叠踩过同一个坑，那里有详细说明）。
 * 不支持 `0fr ↔ 1fr` 插值的浏览器**降级为瞬间展开**，不会坏。
 */
.link-slot {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--nd-dur) var(--nd-ease),
    opacity var(--nd-dur-fast) var(--nd-ease);
}
.link-slot.open { grid-template-rows: 1fr; opacity: 1; }

/* `min-height: 0` 是 grid 子项能收到 0 高度的前提，少了它内容会把行撑开。 */
.link-clip {
  overflow: hidden;
  min-height: 0;
  visibility: visible;
  transition: visibility 0s;
}
/* 收起时**延迟到高度动画播完**再隐藏，否则内容会先"啪"地消失、只剩空行在收。 */
.link-slot:not(.open) .link-clip {
  visibility: hidden;
  transition: visibility 0s linear var(--nd-dur);
}

.link-row { border-top: 1px solid var(--nd-line); gap: 6px; }

.link-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  font: inherit;
  font-size: 13px;
  color: var(--nd-text);
  background: #fff;
  border: 1px solid var(--nd-border);
  border-radius: var(--nd-radius-sm);
  padding: 0 9px;
  outline: none;
  transition:
    border-color var(--nd-dur-fast) var(--nd-ease),
    box-shadow var(--nd-dur-fast) var(--nd-ease);
}
.link-input:focus { border-color: var(--nd-brand-soft-border); box-shadow: 0 0 0 2px var(--nd-brand-soft); }
.link-input::placeholder { color: var(--nd-text-4); }

/* ---------------------------------------------------------------- 提及选择器 */

/**
 * 浮层：白底 + 1px 边框 + `--shadow-2`（和悬停卡片同一档"浮起来的下拉"）。
 *
 * ⚠️ `z-index: 50` —— 要盖在悬停卡片（40）和链接输入行上面。
 * ⚠️ 宽度写死 260：输入框和列表等宽，鼠标扫过时不会左右抽动。
 * ⚠️ `left: 22px` 对齐工具栏左边距（同 `.row` 的 `padding`），
 *    这样面板左边缘和第一个按钮的**图标**对齐（见 `.cm-toolbar` 那节的尺寸表）。
 */
.mention-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 22px;
  z-index: 50;

  box-sizing: border-box;
  width: 260px;
  max-height: 264px;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  background: #fff;
  border: 1px solid var(--nd-border);
  border-radius: var(--nd-radius-md);
  box-shadow: var(--nd-shadow-2);

  /*
   * 入场：100ms 淡入 + 4px 上浮（`--nd-motion-ease`，小状态那一档）。
   *
   * 它是 `v-if` 挂上来的（没有 `<Transition>`），所以**挂载时自然播一次** ——
   * 不需要任何 JS。⚠️ 只动 `opacity` / `transform`：浮层的位置由 `top` / `left`
   * 定，动它们会牵扯布局。
   * 减少动效时 `--nd-motion-dur-2` 被 `motion.css` 压成 0ms，直接是终态。
   *
   * ⚠️ 拆成三条长写、动画名**写字面量**（同 `demos.css` 那条纪律）：
   * `animation` 简写里塞 `var()`、或者名字走变量，在 scoped 样式里都可能
   * 静默失效 —— 而"失效"在这里等于"浮层不淡入"，没人会报错。
   */
  animation-name: nd-mention-pop;
  animation-duration: var(--nd-motion-dur-2);
  animation-timing-function: var(--nd-motion-ease);
}

@keyframes nd-mention-pop {
  from {
    opacity: 0;
    transform: translateY(var(--nd-motion-dist-2));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.mention-input {
  flex: none;
  height: 30px;
  font: inherit;
  font-size: 13px;
  color: var(--nd-text);
  background: #fff;
  border: 0;
  /* 只留底边一条分隔线 —— 输入框和列表是一整块，再画一圈框就"框里还有框"了 */
  border-bottom: 1px solid var(--nd-line);
  border-radius: var(--nd-radius-md) var(--nd-radius-md) 0 0;
  padding: 0 10px;
  outline: none;
}
.mention-input:focus { box-shadow: inset 0 0 0 2px var(--nd-brand-soft); }
.mention-input::placeholder { color: var(--nd-text-4); }

/* 提示行（加载中 / 出错 / 空结果）。 */
.mention-note {
  margin: 0;
  padding: 12px 10px;
  font-size: 12.5px;
  color: var(--nd-text-3);
}
.mention-note--err { color: var(--nd-danger, #cf222e); }

/* 列表：候选多时内部滚动，面板高度不失控。`min-height: 0` 是 flex 子项能滚动的前提。 */
.mention-list {
  min-height: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  overflow-y: auto;
}

.mention-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 7px;
  border-radius: var(--nd-radius-sm);
  cursor: pointer;
}
/* 高亮：键盘和鼠标**共用这一个类**（鼠标悬停会同步 `mentionActive`），
   所以不会出现"键盘选中的是 A、鼠标指着的是 B"两套高亮。 */
.mention-item.on { background: var(--nd-brand-soft); }

.mention-item__slug {
  flex: none;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--nd-brand);
}
.mention-item__title {
  min-width: 0;
  overflow: hidden;
  font-size: 12.5px;
  color: var(--nd-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------------------------------------- 卡片外壳 */

/**
 * 包一层的原因见 template 上的注释：`<button>` 装不下 `<div>`，而且按钮
 * `:active` 的位移会拖着卡片一起抖。宽度仍是 28，所以整排按钮的间距和对齐
 * **和加卡片之前一模一样**。
 */
.tb-wrap {
  position: relative;
  flex: none;
  display: flex;
}

/**
 * 卡片：白底 + 1px 边框 + `--shadow-2`（全站"浮起来的下拉"那一档）。
 *
 * ⚠️ **`pointer-events: none` 是必须的。** 卡片就贴在按钮下面，能接鼠标的话会变成：
 * hover 按钮 → 卡片弹出 → 鼠标正好落在卡片上 → 按钮失去 hover → 卡片收起 →
 * 鼠标又回到按钮上 → …… 一秒钟抖十几次。卡片是"看"的，不是"点"的。
 *
 * ⚠️ 宽度写死 168。卡片必须等宽，否则鼠标横扫过去整排卡片会宽窄不一地跳。
 * 168 = 左右各 12 内边距 + 144 的演示区（够放最长的快捷键 `Ctrl/⌘ + Shift + Z`）。
 *
 * ⚠️ `z-index: 40` —— 卡片要盖在编辑器和链接输入行上面。
 */
.demo-pop {
  /* 隐藏的 absolute 卡片也会撑宽页面；fixed 卡片不参与页面滚动范围。 */
  position: fixed;
  top: var(--nd-demo-top, 0px);
  left: var(--nd-demo-left, 0px);
  z-index: 40;

  box-sizing: border-box;
  width: 168px;
  max-width: calc(100vw - 16px);
  padding: 12px;

  background: #fff;
  border: 1px solid var(--nd-border);
  border-radius: var(--nd-radius-md);
  box-shadow: var(--nd-shadow-2);

  pointer-events: none;

  opacity: 0;
  visibility: hidden;
  transform: translateY(4px);
  transition:
    opacity var(--nd-dur) var(--nd-ease-out),
    transform var(--nd-dur) var(--nd-ease-out),
    visibility 0s linear var(--nd-dur);
}

/**
 * 出现**等 400ms**，消失不等。
 *
 * 鼠标**划过**一排按钮时每次悬停都不到 400ms，一张卡片都不会弹；只有**停下来**看
 * 某一个按钮才弹。反过来（消失）如果也延迟，卡片会赖着不走。
 * 用 `transition-delay` 而不是 JS 定时器：没有状态要存、没有清理要做，
 * 鼠标飞快划过也不会留下一串排队中的定时器。
 *
 * 键盘走 `:focus-visible`（Tab 过来）—— 鼠标点完按钮不留焦点环，也不弹卡片。
 * 键盘用户和鼠标用户拿到的是同一个东西。
 */
.tb-wrap:hover > .demo-pop,
.tb:focus-visible + .demo-pop {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
  transition-delay: 400ms, 400ms, 0s;
}

/* 卡片头：左边功能名、右边快捷键 */
.demo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.demo-name {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  color: var(--nd-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 快捷键做成浅底小胶囊。`flex: none` —— 挤的时候先挤功能名，快捷键不能被切掉半个。 */
.demo-key {
  flex: none;
  padding: 3px 5px;
  font: 9.5px/1 system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  letter-spacing: -0.01em;
  color: var(--nd-text-3);
  background: var(--nd-surface);
  border-radius: 4px;
  white-space: nowrap;
}

/* ---------------------------------------------------------------- 块变体菜单 */

/**
 * 「＋ 变体」的下拉。定位和 `.demo-pop` 同一档（按钮下方、右对齐），
 * 但**可点** —— 和演示卡片相反（那个 `pointer-events: none`）。
 */
.variant-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  min-width: 176px;
  padding: 4px;
  background: var(--nd-surface);
  border: 1px solid var(--nd-border);
  border-radius: var(--nd-radius);
  box-shadow: var(--shadow-2, 0 6px 24px rgb(0 0 0 / 12%));
}

.variant-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  font-size: 12.5px;
  color: var(--nd-text);
  text-align: left;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.variant-item:hover,
.variant-item:focus-visible {
  background: var(--nd-surface-2);
  outline: none;
}

.variant-item code {
  font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--nd-text-3);
}

/* ---------------------------------------------------------------- 块变体菜单 */

/**
 * 「＋ 变体」的下拉。定位和 `.demo-pop` 同一档（按钮下方、右对齐），
 * 但**可点** —— 和演示卡片相反（那个 `pointer-events: none`）。
 */
.variant-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  min-width: 176px;
  padding: 4px;
  background: var(--nd-surface);
  border: 1px solid var(--nd-border);
  border-radius: var(--nd-radius);
  box-shadow: var(--shadow-2, 0 6px 24px rgb(0 0 0 / 12%));
}

.variant-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  font-size: 12.5px;
  color: var(--nd-text);
  text-align: left;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.variant-item:hover,
.variant-item:focus-visible {
  background: var(--nd-surface-2);
  outline: none;
}

.variant-item code {
  font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--nd-text-3);
}
</style>
