# Real-time content references

References store stable entity IDs in Markdown, never titles, URLs, or body snapshots:

```md
[[resource:resource-1]]
[[tutorial:tutorial-1#section:section-1]]
[[tutorial:tutorial-1#block:block-1]]
See [[post:post-1]] for details.
```

A reference alone in a top-level paragraph displays as a card. Inside text it displays as a link. Code, escaped brackets, image labels, Markdown links and attribute values do not create reference facts. Ordinary Markdown reference-style links and legacy `@slug` mentions keep their existing APIs.

Both `/render` and `/cm` export `ContentReferenceTarget`, `ContentReferenceResolution`, `ContentReferenceResolutions`, `ContentReferenceCandidate`, `ContentReferenceProvider`, `contentReferenceKey`, and `formatContentReference`. Invalid targets throw `TypeError` in the key/format helpers. IDs contain 1–128 ASCII letters, digits, underscores or hyphens and start with a letter or digit. Only tutorials accept paired section/block fragment fields.

## Resolve before rendering

```ts
import { extractContentReferences, renderMarkdown } from '@nexusmc-cn/nexusdown/render'

const targets = extractContentReferences(markdown)
// The host resolves public targets and supplies a fresh map for each render.
const contentReferences = await resolveCurrentPublicTargets(targets)
const html = renderMarkdown(markdown, { data: { contentReferences } })
```

The map key is `kind:id` or `tutorial:id#section:id` / `tutorial:id#block:id`. Available results contain `status: 'available'`, `kind`, `title`, `href`, optional `summary`, and optional `targetTitle`. Explicit `{ status: 'unavailable' }` results display a generic non-link “内容不可用” label. Missing results preserve literal Markdown. Hrefs must start with exactly one slash and contain no backslashes, whitespace or control characters. All result text is escaped; summaries are limited to 280 Unicode characters and are never recursively rendered as Markdown.

The renderer stays synchronous and DOM-free. It does not fetch data or retain a request’s resolution map in its cached parser.

## Editor and toolbar

Pass `contentReferenceProvider` to `NexusdownEditor` or `NexusdownToolbar` to enable “插入引用”. Its signature is:

```ts
type ContentReferenceProvider = (request: {
  query: string
  target?: ContentReferenceTarget
  signal: AbortSignal
}) => Promise<ContentReferenceCandidate[]>
```

Without `target`, search resources, tutorials and posts. With a tutorial `target`, search that tutorial’s persistent section and block IDs. The panel offers the whole tutorial separately. Hosts remain responsible for authorization and for explaining any server-side result truncation; the generic provider does not expose pagination metadata. Queries are bounded to 100 code units. Canceled and superseded requests cannot replace newer results. Failures can be retried.

Supply current results through `renderData.contentReferences` or the editor’s direct `contentReferences` prop (the direct prop takes precedence). Replace the read-only map when results change. Both Preview and Live Preview use the latest map; asynchronous loading belongs to the host.

For direct CM consumers:

```ts
import { mountEditor, insertContentReference, updateContentReferences } from '@nexusmc-cn/nexusdown/cm'

const view = mountEditor({ parent, doc: markdown, contentReferences })
insertContentReference({ kind: 'post', id: 'post-1' }, { block: true })(view)
updateContentReferences(view, refreshedContentReferences)
```

Insertion handles all selections in one undoable transaction. Invalid targets, read-only views, and active IME composition return `false`. Data updates refresh decorations without replacing text, changing selection or adding undo steps. During IME composition only the last data update is retained and it is applied after composition ends.
