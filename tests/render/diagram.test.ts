// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderMarkdown } from '../../src/render/index.js'

const fence = (source: string, language = 'mermaid') => `\`\`\`${language}\n${source}\n\`\`\``
const accessibleFlow = 'flowchart LR\naccTitle: 发布流程\naccDescr: 草稿到发布\nA[草稿] --> B[发布]'

afterEach(() => vi.unstubAllGlobals())

describe('Pele diagram rendering', () => {
  it.each([
    ['flowchart', 'flowchart LR\nA[输入] --> B[发布]'],
    ['sequence', 'sequenceDiagram\nAlice->>Bob: 你好'],
    ['class', 'classDiagram\nAnimal <|-- Duck'],
    ['state', 'stateDiagram-v2\n[*] --> Draft\nDraft --> Published'],
    ['er', 'erDiagram\nUSER ||--o{ POST : writes'],
    ['pie', 'pie\n"完成": 3\n"待办": 1'],
    ['gantt', 'gantt\ndateFormat YYYY-MM-DD\nsection 项目\n准备 :a,2026-01-01,1d'],
    ['mindmap', 'mindmap\n  root((中心))\n    A\n    B'],
  ])('renders %s synchronously in a DOM-free process', (type, source) => {
    expect(globalThis.document).toBeUndefined()
    const html = renderMarkdown(fence(source))
    expect(html).toContain(`class="pele pele-${type}"`)
    expect(html).toContain('class="nd-diagram"')
    expect(html).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/)
    expect(html).not.toContain('language-mermaid')
  })

  it('keeps Mermaid as the source language and treats other fence names as code', () => {
    const html = renderMarkdown(fence(accessibleFlow, 'pele'))
    expect(html).toContain('class="language-pele"')
    expect(html).not.toContain('<svg')
  })

  it('renders diagram fences inside quotes and tabs', () => {
    const quote = fence(accessibleFlow).split('\n').map((line) => `> ${line}`).join('\n')
    expect(renderMarkdown(quote)).toContain('class="pele pele-flowchart"')
    const tabs = `${fence(accessibleFlow)}\n{tab="流程"}\n\n${fence('sequenceDiagram\nA->>B: Hi')}\n{tab="时序"}`
    const html = renderMarkdown(tabs)
    expect(html).toContain('class="nd-tabs"')
    expect(html).toContain('class="pele pele-flowchart"')
    expect(html).toContain('class="pele pele-sequence"')
  })

  it('gives repeated diagrams independent accessibility references in one document', () => {
    const html = renderMarkdown(`${fence(accessibleFlow)}\n\n${fence(accessibleFlow)}`)
    const ids = [...html.matchAll(/(?<![\w-])id="([^"]+)"/g)].map((match) => match[1])
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    for (const id of ids) expect(html).toContain(`="${id}"`)
    expect(html).toContain('aria-labelledby="nd-diagram-1-title"')
    expect(html).toContain('aria-labelledby="nd-diagram-2-title"')
  })

  it('allows stable namespaces for multiple rendered documents', () => {
    const source = fence(accessibleFlow)
    const first = renderMarkdown(source, { diagramIdPrefix: 'article-1' })
    const second = renderMarkdown(source, { diagramIdPrefix: 'article-2' })
    expect(first).toContain('id="article-1-1-title"')
    expect(second).toContain('id="article-2-1-title"')
    expect(first).toBe(renderMarkdown(source, { diagramIdPrefix: 'article-1' }))
    expect(renderMarkdown(source)).toContain('id="nd-diagram-1-title"')
  })

  it('does not use browser canvas metrics or global render counters', () => {
    const source = fence('flowchart LR\nA[中文与 Latin labels] --> B[完成]')
    const server = renderMarkdown(source)
    const createElement = vi.fn(() => { throw new Error('DOM access during synchronous rendering') })
    vi.stubGlobal('document', { createElement })
    const client = renderMarkdown(source)
    expect(client).toBe(server)
    expect(createElement).not.toHaveBeenCalled()
  })

  it.each(['flowchart LR\nA[', 'not a diagram', ''])('keeps invalid diagrams as editable escaped code: %s', (source) => {
    const html = renderMarkdown(fence(source))
    expect(html).toContain('class="language-mermaid"')
    expect(html).not.toContain('<svg')
  })

  it('limits diagram source size and preserves oversized source as code', () => {
    const source = `flowchart LR\nA[${'x'.repeat(50_000)}]`
    const html = renderMarkdown(fence(source))
    expect(html).toContain('class="language-mermaid"')
    expect(html).not.toContain('<svg')
    expect(html).toContain('x'.repeat(50_000))
  })

  it('does not execute labels, link callbacks, or remote image directives', () => {
    const source = [
      'flowchart LR',
      'A["<script>alert(1)</script>"] --> B',
      'click A href "javascript:alert(1)"',
      'click B href "https://example.com"',
      'C@{ img: "https://example.com/a.png", label: "Image" }',
    ].join('\n')
    const html = renderMarkdown(fence(source))
    expect(html).toContain('class="pele pele-flowchart"')
    expect(html).not.toMatch(/<script|<foreignObject|<a\s|<image\s|\sonclick=|\sonload=/)
    expect(html).not.toContain('https://example.com')
  })

  it('escapes invalid source and caller-provided prefixes', () => {
    const invalid = renderMarkdown(fence('<img src=x onerror=alert(1)>'))
    expect(invalid).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(invalid).not.toContain('<img')
    const html = renderMarkdown(fence(accessibleFlow), { diagramIdPrefix: 'x" onload="alert(1)' })
    expect(html).toContain('x&quot; onload=&quot;alert(1)-1-title')
    expect(html).not.toContain(' onload="')
  })

  it('keeps ordinary fences, math, and custom fence renderers working', () => {
    const code = renderMarkdown(fence('flowchart LR\nA --> B', 'text'))
    expect(code).toContain('class="language-text"')
    expect(code).toContain('A --&gt; B')
    expect(code).not.toContain('<svg')
    expect(renderMarkdown(fence('x^2', 'math'))).toContain('nd-math-block')
    expect(renderMarkdown(fence(accessibleFlow), {
      plugins: [(md) => { md.renderer.rules.fence = () => '<pre>custom fence</pre>' }],
    })).toBe('<pre>custom fence</pre>')
  })
})
