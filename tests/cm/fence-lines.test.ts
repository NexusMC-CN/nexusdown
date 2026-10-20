/**
 * 代码块 `{lines}` / `{highlight="…"}` 的编辑器侧行装饰。
 *
 * 纯函数层：在真语法树里找 `FencedCode`，直接调 `decorateFencedCode`，
 * 读行装饰的 class（不依赖 DOM）。
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'
import { describe, expect, it } from 'vitest'

import { decorateFencedCode } from '../../src/cm/decorate/fence.js'

function lineClasses(doc: string, cursor = doc.length): string[] {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, addKeymap: false })],
  })
  const ranges: { from: number; to: number; value: Decoration }[] = []
  const atomic: typeof ranges = []

  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'FencedCode') {
        decorateFencedCode(ranges, atomic, ref.node, state.doc, state.selection)
      }
    },
  })

  return ranges
    .map((range) => (range.value.spec as { class?: string }).class)
    .filter((cls): cls is string => Boolean(cls))
}

describe('fence lines / highlight', () => {
  it('★ `{lines}` → 两个内容行都带 nd-code-lines，首个带 first', () => {
    const classes = lineClasses('```ts\na\nb\n```\n{lines}\n\n尾部')
    expect(classes.filter((cls) => cls.includes('nd-code-lines')).length).toBe(2)
    expect(classes.filter((cls) => cls.includes('nd-code-lines-first')).length).toBe(1)
  })

  it('★ `{highlight="2"}` → 第二个内容行带 nd-code-hl', () => {
    const classes = lineClasses('```ts\na\nb\n```\n{highlight="2"}\n\n尾部')
    expect(classes.filter((cls) => cls.includes('nd-code-hl')).length).toBe(1)
  })

  it('没有属性行 → 不加行号/高亮类', () => {
    const classes = lineClasses('```ts\na\nb\n```\n\n尾部')
    expect(classes.some((cls) => cls.includes('nd-code-lines'))).toBe(false)
    expect(classes.some((cls) => cls.includes('nd-code-hl'))).toBe(false)
  })
})
