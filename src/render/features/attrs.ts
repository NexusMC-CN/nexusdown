/**
 * `attrs` —— 渲染侧把 `{…}` 属性行挂到**前一个块**上
 * （契约：`docs/dialect-extensions.md` §0）。
 *
 * ## 做什么
 *
 * 1. 找到「整段只有一个 `{…}`」的段落；
 * 2. 找到它前面那个块（列表 / 表格 / 围栏 / 引用）；
 * 3. 把属性挂到块的**打开 token** 上（`meta[ATTRS_META]` + `class`/`id`）；
 * 4. 把这一个段落从 token 流里删掉。
 *
 * ## 为什么挂在打开 token 上
 *
 * markdown-it 是**流式渲染**：`rules.table_open` 在 `table_close` 之前就执行了。
 * 属性挂到关闭 token 上，打开规则根本看不到。所以先向前找到匹配的 `*_open`。
 *
 * ## 只删「至少认出一个属性」的行
 *
 * 如果一行 `{…}` 里全是未知属性（拼错了 / 还没实现），**保留原文**并告警 ——
 * 静默吞掉用户写的东西是最难查的那种 bug（用户只看到"我写的一行没了"）。
 *
 * ## 阶段 2 的范围
 *
 * 本轮只做**管线 + 可见的少量变体**：
 *
 * - 列表：`.steps` / `.cards` → 加 `nd-steps` / `nd-cards` 类（视觉留给后续，两侧要一起做）；
 * - 表格：`.fields` → `nd-fields` 类；`caption="…"` → `<caption>`；
 * - 围栏：`title="…"` → 代码块标题栏的文件名；
 * - `id` / `label` → `id` 属性（锚点）。
 *
 * `tab` / `label` 仍**只告警不实现**：tab 是跨块的组（相邻围栏 + 页签栏），
 * 编辑器侧需要块级组合 UI，单独一轮做；只做显示侧会破坏
 * 「编辑时看到的 = 发布出来的」。
 */
import type { Token } from 'markdown-it'

import { ATTRS_META, parseAttrLine, type AttrToken } from '../../shared/attrs.js'
import type { RenderFeature } from '../feature.js'

/** 能带属性行的块（打开 token 的类型）。 */
const HOST_OPEN_TYPES: ReadonlySet<string> = new Set([
  'bullet_list_open',
  'ordered_list_open',
  'table_open',
  'fence',
  'blockquote_open',
])

/** 已实现的类变体。 */
const CLASS_VARIANTS: Readonly<Record<string, string>> = {
  steps: 'nd-steps',
  cards: 'nd-cards',
  fields: 'nd-fields',
  gallery: 'nd-gallery',
  card: 'nd-card',
  'no-card': 'nd-no-card',
  'no-carousel': 'nd-no-carousel',
}

/** 已实现的键值属性（挂在 meta 上，由各渲染规则读取）。 */
const KEY_ATTRS: ReadonlySet<string> = new Set(['title', 'caption', 'lines', 'highlight', 'tab'])

/** 已实现、但**只告警不生效**的属性（两侧还没对齐）。 */
const DEFERRED: ReadonlySet<string> = new Set(['label'])

interface AttrsMeta {
  readonly tokens: readonly AttrToken[]
  readonly title?: string
  readonly caption?: string
  readonly label?: string
  readonly lines?: unknown
  readonly highlight?: string
  readonly tab?: string
}

/** 从 `paragraph_open` 的索引向前找宿主块。 */
function findHost(tokens: readonly Token[], paragraphIndex: number): Token | null {
  const prev = tokens[paragraphIndex - 1]
  if (!prev) return null

  // 围栏是自闭合 token，直接就是宿主。
  if (prev.type === 'fence') return prev

  if (!prev.type.endsWith('_close')) return null

  const openType = `${prev.type.slice(0, -'_close'.length)}_open`
  if (!HOST_OPEN_TYPES.has(openType)) return null

  for (let i = paragraphIndex - 1; i >= 0; i -= 1) {
    const token = tokens[i]!
    if (token.type === openType && token.level === prev.level) return token
  }
  return null
}

/**
 * 把属性应用到宿主上。
 *
 * @returns 是否**至少认出了一个**属性。`false` 时调用方保留原文。
 */
function applyAttrs(
  host: Token,
  attrs: readonly AttrToken[],
  warn: (message: string) => void,
): boolean {
  const classes: string[] = []
  const meta: {
    tokens: readonly AttrToken[]
    title?: string
    caption?: string
    label?: string
    lines?: unknown
    highlight?: string
    tab?: string
  } = { tokens: attrs }
  let applied = false

  for (const attr of attrs) {
    if (attr.kind === 'class') {
      const cls = CLASS_VARIANTS[attr.name]
      if (cls) {
        classes.push(cls)
        applied = true
      } else {
        warn(`未知的类变体 .${attr.name}（已忽略）`)
      }
      continue
    }

    if (attr.kind === 'id') {
      host.attrSet('id', attr.name)
      applied = true
      continue
    }

    if (KEY_ATTRS.has(attr.name)) {
      if (attr.name === 'lines') {
        // `lines` 可以是布尔（`{lines}`）也可以是区间（`{lines=1-20}`）。
        meta.lines = attr.value ?? true
        applied = true
        continue
      }
      if (attr.value === undefined) {
        warn(`属性 ${attr.name} 需要一个值（已忽略）`)
        continue
      }
      if (attr.name === 'highlight') meta.highlight = attr.value
      else if (attr.name === 'tab') meta.tab = attr.value
      else meta[attr.name as 'title' | 'caption' | 'label'] = attr.value
      applied = true
      continue
    }

    if (DEFERRED.has(attr.name)) {
      warn(`属性 ${attr.name} 尚未实现（编辑器侧还没有对应能力），已忽略`)
      continue
    }

    warn(`未知属性 ${attr.name}（已忽略）`)
  }

  if (classes.length > 0) host.attrJoin('class', classes.join(' '))
  host.meta = { ...(host.meta ?? {}), [ATTRS_META]: meta satisfies AttrsMeta }
  return applied
}

export const attrsFeature: RenderFeature = {
  name: 'attrs',

  install(ctx) {
    const warned = new Set<string>()
    const warn = (message: string): void => {
      if (warned.has(message)) return
      warned.add(message)
      console.warn(`[nexusdown] ${message}`)
    }

    ctx.md.core.ruler.push('nd_attrs', (state) => {
      const tokens = state.tokens

      for (let i = 0; i < tokens.length; i += 1) {
        const open = tokens[i]!
        if (open.type !== 'paragraph_open' || open.level !== 0) continue

        const inline = tokens[i + 1]
        const close = tokens[i + 2]
        if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') continue

        const attrs = parseAttrLine(inline.content)
        if (!attrs) continue

        const host = findHost(tokens, i)
        if (!host) continue

        // 一个都没认出来 → 保留原文（见文件头）。
        if (!applyAttrs(host, attrs, warn)) continue

        tokens.splice(i, 3)
        i -= 1
      }
    })
  },
}
