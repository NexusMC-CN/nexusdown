// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as api from '../../src/render/index.js'

type Block = { kind: string; from: number; to: number; html: string }
type Analyzer = (source: string, options?: { idPrefix?: string }) => Block[]

function analyze(source: string): Block[] {
  const fn = (api as unknown as { analyzeMarkdownBlocks?: Analyzer }).analyzeMarkdownBlocks
  expect(typeof fn).toBe('function')
  return fn!(source, { idPrefix: 'editor' })
}

describe('shared Markdown preview analysis', () => {
  it.each([
    { name: 'LF', newline: String.fromCharCode(10), from: 8, to: 25 },
    { name: 'CRLF', newline: String.fromCharCode(13, 10), from: 10, to: 29 },
    { name: 'CR', newline: String.fromCharCode(13), from: 8, to: 25 },
  ])('preserves original UTF-16 block offsets for $name newlines', ({ newline, from, to }) => {
    const source = ['before', '', '::: note', 'body', ':::', '', 'after'].join(newline)
    const blocks = analyze(source)
    expect(blocks).toHaveLength(1)
    expect({ from: blocks[0]!.from, to: blocks[0]!.to }).toEqual({ from, to })
    expect(source.slice(blocks[0]!.from, blocks[0]!.to)).toBe(['::: note', 'body', ':::'].join(newline))
    expect(blocks[0]!.html).toContain('nd-container--note')
  })
  it('returns exact container and definition-list ranges without hiding adjacent text', () => {
    const container = '::: note 标题\n正文\n:::'
    const definition = '术语\n: 定义'
    const source = '开头\n\n' + container + '\n\n' + definition + '\n\n尾段'
    const blocks = analyze(source)
    expect(blocks.map((block) => block.kind)).toEqual(['container', 'definition-list'])
    expect(source.slice(blocks[0]!.from, blocks[0]!.to)).toBe(container)
    expect(source.slice(blocks[1]!.from, blocks[1]!.to)).toBe(definition)
    expect(blocks[0]!.html).toContain('nd-container--note')
    expect(blocks[1]!.html).toContain('<dl>')
  })

  it('renders TOC previews from full-document headings', () => {
    const source = '[TOC]\n\n# 安装\n\n正文'
    const blocks = analyze(source)
    expect(blocks).toHaveLength(1)
    expect(source.slice(blocks[0]!.from, blocks[0]!.to)).toBe('[TOC]')
    expect(blocks[0]!.html).toContain('href="#editor-安装"')
  })

  it('previews only a footnote definition while preserving its global number', () => {
    const definition = '[^n]: 注释 **正文**'
    const source = '先引用[^first]，再引用[^n]。\n\n[^first]: 第一项\n\n' + definition + '\n\n尾段'
    const blocks = analyze(source)
    const block = blocks.find((candidate) => source.slice(candidate.from, candidate.to) === definition)
    expect(block).toBeDefined()
    expect(block!.kind).toBe('footnote')
    expect(block!.html).toContain('id="editor-fn2"')
    expect(block!.html).toContain('<strong>正文</strong>')
    expect(block!.html).not.toContain('先引用')
  })

  it('does not expose extension blocks inside code, nested previews, or quote markers', () => {
    const fence = String.fromCharCode(96).repeat(3)
    const source = fence + '\n::: note\n文字\n:::\n' + fence +
      '\n\n> ::: note\n> 正文\n> :::\n\n:::: note 外层\n::: tip 内层\n文字\n:::\n::::'
    const blocks = analyze(source)
    expect(blocks).toHaveLength(1)
    expect(source.slice(blocks[0]!.from, blocks[0]!.to)).toContain(':::: note 外层')
    expect(blocks[0]!.html).toContain('nd-container--tip')
  })
})
