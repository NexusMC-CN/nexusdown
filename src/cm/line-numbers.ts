/**
 * 文档行号 gutter —— **带 `{lines}` 的代码块不再重复编号**。
 *
 * 背景：`{lines}` 会在代码块内部渲染 1/2/3 的行号；如果左侧文档 gutter 也给
 * 这几行编号，就会出现两套数字并排（用户实测：“行号两套，看着乱”）。
 *
 * 规则：**凡是带 `{lines}` 的围栏，整段（开围栏、内容、闭围栏）都不出文档行号**，
 * 让代码块自己的编号成为唯一编号；块结束后 gutter 继续按文档行号走。
 */
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { gutter, GutterMarker } from '@codemirror/view'

import { readFenceAttrs } from './decorate/fence.js'

class LineNumberMarker extends GutterMarker {
  constructor(private readonly number: number) {
    super()
  }

  override eq(other: LineNumberMarker): boolean {
    return other.number === this.number
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'nd-line-no'
    span.textContent = String(this.number)
    return span
  }
}

export const lineNumbersWithCode = gutter({
  class: 'cm-lineNumbers nd-line-numbers',
  lineMarker(view, line) {
    // 落在带 `{lines}` 的围栏里 → 这一段交给代码块自己的行号编号。
    let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(line.from, 1)
    while (node && node.name !== 'FencedCode') node = node.parent
    if (node && readFenceAttrs(view.state.doc, node)?.lines) return null

    return new LineNumberMarker(view.state.doc.lineAt(line.from).number)
  },
})
