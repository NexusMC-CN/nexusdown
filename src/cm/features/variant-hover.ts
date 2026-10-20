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
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'

import { applyBlockAttrs, blockRangeAt, type BlockKind } from '../commands.js'
import { editingRange } from '../plugin.js'
import { addTab, removeTab, tabGroupAt } from '../tabs-actions.js'
import { variantItemsFor } from '../variants.js'

const HIDE_DELAY = 160

interface HoverTarget {
  kind: BlockKind
  from: number
}

interface MenuEntry {
  label: string
  /** 属性变体（步骤/卡片/参数表/标题）。 */
  attr?: string
  /** 块级操作（增加/删除页签）。 */
  run?: () => void
}

class VariantHover {
  private readonly button: HTMLButtonElement
  private target: HoverTarget | null = null
  private hideTimer: number | null = null
  /** 出现延迟：鼠标只是路过时不要闪一下按钮。 */
  private showTimer: number | null = null
  private menuCleanup: (() => void) | null = null

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
    this.cancelShow()
    this.cancelHide()
    this.button.remove()
    this.view.dom.removeEventListener('mousemove', this.onMove)
    this.view.dom.removeEventListener('mouseleave', this.onLeave)
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
  }

  private handleMove(event: MouseEvent): void {
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

    if (!range || range.kind === 'paragraph' || variantItemsFor(range.kind).length === 0) {
      this.scheduleHide()
      return
    }

    this.target = { kind: range.kind, from: range.from }
    this.scheduleShow()
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
  }

  private hide(): void {
    this.cancelShow()
    this.button.hidden = true
    this.target = null
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

    const entries: MenuEntry[] = group
      ? [
          { label: '增加页签', run: () => addTab(this.view, group) },
          {
            // 悬停的是整块（块首），所以删除的是第一段 —— 标签写清楚是哪一段，
            // 不要用含糊的「当前页签」（用户不知道“当前”指哪个）。
            label: `删除「${group.panels[0]!.label}」`,
            run: () => removeTab(this.view, group, 0),
          },
        ]
      : variantItemsFor(this.target.kind).map((item) => ({ label: item.label, attr: item.attr }))

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
      label.textContent = item.label
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
        if (item.run) item.run()
        else if (item.attr) applyBlockAttrs(item.attr, from)(this.view)
        this.view.focus()
      })

      menu.appendChild(entry)
    }

    document.body.appendChild(menu)

    const rect = this.button.getBoundingClientRect()
    menu.style.top = `${Math.round(rect.bottom + 6)}px`
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
