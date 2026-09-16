import { describe, expect, it } from 'vitest'
import { Extension, Mark, type MarkdownLexerConfiguration, type MarkdownToken } from '@tiptap/core'
import { createNexusdownEditor } from '../../src/core/session'
import { createNexusdownExtensions } from '../../src/core/extensions'

describe('Nexusdown extension registry', () => {
  it('includes the built-in formatting and media extensions', () => {
    const extensions = createNexusdownExtensions()
    const names = extensions.map((extension) => extension.name)

    expect(names).toEqual(expect.arrayContaining([
      'color',
      'highlight',
      'underline',
      'superscript',
      'subscript',
      'typography',
      'placeholder',
      'characterCount',
      'image',
    ]))
    const session = createNexusdownEditor({ content: '', contentType: 'markdown' })
    expect(session.getEditor().extensionManager.extensions.find((extension) => extension.name === 'table')?.options.resizable).toBe(true)
    session.destroy()
  })

  it('appends caller extensions and lets a resolver adjust the list', () => {
    const custom = Extension.create({ name: 'customNexusdownMark' })
    const extensions = createNexusdownExtensions({
      extensions: [custom],
      resolve: (defaults) => defaults.filter((extension) => extension.name !== 'image'),
    })

    expect(extensions.some((extension) => extension.name === custom.name)).toBe(true)
    expect(extensions.some((extension) => extension.name === 'image')).toBe(false)
  })

  it('rejects a resolver that does not return an extension array', () => {
    expect(() => createNexusdownExtensions({ resolve: () => undefined as never })).toThrow(/must return an array/)
  })
})

describe('NexusdownEditorSession extension options', () => {
  it('passes custom extensions and resolver output to the Tiptap editor', () => {
    const custom = Extension.create({ name: 'customNexusdownExtension' })
    const session = createNexusdownEditor({
      content: '<p>hello</p>',
      contentType: 'html',
      extensions: [custom],
      extensionResolver: (extensions) => extensions.filter((extension) => extension.name !== 'image'),
    })

    const names = session.getEditor().extensionManager.extensions.map((extension) => extension.name)
    expect(names).toContain(custom.name)
    expect(names).not.toContain('image')
    session.destroy()
  })

  it('registers custom Markdown tokenizer and serializer hooks from extensions', () => {
    const Badge = Mark.create({
      name: 'badge',
      parseHTML: () => [{ tag: 'span[data-badge]' }],
      renderHTML: () => ['span', { 'data-badge': '' }, 0],
      markdownTokenName: 'badge',
      markdownTokenizer: {
        name: 'badge',
        level: 'inline' as const,
        start: (src: string) => src.indexOf('!!'),
        tokenize(src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) {
          const match = /^!!([^!]+)!!/.exec(src)
          if (!match) return undefined
          return { type: 'badge', raw: match[0], text: match[1], tokens: helpers.inlineTokens(match[1]) } as MarkdownToken
        },
      },
      parseMarkdown: (token, helpers) => helpers.applyMark('badge', helpers.parseInline(token.tokens || [])),
      renderMarkdown: (node, helpers) => `!!${helpers.renderChildren(node)}!!`,
    })

    const session = createNexusdownEditor({
      content: '!!custom!!',
      contentType: 'markdown',
      extensions: [Badge],
    })

    expect(session.getHTML()).toContain('data-badge')
    expect(session.getMarkdown()).toBe('!!custom!!')
    session.destroy()
  })

  it('round-trips a fenced TypeScript code block with its language marker', () => {
    const session = createNexusdownEditor({
      content: '```ts\nconst x: number = 1\n```',
      contentType: 'markdown',
    })

    expect(session.getEditor().getAttributes('codeBlock').language).toBe('ts')
    expect(session.getMarkdown()).toContain('```ts')
    expect(session.getMarkdown()).toContain('const x: number = 1')
    session.destroy()
  })

  it('updates the code block language via setCodeBlockLanguage', () => {
    const session = createNexusdownEditor({
      content: '```js\nconst x = 1\n```',
      contentType: 'markdown',
    })

    expect(session.getEditor().getAttributes('codeBlock').language).toBe('js')
    expect(session.commands.setCodeBlockLanguage('ts')).toBe(true)
    expect(session.getEditor().getAttributes('codeBlock').language).toBe('ts')
    expect(session.getMarkdown()).toContain('```ts')
    expect(session.getHTML()).toContain('language-ts')
    session.destroy()
  })

  it('reports character and line counts from the built-in CharacterCount extension', () => {
    const session = createNexusdownEditor({
      content: '# Title\n\nHello world',
      contentType: 'markdown',
    })
    const storage = session.getEditor().storage.characterCount as {
      characters: () => number
    }

    expect(storage.characters()).toBeGreaterThan(0)
    session.destroy()
  })
})
