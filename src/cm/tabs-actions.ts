/**
 * 页签组的**块级操作**：识别一组相邻的 tab 围栏，并支持增加 / 删除页签。
 *
 * 这些操作只改 Markdown 源（插入/删除 fence + `{tab="…"}` 行），
 * 由渲染侧 `render/features/tabs.ts` 重新分组成页签块。
 *
 * ⚠️ 不要在这里自己画页签 UI：编辑器里的页签块是 `features/tabs.ts` 的
 * 整块 widget，内容来自 `renderMarkdown()`。这里只负责“改源”。
 */
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import type { EditorView } from '@codemirror/view'

import { readFenceInfo } from './decorate/fence.js'
import { parseAttrLine } from '../shared/attrs.js'

export interface TabPanel {
  fence: SyntaxNode
  attr: SyntaxNode
  label: string
}

export interface TabGroup {
  from: number
  to: number
  panels: TabPanel[]
}

/** 属性节点里的 `tab="…"` 值（不是 tab 属性就返回 null）。 */
function tabLabel(state: EditorState, attr: SyntaxNode): string | null {
  const tokens = parseAttrLine(state.doc.sliceString(attr.from, attr.to))
  const tab = tokens?.find((token) => token.kind === 'key' && token.name === 'tab')
  return tab && tab.kind === 'key' ? (tab.value ?? null) : null
}

/**
 * `pos` 所在的页签组（至少 2 段）；不在组里返回 null。
 *
 * 结构是 `FencedCode, Paragraph({tab}), FencedCode, Paragraph({tab}), …`，
 * 所以从任意一段往前/往后按「围栏 → 属性段」成对走。
 */
export function tabGroupAt(state: EditorState, pos: number): TabGroup | null {
  // ⚠️ bias 必须是 +1：pos 正好在围栏行首时，bias -1 会解析到 Document，
  // 往上走永远找不到 FencedCode（实测：菜单退化成「代码标题」）。
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1)
  while (node && node.name !== 'FencedCode') node = node.parent
  if (!node) return null

  const attr = node.nextSibling
  if (!attr || attr.name !== 'Paragraph' || tabLabel(state, attr) === null) return null

  // 往前找第一段
  let first = node
  for (;;) {
    const prevAttr = first.prevSibling
    if (!prevAttr || prevAttr.name !== 'Paragraph') break
    const prevFence = prevAttr.prevSibling
    if (!prevFence || prevFence.name !== 'FencedCode') break
    if (tabLabel(state, prevAttr) === null) break
    first = prevFence
  }

  // 往后收集
  const panels: TabPanel[] = []
  let current: SyntaxNode | null = first
  while (current && current.name === 'FencedCode') {
    const attrNode: SyntaxNode | null = current.nextSibling
    if (!attrNode || attrNode.name !== 'Paragraph') break
    const label = tabLabel(state, attrNode)
    if (label === null) break
    panels.push({ fence: current, attr: attrNode, label })
    const next: SyntaxNode | null = attrNode.nextSibling
    current = next && next.name === 'FencedCode' ? next : null
  }

  if (panels.length < 2) return null

  const from = state.doc.lineAt(first.from).from
  const last = panels[panels.length - 1]!
  const lastAttrLine = state.doc.lineAt(last.attr.to > last.attr.from ? last.attr.to - 1 : last.attr.to)
  return { from, to: lastAttrLine.to, panels }
}

/**
 * 在组尾增加一个空页签（语言沿用最后一段）。
 *
 * 光标放到**组外**（插入内容末尾的空行上）—— 放在组内会让整个页签组
 * 立刻进入揭示态，用户看不到新增的页签。
 */
export function addTab(view: EditorView, group: TabGroup): void {
  const { state } = view
  const last = group.panels[group.panels.length - 1]!
  const info = readFenceInfo(state.doc, last.fence) ?? ''
  const lang = info.split(/\s+/)[0] ?? ''
  const label = `页签 ${group.panels.length + 1}`
  const fence = '```'

  const insert = `\n\n${fence}${lang}\n\n${fence}\n{tab="${label}"}\n\n`
  const at = group.to
  const cursor = Math.min(at + insert.length, state.doc.length + insert.length)

  view.dispatch({
    changes: { from: at, insert },
    selection: EditorSelection.cursor(cursor),
    userEvent: 'format.nexusdown',
  })
  view.focus()
}

/**
 * 删除组里第 `index` 段（围栏 + 它的属性行）。
 *
 * 只剩一段时拒绝删除 —— 一段不构成页签组，删了会变成普通代码块，
 * 和用户预期（“删掉这个页签”）不符。
 */
export function removeTab(view: EditorView, group: TabGroup, index: number): void {
  if (group.panels.length <= 1) return
  const panel = group.panels[index]
  if (!panel) return

  const { state } = view
  const from = state.doc.lineAt(panel.fence.from).from
  const attrLine = state.doc.lineAt(panel.attr.to > panel.attr.from ? panel.attr.to - 1 : panel.attr.to)
  let to = attrLine.to
  // 连同属性行后的换行一起删，避免留下一条空行。
  if (to < state.doc.length) to += 1

  view.dispatch({
    changes: { from, to },
    selection: EditorSelection.cursor(from),
    userEvent: 'delete',
  })
  view.focus()
}
