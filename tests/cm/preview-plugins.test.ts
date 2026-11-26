import { describe, expect, it } from 'vitest'
import { renderEditorPreview } from '../../src/cm/preview.js'
import { katexRenderer, type MarkdownItPlugin } from '../../src/render/index.js'

function markerPlugin(label: string, installed: () => void): MarkdownItPlugin {
  return md => {
    installed()
    md.inline.ruler.before('text', 'consumer_marker', (state, silent) => {
      if (!state.src.startsWith('%%', state.pos)) return false
      const end = state.src.indexOf('%%', state.pos + 2)
      if (end < 0) return false
      if (!silent) {
        const token = state.push('consumer_marker', '', 0)
        token.content = state.src.slice(state.pos + 2, end)
      }
      state.pos = end + 2
      return true
    })
    md.renderer.rules.consumer_marker = (tokens, index) =>
      `<mark data-consumer="${label}">${md.utils.escapeHtml(tokens[index]!.content)}</mark>`
  }
}

describe('renderEditorPreview custom plugins', () => {
  it('renders consumer syntax and reuses its parser for a stable plugin array', () => {
    let installed = 0
    const custom = markerPlugin('custom', () => installed++)
    const plugins = [custom]
    const source = '%%hello%%'
    expect(renderEditorPreview(source, { plugins })).toContain('<mark data-consumer="custom">hello</mark>')
    expect(renderEditorPreview('%%next%%', { plugins })).toContain('<mark data-consumer="custom">next</mark>')
    expect(installed).toBe(1)
    expect(plugins).toEqual([custom])
    expect(source).toBe('%%hello%%')
  })

  it('keeps optional math and custom syntax working without reinstalling plugins on each render', () => {
    let installed = 0
    const plugins = [markerPlugin('math', () => installed++)]
    const mathRenderer = { renderToString: (tex: string) => `<b class="math-result">${tex}</b>` }
    const first = renderEditorPreview('%%hello%% $x$', { mathRenderer, plugins })
    const second = renderEditorPreview('%%next%% $y$', { mathRenderer, plugins })

    expect(first).toContain('<mark data-consumer="math">hello</mark>')
    expect(first).toContain('<b class="math-result">x</b>')
    expect(second).toContain('<mark data-consumer="math">next</mark>')
    expect(second).toContain('<b class="math-result">y</b>')
    expect(installed).toBe(1)
    expect(plugins).toHaveLength(1)
  })

  it('isolates parsers by both math renderer and custom plugin-array identity', () => {
    let firstInstalls = 0
    let secondInstalls = 0
    const firstPlugins = [markerPlugin('first', () => firstInstalls++)]
    const secondPlugins = [markerPlugin('second', () => secondInstalls++)]
    const firstMath = { renderToString: (tex: string) => `<b class="first-math">${tex}</b>` }
    const secondMath = { renderToString: (tex: string) => `<b class="second-math">${tex}</b>` }
    const source = '%%value%% $x$'

    const first = renderEditorPreview(source, { plugins: firstPlugins, mathRenderer: firstMath })
    const second = renderEditorPreview(source, { plugins: secondPlugins, mathRenderer: firstMath })
    const third = renderEditorPreview(source, { plugins: firstPlugins, mathRenderer: secondMath })
    const noMath = renderEditorPreview(source, { plugins: firstPlugins })
    const repeated = renderEditorPreview(source, { plugins: firstPlugins, mathRenderer: firstMath })

    expect(first).toContain('data-consumer="first"')
    expect(first).toContain('class="first-math"')
    expect(second).toContain('data-consumer="second"')
    expect(second).toContain('class="first-math"')
    expect(third).toContain('data-consumer="first"')
    expect(third).toContain('class="second-math"')
    expect(noMath).toContain('data-consumer="first"')
    expect(noMath).not.toContain('class="first-math"')
    expect(noMath).not.toContain('class="second-math"')
    expect(repeated).toBe(first)
    expect(firstInstalls).toBe(3)
    expect(secondInstalls).toBe(1)
  })

  it('installs custom plugins after the optional math plugin so consumer overrides take effect', () => {
    const mathRenderer = { renderToString: () => '<b class="default-math"></b>' }
    const consumerMath = { renderToString: () => '<b class="consumer-math"></b>' }
    const plugins = [katexRenderer(consumerMath)]

    const html = renderEditorPreview('$x$', { mathRenderer, plugins })
    expect(html).toContain('class="consumer-math"')
    expect(html).not.toContain('class="default-math"')
  })
})
