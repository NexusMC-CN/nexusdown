/**
 * Keep autolinking to the URLs the editor autolinks.
 *
 * `linkify: true` makes markdown-it turn bare text into links, but which bare
 * text is a judgement call, and the two libraries disagree:
 *
 * | input | editor | markdown-it 15 |
 * | --- | --- | --- |
 * | `www.example.com` | link | link |
 * | `example.com` | text | **link** |
 * | `README.md` | text | **link** |
 * | `start.sh` | text | **link** |
 * | `a@b.com` | link | link |
 * | `http://example.com` | link | link |
 *
 * `linkify-it` 6 turned `fuzzyLink` off by default, which is what stopped
 * `www.` URLs from being linked at all (see `index.ts`); turning it back on
 * restores those, but also links any `word.tld` — and a lot of real TLDs are
 * file extensions people write constantly (`.md`, `.sh`, `.zip`, `.io`, `.dev`).
 * `see README.md` becoming `see <a href="http://README.md">` is worse than a
 * `www.` URL staying plain text.
 *
 * So the fuzzy pass is enabled and then narrowed here: a schemeless **domain**
 * match survives only when it starts with `www.`. Everything else markdown-it
 * finds — a URL with a scheme, an email, an autolink in angle brackets — is left
 * alone, because the editor links those too.
 */
import type { MarkdownIt, Token } from 'markdown-it'

/** `http:`, `mailto:`, … — anything that already says how to open it. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

const HAS_WWW = /^www\./i

export function wwwOnlyAutolinkPlugin(md: MarkdownIt): void {
  md.core.ruler.after('linkify', 'nexusdown_www_only', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue
      unwrapBareDomains(token.children)
    }
  })
}

/**
 * Replace every `link_open`/text/`link_close` triple that came from a bare
 * domain with just its text.
 *
 * markdown-it builds each linkify match as exactly those three tokens, so the
 * anchor can be dropped in place without disturbing anything around it.
 * Iterating backwards keeps the indices valid as entries are removed.
 */
function unwrapBareDomains(children: Token[]): void {
  for (let i = children.length - 3; i >= 0; i--) {
    const open = children[i]!
    if (open.type !== 'link_open' || open.markup !== 'linkify') continue

    const text = children[i + 1]!
    const close = children[i + 2]!
    if (text.type !== 'text' || close.type !== 'link_close') continue
    if (HAS_SCHEME.test(text.content) || text.content.includes('@') || HAS_WWW.test(text.content)) continue

    text.level = open.level
    children.splice(i, 3, text)
  }
}
