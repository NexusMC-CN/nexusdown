/**
 * `media`（动态图）—— 两侧 URL 白名单对齐的测试。
 *
 * 这个功能**不新增语法**（`![x](a.gif)` 照旧），只是把编辑器侧
 * `src/cm/url.ts` 的 `data:image/*` 白名单收敛到渲染侧 markdown-it 的
 * `GOOD_DATA_RE = /^data:image\/(gif|png|jpeg|webp);/`。
 *
 * 三层断言：
 *  1. `safeUrl` 本身放行/拒绝什么（单测）；
 *  2. **交叉断言**：`data:image` 这一维上，编辑器侧（`safeUrl`）与渲染侧
 *     （markdown-it 的 `validateLink`）逐个 URL 结果一致 —— 这是「两侧对齐」
 *     这条不变量的直接守卫；
 *  3. 端到端：渲染侧 `renderMarkdown` 与编辑器侧（真挂编辑器看有没有 ImageWidget）
 *     对同一个 URL 给出**同样的取舍**。
 *
 * ⚠️ 交叉断言只覆盖 `data:image` 这一维。别的 scheme 两侧**故意**不同
 *    （`url.ts` 连 `mailto:` 都拒，markdown-it 放行），那是既有设计，不在本次范围。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import MarkdownIt from 'markdown-it'
import { afterEach, describe, expect, it } from 'vitest'

import { decorateBlock } from '../../src/cm/decorate/block.js'
import { nexusdownLivePreview, type LivePreviewPluginValue } from '../../src/cm/plugin.js'
import { safeUrl } from '../../src/cm/url.js'
import { ImageWidget } from '../../src/cm/widgets/image.js'
import { renderMarkdown } from '../../src/render/index.js'

/** 两侧都应放行的 `data:image` URL（四种 + 大小写不敏感）。 */
const ALLOWED = [
  'data:image/gif;base64,R0lGOD',
  'data:image/png;base64,iVBORw0KGgo',
  'data:image/jpeg;base64,/9j/4AAQ',
  'data:image/webp;base64,UklGR',
  'DATA:IMAGE/PNG;base64,iVBORw0KGgo',
]

/** 两侧都应拒绝的 `data:image` URL —— 前两条就是本次要修的 APNG / SVG。 */
const REJECTED = [
  'data:image/apng;base64,AAAA', // ← APNG：此前编辑器放行、渲染器拒绝
  'data:image/svg+xml;base64,PHN2Zz4=', // ← SVG：同上
  'data:image/bmp;base64,Qk',
  'data:image/avif;base64,AAAA',
  'data:image/png', // 缺分号：markdown-it 也拒
  'data:image/svg+xml',
  'data:image/;base64,AAAA', // 没有 subtype
]

describe('media —— safeUrl 的 data:image 白名单', () => {
  it('放行 gif / png / jpeg / webp（带分号），大小写不敏感', () => {
    for (const url of ALLOWED) {
      expect(safeUrl(url), url).toBe(url.trim())
    }
  })

  it('★ 拒绝 APNG / SVG 及其它 subtype、以及缺分号的写法', () => {
    for (const url of REJECTED) {
      expect(safeUrl(url), url).toBeNull()
    }
  })

  it('白名单只作用于 `data:` scheme —— http(s) 的 .apng 不受影响', () => {
    expect(safeUrl('https://a.com/x.apng')).toBe('https://a.com/x.apng')
    expect(safeUrl('./x.apng')).toBe('./x.apng')
  })
})

describe('media —— 两侧白名单一致（data:image 维度）', () => {
  const md = new MarkdownIt()

  it('★ 编辑器侧 safeUrl 与渲染侧 md.validateLink 对每个 URL 判断相同', () => {
    for (const url of [...ALLOWED, ...REJECTED]) {
      const editorAllows = safeUrl(url) !== null
      const rendererAllows = md.validateLink(url)
      expect(editorAllows, url).toBe(rendererAllows)
    }
  })

  it('★ 修复点：APNG / SVG 两侧现在**都拒绝**', () => {
    for (const url of ['data:image/apng;base64,AAAA', 'data:image/svg+xml;base64,AAAA']) {
      expect(safeUrl(url)).toBeNull()
      expect(md.validateLink(url)).toBe(false)
    }
  })
})

describe('media —— 端到端：渲染侧 renderMarkdown', () => {
  it('放行的 data:image 渲染成真 <img>', () => {
    expect(renderMarkdown('![x](data:image/png;base64,AAAA)')).toBe(
      '<p><img src="data:image/png;base64,AAAA" alt="x"/></p>',
    )
  })

  it('★ 被拒的 data:image 降级成**源码文本**（和编辑器侧一致）', () => {
    // 两边都拒绝，而且降级形态都是「原样源码」，不是 <img src="">。
    expect(renderMarkdown('![x](data:image/apng;base64,AAAA)')).toBe(
      '<p>![x](data:image/apng;base64,AAAA)</p>',
    )
    expect(renderMarkdown('![x](data:image/svg+xml;base64,AAAA)')).toBe(
      '<p>![x](data:image/svg+xml;base64,AAAA)</p>',
    )
  })
})

describe('media —— 端到端：编辑器侧真的用了这个白名单', () => {
  const views: EditorView[] = []

  afterEach(() => {
    for (const view of views.splice(0)) view.destroy()
    document.body.innerHTML = ''
  })

  /** 挂一个真编辑器（光标在末尾，避免图片被揭示成源码）。 */
  function mount(doc: string) {
    const plugin = nexusdownLivePreview({ decorators: { block: decorateBlock } })
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown({ base: markdownLanguage, addKeymap: false }), plugin] as Extension[],
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({ state, parent })
    views.push(view)
    const instance = view.plugin(plugin as unknown as ViewPlugin<LivePreviewPluginValue>)
    if (!instance) throw new Error('插件没有挂上')
    return instance
  }

  function widgets(instance: LivePreviewPluginValue): ImageWidget[] {
    const out: ImageWidget[] = []
    instance.decorations.between(0, 1e9, (_f, _t, value) => {
      const widget = (value.spec as { widget?: unknown }).widget
      if (widget instanceof ImageWidget) out.push(widget)
    })
    return out
  }

  it('放行的 data:image → 产出 ImageWidget', () => {
    const instance = mount('![x](data:image/png;base64,AAAA)\n\n尾部')
    const ws = widgets(instance)

    expect(ws).toHaveLength(1)
    expect(ws[0]).toMatchObject({ src: 'data:image/png;base64,AAAA', alt: 'x' })
    expect(instance.atomicDecorations.size).toBe(1)
  })

  it('★ 被拒的 APNG / SVG → 不产出 widget（源码原样显示，和渲染侧一致）', () => {
    for (const url of ['data:image/apng;base64,AAAA', 'data:image/svg+xml;base64,AAAA']) {
      const instance = mount(`![x](${url})\n\n尾部`)
      expect(widgets(instance), url).toHaveLength(0)
      expect(instance.decorations.size, url).toBe(0)
    }
  })

  it('http(s) 的动态图（.apng）照常产出 widget —— 白名单不按扩展名拦', () => {
    const instance = mount('![x](https://a.com/x.apng)\n\n尾部')
    expect(widgets(instance)[0]).toMatchObject({ src: 'https://a.com/x.apng', alt: 'x' })
  })
})
