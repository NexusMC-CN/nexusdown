/**
 * 链接 / 图片 / 自动链接（参考文档 4.6 + 4.8 节）。**本项目最复杂的一个装饰器。**
 *
 * 覆盖的形态（`@lezer/markdown` 1.7.2 实测树形见每个分支的注释）：
 *
 *   1. `[文字](url)`      行内链接      → Link 节点，4 个 LinkMark
 *   2. `![alt](src)`      图片          → Image 节点，4 个 LinkMark
 *   3. `<https://x>`      尖括号自动链接 → Autolink 节点
 *   4. `https://x.com`    裸 GFM 自动链接 → 裸 URL 节点（**没有外层节点**）
 *   5. `[文字][label]`    完整引用式     → Link 节点，2 个 LinkMark + LinkLabel
 *   6. `[label]`          快捷引用式     → Link 节点，2 个 LinkMark
 *
 * 三个关键设计（都是**故意不照抄 silkdown** 的地方）：
 *
 * - **URL 白名单必须在渲染前过滤**：被拒时**什么都不做**（源码原样显示），
 *   绝不出现「语法被藏了、但没变成链接」的半渲染状态。
 * - **揭示态是「变灰」不是「隐藏」**：光标在链接行时 `[`、`]`、`(`、`)`、URL
 *   全部留在文本流里（`MUTED_MARK`），文字仍然带 `.nd-link`。
 * - **点击不用 widget**：链接文字保持真实可编辑文本，靠
 *   `Decoration.mark({ attributes: { 'data-href' } })` + 全局 click handler，
 *   **只有 `Cmd/Ctrl` 才跳转** —— 这样「点一下想改字」和「点一下想跳转」不打架。
 */
import type { EditorSelection, Text } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

import type { DecorationRanges, LinkReferences, MarkdownNode, UrlPolicy } from '../types.js'
import { defaultUrlPolicy } from '../url.js'
import { selectionTouchesLineRange } from '../util/selection.js'
import { children, firstChildNamed } from '../util/tree.js'
import { ImageWidget } from '../widgets/image.js'
import { HIDE, MUTED_MARK, pushAtomicRange } from './shared.js'

/** 一个链接/图片被拆出来的坐标。 */
interface LinkParts {
  /** 整个节点的区间。 */
  to: number
  /** 开头定界符（`[` / `![` / `<`）的区间；裸自动链接没有，为 -1。 */
  openFrom: number
  openTo: number
  /** 链接文字 / 图片 alt 的区间。 */
  textFrom: number
  textTo: number
  /** 尾部语法的起点（`](url)` / `][label]` / `]` / `>` 的第一个字符）。 */
  tailFrom: number
  /** URL 子节点区间；引用式/快捷式为 -1（URL 要去 references 里查）。 */
  urlFrom: number
  urlTo: number
  /** 引用式/快捷式的 label（已规范化）；行内式为 `''`。 */
  label: string
}

/**
 * 把节点拆成「开头定界符 / 文字 / 尾部语法 / URL」四段。
 *
 * ⚠️ 链接文字**不是子节点**，是夹在定界符之间的裸文本 —— 所以坐标只能靠
 * `LinkMark` 反推，不能靠 `children()` 里找 text。
 */
function parseLink(node: MarkdownNode, doc: Text): LinkParts | null {
  const from = node.from
  const to = node.to

  if (node.name === 'Autolink') {
    // `<https://x.com>`：LinkMark(`<`) + URL + LinkMark(`>`)
    const url = firstChildNamed(node, 'URL')
    if (!url) return null
    return {
      to,
      openFrom: from,
      openTo: url.from,
      textFrom: url.from,
      textTo: url.to,
      tailFrom: url.to,
      urlFrom: url.from,
      urlTo: url.to,
      label: '',
    }
  }

  if (node.name === 'URL') {
    // GFM 裸自动链接：`https://x.com` 直接写在正文里，节点自己就是 URL，
    // 没有定界符，整段都是链接文字。
    return {
      to,
      openFrom: -1,
      openTo: -1,
      textFrom: from,
      textTo: to,
      tailFrom: to,
      urlFrom: from,
      urlTo: to,
      label: '',
    }
  }

  // Link / Image
  const marks: MarkdownNode[] = []
  for (const child of children(node)) {
    if (child.name === 'LinkMark') marks.push(child)
  }
  // `[文字](url)` 是 4 个（`[` `]` `(` `)`），`[文字][label]` / `[label]` 是 2 个（`[` `]`）。
  // 少于 2 个说明树形和预期不符 —— 放弃，不猜。
  if (marks.length < 2) return null

  const open = marks[0]
  const closeBracket = marks[1]
  const textFrom = open.to
  const textTo = closeBracket.from
  const tailFrom = closeBracket.from

  const url = firstChildNamed(node, 'URL')
  if (url) {
    return {
      to,
      openFrom: open.from,
      openTo: open.to,
      textFrom,
      textTo,
      tailFrom,
      urlFrom: url.from,
      urlTo: url.to,
      label: '',
    }
  }

  const label = firstChildNamed(node, 'LinkLabel')
  if (label) {
    // `[文字][label]`：URL 在定义行里，靠 label 去 references 查。
    return {
      to,
      openFrom: open.from,
      openTo: open.to,
      textFrom,
      textTo,
      tailFrom,
      urlFrom: -1,
      urlTo: -1,
      label: normalizeLabel(labelText(doc, label)),
    }
  }

  // `[label]` 快捷引用式：文字本身就是 label。
  return {
    to,
    openFrom: open.from,
    openTo: open.to,
    textFrom,
    textTo,
    tailFrom,
    urlFrom: -1,
    urlTo: -1,
    label: normalizeLabel(doc.sliceString(textFrom, textTo)),
  }
}

/** `[label]` → `label`。 */
function labelText(doc: Text, labelNode: MarkdownNode): string {
  let text = doc.sliceString(labelNode.from, labelNode.to)
  if (text.startsWith('[')) text = text.slice(1)
  if (text.endsWith(']')) text = text.slice(0, -1)
  return text
}

/** CommonMark 的引用标签匹配规则：折叠空白 + 大小写不敏感。 */
function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 尖括号包裹的目标（`[x](<https://a.com/a b>)` 的 URL 节点含 `<>`）。 */
function stripAngleBrackets(url: string): string {
  return url.length >= 2 && url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url
}

/**
 * 引用式链接的定义表：`label → url`。
 *
 * ★ 这里**故意不照抄 silkdown**（参考文档坑 ④）：它在每次重建都全量遍历语法树，
 *   大文档里是热点。本实现的取舍是：
 *
 *   1. **按需才扫** —— 只有真的遇到引用式/快捷式链接（行内没有 URL 子节点）时
 *      才会调用。纯行内链接 `[x](url)` 一个字符都不扫。
 *   2. **按 `Text` 实例缓存** —— `Text` 是不可变的：光标移动 / 选区变化时
 *      `state.doc` 是**同一个对象**，WeakMap 直接命中；只有真正改动了文档才会
 *      产生新对象、缓存自然失效。WeakMap 也保证不会泄漏。
 *      （silkdown 连「只移动光标」都会重扫一遍，这里不会。）
 *
 * 代价：扫的是**行文本**而不是语法树 —— 装饰器只拿得到 `doc`，拿不到 `state`，
 * 所以 `syntaxTree(state)` 在这里不可用。因此做了两条最小防护：跳过围栏代码块
 * 内部的行；只认「整行就是一个定义」的形状。多行定义（URL 或标题换行）不认。
 */
const REFERENCE_CACHE = new WeakMap<Text, LinkReferences>()
const DEFINITION_RE = /^ {0,3}\[([^\]]+)\]:[ \t]*(\S+)/
const FENCE_RE = /^(```+|~~~+)/

function referencesFor(doc: Text, provided: LinkReferences | undefined): LinkReferences | undefined {
  if (provided) return provided
  const cached = REFERENCE_CACHE.get(doc)
  if (cached) return cached
  const built = collectReferenceDefinitions(doc)
  REFERENCE_CACHE.set(doc, built)
  return built
}

function collectReferenceDefinitions(doc: Text): LinkReferences {
  const map = new Map<string, string>()
  let fence: string | null = null

  for (const line of doc.iterLines()) {
    const fenceMatch = FENCE_RE.exec(line.trimStart())
    if (fenceMatch) {
      // 只记围栏的种类（``` 还是 ~~~），用同一种围栏才能闭合。
      if (fence === null) fence = fenceMatch[1][0]
      else if (fence === fenceMatch[1][0]) fence = null
      continue
    }
    if (fence !== null) continue

    const match = DEFINITION_RE.exec(line)
    if (!match) continue
    const label = normalizeLabel(match[1])
    // 先出现者优先（CommonMark：重复定义只认第一个）。
    if (!map.has(label)) map.set(label, match[2])
  }

  return map
}

/**
 * 带 `data-href` 的链接 mark。
 *
 * ⚠️ 这里**不能**用一个模块级单例 —— href 各不相同。改成按 href 缓存：
 * 同一个 URL 反复重建时拿到的仍是同一个 `Decoration` 实例，
 * CM 的 RangeSet diff 才能复用 DOM。
 */
const LINK_MARK_CACHE = new Map<string, Decoration>()
const LINK_MARK_CACHE_LIMIT = 512

function linkMark(href: string): Decoration {
  const cached = LINK_MARK_CACHE.get(href)
  if (cached) return cached

  const mark = Decoration.mark({ class: 'nd-link', attributes: { 'data-href': href } })
  // 缓存只是为了 DOM 复用；超过上限直接清空，避免长会话里无限增长。
  if (LINK_MARK_CACHE.size >= LINK_MARK_CACHE_LIMIT) LINK_MARK_CACHE.clear()
  LINK_MARK_CACHE.set(href, mark)
  return mark
}

/** 揭示态：把两段语法**变灰**（而不是藏掉），文字留在原地。 */
function muteSyntax(ranges: DecorationRanges, parts: LinkParts): void {
  if (parts.openFrom >= 0 && parts.openTo > parts.openFrom) {
    ranges.push(MUTED_MARK.range(parts.openFrom, parts.openTo))
  }
  if (parts.tailFrom < parts.to) {
    ranges.push(MUTED_MARK.range(parts.tailFrom, parts.to))
  }
}

export function decorateLink(
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
  references: LinkReferences | undefined,
  urlPolicy: UrlPolicy | undefined,
): void {
  const name = node.name
  if (name !== 'Link' && name !== 'Image' && name !== 'Autolink' && name !== 'URL') return

  const parts = parseLink(node, doc)
  if (!parts) return

  const rawUrl =
    parts.urlFrom >= 0
      ? stripAngleBrackets(doc.sliceString(parts.urlFrom, parts.urlTo))
      : referencesFor(doc, references)?.get(parts.label)

  // ⚠️ GFM 裸自动链接（节点名就是 `URL`）**额外要求显式 `http(s)://`**：
  //    lezer 也会把 `www.x.com`、`a@b.com` 认成裸 URL，但这些文本不是作者手写的
  //    链接目标 —— 直接当「无 scheme 的相对路径」放行会得到 `.../www.x.com`
  //    这种**错误**的 href。与其给出一个错链接，不如不给（保持默认拒绝）。
  if (name === 'URL' && rawUrl !== undefined && !/^https?:\/\//i.test(rawUrl)) return

  // ★ 白名单过滤必须在**渲染前**做。被拒时什么都不做 —— 源码原样显示，
  //   不会出现「藏了语法但没变成链接」的半渲染状态。
  const href = rawUrl === undefined ? null : (urlPolicy ?? defaultUrlPolicy)(rawUrl)
  if (!href) return

  const revealed = selectionTouchesLineRange(doc, selection, node.from, node.to)

  if (name === 'Image') {
    if (revealed) {
      // 揭示态：显示 `![alt](src)` 源码（变灰），光标能进去改 alt / src。
      muteSyntax(ranges, parts)
      return
    }
    const alt = doc.sliceString(parts.textFrom, parts.textTo)
    // ⚠️ 图片节点是单行的，所以整节点 replace 不会跨行。
    //    `Decoration` 每次新建没问题：`ImageWidget.eq()` 让 CM 认出等值、复用 DOM。
    pushAtomicRange(ranges, atomicRanges, Decoration.replace({ widget: new ImageWidget(href, alt) }), node.from, node.to)
    return
  }

  if (revealed) {
    muteSyntax(ranges, parts)
  } else {
    // 非揭示态：`[` 和 `](url)` 两段**分别** HIDE。
    if (parts.openFrom >= 0 && parts.openTo > parts.openFrom) {
      pushAtomicRange(ranges, atomicRanges, HIDE, parts.openFrom, parts.openTo)
    }
    if (parts.tailFrom < node.to) {
      pushAtomicRange(ranges, atomicRanges, HIDE, parts.tailFrom, node.to)
    }
  }

  // 文字段两种状态都加 `.nd-link`（+ `data-href`）。
  if (parts.textFrom < parts.textTo) {
    ranges.push(linkMark(href).range(parts.textFrom, parts.textTo))
  }
}

/**
 * 链接点击：**不用 widget**，全局 click handler + `data-href`。
 *
 * 链接文字保持**真实可编辑文本**，所以「点一下想改字」（普通点击 → 交还给 CM
 * 做光标定位）和「点一下想跳转」（Cmd/Ctrl + 点击）不会打架。
 */
export const linkClickHandler = EditorView.domEventHandlers({
  click(event) {
    if (!event.metaKey && !event.ctrlKey) return false

    const target = event.target
    const link = target instanceof Element ? target.closest('[data-href]') : null
    const href = link?.getAttribute('data-href')
    if (!href) return false

    window.open(href, '_blank', 'noopener,noreferrer')
    event.preventDefault()
    return true
  },
})
