// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderDiagram } from '../../src/shared/diagram.js'

describe('shared diagram renderer', () => {
  it('returns intrinsic dimensions for editor geometry and responsive SVG', () => {
    const diagram = renderDiagram('flowchart LR\nA[草稿] --> B[发布]', 'editor-1')
    expect(diagram).not.toBeNull()
    expect(diagram!.width).toBeGreaterThan(0)
    expect(diagram!.height).toBeGreaterThan(0)
    expect(diagram!.svg).toContain(`viewBox="0 0 ${diagram!.width} ${diagram!.height}"`)
    expect(diagram!.svg).toContain('max-width:100%;height:auto;')
    expect(diagram!.type).toBe('flowchart')
  })

  it('keeps accessibility IDs scoped without changing diagram geometry', () => {
    const source = 'flowchart LR\naccTitle: 编辑与预览\naccDescr: 同一份源码\nA --> B'
    const editor = renderDiagram(source, 'editor-1')!
    const preview = renderDiagram(source, 'preview-1')!
    expect(editor.svg).toContain('aria-labelledby="editor-1-title"')
    expect(preview.svg).toContain('aria-describedby="preview-1-desc"')
    expect(editor.svg.replaceAll('editor-1', 'preview-1')).toBe(preview.svg)
    expect(editor.width).toBe(preview.width)
    expect(editor.height).toBe(preview.height)
  })

  it('bounds compact edge expansions before layout', () => {
    const left = Array.from({ length: 75 }, (_, index) => `A${index}`).join(' & ')
    const right = Array.from({ length: 75 }, (_, index) => `B${index}`).join(' & ')
    expect(renderDiagram(`flowchart LR\n${left} --> ${right}`, 'limited')).toBeNull()
  })

  it('does not let Mermaid init directives enable external links or images', () => {
    const source = [
      '%%{init: {"securityLevel": "loose", "links": true, "images": true}}%%',
      'flowchart LR',
      'A[Link] --> B',
      'click A href "https://example.com"',
      'B@{ img: "https://example.com/image.png" }',
    ].join('\n')
    const diagram = renderDiagram(source, 'restricted')
    expect(diagram).not.toBeNull()
    expect(diagram!.svg).not.toMatch(/<a\s|<image\s|https:\/\/example\.com/)
  })

  it('does not treat author-provided size limits as host render options', () => {
    const source = `%%{init: {"maxTextSize": 1000000, "limit": 1000000}}%%\nflowchart LR\nA[${'x'.repeat(50_000)}]`
    expect(renderDiagram(source, 'limited')).toBeNull()
  })
})
