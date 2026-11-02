// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/render/index.js'

describe('fenced code highlighting', () => {
  it('passes the displayed code and language to a per-render highlighter', () => {
    const seen: Array<[string, string]> = []
    const html = renderMarkdown('```TS\nconst value = 1\n```', {
      codeHighlighter: (code, language) => {
        seen.push([code, language])
        return [
          { text: 'const', classes: ['hljs-keyword'] },
          { text: ' value = 1' },
        ]
      },
    })

    expect(seen).toEqual([['const value = 1', 'TS']])
    expect(html).toContain('<span class="hljs-keyword">const</span> value = 1')
    expect(html).toContain('class="language-TS"')
    expect(renderMarkdown('```TS\nconst value = 1\n```')).not.toContain('hljs-keyword')
  })

  it('keeps token styling inside the existing line-number and highlighted-line wrappers', () => {
    const html = renderMarkdown('```ts\na\nb\n```\n{lines highlight="2"}', {
      codeHighlighter: () => [{ text: 'a\nb', classes: ['hljs-string'] }],
    })

    expect(html).toContain('class="nd-code-lines"')
    expect(html).toContain('<span class="nd-code-line"><span class="hljs-string">a</span></span>')
    expect(html).toContain('<span class="nd-code-line nd-code-line--hl"><span class="hljs-string">b</span></span>')
  })

  it('escapes code and refuses malformed token content or class names', () => {
    const source = '```js\n<script>alert(1)</script>\n```'
    const safe = renderMarkdown(source, {
      codeHighlighter: () => [{ text: '<script>alert(1)</script>', classes: ['hljs-string'] }],
    })
    expect(safe).toContain('<span class="hljs-string">&lt;script&gt;alert(1)&lt;/script&gt;</span>')
    expect(safe).not.toContain('<script>')

    const wrongText = renderMarkdown(source, {
      codeHighlighter: () => [{ text: '<script>different</script>', classes: ['hljs-string'] }],
    })
    expect(wrongText).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(wrongText).not.toContain('hljs-string')

    const unsafeClass = renderMarkdown(source, {
      codeHighlighter: () => [{ text: '<script>alert(1)</script>', classes: ['x" onclick="alert(1)'] }],
    })
    expect(unsafeClass).not.toContain('onclick')
    expect(unsafeClass).not.toContain('<script>')
  })

  it('falls back to plain code when a highlighter fails or input is too large', () => {
    const failed = renderMarkdown('```js\nconst x = 1\n```', {
      codeHighlighter: () => { throw new Error('broken grammar') },
    })
    expect(failed).toContain('const x = 1')
    expect(failed).not.toContain('hljs-')

    let called = false
    renderMarkdown(`\`\`\`js\n${'x'.repeat(65_537)}\n\`\`\``, {
      codeHighlighter: () => { called = true; return null },
    })
    expect(called).toBe(false)
  })

  it('preserves astral Unicode when a highlighter splits a surrogate pair', () => {
    const emoji = String.fromCodePoint(0x1f600)
    const code = `say "${emoji}"`
    const cut = code.indexOf(emoji) + 1
    const html = renderMarkdown(`~~~mcfunction\n${code}\n~~~`, {
      codeHighlighter: () => [
        { text: code.slice(0, cut), classes: ['hljs-keyword'] },
        { text: code.slice(cut), classes: ['hljs-string'] },
      ],
    })

    expect(html).toContain(emoji)
    expect(new TextDecoder().decode(new TextEncoder().encode(html))).toContain(emoji)
    expect(html).not.toContain('hljs-keyword')
  })
})
