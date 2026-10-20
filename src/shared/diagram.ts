import { render } from 'pele'
import { diagramTextMeasurer } from './diagram-metrics.js'

export interface RenderedDiagram {
  readonly svg: string
  readonly width: number
  readonly height: number
  readonly type: string
}

/** Shared synchronous renderer for Markdown output and editor widgets. */
export function renderDiagram(source: string, idPrefix: string): RenderedDiagram | null {
  try {
    const { svg, width, height, type } = render(source, {
      idPrefix,
      measurer: diagramTextMeasurer,
      // A single font contract for the server's estimates and browser labels.
      fontFamily: 'Arial, sans-serif',
      links: false,
      images: false,
      limit: 50_000,
      outputLimit: 4_000_000,
      maxEdges: 5_000,
    })
    return { svg, width, height, type }
  } catch {
    // Incomplete diagrams are normal while editing. Keep their original fence
    // visible instead of interrupting the document or inserting error markup.
    return null
  }
}
