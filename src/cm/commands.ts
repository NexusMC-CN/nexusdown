/**
 * 工具栏用的 Markdown 编辑命令（CodeMirror 6）。
 *
 * ## 为什么这个文件在库里，而不是在应用里
 *
 * 这些命令**只改文档、不画 UI** —— 是纯粹的**方言知识**
 * （`Mod-b` 加粗加的是 `**`、列表标记是 `- `、代码块是围栏…）。
 *
 * 所以它属于 nexusdown：**工具栏按钮和快捷键必须做同一件事**，
 * 那就不该有两份实现。以前它在应用里（`app/utils/cm-markdown.ts`），
 * 而 `shortcuts.ts` 里**另有一份逐字相同的 `toggle()`** —— 改一边另一边不会知道。
 * 现在实现在这里，`shortcuts.ts` 只负责把命令绑到键上。
 *
 * ⚠️ **历史教训**（留着，别再犯）：这份代码曾经是应用的副本，因为
 * `nexusdown/cm` 当时**没把这些命令导出**。判据是"改了它会不会导致
 * 编辑器行为不一致"—— 会，那就必须只有一份。
 *
 * ## 块级那几条是新代码
 *
 * 标题 / 列表 / 引用 / 代码块 / 链接在 `shortcuts.ts` 里**本来就没有**
 * （那边只有 `Mod-b` / `Mod-i` / `` Mod-` `` / Enter 续列表），写在哪儿都是新写的。
 * 后来加的表格 / 行内公式 / 块级公式 / 嵌入同理 —— 它们**只服务工具栏按钮**
 * （用户不知道这几个扩展的语法怎么写，按钮负责把骨架落下来），没有快捷键。
 *
 * ## 全部命令都走 `changeByRange`
 *
 * 和上游同一条约定：每个选区**各算各的**，绝不用 `view.dispatch({ changes })` 一把梭 ——
 * 后者在多光标下只有第一个选区是对的。
 *
 * ## 撤销粒度
 *
 * dispatch 一律带 `userEvent: 'format.nexusdown'`。CM6 的 history 按 `userEvent`
 * **前缀**分组，`format.*` 和 `input.*` 会分成独立的 undo step ——
 * 所以「加粗 → 打字 → 撤销」只撤销打字，不会把加粗一起撤掉。
 */
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state'
import type { Command } from '@codemirror/view'

/**
 * `SyntaxNode` 来自 `@lezer/common`，而它**不是本站的直接依赖**
 * （pnpm 严格布局下从项目根解析不到，`require.resolve` 报 MODULE_NOT_FOUND）。
 * 所以不写 import，直接从 `Tree.resolveInner` 的返回类型**推导**出来。
 */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>

/** 一条文本改动。`insert` 为空串即删除。 */
interface Edit {
  from: number
  to: number
  insert: string
}

/** 一个选区的改动结果：`changes` 用**原文档**坐标，`range` 用**改动后**坐标。 */
interface RangeEdit {
  changes: Edit[]
  range: SelectionRange
}

/**
 * 把**原文档**坐标映射到改动后的坐标。
 *
 * 块级命令一次要改好几行，没法像上游那样手算偏移（`from + marker.length` 那种），
 * 所以统一走这个映射。前提：`edits` 已按 `from` 升序且互不重叠 ——
 * 本文件所有命令都满足（每行至多一条改动，按行号遍历）。
 *
 * 落在「被替换区间内部」的位置（比如光标正好在要被删掉的 `## ` 中间）
 * 贴到替换结果的**末尾** —— 不这么做的话会得到负数或越界的位置。
 */
function mapPos(pos: number, edits: readonly Edit[]): number {
  let delta = 0
  for (const e of edits) {
    if (e.to <= pos) delta += e.insert.length - (e.to - e.from)
    else if (e.from < pos) return e.from + delta + e.insert.length
    else break
  }
  return pos + delta
}

/* ==========================================================================
 * 行内标记 —— nexusdown/src/cm/shortcuts.ts 的移植
 * ========================================================================== */

/** 定界符节点名：`*` 和 `**` 都是 `EmphasisMark`，行内代码是 `CodeMark`。 */
const MARKER_NODES: ReadonlySet<string> = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark'])

interface ToggleSpec {
  /** 目标语法节点名。 */
  readonly node: string
  /** 包裹用的定界符。 */
  readonly marker: string
}

const STRONG: ToggleSpec = { node: 'StrongEmphasis', marker: '**' }
const EM: ToggleSpec = { node: 'Emphasis', marker: '*' }
const CODE: ToggleSpec = { node: 'InlineCode', marker: '`' }

/**
 * 找「已经包住 `[from, to]` 的 `name` 节点」—— 这就是「已在节点内」的判定。
 *
 * `resolveInner(from, 1)`：取 `from` 处**最内层**的节点。`side = 1` 让「正好落在
 * 节点起点」时优先解析进节点内部 —— 否则光标停在 `**` 左边（`from` 等于
 * `StrongEmphasis.from`）时会解析成上一个节点，判不出「已经在粗体里」。
 *
 * 往上爬时必须同时要求 `node.from <= from && node.to >= to`：只认名字的话，
 * 光标在 `**bold**` 之后（同一段落里）也会命中祖先里的 `StrongEmphasis`。
 */
function enclosingNode(state: EditorState, from: number, to: number, name: string): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    if (node.name === name && node.from <= from && node.to >= to) return node
  }
  return null
}

/** 节点的首尾定界符（`**` / `*` / `` ` ``）。取不到两个就返回 null。 */
function delimiters(node: SyntaxNode): { open: SyntaxNode; close: SyntaxNode } | null {
  let open: SyntaxNode | null = null
  let close: SyntaxNode | null = null
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!MARKER_NODES.has(child.name)) continue
    if (!open) open = child
    close = child
  }
  return open && close && open !== close ? { open, close } : null
}

/** 解包：删掉节点自己的首尾定界符，选区落到剩下的内容上。 */
function unwrap(node: SyntaxNode): RangeEdit | null {
  const marks = delimiters(node)
  if (!marks) return null
  const openLength = marks.open.to - marks.open.from

  return {
    changes: [
      { from: marks.open.from, to: marks.open.to, insert: '' },
      { from: marks.close.from, to: marks.close.to, insert: '' },
    ],
    // 新坐标：开头被删掉 openLength 个字符，内容整体左移同样的距离。
    range: EditorSelection.range(marks.open.from, marks.close.from - openLength),
  }
}

/** 包裹：在 `from` 和 `to` 各插一个定界符，选区跟着右移。 */
function wrap(from: number, to: number, marker: string): RangeEdit {
  return {
    changes: [
      { from, to: from, insert: marker },
      { from: to, to, insert: marker },
    ],
    range: EditorSelection.range(from + marker.length, to + marker.length),
  }
}

function toggle(spec: ToggleSpec): Command {
  return (view) => {
    const { state } = view

    const changes = state.changeByRange((range) => {
      // 光标/选区已经在这个节点里 → 解包。
      const inside = enclosingNode(state, range.from, range.to, spec.node)
      if (inside) return unwrap(inside) ?? { range }

      // 有选区 → 直接包。
      if (!range.empty) return wrap(range.from, range.to, spec.marker)

      // 无选区 → 先试着扩展到光标所在的词。
      const word = state.wordAt(range.head)
      if (word) return wrap(word.from, word.to, spec.marker)

      // 空白处 → 插一对定界符，光标停在正中间，接着打字就是加粗内容。
      return {
        changes: { from: range.head, to: range.head, insert: spec.marker + spec.marker },
        range: EditorSelection.cursor(range.head + spec.marker.length),
      }
    })

    // 一个选区都没改动（比如解包时节点里没有定界符子节点）→ 不产生空事务。
    if (changes.changes.empty) return false

    view.dispatch({ ...changes, userEvent: 'format.nexusdown' })
    return true
  }
}

/** 粗体：包裹 / 解包 `**`。与编辑器自带的 `Mod-b` 是同一套逻辑。 */
export const toggleBold = toggle(STRONG)

/** 斜体：包裹 / 解包 `*`。与编辑器自带的 `Mod-i` 是同一套逻辑。 */
export const toggleItalic = toggle(EM)

/** 行内代码：包裹 / 解包 `` ` ``。与编辑器自带的 `` Mod-` `` 是同一套逻辑。 */
export const toggleInlineCode = toggle(CODE)

/* ==========================================================================
 * 行内公式
 * ========================================================================== */

/**
 * 行内公式：插一对 `$` 定界符（契约：`docs/dialect-extensions.md` 第 2 节）。
 *
 * - 空白处 → 插 `$$` 并把光标放在**两个 `$` 中间**，接着打字就是 `$公式$` ——
 *   和「加粗」在空白处的行为一致（插一对定界符、光标居中）；
 * - 有选区 → 用 `$` 把选区包起来。
 *
 * ⚠️ 它**不是 toggle**：按钮属于「插入」类，没有 `kind`（不会点亮 `aria-pressed`），
 * 所以这里只负责落定界符，不做「已在公式里就解包」那套。
 *
 * ⚠️ 为什么两个 `$` 中间必须打字：契约规定 `$$…$$` **不是**行内公式（块级走围栏），
 * `math.ts` 的扫描器遇到 `$$` 会直接跳过 —— 所以光标停在 `$|$` 之间时，
 * 那对定界符是惰性的，不会把周围文字误判成公式。
 */
export const insertInlineMath: Command = (view) => {
  const { state } = view

  const changes = state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.head, to: range.head, insert: '$$' },
        range: EditorSelection.cursor(range.head + 1),
      }
    }
    const tex = state.sliceDoc(range.from, range.to)
    return {
      changes: { from: range.from, to: range.to, insert: '$' + tex + '$' },
      // 包完两个 `$` 之后，正文整体右移 1 格。
      range: EditorSelection.range(range.from + 1, range.to + 1),
    }
  })

  if (changes.changes.empty) return false

  view.dispatch({ ...changes, userEvent: 'format.nexusdown' })
  return true
}

/* ==========================================================================
 * 块级 —— 行首前缀
 * ========================================================================== */

/**
 * 行首前缀拆成三段：缩进 / 引用标记 / 块标记（标题或列表）。
 *
 * 拆开是为了「只翻其中一段」：点 H2 时不该把行首的 `> ` 一起吃掉
 * （`> ## 标题` 是合法的），点引用时也不该把 `- ` 弄丢。
 *
 * ⚠️ 列表标记**要求后面跟空白**（`- foo` 而不是 `-foo`）—— 这是 CommonMark 的规则，
 * 而且不这么写的话，`-` 开头的普通句子会被误判成列表项。
 */
const QUOTE_RE = /^(?:>[ \t]?)+/
const BLOCK_RE = /^(?:#{1,6}[ \t]+|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/

interface LinePrefix {
  indent: string
  quote: string
  block: string
}

function parsePrefix(text: string): LinePrefix {
  const indent = /^[ \t]*/.exec(text)?.[0] ?? ''
  let rest = text.slice(indent.length)
  const quote = QUOTE_RE.exec(rest)?.[0] ?? ''
  rest = rest.slice(quote.length)
  const block = BLOCK_RE.exec(rest)?.[0] ?? ''
  return { indent, quote, block }
}

/** 要翻的那一段前缀。`quote` 只翻引用；`block` 只翻块标记。 */
type PrefixTarget = { readonly part: 'quote' } | { readonly part: 'block'; readonly marker: string }

function togglePrefix(target: PrefixTarget): Command {
  return (view) => {
    const { state } = view

    const changes = state.changeByRange((range) => {
      const first = state.doc.lineAt(range.from)
      const last = state.doc.lineAt(range.to)
      const edits: Edit[] = []

      for (let n = first.number; n <= last.number; n++) {
        const line = state.doc.line(n)
        const p = parsePrefix(line.text)
        const to = line.from + p.indent.length + p.quote.length + p.block.length

        const insert =
          target.part === 'quote'
            ? p.indent + (p.quote ? '' : '> ') + p.block
            : p.indent + p.quote + (p.block === target.marker ? '' : target.marker)

        // 已经是目标形态 → 不产生改动，避免制造空事务（空事务会污染撤销栈）。
        if (state.sliceDoc(line.from, to) === insert) continue
        edits.push({ from: line.from, to, insert })
      }

      if (!edits.length) return { range }
      return {
        changes: edits,
        range: EditorSelection.range(mapPos(range.anchor, edits), mapPos(range.head, edits)),
      }
    })

    if (changes.changes.empty) return false

    view.dispatch({ ...changes, userEvent: 'format.nexusdown' })
    return true
  }
}

/**
 * 标题：行首切换 `# ` / `## ` / `### `。
 *
 * - 已经是这一级 → 去掉（再点一次取消）
 * - 是别的级 → 换成这一级
 * - 不是标题 → 加上
 */
export function toggleHeading(level: 1 | 2 | 3): Command {
  return togglePrefix({ part: 'block', marker: '#'.repeat(level) + ' ' })
}

/** 无序列表：行首切换 `- `。 */
export const toggleBulletList = togglePrefix({ part: 'block', marker: '- ' })

/**
 * 有序列表：行首切换 `1. `。
 *
 * ⚠️ 统一用 `1. ` 而不是「按行号递增」—— Markdown 渲染器只认第一个数字，
 * 后面写 `1.` 还是 `7.` 渲染出来都一样；写递增数字反而让「在第 3 行前面插一行」
 * 变成要重排后面所有行。切换判据也因此只看「有没有 `1. `」。
 */
export const toggleOrderedList = togglePrefix({ part: 'block', marker: '1. ' })

/** 引用：行首切换 `> `。 */
export const toggleQuote = togglePrefix({ part: 'quote' })

/* ==========================================================================
 * 块级 —— 围栏（代码块 / 块级公式 / 嵌入）
 * ========================================================================== */

/**
 * 围栏命令工厂：用 `info` 当语言名插一对围栏。
 *
 * 代码块 / 块级公式 / 嵌入这三件事在**编辑动作**上逐字相同 ——
 * 都是「插一对围栏、光标停在里面」，区别只在开围栏那行的 `info`
 * （`` ``` `` / ```` ```math ```` / ```` ```embed ````）。所以共用这一个工厂，
 * 而不是抄三份。
 *
 * - 有选区 → 把选中的整行包进围栏里，选区仍落在原来的文字上；
 * - 无选区 → 插一个空围栏，**光标停在里面**，接着打字就是内容。
 *
 * ⚠️ 工厂在**模块加载时**就调用完（`wrapCodeBlock = wrapFence('')`），
 * 导出的仍然是现成的 `Command` 常量，不是工厂 —— 理由见下面 `wrapCodeBlock`
 * 那条注释里记的坑。
 */
function wrapFence(info: string): Command {
  const open = '```' + info + '\n'
  return (view) => {
    const { state } = view

    const changes = state.changeByRange((range) => {
      if (range.empty) {
        return {
          changes: { from: range.head, to: range.head, insert: open + '\n```' },
          // `open` 之后就是那个空行，光标落在这一行的行首。
          range: EditorSelection.cursor(range.head + open.length),
        }
      }

      const first = state.doc.lineAt(range.from)
      const last = state.doc.lineAt(range.to)
      const block = state.sliceDoc(first.from, last.to)

      return {
        changes: { from: first.from, to: last.to, insert: open + block + '\n```' },
        range: EditorSelection.range(first.from + open.length, first.from + open.length + block.length),
      }
    })

    if (changes.changes.empty) return false

    view.dispatch({ ...changes, userEvent: 'format.nexusdown' })
    return true
  }
}

/**
 * 代码块：用 ```` ``` ```` 包裹。
 *
 * ⚠️ 它和上面几条一样是**现成的 `Command` 常量**，不是工厂 ——
 * 统一成"不需要参数的写成常量、需要参数的才写成工厂（`toggleHeading` / `insertLink`）"，
 * 这样 `runCommand(x)` 的写法永远是对的。
 * （曾经写成 `() => Command` 工厂，结果工具栏那边写成了 `runCommand(wrapCodeBlock)`
 * —— 把工厂本身当命令传了进去，`view` 被当成 level 参数、返回一个没人调的 Command，
 * **按钮点了完全没反应，而且不报任何错**。实测验证脚本抓到的。）
 *
 * `wrapFence('')` 在加载时就求值完，所以这里**依然是常量**，那条约定没有破。
 */
export const wrapCodeBlock = wrapFence('')

/**
 * 块级公式：```` ```math ```` 围栏（契约：块级公式用围栏，**不用 `$$`**）。
 *
 * 骨架是三行（开围栏 / 空行 / 闭围栏），光标落在中间那行。
 * 编辑器侧不把 `math` 渲染成公式（`fence.ts` 一视同仁地当代码块画），
 * 真正变成 KaTeX 的是**渲染侧**（`src/render/features/math.ts`）——
 * 这不是遗漏，见 `src/cm/features/math.ts` 文件头。
 */
export const insertBlockMath = wrapFence('math')

/**
 * 嵌入：```` ```embed ```` 围栏（契约第 4 节，provider / kind / id 三段）。
 *
 * ⚠️ 这里只落一个**空骨架**（` ```embed ` + 空行 + ` ``` `），
 * **没有**填 `provider kind id` 占位 —— 因为那三段的具体取值由作者定
 * （B站/抖音/网易云各不同），骨架给不出通用默认值。
 * 后果是：光有这个骨架时 `parseEmbedFence` 解析不出 spec，会**降级成普通代码块**
 * （编辑器与渲染侧都是这个行为，见 `features/embed.ts` 的分流）。
 * 作者需要自己在开围栏那行补上三段；悬停卡片里的演示会展示完整的写法。
 */
export const insertEmbed = wrapFence('embed')

/* ==========================================================================
 * 表格
 * ========================================================================== */

/**
 * GFM 管道表骨架：两列表头 + 分隔行 + 一行空数据。
 *
 * 契约第 1 节：表格**不新增语法**，就是标准 GFM 管道表，所以这里只是把
 * 一段现成的源码落下来。两列是"够用就行"的默认值 —— 列数没有通用答案，
 * 作者在骨架里自己加 `|` 比我们猜一个更省事。
 *
 * 第三行写成 `|  |  |`（两个空格）而不是 `| | |`：CommonMark 把单元格内容
 * 两侧的空白去掉，两种写法都是"空单元格"，但空一格更看得出"这里能打字"。
 */
const TABLE_SKELETON = '| 列一 | 列二 |\n| --- | --- |\n|  |  |'

/** `列一` 在骨架里的区间 —— 光标（选区）落在这里。 */
const TABLE_CELL_START = TABLE_SKELETON.indexOf('列一')
const TABLE_CELL_END = TABLE_CELL_START + '列一'.length

/**
 * 表格：插入一个两列的 GFM 表骨架，光标落在**表头第一个单元格**里。
 *
 * ⚠️ 落在单元格里的是**选区**（选中占位字 `列一`），不是裸光标 ——
 * 和 `insertLink` 的「占位文字选中」同一套：接着打字就替换掉它，
 * 不然会在 `列一` 前面插入，得到 `新列一` 这种半截东西。
 *
 * 有选区时用骨架**替换**选区：表格没有"把选中内容包进去"的自然语义
 * （不像围栏能把选中行装进代码块），所以退化成"就地插入"。
 */
export const insertTable: Command = (view) => {
  const { state } = view

  const changes = state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: TABLE_SKELETON },
    range: EditorSelection.range(range.from + TABLE_CELL_START, range.from + TABLE_CELL_END),
  }))

  if (changes.changes.empty) return false

  view.dispatch({ ...changes, userEvent: 'format.nexusdown' })
  return true
}

/* ==========================================================================
 * 链接
 * ========================================================================== */

/**
 * 插入 `[文字](url)`。
 *
 * `href` 由调用方给（工具栏弹输入框问用户），这里只负责落字 ——
 * 命令层不去碰 UI，这样它还能被别的入口复用（比如以后做粘贴板识别）。
 *
 * - 有选区 → 选中的文字当链接文字；
 * - 无选区 → 填 `文字` 两个占位字，**并把它选中**，用户直接打字就能替换掉。
 *
 * ⚠️ 不校验 URL 合法性：`javascript:` 之类的危险协议由**渲染端**的
 * `urlPolicy` 兜（`nexusdown/render` 和 CM6 的链接装饰共用同一套白名单），
 * 在这里拦一遍只会让「先写文字、以后再补链接」这种正常操作被挡。
 */
export function insertLink(href: string): Command {
  return (view) => {
    const { state } = view
    const url = href.trim()
    if (!url) return false

    const changes = state.changeByRange((range) => {
      const label = range.empty ? '文字' : state.sliceDoc(range.from, range.to)
      const insert = `[${label}](${url})`
      return {
        changes: { from: range.from, to: range.to, insert },
        range: range.empty
          ? // 占位文字选中：接着打字就替换掉它
            EditorSelection.range(range.from + 1, range.from + 1 + label.length)
          : EditorSelection.cursor(range.from + insert.length),
      }
    })

    if (changes.changes.empty) return false

    view.dispatch({ ...changes, userEvent: 'input.nexusdown.link' })
    return true
  }
}

/* ==========================================================================
 * 提及
 * ========================================================================== */

/**
 * 选择器里的一条候选 —— **由消费方注入**。
 *
 * 和 `mathRenderer` / 渲染侧的 `RenderData` 是同一条边界：**库不查库**。
 * 「有哪些 slug 可提及」是消费方的事（要查资源表、要发请求），库只认
 * `@slug` 这个**语法**（`shared/mention.ts`）。所以候选从外面送进来，
 * 没送进来时按钮照样在（见 `Toolbar.vue` 的降级说明）。
 */
export interface MentionCandidate {
  /** 插进正文的 slug —— `@` 后面那串（契约 §8：`[a-z0-9][a-z0-9-]*`）。 */
  slug: string
  /** 展示名（选择器里显示，**不**进正文）。 */
  title: string
  /** 实体类型（`resource` / `post` …）。只用于展示，命令层与扫描器都不看它。 */
  kind: string
}

/**
 * 插入 `@slug`（契约 §8 的提及语法）。
 *
 * `slug` 由调用方给（工具栏弹选择器让用户挑），命令层只负责落字 ——
 * 和 `insertLink` 同一条：命令不碰 UI，才能被别的入口复用（快捷键、粘贴板识别…）。
 *
 * - 有选区 → 用 `@slug` **替换**选区。提及没有"把选中文字包进去"的自然语义
 *   （不像链接的 `[选中文字](url)`），所以退化成"就地插入"（同 `insertTable`）。
 * - `slug` 为空 → 落一个裸 `@`。这是工具栏**没注入候选**时的降级：
 *   编辑器侧的提及本来就是纯语法的（打 `@slug` 就渲染成胶囊，不查库），
 *   所以按钮退化成"给出语法的开头"，而不是禁用 —— 见 `Toolbar.vue`。
 *
 * ⚠️ **不校验 slug 合法性**（同 `insertLink` 不校验 URL）：真正认不认这个提及，
 * 由 `shared/mention.ts` 的扫描器判定。这里拦一遍只会让"先写 `@`、slug 以后再补"
 * 这种正常操作被挡住，而用户看到的是按钮没反应。
 */
export function insertMention(slug: string): Command {
  return (view) => {
    const { state } = view
    const insert = '@' + slug.trim()

    const changes = state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    }))

    if (changes.changes.empty) return false

    view.dispatch({ ...changes, userEvent: 'format.nexusdown' })
    return true
  }
}
