import { katexRenderer, renderMarkdown } from '../render/index.js'
import type { KatexLike, MarkdownItPlugin, RenderData } from '../render/index.js'

export interface RenderEditorPreviewOptions {
  /** Use a distinct, stable namespace for each preview fragment. */
  idPrefix?: string
  /** Heading numbers only affect display; defaults to false. */
  headingNumbers?: boolean
  mathRenderer?: KatexLike
  /** Already resolved data. Preview rendering never fetches URLs. */
  data?: RenderData
}

const mathPlugins = new WeakMap<KatexLike, MarkdownItPlugin[]>()

/** Render the complete Markdown document with the same renderer used for publishing. */
export function renderEditorPreview(markdown: string, options: RenderEditorPreviewOptions = {}): string {
  let plugins: MarkdownItPlugin[] | undefined
  if (options.mathRenderer) {
    plugins = mathPlugins.get(options.mathRenderer)
    if (!plugins) {
      plugins = [katexRenderer(options.mathRenderer)]
      mathPlugins.set(options.mathRenderer, plugins)
    }
  }
  return renderMarkdown(markdown, {
    idPrefix: options.idPrefix,
    headingNumbers: options.headingNumbers,
    data: options.data,
    plugins,
  })
}
