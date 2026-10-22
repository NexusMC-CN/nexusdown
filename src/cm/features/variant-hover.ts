/**
 * 块悬停「＋ 变体」—— 鼠标停在列表 / 表格 / 围栏 / 段落上时，
 * 在块的右上角浮出一个小按钮；点它打开变体菜单（和工具栏那个同一份 `variantItemsFor`）。
 *
 * ## 为什么是「追加到 `.cm-editor` 的绝对定位按钮」，而不是 widget / gutter
 *
 * - **widget**：无论 `Decoration.widget` 还是块级 widget，都会占布局 ——
 *   要么把正文挤一下，要么改高度表。悬停按钮不该影响排版。
 * - **gutter**：每行一个槽，空行/嵌套列表上会连成一片，且要另做菜单定位。
 * - **绝对定位按钮**：`.cm-editor` 是 `position: relative`（实测），
 *   按钮挂进去、用 `coordsAtPos` 算 top 即可；不占任何布局。
 *
 * ## 什么时候出现
 *
 * 鼠标在**块内任意位置** → 按钮贴在**块首行**的右上角。
 * 鼠标离开编辑器 / 滚动 / 文档变化 → 160ms 后隐藏（留出"从正文移到按钮"的时间）。
 *
 * ## 菜单
 *
 * 菜单是 `document.body` 里的 fixed 浮层（不随编辑器滚动），
 * 点外面 / Escape 关闭；点选项 → `applyBlockAttrs(attr)` → 焦点还给编辑器。
 */
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'

import { applyBlockAttrs, blockAttrsAt, blockRangeAt, isTaskList, type BlockKind } from '../commands.js'
import { readFenceInfo } from '../decorate/fence.js'
import { editingRange } from '../plugin.js'
import { addTab, removeTab, tabGroupAt } from '../tabs-actions.js'
import { variantItemsFor } from '../variants.js'

const HIDE_DELAY = 160

interface HoverTarget {
  kind: BlockKind
  from: number
  /** 块结束位置 —— 菜单优先开在块下方，不盖住块内容。 */
  to: number
}

interface MenuEntry {
  label: string
  /** 属性变体（步骤/卡片/参数表/标题）。 */
  attr?: string
  /** 块级操作（增加/删除页签）。 */
  run?: () => void
  /** 已应用 → 菜单打勾；再点一次是“取消”。 */
  applied?: boolean
  /** 互斥组（应用时替换同组旧 class）。 */
  exclusive?: string[]
}

class VariantHover {
  private readonly button: HTMLButtonElement
  private target: HoverTarget | null = null
  private hideTimer: number | null = null
  /** 出现延迟：鼠标只是路过时不要闪一下按钮。 */
  private showTimer: number | null = null
  private menuCleanup: (() => void) | null = null
  /** 正在 hover 的块的属性行（用于展开 chip）。 */
  private chipLine: HTMLElement | null = null

  private readonly onMove = (event: MouseEvent): void => this.handleMove(event)
  private readonly onLeave = (): void => this.scheduleHide()
  private readonly onScroll = (): void => this.hide()

  constructor(private readonly view: EditorView) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'nd-variant-hover'
    button.textContent = '＋'
    button.setAttribute('aria-label', '块变体')
    button.title = '给这个块加变体（步骤 / 卡片 / 参数表 / 代码标题）'
    button.hidden = true

    button.addEventListener('mouseenter', () => this.cancelHide())
    button.addEventListener('mouseleave', () => this.scheduleHide())
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      this.openMenu()
    })

    view.dom.appendChild(button)
    view.dom.addEventListener('mousemove', this.onMove)
    view.dom.addEventListener('mouseleave', this.onLeave)
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })

    this.button = button
  }

  update(update: ViewUpdate): void {
    // 文档/视口变了，按钮的位置可能已经失效 —— 先藏起来，等下一次 mousemove。
    if (update.docChanged || update.viewportChanged) this.hide()
  }

  destroy(): void {
    this.closeMenu()
    this.hideChip()
    this.cancelShow()
    this.cancelHide()
    this.button.remove()
    this.view.dom.removeEventListener('mousemove', this.onMove)
    this.view.dom.removeEventListener('mouseleave', this.onLeave)
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
  }

  private handleMove(event: MouseEvent): void {
    /*
     * 块级 widget（页签/表格）会替换掉整段行：`posAtCoords` 落在 widget 上时
     * 可能拿不到源码位置，`blockRangeAt` 于是返回 null，`＋` 不出现（实测：
     * 页签的第二个面板完全没有入口）。widget 自己带了 `data-from`，直接用它。
     */
    const widget = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '.nd-tabs-block, .nd-table',
    )
    if (widget?.dataset.from) {
      const from = Number(widget.dataset.from)
      if (Number.isFinite(from)) {
        this.target = {
          kind: widget.classList.contains('nd-table') ? 'table' : 'fence',
          from,
          to: Number(widget.dataset.to) || from,
        }
        this.scheduleShow()
        return
      }
    }

    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos == null) {
      this.scheduleHide()
      return
    }

    const range = blockRangeAt(this.view.state, pos)
    /*
     * ⚠️ **普通段落不出按钮。** `.card` / `.no-card` 只对「独占一段的链接/提及」
     * 有意义，而那种段落占正文的绝大多数 —— 鼠标扫过就冒按钮是纯噪音
     * （实测：打开全功能样例，鼠标随便一动就弹）。
     * 段落的变体入口留给工具栏按钮（明确意图时才用）。
     */
    /*
     * 正在「看源码」的区间里不出按钮：那时整段是纯 Markdown，
     * 上面再浮一个「＋ 变体」会干扰编辑。
     */
    if (this.view.state.field(editingRange, false)) {
      this.scheduleHide()
      return
    }

    /*
     * 任务列表（`- [ ]`）不提供步骤/卡片：任务标记优先，步骤不会渲染，
     * 点了只会写入一个看不见的属性（用户实测“为什么待办也有这两个”）。
     */
    if (range && range.kind === 'list' && isTaskList(this.view.state, range.from)) {
      this.scheduleHide()
      return
    }

    /*
     * embed / math / mermaid 也是 `FencedCode`，但「代码标题 / 行号 / 高亮」
     * 对它们没有意义（用户实测：悬停 B 站嵌入卡片，弹出了代码块变体）。
     * 这些特殊围栏不提供代码块变体。
     */
    if (range && range.kind === 'fence' && isSpecialFence(this.fenceInfo(range.from))) {
      this.scheduleHide()
      return
    }

    if (!range || range.kind === 'paragraph' || variantItemsFor(range.kind).length === 0) {
      this.scheduleHide()
      return
    }

    this.target = { kind: range.kind, from: range.from, to: range.to }
    this.scheduleShow()
  }

  /** 围栏的 info string（` ```embed … ` → `embed …`）。 */
  private fenceInfo(from: number): string {
    let node: SyntaxNode | null = syntaxTree(this.view.state).resolveInner(from, 1)
    while (node && node.name !== 'FencedCode') node = node.parent
    return node ? (readFenceInfo(this.view.state.doc, node) ?? '') : ''
  }

  private scheduleShow(): void {
    if (this.showTimer !== null) return
    this.showTimer = window.setTimeout(() => {
      this.showTimer = null
      this.show()
    }, 120)
  }

  private cancelShow(): void {
    if (this.showTimer !== null) {
      window.clearTimeout(this.showTimer)
      this.showTimer = null
    }
  }

  private show(): void {
    if (!this.target) return
    const coords = this.view.coordsAtPos(this.target.from)
    if (!coords) return

    const editor = this.view.dom.getBoundingClientRect()
    this.button.hidden = false
    this.button.style.top = `${Math.round(coords.top - editor.top)}px`
    /*
     * 放在**左侧留白**（`.cm-content` 有 28px 左内边距），而不是右侧：
     * - 右侧会压住围栏的折叠按钮和长行文字；
     * - 左侧是块标记（`-` / ``` ```）前的空白，天然是「块操作」的位置
     *   （Notion / Obsidian 的块把手都在这一侧）。
     */
    this.button.style.left = '4px'
    this.cancelHide()
    this.revealChip()
  }

  private hide(): void {
    this.cancelShow()
    this.hideChip()
    this.button.hidden = true
    this.target = null
  }

  /** hover 块时把它的属性行 chip 展开（0 高 → 正常行高）。 */
  private revealChip(): void {
    if (!this.target) return
    this.hideChip()

    const attrs = blockAttrsAt(this.view.state, this.target.from)
    if (!attrs?.line) return

    const dom = this.view.domAtPos(attrs.line.from)
    const node = dom.node.nodeType === Node.TEXT_NODE ? dom.node.parentElement : (dom.node as HTMLElement)
    const line = (node?.closest?.('.cm-line') as HTMLElement | null) ?? null
    if (line) {
      line.classList.add('nd-attrs-peek')
      this.chipLine = line
    }
  }

  private showToast(text: string): void {
    const toast = document.createElement('div')
    toast.className = 'nd-variant-toast'
    toast.textContent = text
    document.body.appendChild(toast)
    window.setTimeout(() => toast.remove(), 1400)
  }

  private hideChip(): void {
    this.chipLine?.classList.remove('nd-attrs-peek')
    this.chipLine = null
  }

  private scheduleHide(): void {
    this.cancelShow()
    this.cancelHide()
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY)
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }

  private openMenu(): void {
    if (!this.target) return

    /*
     * 页签块不是“套一个变体”，而是**整组操作**：增加/删除页签。
     * 之前这里只给 fence 的「代码标题」，用户点开发现“P 用没有”（实测）。
     */
    const group =
      this.target.kind === 'fence'
        ? tabGroupAt(this.view.state, this.target.from)
        : null

    let entries: MenuEntry[]
    if (group) {
      entries = [
        { label: '增加页签', run: () => addTab(this.view, group) },
        {
          // 悬停的是整块（块首），所以删除的是第一段 —— 标签写清楚是哪一段，
          // 不要用含糊的「当前页签」（用户不知道“当前”指哪个）。
          label: `删除「${group.panels[0]!.label}」`,
          run: () => removeTab(this.view, group, 0),
        },
      ]
    } else {
      /*
       * 已应用状态：读这个块当前的属性行，菜单打勾。
       * 旧菜单不知道状态，重复点同一个变体只会 no-op，看起来像“失效”。
       */
      const attrs = blockAttrsAt(this.view.state, this.target.from)
      const applied = new Set(attrs?.tokens.map((token) => token.name) ?? [])
      entries = variantItemsFor(this.target.kind).map((item) => ({
        label: item.label,
        attr: item.attr,
        applied: applied.has(item.name),
        exclusive: item.exclusive,
      }))
    }

    if (entries.length === 0) return

    this.closeMenu()

    const menu = document.createElement('div')
    menu.className = 'nd-variant-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', '块变体')

    for (const item of entries) {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.className = 'nd-variant-item'
      entry.setAttribute('role', 'menuitem')

      const label = document.createElement('span')
      // 已应用打勾；再点一次是取消（toggle）。
      label.textContent = item.applied ? `✓ ${item.label}` : item.label
      entry.append(label)
      if (item.attr) {
        const attr = document.createElement('code')
        attr.textContent = item.attr
        entry.append(attr)
      }

      entry.addEventListener('mousedown', (event) => event.preventDefault())
      entry.addEventListener('click', () => {
        const from = this.target?.from
        this.closeMenu()

        let ok = false
        if (item.run) {
          item.run()
          ok = true
        } else if (item.attr) {
          ok = applyBlockAttrs(item.attr, from, {
            toggle: true,
            exclusive: item.exclusive,
          })(this.view)
        }

        /*
         * 给一个即时反馈：菜单里的 ✓ 表示“已应用”，再点一次是**取消**。
         * 没有反馈时用户会以为“点了没用”（尤其是行号/高亮这种视觉差异小的）。
         */
        this.showToast(
          ok
            ? `${item.run ? '已执行' : item.applied ? '已取消' : '已应用'}：${item.label}`
            : `没有生效：${item.label}`,
        )
        this.view.focus()
      })

      menu.appendChild(entry)
    }

    document.body.appendChild(menu)

    const rect = this.button.getBoundingClientRect()
    const menuHeight = menu.getBoundingClientRect().height

    /*
     * 菜单位置优先级：
     * 1. **块下方**（不盖住块内容，用户能同时看到菜单和效果）；
     * 2. 块上方（空间不够时）；
     * 3. 按钮下方（最后兜底）。
     *
     * 页签组要取**整组**的结束位置，不是第一个 fence 的结束位置。
     */
    const blockTo = group ? group.to : this.target?.to ?? this.target?.from ?? 0
    const end = this.view.coordsAtPos(blockTo)
    const belowBlock =
      end !== null && end.bottom + 6 + menuHeight <= window.innerHeight - 8

    let top: number
    if (belowBlock) {
      top = end!.bottom + 6
    } else {
      const above = rect.top - menuHeight - 6
      top = above >= 8 ? above : rect.bottom + 6
    }
    menu.style.top = `${Math.round(top)}px`
    // 菜单贴按钮左边；靠近窗口右缘时夹回来，避免被裁掉。
    menu.style.left = `${Math.round(rect.left)}px`
    menu.style.maxWidth = `${Math.max(176, Math.round(window.innerWidth - rect.left - 12))}px`

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!menu.contains(target) && !this.button.contains(target)) this.closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') this.closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    this.menuCleanup = () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      menu.remove()
    }
  }

  private closeMenu(): void {
    this.menuCleanup?.()
    this.menuCleanup = null
  }
}

/**
 * 挂到 `nexusdown()` 的扩展。
 *
 * 只做悬停 UI；没有变体可用的块（例如普通段落之外的东西）不会出现按钮。
 */
export function variantHover() {
  return ViewPlugin.fromClass(VariantHover)
}


/** 这些围栏有自己的渲染器，不该出现代码块变体。 */
function isSpecialFence(info: string): boolean {
  const lang = info.split(/\s+/)[0]?.toLowerCase() ?? ''
  return lang === 'embed' || lang === 'math' || lang === 'mermaid' || lang === 'diagram'
}
