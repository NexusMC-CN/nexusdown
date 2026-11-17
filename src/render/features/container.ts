import container from 'markdown-it-container'
import type { StateBlock } from 'markdown-it'
import type { RenderFeature } from '../feature.js'

const TYPES = ['note', 'tip', 'info', 'warning', 'danger', 'details'] as const
const LABELS: Record<typeof TYPES[number], string> = {
  note: '备注', tip: '提示', info: '信息', warning: '警告', danger: '危险', details: '详细内容',
}
const CODE_FENCE = new RegExp('^ {0,3}(' + String.fromCharCode(96) + '{3,}|~{3,})(.*)$')

/** Find an explicit close, respecting fenced code and shorter nested markers. */
function closingLine(state: StateBlock, start: number, end: number, length: number): number | null {
  let fence: { marker: string; length: number } | undefined
  for (let line = start + 1; line < end; line++) {
    const text = state.src.slice(state.bMarks[line]!, state.eMarks[line]!)
    const code = CODE_FENCE.exec(text)
    if (code) {
      if (!fence) fence = { marker: code[1]![0]!, length: code[1]!.length }
      else if (code[1]![0] === fence.marker && code[1]!.length >= fence.length && !code[2]!.trim()) fence = undefined
      continue
    }
    if (fence) continue
    const close = /^ {0,3}(:{3,})[ \t]*$/.exec(text)
    if (close && close[1]!.length >= length) return line
  }
  return null
}

export const containerFeature: RenderFeature = {
  name: 'container',
  install({ md, escapeHtml }) {
    for (const type of TYPES) {
      md.use(container, type, {
        validate: (params) => params.trim().split(/\s+/, 1)[0] === type,
        render: (tokens, idx) => {
          if (tokens[idx]!.nesting === -1) return type === 'details' ? '</details>' : '</div>'
          const title = tokens[idx]!.info.trim().slice(type.length).trim() || LABELS[type]
          const classes = ' class="nd-container nd-container--' + type + '"'
          return type === 'details'
            ? '<details' + classes + '><summary>' + escapeHtml(title) + '</summary>'
            : '<div' + classes + '><p class="nd-container__title">' + escapeHtml(title) + '</p>'
        },
      })
      // The upstream rule auto-closes incomplete input. Keep that input editable
      // text and ignore marker lines that belong to a fenced code block.
      md.block.ruler.at('container_' + type, (state, start, end, silent) => {
        const position = state.bMarks[start]! + state.tShift[start]!
        if (state.sCount[start]! - state.blkIndent >= 4) return false
        const open = /^(:{3,})[ \t]*([a-z]+)(?:[ \t]+.*)?$/.exec(state.src.slice(position, state.eMarks[start]))
        if (!open || open[2] !== type) return false
        const close = closingLine(state, start, end, open[1]!.length)
        if (close === null) return false
        if (silent) return true
        const oldParent = state.parentType
        const oldMax = state.lineMax
        state.parentType = 'container'
        state.lineMax = close
        const token = state.push('container_' + type + '_open', 'div', 1)
        token.block = true
        token.markup = open[1]!
        token.info = state.src.slice(position + open[1]!.length, state.eMarks[start])
        token.map = [start, close + 1]
        state.md.block.tokenize(state, start + 1, close)
        const closing = state.push('container_' + type + '_close', 'div', -1)
        closing.block = true
        closing.markup = open[1]!
        state.parentType = oldParent
        state.lineMax = oldMax
        state.line = close + 1
        return true
      }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
    }
  },
}
