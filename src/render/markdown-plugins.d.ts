declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it'
  export default function footnote(md: MarkdownIt): void
}

declare module 'markdown-it-deflist' {
  import type { MarkdownIt } from 'markdown-it'
  export default function definitionList(md: MarkdownIt): void
}

declare module 'markdown-it-container' {
  import type { MarkdownIt, RendererRule } from 'markdown-it'
  export default function container(md: MarkdownIt, name: string, options?: {
    validate?: (params: string, markup: string) => boolean
    render?: RendererRule
  }): void
}
