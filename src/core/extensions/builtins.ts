import Color from '@tiptap/extension-color'
import CharacterCount from '@tiptap/extension-character-count'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { TextStyle } from '@tiptap/extension-text-style'
import { TableKit } from '@tiptap/extension-table'
import Typography from '@tiptap/extension-typography'
import Underline from '@tiptap/extension-underline'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { FindReplace } from './find-replace.js'
import type { AnyExtension, MarkdownLexerConfiguration, MarkdownToken } from '@tiptap/core'

/** Highlight.js grammars shared by the code-block lowlight extension. */
const nexusdownLowlight = createLowlight(common)

const markdownColorPattern = /^\[color\s+color\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s\]]+))\]([\s\S]*?)\[\/color\]/i
const simpleMarkdownColorPattern = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z]+)$/i

function safeColorValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[<>"']/g, '') : ''
}

function canUseMarkdownColor(value: string): boolean {
  return simpleMarkdownColorPattern.test(value)
}

const MarkdownTextStyle = TextStyle.extend({
  markdownTokenName: 'color',
  markdownTokenizer: {
    name: 'color',
    level: 'inline' as const,
    start: (src: string) => src.indexOf('[color'),
    tokenize(src: string, _tokens: MarkdownToken[], helpers: MarkdownLexerConfiguration) {
      const match = markdownColorPattern.exec(src)
      if (!match) return undefined
      const color = safeColorValue(match[1] ?? match[2] ?? match[3])
      if (!color) return undefined
      const content = match[4] ?? ''
      return {
        type: 'color',
        raw: match[0],
        color,
        text: content,
        tokens: helpers.inlineTokens(content),
      } as MarkdownToken
    },
  },
  parseMarkdown: (token, helpers) => {
    const color = safeColorValue((token as { color?: unknown }).color)
    if (!color) return helpers.parseInline([])
    return helpers.applyMark('textStyle', helpers.parseInline(token.tokens || []), { color })
  },
  renderMarkdown: (node, helpers) => {
    const color = safeColorValue(node.attrs?.color)
    if (!color) return helpers.renderChildren(node)
    const children = helpers.renderChildren(node)
    if (canUseMarkdownColor(color)) {
      return `[color color="${color}"]${children}[/color]`
    }
    return `<span style="color: ${color}">${children}</span>`
  },
})

/** The extensions included in every Nexusdown editor by default. */
export function createBuiltInExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ link: false, underline: false, codeBlock: false }),
    MarkdownTextStyle,
    Color.configure({ types: ['textStyle'] }),
    Highlight.configure({ multicolor: true }),
    Underline,
    Superscript,
    Subscript,
    Typography,
    Placeholder.configure({ placeholder: '开始输入…' }),
    CharacterCount,
    Image.configure({ allowBase64: true }),
    Link,
    CodeBlockLowlight.configure({
      lowlight: nexusdownLowlight,
      defaultLanguage: 'plaintext',
    }),
    TableKit.configure({
      table: { resizable: true, renderWrapper: false },
    }),
    TaskList,
    TaskItem,
    Markdown,
    FindReplace,
  ]
}
