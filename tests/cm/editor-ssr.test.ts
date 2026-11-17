// @vitest-environment node
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import NexusdownEditor from '../../src/editor/Editor.vue'

describe('NexusdownEditor SSR', () => {
  it('renders a deterministic shell without loading a browser engine or allocating preview anchors', async () => {
    const render = () => renderToString(createSSRApp({
      render: () => h(NexusdownEditor, { modelValue: '[TOC]\n\n# 标题', headingNumbers: true }),
    }))
    const first = await render()
    expect(first).toBe(await render())
    expect(first).toContain('nd-editor__content')
    expect(first).toContain('disabled')
    expect(first).not.toContain('nd-editor-preview-')
    expect(first).not.toContain('class="cm-editor')
    expect(first).not.toContain('nd-toc')
  })
})
