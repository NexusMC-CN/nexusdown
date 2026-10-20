import { renderDiagram } from '../../shared/diagram.js'
import type { RenderFeature } from '../feature.js'

interface DiagramEnvironment {
  diagramIdPrefix?: string
  diagramSequence?: number
}

export const diagramFeature: RenderFeature = {
  name: 'diagram',
  install({ md, rules }) {
    const baseFence = rules.fence
    rules.fence = (tokens, index, options, env, self) => {
      const token = tokens[index]!
      const language = md.utils.unescapeAll(token.info).trim().split(/\s+/)[0]
      if (language === 'mermaid') {
        // markdown-it passes the same per-render env to fences inside tabs too.
        const state = env as DiagramEnvironment
        const sequence = (state.diagramSequence ?? 0) + 1
        state.diagramSequence = sequence
        const idPrefix = `${state.diagramIdPrefix ?? 'nd-diagram'}-${sequence}`
        const diagram = renderDiagram(token.content, idPrefix)
        if (diagram) return `<div class="nd-diagram">${diagram.svg}</div>`
      }
      return baseFence ? baseFence(tokens, index, options, env, self) : ''
    }
  },
}
