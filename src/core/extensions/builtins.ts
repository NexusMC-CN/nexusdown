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
import TextAlign from '@tiptap/extension-text-align'
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

/**
 * Render a paragraph/heading as Markdown, persisting block alignment and indent.
 *
 * `@tiptap/extension-text-align` ships no Markdown support, so alignment was
 * silently dropped by `getMarkdown()`. The Markdown manager resolves render
 * handlers **per node type**, and both `textAlign` and `indent` are attributes
 * of `paragraph` / `heading` rather than node types of their own — so those
 * nodes are the only place the hook can fire.
 *
 * Markdown has no syntax for either, so both are emitted as an HTML block with
 * an inline style. Blocks with neither stay plain Markdown (a `#`-prefixed
 * heading or bare paragraph text).
 */
function renderAlignedBlock(
  node: { attrs?: Record<string, unknown>; type?: unknown; content?: unknown[] },
  helpers: { renderChildren: (node: unknown) => string },
): string {
  const align = typeof node.attrs?.textAlign === 'string' ? node.attrs.textAlign : ''
  const indent = typeof node.attrs?.indent === 'number' && node.attrs.indent > 0 ? node.attrs.indent : 0
  const aligned = Boolean(align && align !== 'left')

  // `type` is a plain string on the JSON nodes the renderer passes in, but a
  // `{ name }` object on ProseMirror nodes; accept both.
  const typeName = typeof node.type === 'string' ? node.type : (node.type as { name?: string } | undefined)?.name
  const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
  // Always pass the child *array*, not the node: handing back the node makes the
  // manager re-render the same block through this handler and recurse forever.
  const children = helpers.renderChildren(node.content ?? [])

  // Without alignment or indent, emit exactly what the stock renderers would.
  // Delegating to `this.parent()` is not an option: that handler is bound to the
  // manager's own helper set, which is not available here.
  if (!aligned && !indent) {
    return typeName === 'heading' ? `${'#'.repeat(level)} ${children}` : children
  }

  const tag = typeName === 'heading' ? `h${level}` : 'p'
  const style = [aligned ? `text-align: ${align}` : '', indent ? `margin-left: ${indent * 2}em` : '']
    .filter(Boolean)
    .join('; ')
  return `<${tag} style="${style}">${children}</${tag}>`
}

/** Default `indent` attribute contributed to paragraph and heading nodes. */
const indentAttribute = {
  indent: {
    default: null as number | null,
    parseHTML: (element: HTMLElement) => {
      const margin = element.style.marginLeft
      const match = margin ? /^([\d.]+)em$/.exec(margin) : null
      return match ? Math.round(Number(match[1]) / 2) || null : null
    },
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes.indent
      if (typeof value !== 'number' || value <= 0) return {}
      return { style: `margin-left: ${value * 2}em` }
    },
  },
}

/**
 * Rebuild a StarterKit bundle, swapping the named child nodes for variants that
 * carry the `indent` attribute and render block alignment/indent as Markdown.
 *
 * StarterKit is a single extension that injects its children through
 * `addExtensions()`, so the only way to override one child is to re-declare the
 * bundle with that child replaced.
 */
function replaceStarterKitNodes(bundle: AnyExtension, nodeNames: string[]): AnyExtension {
  const targets = new Set(nodeNames)
  const instance = bundle as unknown as {
    options: Record<string, unknown>
    config: { addExtensions?: () => AnyExtension[] }
  }
  return bundle.extend({
    addExtensions() {
      const children = instance.config.addExtensions?.call(this) ?? []
      return children.map((child) => {
        if (!targets.has(child.name)) return child
        return child.extend({
          addAttributes(this: { parent?: () => Record<string, unknown> | undefined }) {
            const inherited = this.parent?.() ?? {}
            return { ...inherited, ...indentAttribute }
          },
          renderMarkdown: renderAlignedBlock,
        }) as AnyExtension
      })
    },
  })
}

/** The extensions included in every Nexusdown editor by default. */
export function createBuiltInExtensions(): AnyExtension[] {
  const starterKit = StarterKit.configure({ link: false, underline: false, codeBlock: false })
  return [
    // StarterKit's `paragraph` and `heading` carry the `textAlign` attribute
    // (contributed by TextAlign below). Because the Markdown manager resolves
    // render handlers per node type, those two nodes are where alignment and
    // indent must be emitted — so replace the bundle's own instances.
    replaceStarterKitNodes(starterKit, ['paragraph', 'heading']),
    MarkdownTextStyle,
    Color.configure({ types: ['textStyle'] }),
    Highlight.configure({ multicolor: true }),
    Underline,
    Superscript,
    Subscript,
    Typography,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
    }),
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
