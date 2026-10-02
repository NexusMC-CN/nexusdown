/**
 * `paragraph` 编辑器侧：独占一段的两种特殊段落。
 *
 * 断言的是**行级 class 挂对了没有**，以及**误伤**（段落里混了文字就不该挂）。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { paragraphFeature } from '../../src/cm/features/paragraph.js'
import { nexusdownLivePreview } from '../../src/cm/plugin.js'

function classesOf(doc: string): string[] {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage }),
        nexusdownLivePreview({ features: new Map([['Paragraph', paragraphFeature]]) }),
      ],
    }),
  })
  const out = Array.from(view.contentDOM.querySelectorAll('.cm-line')).map((el) => el.className)
  view.destroy()
  return out
}

describe('paragraph：独占一段的链接 → 卡片提示', () => {
  it('裸 URL 独占一段', () => {
    expect(classesOf('https://example.com/post')[0]).toContain('nd-para-card')
  })

  it('Markdown 链接写法也认', () => {
    expect(classesOf('[标题](https://example.com/post)')[0]).toContain('nd-para-card')
  })

  it('★ 段落里混了文字 → 不是卡片（否则会吞掉作者写的话）', () => {
    expect(classesOf('看这个 https://example.com/post 挺好')[0]).not.toContain('nd-para-card')
  })

  it('非 http(s) 的链接不算', () => {
    expect(classesOf('[x](mailto:a@b.c)')[0]).not.toContain('nd-para-card')
  })
})

describe('paragraph：独占一段的多张图 → 轮播提示', () => {
  it('两张图独占一段', () => {
    expect(classesOf('![一](a.png)\n![二](b.png)')[0]).toContain('nd-para-carousel')
  })

  it('★ 单张图不是轮播', () => {
    expect(classesOf('![一](a.png)')[0]).not.toContain('nd-para-carousel')
  })

  it('★ 图和文字混排不是轮播', () => {
    expect(classesOf('![一](a.png)\n文字')[0]).not.toContain('nd-para-carousel')
  })
})
