/**
 * `tabs` —— 编辑器侧把**相邻的 tab 围栏**整组渲染成页签（`{tab="…"}`）。
 *
 * ## 为什么整组换成一个块 widget，而不是自己画页签 UI
 *
 * 页签组是**跨多个 FencedCode** 的结构，CM6 里没有「组」这个节点。自己画一套
 * 页签 UI 意味着：选中态、键盘切换、和源码同步、揭示态……全都要重写一遍，
 * 而且很难和渲染侧逐字一致。
 *
 * 这里的做法和 `table.ts` 完全一样：**把整组源码交给 `renderMarkdown()`**，
 * 渲染侧的 `render/features/tabs.ts` 会把它变成页签 HTML。于是
 * 「编辑时看到的 = 发布出来的」是**结构性保证**，不是两套实现对齐。
 *
 * 代价：整组是块级 replace，光标进不去；点 widget → 光标落到组前（`from - 1`）
 * + `editingBlock` → 整组揭示成源码。和表格/公式同一套「点开才揭示」。
 */
import { EditorSelection } from '@codemirror/state'
import { Decoration, WidgetType, type EditorView } from '@codemirror/view'

import { renderMarkdown } from '../../render/index.js'
import { parseAttrLine } from '../../shared/attrs.js'
import type { EditorFeature } from '../feature.js'
import { setEditingBlock, setEditingRange } from '../plugin.js'
import type { MarkdownNode } from '../types.js'
import { selectionHoversBlock, selectionTouchesLineRange } from '../util/selection.js'

interface PanelSource {
  /** 面板内容在**整组源码**里的起点（不含开围栏行）。 */
  contentStart: number
  lines: string[]
}

/**
 * 把整组源码切成面板：每段 fence 的内容行 + 它在源码里的起点。
 *
 * 用于「点面板的哪一行，光标就落到源码的哪一行」—— 否则点一下永远落在
 * 块首（实测：点代码第二行，光标跑到 ```bash 行首，一打字把围栏写坏）。
 */
function parsePanels(source: string): PanelSource[] {
  const panels: PanelSource[] = []
  let open: { marker: string; contentStart: number } | null = null
  let offset = 0

  for (const line of source.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (match) {
      const marker = match[1]!
      const info = match[2]!
      if (open) {
        // 闭围栏必须同类且不短于开围栏；消费整行后再找下一个面板。
        // 否则闭围栏会被当作新的开围栏，让第二个页签指向第一个属性行。
        if (marker[0] === open.marker[0] && marker.length >= open.marker.length && /^\s*$/.test(info)) {
          panels.push({
            contentStart: open.contentStart,
            lines: source.slice(open.contentStart, Math.max(open.contentStart, offset - 1)).split('\n'),
          })
          open = null
        }
      } else if (marker[0] !== '`' || !info.includes('`')) {
        open = { marker, contentStart: offset + line.length + 1 }
      }
    }
    offset += line.length + 1
  }

  if (open) {
    panels.push({ contentStart: open.contentStart, lines: source.slice(open.contentStart).split('\n') })
  }
  return panels
}

export class TabsWidget extends WidgetType {
  private readonly panels: PanelSource[]

  constructor(
    private readonly source: string,
    private readonly from: number,
    private readonly to: number,
  ) {
    super()
    this.panels = parsePanels(source)
  }

  override eq(other: TabsWidget): boolean {
    return other.source === this.source && other.from === this.from && other.to === this.to
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'nd-tabs-block'

    try {
      wrap.innerHTML = renderMarkdown(this.source)
      /*
       * 块级 widget 会**替换掉整段行**，gutter 拿不到这些行的行号 —— 左边会从
       * 块后的第一行（比如 10）开始，看起来像跳号。这里在块头补一个**起始行号**，
       * 对齐到 gutter（偏移在 mount 后按实际 gutter 位置算）。
       */
      wrap.dataset.line = String(view.state.doc.lineAt(this.from).number)
      window.requestAnimationFrame(() => {
        const gutter = view.dom.querySelector('.cm-gutters')
        if (!gutter) return
        const left = gutter.getBoundingClientRect().left - wrap.getBoundingClientRect().left
        wrap.style.setProperty('--nd-block-line-left', `${Math.round(left)}px`)
      })
      /*
       * ⚠️ 同一页面里预览也会渲染一份页签，radio 的 `name` 都从 `nd-tabs-1` 开始 ——
       * 同名的 radio 在同一个 document 里是一组，预览的选中会把编辑器里的取消掉，
       * 编辑器的面板就全部 `display: none`（实测：页签块看起来坏了）。
       * 这里给编辑器的副本加一个**基于位置**的后缀（`from` 稳定，快照/复现不受影响）。
       */
      const suffix = `-e${this.from}`
      wrap.querySelectorAll<HTMLInputElement>('input[name]').forEach((input) => {
        const oldName = input.getAttribute('name')!
        input.setAttribute('name', `${oldName}${suffix}`)
        if (input.id) {
          const oldId = input.id
          input.id = `${oldId}${suffix}`
          wrap.querySelectorAll<HTMLLabelElement>(`label[for="${oldId}"]`).forEach((label) => {
            label.setAttribute('for', `${oldId}${suffix}`)
          })
        }
      })
    } catch (error) {
      // 渲染失败降级成源码（同 table / math 的契约），绝不抛。
      console.warn('[nexusdown] 页签组渲染失败，已降级成源码：', error)
      wrap.textContent = this.source
    }

    wrap.addEventListener('mousedown', (event) => {
      /*
       * ⚠️ 点**页签栏**时不要揭示源码：那是切换页签的交互（radio + label），
       * 不是"点开这个块"。不排除的话，一点 macOS 整组就变成源码了（实测）。
       */
      const target = event.target as HTMLElement | null
      if (target?.closest('.nd-tabs__bar')) return

      event.preventDefault()
      /*
       * 点面板的**哪一行**，光标就落到源码的哪一行 —— 不是永远落到块首。
       * 否则用户点第二行代码、一打字却插进了 ```bash 那一行（实测）。
       */
      const panelEl = target?.closest('.nd-tabs__panel') ?? null
      const panels = wrap.querySelectorAll('.nd-tabs__panel')
      const panelIndex = panelEl ? [...panels].indexOf(panelEl) : 0
      const panel = this.panels[panelIndex] ?? this.panels[0]
      let offset = 0

      if (panel) {
        const pre = panelEl?.querySelector('pre') ?? null
        let lineIndex = 0
        if (pre) {
          const rect = pre.getBoundingClientRect()
          const style = window.getComputedStyle(pre)
          const lineHeight = Number.parseFloat(style.lineHeight) || 21
          const padTop = Number.parseFloat(style.paddingTop) || 0
          lineIndex = Math.floor((event.clientY - rect.top - padTop) / lineHeight)
          lineIndex = Math.max(0, Math.min(panel.lines.length - 1, lineIndex))
        }
        offset = panel.contentStart
        for (let i = 0; i < lineIndex; i += 1) offset += panel.lines[i]!.length + 1
      }

      view.dispatch({
        selection: EditorSelection.cursor(this.from + offset),
        effects: [
          setEditingRange.of({ from: this.from, to: this.to }),
          setEditingBlock.of(this.from),
        ],
      })
      view.focus()
    })

    return wrap
  }
}

interface FenceWithTab {
  fence: MarkdownNode
  /** 属性行所在行号（用于判断"相邻"）。 */
  attrLine: number
}

/** 收集子树里的所有 FencedCode（保持文档顺序）。 */
function collectFences(node: MarkdownNode, out: MarkdownNode[]): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'FencedCode') out.push(child)
    else collectFences(child, out)
  }
}

export const tabsFeature: EditorFeature = {
  name: 'tabs',
  nodes: ['Document'],
  block: true,

  decorate(ranges, _atomicRanges, node, doc, selection, _context, blockEditing, editingRange) {
    const fences: MarkdownNode[] = []
    collectFences(node, fences)

    const runs: FenceWithTab[][] = []
    let run: FenceWithTab[] = []

    const flush = (): void => {
      if (run.length >= 2) runs.push(run)
      run = []
    }

    for (const fence of fences) {
      // 围栏结束行（`to` 排他，可能落在下一行行首）
      const endLine = doc.lineAt(fence.to > fence.from ? fence.to - 1 : fence.to)
      const attrLineNo = endLine.number + 1
      if (attrLineNo > doc.lines) {
        flush()
        continue
      }

      const attrs = parseAttrLine(doc.line(attrLineNo).text)
      const tab = attrs?.find((attr) => attr.kind === 'key' && attr.name === 'tab')
      if (!tab || tab.kind !== 'key') {
        flush()
        continue
      }

      /*
       * 相邻：上一个属性行到当前围栏之间**只允许空行**（渲染侧按 token 相邻分组，
       * 空行不是 token，所以允许）。中间夹了任何非空内容就断开。
       */
      if (run.length > 0) {
        const previous = run[run.length - 1]!
        const startLine = doc.lineAt(fence.from).number
        let adjacent = true
        for (let n = previous.attrLine + 1; n < startLine; n += 1) {
          if (doc.line(n).text.trim() !== '') {
            adjacent = false
            break
          }
        }
        if (!adjacent) flush()
      }
      run.push({ fence, attrLine: attrLineNo })
    }
    flush()

    for (const group of runs) {
      const first = group[0]!
      const last = group[group.length - 1]!
      const from = doc.lineAt(first.fence.from).from
      /*
       * ⚠️ `to` 必须包含**最后一个属性行**，不能只到最后一个围栏的闭围栏：
       * 否则 `renderMarkdown(source)` 拿到的源码里，最后一段没有 `{tab=…}`，
       * 整组就退化成两个独立代码块（实测：编辑器里画出来是两个 fence，没有页签）。
       */
      const to = doc.line(last.attrLine).to
      if (to <= from) continue

      // 已经在「看源码」区间里 → 不再盖 widget。
      if (editingRange && from >= editingRange.from && to <= editingRange.to) continue

      // 揭示态：光标碰到整组任意一行，或用户点开了这个块 → 源码原样。
      if (
        selectionTouchesLineRange(doc, selection, from, to) ||
        selectionHoversBlock(doc, selection, from, to) ||
        blockEditing === from
      ) {
        continue
      }

      ranges.push(
        Decoration.replace({
          block: true,
          widget: new TabsWidget(doc.sliceString(from, to), from, to),
        }).range(from, to),
      )
    }
  },
}
