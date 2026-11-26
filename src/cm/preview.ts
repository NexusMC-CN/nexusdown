import { katexRenderer, renderMarkdown } from '../render/index.js'
import type { KatexLike, MarkdownItPlugin, RenderData } from '../render/index.js'

export interface RenderEditorPreviewOptions {
  /** Use a distinct, stable namespace for each preview fragment. */
  idPrefix?: string
  /** Heading numbers only affect display; defaults to false. */
  headingNumbers?: boolean
  mathRenderer?: KatexLike
  /** Stable custom plugin array, applied after the optional math renderer. */
  plugins?: MarkdownItPlugin[]
  /** Already resolved data. Preview rendering never fetches URLs. */
  data?: RenderData
}

const mathPlugins = new WeakMap<KatexLike, {
  math: MarkdownItPlugin[]
  custom: WeakMap<MarkdownItPlugin[], MarkdownItPlugin[]>
}>()

/** Render the complete Markdown document with the same renderer used for publishing. */
export function renderEditorPreview(markdown: string, options: RenderEditorPreviewOptions = {}): string {
  let plugins = options.plugins
  if (options.mathRenderer) {
    let cached = mathPlugins.get(options.mathRenderer)
    if (!cached) {
      cached = { math: [katexRenderer(options.mathRenderer)], custom: new WeakMap() }
      mathPlugins.set(options.mathRenderer, cached)
    }
    if (plugins) {
      let combined = cached.custom.get(plugins)
      if (!combined) {
        combined = [...cached.math, ...plugins]
        cached.custom.set(plugins, combined)
      }
      plugins = combined
    } else {
      plugins = cached.math
    }
  }
  return renderMarkdown(markdown, {
    idPrefix: options.idPrefix,
    headingNumbers: options.headingNumbers,
    data: options.data,
    plugins,
  })
}
