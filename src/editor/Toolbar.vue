<script setup lang="ts">
/**
 * 发帖页的 Markdown 工具栏（CodeMirror 6）。
 *
 * ## 为什么不是 `nexusdown/vue` 的 `EditorToolbar`
 *
 * 那个工具栏是 **Tiptap** 的：按钮跑的是 `editor.chain().focus().toggleBold()`，
 * 改的是 Tiptap 的**节点树**。CM6 这边根本没有节点树可改 —— 真相是文本，
 * 命令签名是 `(view: EditorView) => boolean`。**两边的抽象对不上，不能复用。**
 *
 * 命令本体在 `nexusdown/cm`（以前是本地的 `~/utils/cm-markdown`，
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
import { nextTick, onUnmounted, ref, watch } from 'vue'
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
import type { Command, EditorView } from 'nexusdown/cm'
import {
  redo,
  syntaxTree,
  undo,
  insertBlockMath,
  insertEmbed,
  insertInlineMath,
  insertLink,
  insertTable,
  toggleBold,
  toggleBulletList,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
  wrapCodeBlock,
} from 'nexusdown/cm'
import { codeIconSvg } from 'nexusdown/cm'

const props = defineProps<{
  /** 编辑器实例。还没挂上时是 `null` —— 那时所有按钮都禁用。 */
  view: EditorView | null
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
  | 'link' | 'codeBlock' | 'blockMath' | 'embed'
  | 'undo' | 'redo'

/** 列表三行的 y —— 无序和有序**共用同一组基准线**，两个图标才会像一对。 */
/**
 * 代码块演示里的文件图标 —— **从 nexusdown 导入，不手抄**。
 *
 * 这里原来内联了一整份 yaml 图标的 SVG（1103 个字符），而
 * `nexusdown/src/cm/widgets/code-icons.ts` 的 `yaml` 条目就是它。
 *
 * ⚠️ 两份**当时是一致的**（颜色都是 `#ffe885`）—— 但那是运气，不是保证：
 * nexusdown 换图标这边不会知道、不会报错、也没有测试。凡是"必须长得一样"
 * 的东西都不该有第二份手抄件。
 *
 * 图标表是构建期拉取/手绘的内联 SVG，`width/height="1em"` 跟着 font-size 走，
 * 尺寸由 `.demo-code-block__icon svg` 那条 CSS 定（11px），不用额外处理。
 */
const codeBlockIcon = codeIconSvg('yaml') ?? ''

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
/** 上一次算出来的结果。相同就**不写 ref**，省掉一次整表重渲染。 */
let lastKey = ''

function refreshActive() {
  const view = props.view
  if (!view) return
  let next: Kind[]
  try {
    next = detectActive(view)
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

/* ---------------------------------------------------------------- 按钮表 */

/**
 * 悬停卡片里播哪一段演示 —— 也就是那段演示 CSS 的根类名后缀（`demo-{名字}`）。
 *
 * 每个按钮的 `demo` 现在都和它的 `icon` 同名，但字段是分开的：它们回答的是
 * **两个不同的问题** —— `icon` 是"这个按钮长什么样"，`demo` 是"它教什么"。
 * 模板只认 `demo`，所以以后换图标不会连带动画，两个按钮也可以共用一段演示。
 */
type DemoName =
  | 'bold' | 'italic' | 'inlineCode' | 'inlineMath'
  | 'h1' | 'h2' | 'h3'
  | 'bullet' | 'ordered' | 'quote' | 'table'
  | 'link' | 'codeBlock' | 'blockMath' | 'embed'
  | 'undo' | 'redo'

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

/** 列表演示的两行文字。无序 / 有序共用，序号由模板按行号拼。 */
const DEMO_LINES = ['文字一', '文字二']

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
 * 现在动画名**常驻声明**（见 CSS 那节），默认 `animation-play-state: paused`。
 * 移开时动画**停在最后一帧**，和卡片一起淡出，不会穿帮。
 *
 * `currentTime = 0` + `play()` 是重播的标准写法：
 * - 只 `play()` 的话，第二次悬停会从**上次暂停的位置**接着跑；
 * - 只设 `currentTime = 0` 不 `play()` 的话，它还是暂停的，不动。
 *
 * `Element.getAnimations()` 会**连同伪元素**（`::before` / `::after`）的动画一起返回，
 * 所以行内代码的灰底、链接的下划线这两条也覆盖到了，不需要单独处理。
 */
function replayDemos(event: MouseEvent) {
  const wrap = event.currentTarget as HTMLElement | null
  if (!wrap) return
  wrap.querySelectorAll('.demo-stage *').forEach((el) => {
    for (const anim of el.getAnimations()) {
      anim.currentTime = 0
      anim.play()
    }
  })
}
</script>

<template>
  <div class="cm-toolbar">
    <div class="row" role="toolbar" aria-label="正文格式">
      <template v-for="(group, gi) in GROUPS" :key="gi">
        <span v-if="gi" class="sep" aria-hidden="true" />

        <!--
          每个按钮包一层 `.tb-wrap`，是为了给悬停卡片一个定位基准。
          **不能**直接把卡片塞进 `<button>` 里：`<button>` 的内容模型只收
          短语内容（放 `<div>` 是非法 HTML），而且 `.tb:active` 的
          `transform: translateY(0.5px)` 会造出一个包含块，卡片会跟着按钮一起抖。

          靠右的两组（链接/代码块、撤销/重做）的卡片改贴右边 —— 原因和代价见样式里
          `.tb-wrap.pop-right .demo-pop` 那条注释。
        -->
        <div
          v-for="b in group"
          :key="b.icon"
          class="tb-wrap"
          :class="{ 'pop-right': gi >= GROUPS.length - 2 }"
          @mouseenter="replayDemos"
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

            <div class="demo-stage">
              <!--
                ★ **镜头层。**
                
                运镜（推近/拉远）挂在**这一层**，不是挂在 `.demo-stage` 上 ——
                挂画布上的话连边框和背景一起缩放，看起来像"卡片自己在呼吸"
                （用户原话："这个框也放大缩小了啊太搞笑了"）。
                
                画布是**固定的取景框**，动的只有框里的内容。
                包一层也顺便让各个演示自己的 `transform`（斜体 `skewX`、
                列表 `translateX`）和镜头互不干扰 —— 它们是不同的元素。
              -->
              <div class="demo-cam">
              <!-- 加粗：源码 `**文字**` → 渲染成粗体 -->
              <div v-if="b.demo === 'bold'" class="demo-bold">
                <span class="demo-bold__box">
                  <span class="demo-bold__text">文字</span>
                  <span class="demo-bold__syntax demo-bold__syntax--l">**</span>
                  <span class="demo-bold__syntax demo-bold__syntax--r">**</span>
                </span>
              </div>

              <!-- 斜体：源码 `*文字*` → 渲染成斜体 -->
              <div v-else-if="b.demo === 'italic'" class="demo-italic">
                <span class="demo-italic__box">
                  <span class="demo-italic__text">文字</span>
                  <span class="demo-italic__syntax demo-italic__syntax--l">*</span>
                  <span class="demo-italic__syntax demo-italic__syntax--r">*</span>
                </span>
              </div>

              <!-- 行内代码：源码 `` `code` `` → 渲染成等宽灰底 -->
              <div v-else-if="b.demo === 'inlineCode'" class="demo-inline-code">
                <span class="demo-inline-code__chip">
                  <span class="demo-inline-code__box">
                    <span class="demo-inline-code__text">code</span>
                    <span class="demo-inline-code__syntax demo-inline-code__syntax--l">`</span>
                    <span class="demo-inline-code__syntax demo-inline-code__syntax--r">`</span>
                  </span>
                </span>
              </div>

              <!-- 行内公式：源码 `$x^2$` → 渲染成上标 `x²` -->
              <div v-else-if="b.demo === 'inlineMath'" class="demo-inline-math">
                <span class="demo-inline-math__box">
                  <!--
                    `^` 和 `2` 拆成两个元素：源码态是 `x^2`（`^` 露出来、`2` 在基线上），
                    渲染态是 `x²`（`^` 消失、`2` 缩小并抬起来）。

                    `2` 的 `margin-left` 从 4px 收到 0：`^` 是绝对定位的（不推文字），
                    所以得由 `2` 自己让出 / 收回这 4px，`^` 才有地方站。
                  -->
                  <span class="demo-inline-math__base">x<span class="demo-inline-math__caret">^</span></span>
                  <span class="demo-inline-math__sup">2</span>
                  <span class="demo-inline-math__syntax demo-inline-math__syntax--l">$</span>
                  <span class="demo-inline-math__syntax demo-inline-math__syntax--r">$</span>
                </span>
              </div>

              <!-- 三级标题：同一个模板 + 同一个节奏，只有目标字号不同 -->
              <div
                v-else-if="b.demo === 'h1' || b.demo === 'h2' || b.demo === 'h3'"
                :class="`demo-${b.demo}`"
              >
                <span :class="`demo-${b.demo}__box`">
                  <span :class="`demo-${b.demo}__word`">你好</span>
                  <span :class="`demo-${b.demo}__syntax`">{{ '#'.repeat(Number(b.demo[1])) }}</span>
                </span>
              </div>

              <!-- 列表：同一个模板，标记文字按种类换（• / 1. 2.） -->
              <div
                v-else-if="b.demo === 'bullet' || b.demo === 'ordered'"
                :class="`demo-${b.demo}`"
              >
                <span
                  v-for="(line, li) in DEMO_LINES"
                  :key="line"
                  :class="`demo-${b.demo}__line`"
                >
                  <span :class="`demo-${b.demo}__box`">
                    <span :class="`demo-${b.demo}__text`">{{ line }}</span>
                    <span :class="`demo-${b.demo}__syntax`">{{ b.demo === 'bullet' ? '-' : `${li + 1}.` }}</span>
                    <span :class="`demo-${b.demo}__marker`">{{ b.demo === 'bullet' ? '•' : `${li + 1}.` }}</span>
                  </span>
                </span>
              </div>

              <!-- 引用：竖条从竖直中线长出来 -->
              <div v-else-if="b.demo === 'quote'" class="demo-quote">
                <span class="demo-quote__box">
                  <span class="demo-quote__text">引用一段话</span>
                  <span class="demo-quote__bar" />
                  <span class="demo-quote__syntax">&gt;</span>
                </span>
              </div>

              <!-- 表格：两段文字被 `|` 串起来（源码），再落成一行表格（渲染） -->
              <div v-else-if="b.demo === 'table'" class="demo-table">
                <span class="demo-table__box">
                  <span class="demo-table__cell">列一</span>
                  <span class="demo-table__cell">列二</span>
                  <!--
                    三个 `|`：左右各一个贴住整块（`--l` / `--r`），
                    中间那个用 `left: 50%` 落在两个单元格的**分界**上 ——
                    单元格各带 7px 内边距，中间天然空出 14px 给它站。
                  -->
                  <span class="demo-table__syntax demo-table__syntax--l">|</span>
                  <span class="demo-table__syntax demo-table__syntax--m">|</span>
                  <span class="demo-table__syntax demo-table__syntax--r">|</span>
                </span>
              </div>

              <!-- 链接：变蓝 + 下划线从左画到右 -->
              <div v-else-if="b.demo === 'link'" class="demo-link">
                <span class="demo-link__box">
                  <span class="demo-link__text">链接文字</span>
                  <span class="demo-link__syntax demo-link__syntax--l">[</span>
                  <span class="demo-link__syntax demo-link__syntax--r">](url)</span>
                </span>
              </div>

              <!-- 代码块：同一行字，上方长出一个小窗口的标题栏 -->
              <div v-else-if="b.demo === 'codeBlock'" class="demo-code-block">
                <!--
                  ★ **上下各一条围栏**，和真实的 Markdown 代码块结构一致：
                  源码就是 ` ``` ` / ` ``` ` 夹着内容，渲染后围栏被"消化"掉、只剩窗口。

                  ⚠️ 第一版只在上方放了一条 ` ``` `，而且位置贴着窗口 ——
                  用户："**上下两行都应该是 ```**，现在 ``` 的位置根本不是它应该在的位置。"
                  现在上下各一条，窗口夹在中间，三条一起垂直居中。
                -->
                <div class="demo-code-block__win">
                  <!--
                    ★ **围栏在窗口**里面**，和标题栏 / 底边占同一个位置。**

                    第一版把围栏放在窗口外面当兄弟节点，于是围栏和代码之间
                    必须给标题栏留一段空白 —— 源码态看起来就是"**空出去一行**"
                    （用户截图指出来的）。放进来之后：上围栏 ≡ 标题栏的位置、
                    下围栏 ≡ 窗口底边的位置，两者**交替换位** —— 没有空白、零位移。
                  -->
                  <span class="demo-code-block__syntax demo-code-block__syntax--open">```yaml ci.yml</span>
                  <div class="demo-code-block__bar">
                    <span class="demo-code-block__dots"><i /><i /><i /></span>
                    <!-- 文件图标 + 文件名 —— 和 nexusdown 代码窗口的标题栏同构 -->
                    <span class="demo-code-block__icon" aria-hidden="true" v-html="codeBlockIcon" />
                    <span class="demo-code-block__file">ci.yml</span>
                    <span class="demo-code-block__lang">yaml</span>
                  </div>
                  <div class="demo-code-block__code">name: build</div>
                  <span class="demo-code-block__syntax demo-code-block__syntax--close">```</span>
                </div>
              </div>

              <!-- 块级公式：```math 围栏夹住一行公式，渲染后围栏被"消化"掉 -->
              <div v-else-if="b.demo === 'blockMath'" class="demo-block-math">
                <span class="demo-block-math__syntax demo-block-math__syntax--open">```math</span>
                <span class="demo-block-math__formula">E = mc²</span>
                <span class="demo-block-math__syntax demo-block-math__syntax--close">```</span>
              </div>

              <!-- 嵌入：```embed 围栏 + provider → 落成一张占位卡 -->
              <div v-else-if="b.demo === 'embed'" class="demo-embed">
                <span class="demo-embed__syntax demo-embed__syntax--open">```embed bilibili</span>
                <span class="demo-embed__card">
                  <span class="demo-embed__icon" aria-hidden="true">▶</span>
                  <span class="demo-embed__label">哔哩哔哩 · 视频</span>
                </span>
                <span class="demo-embed__syntax demo-embed__syntax--close">```</span>
              </div>

              <!-- 撤销 / 重做：同一个模板，方向相反 -->
              <!--
                撤销 / 重做：这两个**没有语法可教**，所以演的是**按键本身** ——
                下方浮出一个工具条上的图标，被按下去、弹起来，文字随之改变。
                用户原话："有语法的顺手就教语法了，没有的才做按键。"
              -->
              <div v-else-if="b.demo === 'undo' || b.demo === 'redo'" :class="`demo-${b.demo}`">
                <div :class="`demo-${b.demo}__stage`">
                  <span :class="`demo-${b.demo}__text`">你好</span><span :class="`demo-${b.demo}__word`">世界</span>
                </div>
                <div :class="`demo-${b.demo}__key`">
                  <svg :class="`demo-${b.demo}__ico`" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <!-- 撤销：逆时针弧 + 左箭头；重做是它的镜像 -->
                    <path v-if="b.demo === 'undo'" d="M6 9.3 2.7 6l3.3-3.3M2.7 6h7a3.65 3.65 0 0 1 3.65 3.65 3.65 3.65 0 0 1-3.65 3.65H7.3" />
                    <path v-else d="M10 9.3 13.3 6l-3.3-3.3M13.3 6h-7a3.65 3.65 0 0 0-3.65 3.65 3.65 3.65 0 0 0 3.65 3.65H8.7" />
                  </svg>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      </template>
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
 * 按下：**下沉 0.5px + 压暗到 9%**。
 * 位移给"按到了实体"的手感，压暗负责在位移只有半个像素时也能看出来。
 */
.tb:active:not(:disabled) {
  background-color: rgb(22 24 28 / 9%);
  color: var(--nd-text);
  transform: translateY(0.5px);
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

/* ================================================================ 悬停演示动画
 *
 * 每个按钮悬停时弹出的卡片里播放的演示。9 段片段原来各自一个文件
 * （`app/components/toolbar-demos/*.css`），现在并进来 —— 它们本来就是同一套
 * 语言，分散放反而看不出"这些演示是不是一个家族"。
 *
 * ## ★ 全套共用的一条叙事：四拍，播一次，停在结果上
 *
 * 每个演示讲的都是**同一件事**：这个按钮按下去，文字会经历什么。
 *
 * | 拍 | 时刻 | 画面 | 观众在想什么 |
 * | --- | --- | --- | --- |
 * | 1 | 0% | 原本的文字 | "哦，这是普通的字" |
 * | 2 | 22% | 文字**缩小一点** | "要发生什么了" |
 * | 3 | 44% | **语法标记露出来**（`**` `#` `-` `` ` `` `>` `[]()`） | "原来是要打这个" |
 * | 4 | 66% → 100% | 标记消失，文字变成**渲染后的样子** | "所以结果是这样" |
 *
 * **⚠️ 只播一次（`forwards`），不循环。** 循环会把第 4 拍冲掉 ——
 * 而第 4 拍恰恰是观众唯一想记住的信息。演示是**有终点**的过程，不是氛围灯。
 *
 * **⚠️ 缓动统一 `--ease`**（Material standard，快进快出）。这是"状态切换"类动画；
 * `--ease-out` 的慢尾是给元素**出场**用的，用在这里会显得拖沓。
 *
 * ## ★ 运镜（已去掉）
 *
 * ⚠️ 原来 `.demo-cam` 上挂着"推近 12% → 保持 → 拉回"，想让观众看清很小的标记。
 * 但那是**每个演示都会跳一下** —— 用户："动画里每个都要跳一下好莫名其妙啊，
 * 建议去掉。" 现在画布从头到尾纹丝不动，动的只有内容本身。
 *
 * 同理，各个演示自己那一下 `scale(0.88)` 的"缩小让位"也一并去掉了 ——
 * 标记现在是绝对定位、根本不推文字，本来也不需要谁让位。
 *
 * ## 其它共用约定
 *
 * - **画布固定 120×44**（由 `.demo-stage` 统一提供）。所有演示并排时尺寸必须
 *   完全一致，否则卡片会随着鼠标在工具栏上移动而忽大忽小地跳。
 * - **"缩小"那一拍挂在包住整块内容的元素上**（`.demo-bold` / `__line` / `__win` …），
 *   不挂在单个文字 span 上 —— 一个演示里有多个元素时，各缩各的会看起来不在
 *   一个基线上。
 * - **同一个元素上只能有一条 `transform`**。要同时做"缩小"和"倾斜/位移"，
 *   必须合并进同一条声明（`transform: scale(0.88) skewX(-12deg)`），
 *   写两条的话后者会整个覆盖前者。
 * - **颜色全部走令牌**（`--ink-*` / `--brand-*` / `--surface`）。
 * - **`prefers-reduced-motion: reduce` 时直接呈现"第 4 拍"**，不是回到原样：
 *   静止不动时，"用了这个按钮之后长什么样"才有信息量。所有演示的这条规则
 *   合并在本节末尾那**一个**媒体查询里。
 */

/* ------------------------------------------------- 演示的播放机制（所有演示共用）

/**
 * ★ **每次悬停都从头播一遍。**
 *
 * 做法：动画**不在**演示元素上常驻声明，只在悬停时赋给 `animation-name`。
 * 属性从"没有"变成"有"，浏览器就会从头开始 —— 每次悬停都完整演一遍。
 *
 * ## ⚠️⚠️ 动画名**必须写字面量**，绝不能走 CSS 变量
 *
 * 这是踩了两次的坑，写在这里免得以后有人"优化"回去：
 *
 * 1. **`animation: var(--anim)` 整条简写塞进变量** —— Chrome/Edge 上**完全不生效**，
 *    `getComputedStyle().animationName` 拿到的是 `none`。单属性里的 `var()` 可靠，
 *    简写里的不可靠。
 *
 * 2. **`animation-name: var(--anim-name)`（名字走变量）** —— 在**没有 scoped** 的
 *    环境里能跑（我离线验证时就是），但**在 `<style scoped>` 里必然失效**：
 *    Vue 的 scoped 编译会给 `@keyframes` **加后缀**（`demo-bold-pulse` →
 *    `demo-bold-pulse-abc123`），同时给 `animation-name` 里的**字面量**同步改掉。
 *    但**变量里的值是字符串，Vue 够不着** —— 于是 `animation-name` 拿到
 *    `demo-bold-pulse`，而实际存在的 keyframes 叫 `demo-bold-pulse-abc123`，
 *    **对不上，动画一帧都不跑**。
 *
 * 所以：动画名**写字面量**，Vue 会自动给两边加同一个后缀，永远同步。
 * 代价是每个演示元素要各写一条 `:hover` 规则（不能再用一条通用规则批量赋名）。
 *
 * ## 为什么不能用 `animation-play-state: paused/running`
 *
 * `paused` 是"停在当前进度"，第二次悬停会从**上一次的终点**接着跑，而不是从头。
 * 要"每次都完整演一遍"就必须让 `animation-name` 这条声明**在悬停时才出现**。
 *
 * 副作用（是好事）：鼠标移开 → 声明消失 → 画面立刻回到初始态。
 * 观众看到的永远是"干净的起点 → 完整过程 → 结果"。
 *
 * 键盘走 `:focus-visible`，和鼠标拿到同一套行为。
 */


/* demo-syntax —— 所有语法标记共用一条（属性选择器，一次覆盖全部） */
.tb-wrap:hover [class*='__syntax'],
.tb:focus-visible + .demo-pop [class*='__syntax'] {
  animation-play-state: running;
}

.demo-code-block__syntax--open { top: 0; }
.demo-code-block__syntax--close { bottom: 0; }


/* demo-code-block-win —— 悬停时跑起来（窗口的边框/底色浮出） */
.tb-wrap:hover .demo-code-block__win,
.tb:focus-visible + .demo-pop .demo-code-block__win {
  animation-play-state: running;
}

/* demo-undo-key —— 撤销和重做**各自列全**，逗号省写会把第二个变成顶层选择器 */
.tb-wrap:hover .demo-undo__key,
.tb-wrap:hover .demo-redo__key,
.tb:focus-visible + .demo-pop .demo-undo__key,
.tb:focus-visible + .demo-pop .demo-redo__key {
  animation-play-state: running;
}

/* ------------------------------------------------- 演示动画（常驻声明 + JS 重播）
 *
 * ⚠️ 动画名**常驻**声明，不是悬停时才赋 —— 这样鼠标移开时动画**停在最后一帧**，
 * 而不是瞬间跳回初始态（用户："鼠标移开时那个动画会在整个画布消失的动画中
 * 变成初始态，会被看到，有一点点问题"）。
 *
 * 重播交给 JS：`.tb-wrap` 的 `mouseenter` 里把所有动画 `currentTime = 0` 再 `play()`。
 *
 * 动画名依然是**字面量** —— 走 CSS 变量的话 Vue scoped 给 `@keyframes` 加的后缀传不进来。
 */

/* demo-bold-pulse */
.demo-bold {
  animation-name: demo-bold-pulse;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-bold-pulse —— 悬停时跑起来 */
.tb-wrap:hover .demo-bold,
.tb:focus-visible + .demo-pop .demo-bold {
  animation-play-state: running;
}

/* demo-italic-skew */
.demo-italic__text {
  animation-name: demo-italic-skew;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-italic-skew —— 悬停时跑起来 */
.tb-wrap:hover .demo-italic__text,
.tb:focus-visible + .demo-pop .demo-italic__text {
  animation-play-state: running;
}

/* demo-inline-code-box */
.demo-inline-code__chip::before {
  animation-name: demo-inline-code-box;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-inline-code-box —— 悬停时跑起来 */
.tb-wrap:hover .demo-inline-code__chip::before,
.tb:focus-visible + .demo-pop .demo-inline-code__chip::before {
  animation-play-state: running;
}

/* demo-h1-grow */
.demo-h1__word {
  animation-name: demo-h1-grow;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-h1-grow —— 悬停时跑起来 */
.tb-wrap:hover .demo-h1__word,
.tb:focus-visible + .demo-pop .demo-h1__word {
  animation-play-state: running;
}

/* demo-h2-grow */
.demo-h2__word {
  animation-name: demo-h2-grow;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-h2-grow —— 悬停时跑起来 */
.tb-wrap:hover .demo-h2__word,
.tb:focus-visible + .demo-pop .demo-h2__word {
  animation-play-state: running;
}

/* demo-h3-grow */
.demo-h3__word {
  animation-name: demo-h3-grow;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-h3-grow —— 悬停时跑起来 */
.tb-wrap:hover .demo-h3__word,
.tb:focus-visible + .demo-pop .demo-h3__word {
  animation-play-state: running;
}

/* demo-list-marker */
.demo-bullet__marker, .demo-ordered__marker {
  animation-name: demo-list-marker;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-list-marker —— 悬停时跑起来
 * ⚠️ 每个选择器都必须**各带一遍前缀** —— `A, B,` 这种写法会把 B 变成顶层选择器，
 * 于是它不依赖 hover、加载时就把动画跑完了。 */
.tb-wrap:hover .demo-bullet__marker,
.tb-wrap:hover .demo-ordered__marker,
.tb:focus-visible + .demo-pop .demo-bullet__marker,
.tb:focus-visible + .demo-pop .demo-ordered__marker {
  animation-play-state: running;
}

/* demo-quote-bar */
/*
 * 引用竖条。⚠️ **不用 `transform` 做垂直居中** —— `demo-quote-bar` 关键帧
 * 要用 `transform: scaleY()`，两者会互相覆盖。改用 `top: calc(50% - 8px)`。
 */
.demo-quote__bar {
  /* 动画名常驻；悬停时由 `replayDemos()` 重播（见 `.tb-wrap:hover` 那条规则） */
  animation-name: demo-quote-bar;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  animation-play-state: paused;
  position: absolute;
  top: calc(50% - 8px);
  right: 100%;
  margin-right: 3px;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--nd-brand-strong);
  transform-origin: center;
  transform: scaleY(0);
}

/* demo-quote-bar —— 悬停时跑起来 */
.tb-wrap:hover .demo-quote__bar,
.tb:focus-visible + .demo-pop .demo-quote__bar {
  animation-play-state: running;
}

/* demo-quote-text */
.demo-quote__text {
  animation-name: demo-quote-text;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-quote-text —— 悬停时跑起来 */
.tb-wrap:hover .demo-quote__text,
.tb:focus-visible + .demo-pop .demo-quote__text {
  animation-play-state: running;
}

/* demo-link-ink */
.demo-link__text {
  animation-name: demo-link-ink;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-link-ink —— 悬停时跑起来 */
.tb-wrap:hover .demo-link__text,
.tb:focus-visible + .demo-pop .demo-link__text {
  animation-play-state: running;
}

/* demo-link-underline */
.demo-link__text::after {
  animation-name: demo-link-underline;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-link-underline —— 悬停时跑起来 */
.tb-wrap:hover .demo-link__text::after,
.tb:focus-visible + .demo-pop .demo-link__text::after {
  animation-play-state: running;
}

/* demo-code-block-bar */
.demo-code-block__bar {
  /* 标题栏自己的字号 —— 圆点的 em 基准，也是"yaml"那行字的字号 */
  font-size: 8px;
  animation-name: demo-code-block-bar;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-code-block-bar —— 悬停时跑起来 */
.tb-wrap:hover .demo-code-block__bar,
.tb:focus-visible + .demo-pop .demo-code-block__bar {
  animation-play-state: running;
}

.demo-code-block__code {
  /*
   * ★ **0% 是普通文本（比例字体），渲染态才是等宽代码。**
   *
   * 别的演示起点都是"普通的文本"，代码块原来一上来就是等宽 + 代码色，
   * 看着像个异类（用户："别的都是开始就是普通的文本，它这个怎么开始就是有颜色不同"）。
   * 加回"字体切换"这一拍，它和其他演示就同构了。
   *
   * **居中**（`text-align: center`）—— 和别的演示一样待在画布正中；
   * 窗口无边框透明的时候看不出来，渲染态才显出它在一个窗口里。
   */
  width: 100%;
  padding: 0 6px;
  text-align: left;
  white-space: nowrap;
  color: var(--nd-text);
  animation-name: demo-code-block-font;
  animation-duration: 2.8s;
  animation-timing-function: steps(1, end);
  animation-fill-mode: forwards;
  animation-play-state: paused;
}

/* demo-code-block-font —— 悬停时跑起来 */
.tb-wrap:hover .demo-code-block__code,
.tb:focus-visible + .demo-pop .demo-code-block__code {
  animation-play-state: running;
}

/* 等宽只在渲染态出现；`steps(1, end)` 让它精确卡在 70% 切换 */
@keyframes demo-code-block-font {
  0%,
  58% {
    font-family: system-ui, sans-serif;
  }
  70%,
  100% {
    font-family: ui-monospace, Consolas, monospace;
  }
}

/* demo-undo-word */
.demo-undo__word {
  animation-name: demo-undo-word;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-undo-word —— 悬停时跑起来 */
.tb-wrap:hover .demo-undo__word,
.tb:focus-visible + .demo-pop .demo-undo__word {
  animation-play-state: running;
}

/* demo-redo-word */
.demo-redo__word {
  animation-name: demo-redo-word;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  /* 默认暂停在 0%；JS 在 mouseenter 时 play() 重播 */
  animation-play-state: paused;
}

/* demo-redo-word —— 悬停时跑起来 */
.tb-wrap:hover .demo-redo__word,
.tb:focus-visible + .demo-pop .demo-redo__word {
  animation-play-state: running;
}

/* ------------------------------------------------- 语法标记（所有演示共用）

/**
 * 每个演示都是同一个叙事：**源码 → 加标记 → 渲染结果**。
 *
 *   状态 1（0%）   默认文字，标记藏着
 *   状态 2（22%）  文字缩小一点，准备打标记
 *   状态 3（44%）  标记露出来（`**` / `#` / `-` / `` ` `` / `>` / `[]()`）
 *   状态 4（66%）  标记消失，文字变成渲染后的样子，**停在这里不动**
 *
 * ⚠️ **只播一次**（`forwards`，不是 `infinite`）。循环播放会让"最终长什么样"
 * 这个信息被冲掉 —— 用户要的是"我按下去会发生什么"，那是一个**有终点**的过程。
 *
 * ⚠️ 标记用 `opacity` 淡入淡出而不是 `display: none`：`display` 不可动画，
 * 而且会让文字左右跳位。代价是标记**始终占位**，所以状态 1/2 时文字会比
 * 渲染态略微靠右一点点 —— 这个位移很小，比"文字突然平移"好得多。
 */
[class*='__syntax'] {
  /*
   * ★★ **标记不再"从 0 宽展开"。**
   *
   * 原来这里是 `max-width: 0` → `6em`，想让标记"从左边长出来"。
   * 但那会把文字**推着往右走** —— 用户："**标记把文字挤跑**"。
   *
   * 正确的做法：文字**永远居中、永不移动**；标记**绝对定位在文字两侧**
   * （各演示自己的 `__box` 规则负责），不参与布局，所以宽度多少都不影响文字。
   * 标记只在文字**缩小**腾出的视觉空间里淡入淡出。
   */
  display: inline-block;
  color: var(--nd-text-4);
  font-weight: 400;
  opacity: 0;
  /* 动画名常驻（不移开就重置），悬停时靠 `replayDemos()` 重播 */
  animation-name: demo-syntax;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  animation-play-state: paused;
}

/**
 * 标记的节奏：**只有透明度**。
 *
 * 1–2 拍藏着 → 3 拍露出来 → 4 拍被"消化"掉。
 * **不再动宽度** —— 宽度一动就会挤走文字。
 */
@keyframes demo-syntax {
  /* 1–2：藏着 */
  0%,
  20% {
    opacity: 0;
  }
  /* 3：露出来 */
  40%,
  58% {
    opacity: 1;
  }
  /* 4：渲染后消失 */
  68%,
  100% {
    opacity: 0;
  }
}

/* ------------------------------------------------- 定位盒 + 标记定位（所有演示共用）

/**
 * ★★ **"文字永远居中、永不移动"是靠这一节实现的。**
 *
 * ## 结构
 *
 * ```
 * .demo-xxx            容器：flex 居中
 *   └ .demo-xxx__box    定位盒：宽度 = 文字宽度（shrink-wrap）
 *       ├ .demo-xxx__text   文字（在流内，唯一决定盒子宽度）
 *       └ .demo-xxx__syntax 标记（绝对定位，**不参与布局**）
 * ```
 *
 * ## 为什么标记必须绝对定位
 *
 * 第一版让标记用 `max-width: 0 → 6em` **展开**，文字会被**推着往右走** ——
 * 用户："**标记把文字挤跑**"。
 *
 * 现在标记脱离文档流，宽度是多少都不影响文字；文字是盒子里唯一在流内的内容，
 * 所以它**永远待在画布正中**。标记就靠文字自己"缩小"（`scale(0.88)` 那一拍）
 * 腾出的视觉空间出现 —— 用户要的正是这个："标记的位置应该通过缩放留出来"。
 *
 * ## 垂直居中
 *
 * 标记用 `top: 50%` + `translateY(-50%)` 对齐到文字的视线上。
 * （不能用 `top: 0; bottom: 0` + flex —— 那会让标记撑满行盒，
 * 而行盒比字形高，反而对不齐。）
 */
.demo-bold__box,
.demo-italic__box,
.demo-inline-code__box,
.demo-inline-math__box,
.demo-h1__box,
.demo-h2__box,
.demo-h3__box,
.demo-bullet__box,
.demo-ordered__box,
.demo-quote__box,
.demo-table__box,
.demo-link__box {
  position: relative;
  display: inline-block;
}

/* 标记：绝对定位、垂直居中、不换行 —— 宽度多少都不推动文字 */
[class*='__box'] > [class*='__syntax'],
[class*='__box'] > [class*='__marker'] {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
}
/*
 * ⚠️ **`__bar`（引用的竖条）刻意不在上面那条里。**
 *
 * 它要用 `transform: scaleY()` 做"从中间长出来"，而上面那条的
 * `translateY(-50%)` 特异性是 (0,2,0)，会**压过** `.demo-quote__bar` 的
 * (0,1,0) —— 结果 `scaleY(0)` 被覆盖，竖条**初始态就是满的**
 * （用户："引用的竖条也有了，也不对"）。
 *
 * 所以竖条改用 `top: calc(50% - 8px)` 定位（不占 `transform`），
 * 由下面 `.demo-quote__bar` 自己的规则声明 `position: absolute`。
 */

/*
 * 左侧的标记：右边缘贴住文字的左边缘（`right: 100%`），
 * 再用 `margin-right` 留一口气。
 */
.demo-bold__syntax--l,
.demo-italic__syntax--l,
.demo-inline-code__syntax--l,
.demo-inline-math__syntax--l,
.demo-h1__syntax,
.demo-h2__syntax,
.demo-h3__syntax,
.demo-bullet__syntax,
.demo-ordered__syntax,
.demo-bullet__marker,
.demo-ordered__marker,
.demo-table__syntax--l,
.demo-link__syntax--l {
  right: 100%;
  margin-right: 2px;
}

/* 右侧的标记：左边缘贴住文字的右边缘（`left: 100%`） */
.demo-bold__syntax--r,
.demo-italic__syntax--r,
.demo-inline-code__syntax--r,
.demo-inline-math__syntax--r,
.demo-table__syntax--r,
.demo-link__syntax--r {
  left: 100%;
  margin-left: 2px;
}

/* 列表的标记离文字稍远一点，读起来更像项目符号 */
.demo-bullet__syntax,
.demo-ordered__syntax,
.demo-bullet__marker,
.demo-ordered__marker {
  margin-right: 5px;
}

/*
 * 引用：竖条紧贴文字左侧，`>` 再往左一格 —— 两者**交替换位**
 * （源码态显示 `>`，渲染态显示竖条）。
 */
.demo-quote__syntax {
  right: 100%;
  margin-right: 10px;
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
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;

  box-sizing: border-box;
  width: 168px;
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
 * 靠右的两组（链接/代码块、撤销/重做）改贴按钮的右边缘、往左伸。
 *
 * 为什么需要：卡片 168px、按钮只有 28px，而工具栏在**一张 `overflow: hidden`
 * 的纸里**（`new.vue` 的 `.paper`）。纸宽 760px 时排得下（按钮排到 454px 就结束了），
 * 但纸窄到 476~620px 这一段时工具栏**不折行**、最后一个按钮却已经贴到纸的右边缘 ——
 * 靠左对齐的卡片会伸出纸外被裁掉。这是纯 CSS 能做的、不引定位库的做法。
 *
 * ⚠️ **已知代价**：纸再窄一点（< 476px）工具栏就会折行，而折行后每一行都是从左边
 * 开始排的 —— 那时「撤销/重做」会落在第二行的**左端**，右对齐的卡片反而会往左伸出纸外。
 * 也就是说这个启发式在"不折行但很窄"和"折行"两种窄屏下各对一半。
 * 真正的解法是 `position-try-fallbacks`（CSS 锚点定位），浏览器支持还不够，先不用；
 * 要用就得知道"这一行折没折"，而那是 CSS 拿不到的信息。
 */
.tb-wrap.pop-right .demo-pop { right: 0; left: auto; }

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

/**
 * 演示区：那 120×44 的"画布" + 1px 边框。
 *
 * 底色和边框是从 `.demo-bold` **搬上来**的：原来只有加粗那一段自己画了画布，
 * 另外 11 段都是透明的 —— 并排看时加粗那张卡片会莫名其妙多出一个灰框。
 * 底色用 `--surface-2` 而不是 `--surface`：行内代码和代码块那两段自己的灰底
 * 就是 `--surface`，画布再用同一个色就分不出来了。
 */
.demo-stage {
  box-sizing: border-box;
  width: 100%;
  height: 46px; /* 44 的内容 + 上下各 1px 边框 */
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--nd-surface-2);
  border: 1px solid var(--nd-border);
  border-radius: var(--nd-radius-sm);
}

/**
 * ★ **镜头层。运镜已经去掉了，现在它只负责"居中"这一件事。**
 *
 * 它曾经挂过"推近 12% → 拉回"的运镜（为了让很小的语法标记看得清），
 * 但那是**每个演示都会跳一下** —— 用户："好莫名其妙，建议去掉"。
 *
 * 这一层留着还有用：它是外层画布和内层演示之间的缓冲，
 * 各个演示自己的 `transform`（斜体 `skewX`、引用 `scaleY`）不会影响到它。
 */
.demo-cam {
  /*
   * 镜头层。**现在只剩"居中"一个职责。**
   *
   * 原来这里挂着运镜（推近 12% 再拉回），但那是**每个演示都会跳一下** ——
   * 用户："动画里每个都要跳一下好莫名其妙啊，建议去掉。"
   * 去掉之后画布从头到尾纹丝不动，动的只有内容本身。
   */
  display: flex;
  align-items: center;
  justify-content: center;
}


/* ---------------------------------------------------------------- 1. 加粗 */

/**
 * 加粗这个功能的效果就是字重，动画主体也只该动字重 —— 加描边、加颜色都是"演别的功能"。
 * `nowrap` 是必须的：变粗会让字变宽，换行的话容器高度会炸。
 * （画布底色 / 边框在 `.demo-stage` 上，这里不再画一层。）
 *
 * ## 四拍
 *
 * | 拍 | 画面 | 演的是什么 |
 * | --- | --- | --- |
 * | 1 | `文字` | 还没按按钮的样子 |
 * | 2 | `文字`（缩一点） | "这里马上要被包一层了"，让位 |
 * | 3 | `**文字**` | 打出源码标记（标记由 `__syntax` 自己淡入） |
 * | 4 | **文字** | 标记消失，文字变粗 —— **停在这里** |
 *
 * 第 2 拍的缩小用 `transform: scale()` 而不是 `font-size`：
 * `font-size` 会改行盒高度，把整块内容往下顶；`transform` 不参与布局。
 * 0.88 这个幅度是量出来的 —— 再小就像"出错了"，再大看不出在缩。
 */
.demo-bold {
  box-sizing: border-box;
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
  white-space: nowrap;
}

@keyframes demo-bold-pulse {
  /* 只动字重 —— 不再缩一下（那是"跳"，用户要求去掉） */
  0%,
  22%,
  44% {
    font-weight: 400;
  }
  /* 4 渲染：加粗，停住 */
  66%,
  100% {
    font-weight: 700;
  }
}

/* ---------------------------------------------------------------- 2. 斜体 */

/**
 * 不用 `font-style: italic`：中文字体绝大多数没有真斜体，浏览器只能靠"伪斜体"
 * 临时几何倾斜字形 —— 一开一关时字形的度量和栅格化会变，容易看出闪动，
 * 而且倾斜量由浏览器定、跨字体不一致。
 * 改用 `transform: skewX(-12deg)`：对**已经排好版的同一份字形**做几何变换，
 * 全程可插值、可缓动，观感接近真斜体（12° 比浏览器伪斜体常用的 14° 稍含蓄，更耐看）。
 * `transform-origin: left center` —— 以文字左边缘为轴，文字原地"倒"下去，
 * 不会整体左右跑位，和相邻演示并排看时基线也稳。
 */
.demo-italic {
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
}
.demo-italic__text {
  display: inline-block;
  white-space: nowrap;
  transform-origin: left center;
}
@keyframes demo-italic-skew {
  /* 只动倾斜 —— 不再缩一下 */
  0%,
  22%,
  44% {
    transform: skewX(0deg);
  }
  /* 4 渲染：倾斜，停住 */
  66%,
  100% {
    transform: skewX(-12deg);
  }
}

/* ---------------------------------------------------------------- 3. 行内代码 */

/**
 * 一段普通文字 → 变成 Markdown 行内代码的样子（等宽 + 浅灰底 + 1px 边框 + 圆角），
 * 停一下，再退回原样。
 *
 * 文案刻意用「中文 + 拉丁」的混合串：纯中文时等宽字体回退到同一套中文字体，
 * "变等宽"肉眼看不出来，演示就只剩灰底了；带一个拉丁词才看得见
 * （这也是行内代码真实的用法：中文句子里嵌一小段代码）。
 *
 * 1. **文字不抖**：所有"长出来"的视觉都放在 `::before` 上（`inset` 从 0 向外扩），
 *    chip 的尺寸只由文字本身决定，再配合画布 flex 居中 → 视觉重心恒定不动。
 * 2. **从 0 长出来**：`::before` 的 `inset`（0 → -4px -8px）和 `opacity`（0 → 1）
 *    同步推进，看起来是"浅灰底从文字中心向四周包上去"，比直接切换底色自然得多。
 * 3. **字体瞬切要对齐**：`font-family` 是离散属性、不会插值，所以单独用一条
 *    `steps(1, end)` 的动画让它精确卡在 45% / 55% 两个整点上切换，
 *    正好和底色长满、收回的时间点对齐（用普通缓动会在段中间乱跳）。
 */
.demo-inline-code {
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
}
.demo-inline-code__chip {
  /* 两条并行：字体切换（steps）+ 缩小让位。字体的 steps 必须单独给 */
  animation-name: demo-inline-code-font;
  animation-duration: 2.8s;
  animation-timing-function: steps(1, end);
  animation-fill-mode: forwards;
  animation-play-state: paused;
  position: relative;
  z-index: 0; /* 自建层叠上下文，好让 ::before 的 -1 只沉到文字下面，而不是沉到卡片背后 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /*
   * ⚠️ **固定宽度 + 居中，这是修"鬼畜"的关键。**
   *
   * 状态 4 会切到等宽字体，而等宽和比例字体下同样几个字符的**宽度不一样**。
   * 不锁宽的话，字体切换的那一帧整个 chip 会突然变宽/变窄，文字跟着左右横跳 ——
   * 用户的原话是"文字会鬼畜"。
   *
   * 锁成固定宽度 + `justify-content: center` 之后，宽度变化被吸收在内部，
   * 视觉上只有"字变等宽了 + 灰底长出来"，位置纹丝不动。
   * 46px 是按最长的一帧（` + code + ` 三个 span 都用等宽）量出来的。
   */
  width: 52px;
  height: 20px;
  white-space: nowrap;
  color: var(--nd-text);
}

/* 灰底 + 边框 + 圆角画在这一层，跟文字解耦，文字因此不会位移 */
.demo-inline-code__chip::before {
  content: '';
  position: absolute;
  z-index: -1; /* 定位伪元素默认压在行内文字之上，必须沉下去 */
  /*
   * ⚠️ **`inset` 一开始就是最终值（`-4px -8px`），不是 `0`。**
   *
   * 原来写 `inset: 0` 再过渡到 `-4px -8px`，本意是"灰底从文字中心长出来"。
   * 但 `inset: 0` 时伪元素**紧贴文字**，虽然 `opacity: 0` 看不见 ——
   * 用户却报告"**行内代码刚开始代码框就已经出现了**"（初始态就有一个方框）。
   * 多属性插值容易在某帧露出边，不值得为"从中心长出来"这点效果冒险。
   *
   * 现在它**始终**是最终尺寸，动画只动 `opacity` —— 从无到有，干净。
   */
  inset: -4px -8px;
  box-sizing: border-box;
  border: 1px solid var(--nd-border);
  border-radius: var(--nd-radius-sm);
  background-color: var(--nd-surface);
  opacity: 0;
}
@keyframes demo-inline-code-box {
  /*
   * ⚠️ **只动 `opacity`，`inset` 全程固定。**
   *
   * 第一版让 `inset` 从 `0` 过渡到 `-4px -8px`，本意是"灰底从文字中心长出来"。
   * 但 `inset: 0` 时伪元素**紧贴着文字**，即使 `opacity: 0` 也已经在正确的位置上
   * —— 用户看到的是"刚开始代码框就已经出现了"（截图里初始态就有个方框）。
   *
   * 现在 `inset` 一开始就是最终值（见下面的 `::before`），动画只负责淡入淡出。
   * 少一个动效属性，但"从无到有"这件事更干净。
   */
  0%,
  44% {
    opacity: 0;
  }
  66%,
  100% {
    opacity: 1;
  }
}
/* 等宽只在效果态出现；steps(1, end) 让它精确卡在 45% / 55% 切换 */
/**
 * ⚠️ 这里**只切字体，不动字号**。
 *
 * 第一版在状态 2 把字号也缩了（用户要的"缩小一点"），结果中文在两套字体下的
 * **字宽差异**被放大，切换瞬间文字会左右横跳（用户原话："文字会鬼畜"）。
 * 现在文案固定用英文 `code`（比例字体和等宽字体下宽度只差约 2px），
 * 且字号全程不变 —— 视觉上只有"等宽化 + 灰底长出来"，不跳。
 */
@keyframes demo-inline-code-font {
  0%, 44% { font-family: system-ui, sans-serif; }
  66%, 100% { font-family: ui-monospace, Consolas, monospace; }
}

/* ---------------------------------------------------------------- 4. 一 / 二 / 三级标题 */

/**
 * 三个演示演的是同一件事：同一段正文「标题」被"套上标题样式"的瞬间 ——
 * 字号从正文尺寸放大到该档位、字重 400 → 600，然后回到正文。
 *
 * 三档幅度（同一容器、同一节奏，**只有目标值不同**，并排才看得出阶梯）：
 *
 * | 演示 | 起始      | 目标字号 | 视觉          |
 * | ---   | ---      | ---      | ---           |
 * | h1   | 13px/400 | 22px/600 | 明显最大（+69%） |
 * | h2   | 13px/400 | 18px/600 | 中等（+38%）    |
 * | h3   | 13px/400 | 15px/600 | 略大（+15%）    |
 *
 * 三档取自 `new.vue` 的字号阶梯（正文 13 / 纸张标题 20 / 页面标题 26 之间）。
 * 文字只用两个字「标题」：22px 时宽约 44px、行高 33px，塞进 120×44 不裁切。
 * 只动 `font-size` 和 `font-weight` 两个属性。
 */
.demo-h1,
.demo-h2,
.demo-h3 {
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
}
.demo-h1__word,
.demo-h2__word,
.demo-h3__word {
  display: inline-block;
  white-space: nowrap;
  font-weight: 400;
  /*
   * ⚠️ **这里不能写任何 `animation-*` 属性**（名字、时长、填充都不行）。
   *
   * 它们会和"悬停时才赋动画"的机制打架：`.demo-stage * { animation: none }`
   * 和这条规则的特异性都是 (0,1,0)，**后定义的赢** —— 于是时长之类会活下来、
   * `animation-name` 被压成 `none`。症状很阴：`getComputedStyle` 报出
   * `animationName: demo-h1-grow`（**假阳性**），但 `getAnimations()` 是空的。
   *
   * 动画名现在由下面「悬停时赋动画」那一节的 `.demo-h1__word` 规则给，
   * 而且是**字面量** —— 走变量的话 Vue scoped 给 `@keyframes` 加的后缀传不进来。
   */
}

/*
 * 三个标题的**四拍**（只有目标字号不同，其余完全一致，并排才看得出阶梯）：
 *
 *   1 默认    13px / 400          —— 正文原样
 *   2 缩小    13px / 400，缩 0.88  —— 让位给标记
 *   3 加语法  同上，`#` 露出来     —— 标记由 `__syntax` 自己淡入
 *   4 渲染    22 / 18 / 15px / 600 —— 标记消失、字放大加粗，停住
 *
 * ⚠️ 缩放的 `scale()` 和字号的 `font-size` **不冲突**（一个改字形大小、
 * 一个改行盒度量），所以这里可以同时写。但 `transform` 只有一条 ——
 * 如果将来还要加别的变换，必须合并进同一条声明。
 */
@keyframes demo-h1-grow {
  /* 只动字号和字重 —— 不再缩一下 */
  0%,
  22%,
  44% {
    font-size: 13px;
    font-weight: 400;
  }
  /* 4 渲染：放大到该档位，停住 */
  66%,
  100% {
    font-size: 22px;
    font-weight: 600;
  }
}
@keyframes demo-h2-grow {
  /* 只动字号和字重 —— 不再缩一下 */
  0%,
  22%,
  44% {
    font-size: 13px;
    font-weight: 400;
  }
  /* 4 渲染：放大到该档位，停住 */
  66%,
  100% {
    font-size: 18px;
    font-weight: 600;
  }
}
@keyframes demo-h3-grow {
  /* 只动字号和字重 —— 不再缩一下 */
  0%,
  22%,
  44% {
    font-size: 13px;
    font-weight: 400;
  }
  /* 4 渲染：放大到该档位，停住 */
  66%,
  100% {
    font-size: 15px;
    font-weight: 600;
  }
}

/* ---------------------------------------------------------------- 5. 无序 / 有序列表 */

/**
 * 一行普通文字，左边滑入一个 `•`（或 `1.` `2.`）标记，文字右移让位 ——
 * 一眼看懂"给这几行套上项目符号"。
 *
 * 演示**两行**而不是一行：只有两行才读得出"这是一组列表"，一行看起来只是"加了个点"。
 *
 * · 标记是 `position: absolute`（**不占位**），从左侧滑入的同时淡入。
 *   如果让它在文档流里占位，文字一开始就已经被顶开了，右移就成了假动作 ——
 *   必须"标记滑进来"和"文字让开"**同时**发生才成立。
 * · 文字右移的距离 = `--demo-shift`（标记宽度），两者共用同一个变量，永远同步。
 * · 只动 `transform` / `opacity`（合成层属性），不碰 width / left / margin，不触发重排。
 * · 容器本身**透明**（不画背景、不画边框）—— 画布由 `.demo-stage` 提供，
 *   这样同一份 CSS 放进任何底色的卡片都不会打架。
 */
.demo-bullet,
.demo-ordered {
  /*
   * ⚠️ **13px** —— 在"装得下 `1.`"和"别把文字推太远"之间取的值。
   *
   * 15px 时 `1.` 会折行（标记宽不够）；20px 时文字被推得太右
   * （用户："无序和有序都有问题，**文字移动的太右了**"）。
   * 13px 装得下 `1.`（等宽下约 9px）+ 4px 右侧留白。
   */
  --demo-shift: 13px;

  box-sizing: border-box;
  width: 120px;
  height: 44px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
  user-select: none;
}
/* 一行：宽度由文字撑开（标记绝对定位、不占位），整行在容器里居中。
   `padding-right` 取位移量的一半：让位后整组变宽了 15px，预留半格可以让
   "原样态"和"效果态"各自只偏 3.75px，而不是一边正中一边偏 7.5px。 */
.demo-bullet__line,
.demo-ordered__line {
  display: inline-block;
}
/*
 * ⚠️ 这里**曾经**有一条 `padding-right: calc(var(--demo-shift) / 2)`，
 * 本意是把"标记占位导致的重心偏移"劈成两边各一半。但实际效果是
 * **整行被推左**（用户截图里 `• 文字一` 明显没居中）。
 *
 * 去掉之后：标记用 `position: absolute` 从左侧滑入，**不占文档流**，
 * 所以行的宽度就是文字的宽度，`justify-content: center` 会把它正正地居中。
 * 标记出现时只是"文字右边多出一个点"，重心偏移量很小，不值得为它引入不对称的内边距。
 */
.demo-bullet__text,
.demo-ordered__text {
  display: inline-block;
}
/* 渲染后的标记（• / 1.）—— 定位由下面「定位盒」那一节的共用规则给 */
.demo-bullet__marker,
.demo-ordered__marker {
  color: var(--nd-text-3);
  opacity: 0;
}
/* 两支演示共用同一组 keyframes —— 并排看时节奏、缓动、位移量完全一致 */
@keyframes demo-list-marker {
  /*
   * 只动透明度 —— 标记绝对定位在文字左侧、**不参与布局**，
   * 所以它出现与否都不会推动文字（用户："标记把文字挤跑"）。
   */
  0%,
  62% {
    opacity: 0;
  }
  /* 4 渲染：淡入，停住 */
  76%,
  100% {
    opacity: 1;
  }
}

/**
 * 整行（标记 + 文字）共用的"缩小让位"。
 *
 * 挂在 `__line` 而不是 `__text` 上：两行文字要**一起**缩，各缩各的会看起来
 * 一高一低、像排版坏了。
 */
.demo-bullet__line,
.demo-ordered__line {
}


/* ---------------------------------------------------------------- 6. 引用 */

/**
 * 一行普通文字，左边长出一条品牌色竖条，同时文字略微右移、颜色变灰 ——
 * 也就是块引用（blockquote）的典型视觉。
 *
 * 1. 竖条用 `transform: scaleY()` 从 0 长出来（`transform-origin: left center`，
 *    即从竖直中线向上下两端生长），比动 `height` 性能好，也不触发重排。
 *    `scaleY` 不改变横向占位，所以**布局在整段动画里纹丝不动**。
 * 2. 竖条是**常驻的 flex 子项**（`flex: 0 0 3px`），不是 `display: none` 式地出现 ——
 *    它的 3px 宽度和 8px 的 `gap` 全程占着位，所以文字不会因为竖条出现而左右抖动。
 * 3. 文字只动 `transform` + `color`，都是合成层属性，不碰布局。
 * 4. 竖条用 `--brand-strong` 而不是 `--brand`：3px 的细条要实心色才"撑得住"，
 *    和工具栏图标那条实心竖条是同一个判断。
 */
.demo-quote {
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
}
.demo-quote__text {
  white-space: nowrap;
}
@keyframes demo-quote-bar {
  /*
   * ⚠️ 竖条是 `flex: 0 0 3px` **常驻占位**的（见上面的注释），
   * 所以这里只动 `scaleY`，横向布局全程不变 —— 文字不会因为它长出来而左右抖。
   */
  /* 1–3：还没有竖条 */
  0%,
  44% {
    transform: scaleY(0);
  }
  /* 4 渲染：竖条长满，停住 */
  66%,
  100% {
    transform: scaleY(1);
  }
}
@keyframes demo-quote-text {
  /*
   * 只动颜色 —— 文字**不再右移**（原来 `translateX(4px)` 把文字推走了，
   * 用户："标记把文字挤跑"）。竖条绝对定位在文字左侧，不需要文字让位。
   */
  0%,
  44% {
    color: var(--nd-text);
  }
  /* 4 渲染：变灰（引用的典型视觉），停住 */
  66%,
  100% {
    color: var(--nd-text-3);
  }
}

/**
 * 引用这一拍的"缩小"做在 `.demo-quote` 整块上（竖条 + 文字一起缩），
 * 不做在文字上 —— 只缩文字的话，常驻占位的竖条宽度不变，看起来会"歪"。
 */
.demo-quote {
}


/* ---------------------------------------------------------------- 7. 插入链接 */

/**
 * 一段普通文字变成品牌蓝，同时一条下划线从左到右"画"出来。
 *
 * 1. **下划线不能用 `text-decoration`** —— 它不可动画，没法插值，也做不出
 *    "从左到右画出来"的过程，只能瞬间出现/消失。改用 `::after` 一条 1.5px 的横线，
 *    配 `transform: scaleX(0) → scaleX(1)` + `transform-origin: left`。
 *    动 `transform` 走合成层，比动 `width` / `background-size` 少一次布局或重绘。
 * 2. **文字颜色和下划线是两个独立动画**：伪元素不能"继承"父元素的 `@keyframes` 进度，
 *    只能各写一份。两者参数（1.6s / `--ease` / 同一组百分比停靠点）完全一致，
 *    所以视觉上就是一条线在走。
 * 3. 只动 `color` + `transform`，不写 `transition: all`，避免误伤尺寸 / 布局。
 */
.demo-link {
  box-sizing: border-box;
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
  white-space: nowrap;
}
.demo-link__text {
  position: relative; /* 作为 ::after 的定位上下文，下划线贴着文字底部走 */
  display: inline-block;
  color: var(--nd-text);
}
.demo-link__text::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1.5px;
  border-radius: 1px;
  background: var(--nd-brand);
  /* 以左端为轴做水平缩放 —— 0 完全收拢，1 完整铺开 */
  transform-origin: left center;
  transform: scaleX(0);
}
/**
 * 链接的"四拍"。
 *
 * ⚠️ **颜色和下划线必须是两条独立的 keyframes**：下划线画在 `::after` 伪元素上，
 * 伪元素**不能继承父元素的动画进度** —— 父元素走到 44% 了，伪元素自己那条
 * 还是 0%。两条参数完全一致（时长 / 缓动 / 停靠点），视觉上才像"一起发生的"。
 *
 * 缩小的那一拍做在 `.demo-link` 整块上（文字 + 方括号一起缩），
 * 不做在文字上 —— 只缩文字的话，两侧的 `[` `]` 不跟着缩，比例会怪。
 */
.demo-link {
}


@keyframes demo-link-ink {
  /* 1–3：还是普通文字的颜色（标记还没被"消化"） */
  0%,
  44% {
    color: var(--nd-text);
  }
  /* 4 渲染：变成链接色，停住 */
  66%,
  100% {
    color: var(--nd-brand);
  }
}
@keyframes demo-link-underline {
  /* 1–3：下划线长度 0（不是"没有"，是**缩到没有**，才能从左边画出去） */
  0%,
  44% {
    transform: scaleX(0);
  }
  /* 4 渲染：画满，停住 */
  66%,
  100% {
    transform: scaleX(1);
  }
}

/* ---------------------------------------------------------------- 8. 插入代码块 */

/**
 * 一行普通文字（`port: 25565`）原地变成一个小号"代码窗口"：顶部一条薄标题栏
 * （左边三个小圆点、右边语言名、底边一条分隔线），下面一行等宽代码。
 *
 * 1. **一个元素演两个状态**：`__code` 从头到尾就是同一行字。0% 时是 system-ui 的
 *    普通文字，45% 时变成等宽代码 —— 不需要两套文字做淡入淡出，也就不会有
 *    "两份文字错位半像素"的糊边。
 * 2. **高度展开，不是缩放**：标题栏 `height: 0 → 11px`。卡片是 `align-items: center`
 *    里居中的，所以标题栏长出来的同时整张卡片会自己重新居中 —— 看起来就是
 *    "窗口从文字上方展开、把文字往下压了半格"，比 `scale` 清楚，文字也不会被插值弄糊。
 * 3. **分隔线用 inset box-shadow，不用 border**：`border-bottom` 会参与布局，
 *    高度为 0 时仍会顶出 1px、把普通文字往下推。`box-shadow: inset 0 -1px 0`
 *    完全不影响布局，还能单独动颜色，正好配 height 动画。
 * 4. **字体切换必须 steps**（`font-family` 不会插值），做法同行内代码。
 *
 * ## 和 `.nd-code-header` 的关系
 *
 * 照着 `nexusdown/src/cm/theme.css` 的 `.nd-code-header` 做的小号复刻，视觉语言逐条对齐，
 * 好让演示和真编辑器里的代码块看着是一个家族：
 *   · 标题栏背景 = `rgb(0 0 0 / 4%)`（比内容深一档）   —— 同源
 *   · 标题栏底边 1px 分隔线 = `var(--nd-border)`，通栏    —— 同源
 *   · 三个圆点 `#c8ccd2`、间距 0.32em、直径 0.62em     —— 同源（数值照抄，em 基准缩到 8px）
 *   · 语言名等宽、`var(--nd-text-3)`、右对齐                —— 同源
 * 简化掉的（演示不需要）：文件图标徽章 / 折叠按钮 / 行号 / 语法高亮 —— 44px 高塞不下，
 * 也不是"插入代码块"这个动作的要点。
 */
.demo-code-block {
  box-sizing: border-box; /* 不设的话 `width: 120px` + `padding: 0 4px` = 128px，溢出画布 */
  width: 120px;
  height: 44px;
  display: flex;
  /*
   * 现在只有**一个**子元素（窗口），围栏已经移进窗口内部。
   * 所以这里只管垂直居中 —— 不需要 `flex-direction: column` / `gap` / `justify-content`。
   */
  align-items: center;
  padding: 0 4px;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
}
/* 卡片本体。0% 时背景和边框都是 transparent —— 视觉上就只剩那行字，
   也就是"普通文字"态。宽度写死，两种字体下都塞得下，不会左右抽动。 */
/* 围栏标记 —— 和代码同号（8px 等宽），但加粗一档，才不会被当成噪点 */
.demo-code-block__syntax {
  /*
   * ★ **走和别的标记同一套节奏（`demo-syntax`）。**
   *
   * 原来它用 `demo-fence`（源码态就可见）—— 但那让代码块演示的起点是个异类：
   * 别的演示一开始都是"普通的文本"，它一上来就是 ` ``` ` + 等宽代码
   * （用户："别的都是开始就是普通的文本，它这个怎么开始就是有颜色不同"）。
   * 现在它也是"从无到有"：0% 看不见 → 40–58% 露出来 → 渲染态被消化掉。
   *
   * 动画名由通用规则 `[class*='__syntax']` 给，这里只负责定位和字形。
   */
  position: absolute;
  left: 6px; /* 和代码文字左对齐 */
  /*
   * ⚠️ **字重 400，和别的语法标记同档。**
   * 原来是 700，视觉上比别的标记重一档，看起来"颜色不对"
   * （用户："那个 ``` 为什么颜色也不对"）—— 其实颜色都是 `--ink-4`，
   * 差的是字重。等宽字体本身笔画就粗，再加粗就过了。
   */
  font: 400 11px/1 ui-monospace, Consolas, monospace;
  color: var(--nd-text-4);
  letter-spacing: -0.03em;
}
.demo-code-block__syntax--open { top: 0; }
.demo-code-block__syntax--close { bottom: 0; }

.demo-code-block__win {
  /* 两条并行：窗口浮出（边框/底色）+ 缩小让位 */
  animation-name: demo-code-block-win;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  animation-play-state: paused;
  box-sizing: border-box;
  /*
   * ★ **固定高度 35px + flex 居中，不用 `padding` 留槽。**
   *
   * 用 `padding: 11px 0` 留槽的话，源码态那两条槽是**空的** ——
   * 围栏和代码之间就空出一行（用户："**像空出去一行**"）。
   * 现在围栏**绝对定位在窗口的上下两端**，正好压在标题栏 / 底边的位置上，
   * 交替换位：既没有空白，窗口高度也恒定（零位移）。
   */
  position: relative;
  width: 100%;
  height: 35px;
  display: flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid transparent;
  /*
   * ⚠️ **`4px`，不是 `var(--nd-radius-md)`（10px）。**
   * 窗口只有 35px 高，套 10px 圆角会变成药丸形（踩过）。
   */
  border-radius: 4px;
  background-color: transparent;
  font-size: 9px;
}
/**
 * 代码块的"四拍"。
 *
 *   1 默认    `port: 25565` 一行普通文字
 *   2 缩小    整块缩 0.9 —— "这里要变成别的东西了"
 *   3 加语法  ` ``` ` 露出来（由 `__syntax` 自己淡入）
 *   4 渲染    一行文字变成**代码窗口**：外框浮出来、标题栏长出来、
 *             字切等宽 —— 停在这里
 *
 * ⚠️ 窗口的"长出来"用**三个独立属性各自动画**（边框色 / 标题栏高度 / 字体），
 * 而不是整块缩放。整块缩放会让里面的文字也跟着变大，看起来像"放大镜"
 * 而不是"一个窗口从文字上方展开"。
 */
@keyframes demo-code-block-win {
  /* 1–3：还看不出是个窗口，就是一行字 */
  0%,
  44% {
    border-color: transparent;
    background-color: transparent;
  }
  /* 4 渲染：外框和底色浮出来，停住 */
  70%,
  100% {
    border-color: var(--nd-border);
    background-color: var(--nd-surface);
  }
}

/* 整块的"缩小让位"——和上面那条并行的第二条动画，见 `.demo-code-block__win` 的注释 */
/* 标题栏：高度 0 → 11px 长出来。`overflow: hidden` 把圆点和语言名在高度为 0 时裁掉，
   不然它们会溢到卡片外。底边分隔线用 inset box-shadow（见上面第 3 点）。 */
.demo-code-block__bar {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  /*
   * ★ **绝对定位 + 固定高度** —— 这是修"过渡时整摞内容被挤上去"的关键。
   *
   * 原来标题栏动 `height: 0 → 8px`。高度变化会**改变布局**，而外层是
   * `justify-content: center` —— 为了让变高的内容保持居中，整摞内容（围栏、
   * 代码、下围栏）会一起往上挪。用户截图里就是这个："你有问题啊，
   * **直接给他挤上去了**"。
   *
   * 改成绝对定位后它**完全不参与布局**：占位由 `.demo-code-block__win` 的
   * `padding-top` 预留。整个动画过程中**没有任何布局高度变化** ——
   * 只有透明度、边框色、背景色在动，画面纹丝不动。
   */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 11px; /* 和窗口的 `padding-top` 一致 —— 正好填满上围栏的槽位 */
  padding: 0 6px;
  overflow: hidden;
  background: rgb(0 0 0 / 4%);
  opacity: 0;
  visibility: hidden; /* 和关键帧的 0% 一致，避免首帧闪一下 */
  box-shadow: inset 0 -1px 0 transparent;
}
/**
 * 标题栏只淡入淡出 —— **不动 `height`**（见上面样式里的注释：动高度会把整摞挤上去）。
 *
 * `visibility` 是必须的：光靠 `opacity: 0` 的话，源码态虽然看不见，
 * 但它里面的行内元素在某些情况下仍会被渲染出边缘。
 */
@keyframes demo-code-block-bar {
  /* 58% 才开始淡入 —— 等围栏（52% 收完）退场之后再登场，两者不重叠 */
  0%, 58% { opacity: 0; visibility: hidden; box-shadow: inset 0 -1px 0 transparent; }
  70%, 100% { opacity: 1; visibility: visible; box-shadow: inset 0 -1px 0 var(--nd-border); }
}
/* 三个小圆点 —— 对应 `.nd-code-dots`，尺寸 / 间距照抄源码的 0.62em / 0.32em。
   em 基准是 `.demo-code-block__bar` 的 font-size（8px），实得 ≈ 5px 直径 / 2.5px 间距。 */
.demo-code-block__dots {
  display: inline-flex;
  flex: none;
  gap: 0.32em;
}
.demo-code-block__dots i {
  width: 0.62em;
  height: 0.62em;
  border-radius: 50%;
  background: #c8ccd2; /* 和 .nd-code-dots 的源码逐字对齐，故意不走令牌 */
}
/* 文件图标 —— 内联 SVG，尺寸跟着标题栏字号走（1em = 8px，实得约 8px） */
.demo-code-block__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  /*
   * ⚠️ **11px，不是 8px。**
   *
   * 8px 时 YAML 图标（vscode-icons 的黄字）完全糊成一团、认不出是什么
   * （用户："**yaml 的 logo 直接压根看不清，太小了**"）。
   * 图标是纯色块构成的字形，比文字更需要尺寸才立得住 —— 给它和围栏同档的 11px。
   */
  font-size: 11px;
  line-height: 1;
  margin-right: 1px;
}

.demo-code-block__icon svg {
  display: block;
  width: 1em;
  height: 1em;
}

/* 文件名 —— 占标题栏中段，比语言名略深一档，视觉上是"这是什么文件" */
.demo-code-block__file {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
  font-size: 8px;
  color: var(--nd-text-2);
}

/* 语言名 —— 对应 `.nd-code-title` 的位置，等宽 + var(--nd-text-3) */
.demo-code-block__lang {
  flex: none;
  color: var(--nd-text-3);
  font: 8px/1 ui-monospace, Consolas, monospace;
}
.demo-code-block__code {
  padding: 2px 6px;
  white-space: nowrap;
  color: var(--nd-text);
}

/* ---------------------------------------------------------------- 9. 撤销 / 重做 */

/**
 * 两者**只差方向**，所以用同一个模板、同一个节奏，只有"效果态"的定义相反：
 *
 * | 演示 | 演什么          | 效果态                        |
 * | ---  | ---            | ---                          |
 * | undo | 「你好世界」→「你好」 | 词被划掉 + 褪成极弱的 `--ink-4` |
 * | redo | 「你好」→「你好世界」 | 词恢复 `--ink-1`、删除线撤掉    |
 *
 * 把两条动画都冻在 50%（效果态）并排看：一个是划掉褪色的「世界」、一个是清晰完整的
 * 「世界」—— 一眼分得出"退"和"进"。
 *
 * 1. **不动布局宽度**：词"消失"用的是 `color` + `opacity` + 删除线，而不是
 *    `display: none` / `width: 0` —— 元素始终占位，容器宽度纹丝不动。
 * 2. **删除线用 `background-size` 画**（linear-gradient 当一条横线），不用
 *    `text-decoration: line-through`：后者无法插值、会硬切；`background-size`
 *    可以 0% → 100% 平滑"划过去"，方向感更明确。
 * 3. 只动 `color` / `opacity` / `background-size`，不动字号和位移 ——
 *    动了就是在演别的功能。
 */
.demo-undo,
.demo-redo {
  width: 120px;
  height: 44px;
  display: flex;
  /*
   * 竖排：**文字在上、按键在下**。
   * 按键出现在文字下方，而不是旁边 —— 旁边会挤掉文字的位置，
   * 而"下面浮出来一个按钮被按了"更接近真实工具条给人的感觉。
   */
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
  white-space: nowrap;
}

/**
 * 文字层：**镜头**。
 *
 * 用户要的运镜："镜头缩小 → …… → 镜头放大一些时你好世界在居中"。
 *
 * 和 `.demo-stage` 那台"总镜头"不同，这一台是**给这一个演示单独**推拉的 ——
 * 总镜头负责整块画布的推近拉远，这一台负责让文字在"词变多"时**保持居中**。
 * 两层叠加不冲突（各自在自己的元素上）。
 */
.demo-undo__stage,
.demo-redo__stage {
}


/**
 * 按键层：**按下去、弹起来**。
 *
 * 五拍（比别的演示多一拍，因为"按下"这个动作本身需要两个瞬间才成立：
 * 按下 → 弹起）：
 *
 *   1 藏     还没出现
 *   2 浮现   从下方轻轻升起来（还没被按）
 *   3 按下   缩到 0.9 + 底色变深 —— 这一帧是"咔哒"的那一下
 *   4 弹起   回到 1.0 + 底色变回浅
 *   5 淡出   任务完成，退场（文字已经变了）
 */
.demo-undo__key,
.demo-redo__key {
  /* 按键：浮现 → 按下 → 弹起 → 退场 */
  animation-name: demo-undo-key;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  animation-play-state: paused;
  display: flex;
  align-items: center;
  justify-content: center;
  /*
   * ⚠️ 24×20，比第一版的 20×18 大一圈，而且**带边框和阴影**。
   *
   * 第一版没有边框、底色又是 `--surface`（和画布底几乎一样），
   * 在 44px 的画布里几乎看不见 —— 用户："**恢复和撤回没看到明显的按键过程**"。
   * 加上 1px 边框 + `--shadow-1` 之后它才"浮"在画布上，是个能按的东西。
   */
  width: 24px;
  height: 20px;
  border-radius: 5px;
  color: var(--nd-text-2);
  background: var(--nd-surface-2);
  border: 1px solid var(--nd-border);
  box-shadow: var(--nd-shadow-1);
}

.demo-undo__ico,
.demo-redo__ico {
  width: 14px;
  height: 14px;
}

@keyframes demo-undo-key {
  /*
   * ⚠️ **按键要晚于文字变化**，不能抢戏。
   *
   * 第一版按键在 20% 就浮出来了，而文字到 44% 才开始划掉 ——
   * 看起来是"按键先跳出来，然后文字才动"，因果反了。
   * 用户原话："**撤回是按键前线就出来了不对**"。
   *
   * 正确的叙事顺序是：**文字先变 → 观众疑惑"怎么变的" → 按键浮现给出答案**。
   * 所以按键整体后移到 44% 之后才开始，和文字的"划掉"那一拍接上。
   */
  /* 1 藏：文字在变的时候，按键还没出现（"为什么会变？"） */
  0%,
  44% {
    opacity: 0;
    transform: translateY(3px) scale(1);
    background-color: var(--nd-surface);
  }
  /* 2 浮现：给出答案 —— 是这个按钮干的 */
  54%,
  62% {
    opacity: 1;
    transform: translateY(0) scale(1);
    background-color: var(--nd-surface);
  }
  /* 3 按下：缩一圈、底色**明显压深**、阴影消失 —— 真的"陷进去"了 */
  68%,
  72% {
    opacity: 1;
    transform: translateY(1px) scale(0.84);
    background-color: var(--nd-text-4);
    border-color: var(--nd-text-4);
    box-shadow: none;
  }
  /* 4 弹起：回弹（略微过冲一点点，才有"弹"的手感） */
  82% {
    opacity: 1;
    transform: translateY(0) scale(1.06);
    background-color: var(--nd-surface-2);
    border-color: var(--nd-border);
    box-shadow: var(--nd-shadow-1);
  }
  /* 5 淡出：任务完成，功成身退 */
  92%,
  100% {
    opacity: 0;
    transform: translateY(-2px) scale(1);
    background-color: var(--nd-surface);
  }
}

.demo-undo__text,
.demo-redo__text { color: var(--nd-text); }

/* 用一层渐变当"删除线"，靠 background-size 把它从 0 划到 100% */
.demo-undo__word,
.demo-redo__word {
  background-image: linear-gradient(currentColor, currentColor);
  background-repeat: no-repeat;
  background-position: 0 55%;
}
.demo-undo__word {
  background-size: 0% 1.5px;
}
.demo-redo__word {
  background-size: 100% 1.5px;
}
/**
 * 撤销 / 重做的"四拍"—— 这两个**没有语法标记**那一拍（用户原话："有需要的，
 * 比如代码"），第三拍换成**删除线划过去**，正好是"这一笔要被撤掉"的视觉。
 *
 * | 拍 | 撤销 | 重做 |
 * | --- | --- | --- |
 * | 1 默认 | `你好世界` | `你好`（`世界` 是划掉的、褪色的） |
 * | 2 缩小 | 整块缩 0.9 | 同 |
 * | 3 划掉 | `世界` 上划出删除线 | 删除线从左往右**擦掉** |
 * | 4 渲染 | `世界` 褪成极弱 —— **停住** | `世界` 恢复成正文色 —— **停住** |
 *
 * 删除线用 `background-size` 画（`linear-gradient` 铺 1.5px 高的一条），
 * 不用 `text-decoration: line-through` —— 后者**不可插值**，
 * 只能"有"或"没有"，演不出"划过去"这个动作。
 */
@keyframes demo-undo-word {
  /* 1–2：完整的词 */
  0%,
  22% {
    color: var(--nd-text);
    opacity: 1;
    background-size: 0% 1.5px;
  }
  /* 3 划掉：删除线从左划到右（这一拍不缩小，让眼睛看清"划"这个动作） */
  44%,
  56% {
    color: var(--nd-text);
    opacity: 1;
    background-size: 100% 1.5px;
  }
  /* 4 渲染：词褪成极弱的 ink-4，停住 */
  66%,
  100% {
    color: var(--nd-text-4);
    opacity: 0.45;
    background-size: 100% 1.5px;
  }
}
@keyframes demo-redo-word {
  /* 1–2：词是"没了的"样子（划掉 + 褪色） */
  0%,
  22% {
    color: var(--nd-text-4);
    opacity: 0.45;
    background-size: 100% 1.5px;
  }
  /* 3 擦掉删除线：从左往右退回去 */
  44%,
  56% {
    color: var(--nd-text-3);
    opacity: 0.7;
    background-size: 0% 1.5px;
  }
  /* 4 渲染：词完全恢复，停住 */
  66%,
  100% {
    color: var(--nd-text);
    opacity: 1;
    background-size: 0% 1.5px;
  }
}

/* ---------------------------------------------------------------- 10. 表格 */

/**
 * 两段普通文字 → 被三个 `|` 串起来（源码）→ 落成一行表格（渲染）。
 *
 * 1. **边框画在单元格上、只动 `border-color`** —— 和代码块窗口同一条：
 *    1px 边框一直占位，动画只换颜色，所以格子宽度全程不变，`|` 消失时不会左右跳。
 * 2. **中间那个 `|` 落在两个单元格的分界上**（`left: 50%`）——
 *    单元格各带 7px 左右内边距，中间天然空出 14px 给它站。
 * 3. 三个 `|` 走通用标记的 `demo-syntax`（藏 → 露 → 被消化），节奏和别的演示一致。
 */
.demo-table {
  box-sizing: border-box;
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
  white-space: nowrap;
}
/* 覆盖通用 `__box` 的 `inline-block` —— 两个格子要并排、垂直居中 */
.demo-table__box {
  display: inline-flex;
  align-items: center;
}
.demo-table__cell {
  padding: 1px 7px;
  border: 1px solid transparent;
  border-radius: 3px;
  animation-name: demo-table-cell;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  animation-play-state: paused;
}
/*
 * ⚠️ 选择器**必须带 `.demo-table__box >` 前缀**。
 *
 * 通用规则 `[class*='__box'] > [class*='__syntax']` 的特异性是 (0,2,0)
 * （两个属性选择器），比单类名 (0,1,0) 高 —— 不加前缀的话它那条
 * `transform: translateY(-50%)` 会盖过这里的 `translate(-50%, -50%)`，
 * 中间的 `|` 会**偏右半个字宽**（左边缘对齐到中线而不是中心对齐到中线）。
 */
.demo-table__box > .demo-table__syntax--m {
  left: 50%;
  transform: translate(-50%, -50%);
}
@keyframes demo-table-cell {
  /* 1–3：还看不出是表格，就是两段并排的文字 */
  0%,
  44% {
    border-color: transparent;
    background-color: transparent;
  }
  /* 4 渲染：格子浮出来，停住 */
  70%,
  100% {
    border-color: var(--nd-border);
    background-color: var(--nd-surface);
  }
}
/* demo-table-cell —— 悬停时跑起来 */
.tb-wrap:hover .demo-table__cell,
.tb:focus-visible + .demo-pop .demo-table__cell {
  animation-play-state: running;
}

/* ---------------------------------------------------------------- 11. 行内公式 */

/**
 * `x^2` → `$x^2$`（源码）→ `x²`（渲染）。
 *
 * 1. **`2` 从"基线上的大号"变成"抬起来的小号"**：`translateY(-5px) scale(0.72)`。
 *    不用 `vertical-align: super` —— 那是关键字，插值不了（和链接下划线
 *    不能用 `text-decoration` 是同一类理由）。
 * 2. **`^` 绝对定位，由 `2` 的 `margin-left` 让位**：`^` 不能进文档流，
 *    否则它淡出后左边会留一个洞；所以让 `2` 的 `margin-left` 从 4px 收到 0 ——
 *    两者同步，看起来就是 `^` 被吃掉、`2` 贴回 `x`。
 * 3. `$` 走通用标记的 `demo-syntax`。
 */
.demo-inline-math {
  box-sizing: border-box;
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
  white-space: nowrap;
}
.demo-inline-math__base {
  position: relative;
  display: inline-block;
}
.demo-inline-math__sup {
  display: inline-block;
  /* 以左下角为轴缩放：缩小后仍贴着 `x` 的基线，再整体抬起 */
  transform-origin: left bottom;
  animation-name: demo-inline-math-sup;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  animation-play-state: paused;
}
.demo-inline-math__caret {
  position: absolute;
  left: 100%;
  /*
   * ⚠️ **这 2px 是必须的** ✗ —— caret 是绝对定位贴在 `x` 右边（`left: 100%`），
   * 而终态里 `2` 的 `margin-left` 会收到 0 → **两者落在同一个位置** ✓
   * 设计上靠"caret 淡出"错开，但只要淡出还没走完，用户就会看到**字叠在一起** ✓
   * （用户截图：「那个 `^` 都和 `2` 叠一起了」）。
   *
   * 留 2px：哪怕动画停在中间帧，两个字形也不会真正压上 ✓。
   */
  margin-left: 2px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--nd-text-4);
  animation-name: demo-inline-math-caret;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  animation-play-state: paused;
}
@keyframes demo-inline-math-sup {
  /* 1–3：`^` 还在，`2` 站在基线上、和正文同号 */
  0%,
  58% {
    transform: translateY(0) scale(1);
    margin-left: 4px;
  }
  /*
   * 4 渲染：`^` 消失，`2` 缩小抬起、贴回 `x`。
   *
   * ⚠️ `margin-left` 收 **2px 而不是 0** —— 收成 0 的话，只要 caret 的淡出
   * 还没走完，`^` 和 `2` 就会**落在同一像素上** ✓（用户截图里那个重叠）。
   * 留 2px 的代价是终态 `x²` 有一丝缝 ✓，但换到"任何一帧都不重叠" ✓。
   */
  66%,
  100% {
    transform: translateY(-5px) scale(0.72);
    margin-left: 2px;
  }
}
@keyframes demo-inline-math-caret {
  /* `^` 是"被公式消化掉"的源码字符：整段可见，渲染态才消失 */
  0%,
  58% {
    opacity: 1;
  }
  66%,
  100% {
    opacity: 0;
  }
}
/* demo-inline-math-sup / demo-inline-math-caret —— 悬停时跑起来 */
.tb-wrap:hover .demo-inline-math__sup,
.tb:focus-visible + .demo-pop .demo-inline-math__sup,
.tb-wrap:hover .demo-inline-math__caret,
.tb:focus-visible + .demo-pop .demo-inline-math__caret {
  animation-play-state: running;
}

/* ---------------------------------------------------------------- 12. 块级公式 */

/**
 * 一行普通文字 `E = mc²` → ` ```math ` / ` ``` ` 围栏夹住它（源码）
 * → 围栏消失、公式变成**数学字体**（衬线斜体）居中（渲染）。
 *
 * 1. **围栏绝对定位在上下两端**，不参与布局 —— 和代码块演示同一条：
 *    围栏淡出后公式不会移位（否则会"空出去一行"）。
 * 2. **公式只切字体、不动字号**，`steps(1, end)` 卡在 44%/66% 两个整点上，
 *    和别的演示"标记露出 / 消失"的节奏对齐（`font-family` 插值不了，只能用 steps）。
 */
.demo-block-math {
  position: relative;
  box-sizing: border-box;
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  /*
   * ⚠️ **不能 `justify-content: center`** ✗ —— 它是**块级**内容，
   * 而上下两条围栏是**贴左**的（`left: 6px`）。
   * 居中的话"围栏在左、公式在中"自相矛盾 ✓（用户：「应该靠左而不是居中」）。
   *
   * 既有演示里的 `center` 是给**行内**内容的（h1/h2/列表/引用/链接）——
   * 那种情况下整行居中是对的 ✓。**块级**内容一律跟围栏对齐 ✓。
   */
  padding: 0 4px;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
}

/* 公式和围栏左对齐（围栏在 `left: 6px`，这里补上容器 4px 内边距的差） */
.demo-block-math__formula {
  margin-left: 2px;
}
.demo-block-math__formula {
  white-space: nowrap;
  animation-name: demo-block-math-font;
  animation-duration: 2.8s;
  animation-timing-function: steps(1, end);
  animation-fill-mode: forwards;
  animation-play-state: paused;
}
/* 围栏和代码块演示同号（11px 等宽），贴在公式上下两端 */
.demo-block-math__syntax {
  position: absolute;
  left: 6px;
  font: 400 11px/1 ui-monospace, Consolas, monospace;
  letter-spacing: -0.03em;
}
/* 2px 而不是 0：围栏 10px 高、公式居中约 16px，44px 的画布里
   2 + 10 + 16 + 10 + 2 = 40，刚好放得下且不互相压。 */
.demo-block-math__syntax--open { top: 2px; }
.demo-block-math__syntax--close { bottom: 2px; }
@keyframes demo-block-math-font {
  0%, 44% { font-family: system-ui, sans-serif; font-style: normal; }
  66%, 100% {
    font-family: 'Cambria Math', 'STIX Two Math', 'Times New Roman', serif;
    font-style: italic;
  }
}
/* demo-block-math-font —— 悬停时跑起来 */
.tb-wrap:hover .demo-block-math__formula,
.tb:focus-visible + .demo-pop .demo-block-math__formula {
  animation-play-state: running;
}

/* ---------------------------------------------------------------- 13. 嵌入 */

/**
 * `哔哩哔哩 · 视频` 一行普通文字 → ` ```embed bilibili ` 围栏夹住它（源码）
 * → 落成一张**占位卡**（播放图标 + 标题，渲染）。
 *
 * 1. **卡片常驻，只在渲染态浮出边框和底色**（只动 `border-color` / `background-color`）
 *    —— 和表格格子同一招，尺寸全程不变。
 * 2. **播放图标始终占位、只淡入**：不进文档流就不会把标题推走
 *    （和列表标记同一条：标记出现时文字不许动）。
 * 3. 围栏绝对定位在上下两端，理由同块级公式。
 *
 * ⚠️ 演示里的 ` ```embed bilibili ` **只写了 provider**（没写 kind/id）——
 * 44px 的画布塞不下完整的一行（`embed bilibili video BV1xx411c7mD` 要 200px+）。
 * 卡片上的「哔哩哔哩 · 视频」是渲染后的结果，正好补上 kind 的信息。
 */
.demo-embed {
  position: relative;
  box-sizing: border-box;
  width: 120px;
  height: 44px;
  display: flex;
  align-items: center;
  /* 同上：块级内容跟围栏对齐，不居中 ✓ */
  padding: 0 4px;
  overflow: hidden;
  font: 13px/1.5 system-ui, sans-serif;
  color: var(--nd-text);
}
.demo-embed__card {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  /*
   * 上下内边距只给 1px：卡片居中后高约 20px，44px 的画布上下各剩 12px，
   * 正好够 10px 高的围栏站（围栏在 `top: 2px` / `bottom: 2px`）。
   * 给到 2px 卡片就有 22px 高，会和上围栏压 1px。
   */
  padding: 1px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  animation-name: demo-embed-card;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  animation-play-state: paused;
}
.demo-embed__icon {
  flex: none;
  font-size: 10px;
  line-height: 1;
  color: var(--nd-brand);
  animation-name: demo-embed-icon;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: forwards;
  animation-play-state: paused;
}
.demo-embed__label {
  font-size: 11px;
  white-space: nowrap;
}
/* 围栏：` ```embed bilibili ` 比代码块的 ` ```yaml ` 长，字号收到 10px 才塞得下 */
.demo-embed__syntax {
  position: absolute;
  left: 6px;
  font: 400 10px/1 ui-monospace, Consolas, monospace;
  letter-spacing: -0.03em;
}
.demo-embed__syntax--open { top: 2px; }
.demo-embed__syntax--close { bottom: 2px; }
@keyframes demo-embed-card {
  /* 1–3：还看不出是卡片，就是一行文字 */
  0%,
  44% {
    border-color: transparent;
    background-color: transparent;
  }
  /* 4 渲染：卡片浮出来，停住 */
  70%,
  100% {
    border-color: var(--nd-border);
    background-color: var(--nd-surface);
  }
}
@keyframes demo-embed-icon {
  /* 播放图标只在渲染态出现 —— 源码态它就是一行普通文字 */
  0%,
  58% {
    opacity: 0;
  }
  70%,
  100% {
    opacity: 1;
  }
}
/* demo-embed-card / demo-embed-icon —— 悬停时跑起来 */
.tb-wrap:hover .demo-embed__card,
.tb:focus-visible + .demo-pop .demo-embed__card,
.tb-wrap:hover .demo-embed__icon,
.tb:focus-visible + .demo-pop .demo-embed__icon {
  animation-play-state: running;
}

/* ---------------------------------------------------------------- 降低动效偏好 */

/**
 * 和站里其它组件（`PageSkeleton` / `index.vue` / `app.vue` 的页面过渡）一样尊重这条设置：
 * 状态**照样会变**，只是不再补间。
 *
 * 每段演示各自的这一块**合并在这里**（原来散在 9 个文件里，是同一个查询写 9 遍）。
 * 每一条都是"停掉动画、直接呈现**效果态**"，而不是回到原样 —— 演示的意义就是让人
 * 看见"用了这个按钮之后长什么样"，静止不动时停在原样等于什么都没演。
 */
@media (prefers-reduced-motion: reduce) {
  /*
   * ⚠️ **必须先把悬停时挂上去的动画整个拦掉。**
   *
   * 动画现在是**常驻声明 + 默认 `paused`**（见上面那节），所以这里
   * 只要保证它**永远不跑**就行 —— 不用再跟 `:hover` 那条规则抢特异性。
   * 下面那些 `.demo-xxx { animation: none; ... }` 负责把画面**直接摆到第 4 拍**。
   */
  .demo-stage * {
    animation-play-state: paused !important;
  }

  /* 工具栏本身：展开输入行、按钮压暗都变成瞬间生效 */
  .tb,
  .link-slot,
  .link-input { transition: none; }

  /* 卡片：补间没了，但**那 400ms 的延迟还在** ——
     `transition-delay` 是"停一下才弹"这个交互本身，不是动效；
     只把时长清零，延迟照旧。 */
  .demo-pop { transition-duration: 0s; }

  /*
   * 0. 镜头和"缩小"：全部停掉，回到原尺寸。
   *
   * 这两样是**运镜**，不是信息 —— 停掉它们不影响"这个按钮干什么"的理解。
   * 观众在这里要的是**第 4 拍的结果**，中间过程可以省。
   */
  .demo-cam { animation: none; transform: none; }
  .demo-bold,
  .demo-bullet__line,
  .demo-ordered__line,
  .demo-quote,
  .demo-link,
  .demo-undo__text,
  .demo-redo__text,
  .demo-code-block__win { animation: none; transform: none; }

  /*
   * 语法标记：停在**已消失**（= 第 4 拍）。
   * 标记属于"过程"，结果里没有它们 —— 所以是 `opacity: 0` 而不是 `1`。
   */
  [class*='__syntax'] { animation: none; opacity: 0; }

  /* 1. 加粗：停在最粗，而不是回到 400 */
  .demo-bold { animation: none; font-weight: 700; }

  /* 2. 斜体：停在倾斜态 */
  .demo-italic__text { animation: none; transform: skewX(-12deg); }

  /* 3. 行内代码：等宽 + 灰底边框都长满 */
  .demo-inline-code__chip {
    animation: none;
    font-family: ui-monospace, Consolas, monospace;
  }
  .demo-inline-code__chip::before {
    animation: none;
    inset: -4px -8px;
    opacity: 1;
    border-radius: var(--nd-radius-sm);
    border-color: var(--nd-border);
  }

  /* 4. 标题：停在各自那一档 */
  .demo-h1__word,
  .demo-h2__word,
  .demo-h3__word { animation: none; font-weight: 600; }
  .demo-h1__word { font-size: 22px; }
  .demo-h2__word { font-size: 18px; }
  .demo-h3__word { font-size: 15px; }

  /* 5. 列表：标记可见 + 文字已让位 */
  .demo-bullet__text,
  .demo-ordered__text { animation: none; transform: translateX(var(--demo-shift)); }
  .demo-bullet__marker,
  .demo-ordered__marker { animation: none; opacity: 1; transform: translateX(0); }

  /* 6. 引用：竖条长满 + 文字已右移变灰 */
  .demo-quote__bar { animation: none; transform: scaleY(1); }
  .demo-quote__text { animation: none; color: var(--nd-text-3); }

  /* 7. 链接：蓝字 + 完整下划线 */
  .demo-link__text { animation: none; color: var(--nd-brand); }
  .demo-link__text::after { animation: none; transform: scaleX(1); }

  /* 8. 代码块：停在渲染态（窗口展开、围栏消失） */
  .demo-code-block__win {
    animation: none;
    border-color: var(--nd-border);
    background-color: var(--nd-surface);
  }
  .demo-code-block__bar {
    animation: none;
    opacity: 1;
    visibility: visible;
    box-shadow: inset 0 -1px 0 var(--nd-border);
  }
  /*
   * 围栏停在"已消失"（= 渲染态）。
   *
   * 它现在走通用标记的 `demo-syntax`，0% 本来就是 `opacity: 0`；这里显式写一遍
   * 是为了不依赖那个约定 —— 上面那条 `.demo-stage * { animation-play-state: paused
   * !important }` 会把所有动画冻在 0%。
   */
  .demo-code-block__syntax {
    animation: none;
    opacity: 0;
  }

  /* 9. 撤销停在"词被划掉"、重做停在"词已出现" */
  .demo-undo__word {
    animation: none;
    color: var(--nd-text-4);
    opacity: 0.45;
    background-size: 100% 1.5px;
  }
  .demo-redo__word {
    animation: none;
    color: var(--nd-text);
    opacity: 1;
    background-size: 0% 1.5px;
  }

  /* 10. 表格：格子边框长满（三个 `|` 已消失，走通用 `__syntax` 那条） */
  .demo-table__cell {
    animation: none;
    border-color: var(--nd-border);
    background-color: var(--nd-surface);
  }

  /* 11. 行内公式：`^` 消失、`2` 已经抬起来贴回 `x` */
  .demo-inline-math__sup {
    animation: none;
    transform: translateY(-5px) scale(0.72);
    margin-left: 0;
  }
  .demo-inline-math__caret { animation: none; opacity: 0; }

  /* 12. 块级公式：公式切到数学字体（围栏走通用 `__syntax`，已停在消失） */
  .demo-block-math__formula {
    animation: none;
    font-family: 'Cambria Math', 'STIX Two Math', 'Times New Roman', serif;
    font-style: italic;
  }

  /* 13. 嵌入：卡片浮出、播放图标可见 */
  .demo-embed__card {
    animation: none;
    border-color: var(--nd-border);
    background-color: var(--nd-surface);
  }
  .demo-embed__icon { animation: none; opacity: 1; }
}
</style>
