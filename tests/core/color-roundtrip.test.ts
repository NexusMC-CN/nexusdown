import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

const COLOR_PATTERN = /\[color\s+color\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s\]]+))\]([\s\S]*?)\[\/color\]/i

function colorSession(markdown: string) {
  return createNexusdownEditor({ content: markdown, contentType: 'markdown' })
}

describe('color markdown round-trip', () => {
  it('round-trips a simple named color', () => {
    const editor = colorSession('[color color="red"]hi[/color]')
    expect(editor.getMarkdown()).toBe('[color color="red"]hi[/color]')
    expect(editor.getHTML()).toContain('color: red')
    editor.destroy()
  })

  it('round-trips an rgb color through an HTML span', () => {
    const editor = colorSession('[color color="rgb(1, 2, 3)"]hi[/color]')
    expect(editor.getMarkdown()).toContain('rgb(1, 2, 3)')
    editor.destroy()
  })

  it('parses an uppercase <SPAN style="color"> from html', () => {
    // Regression target: the uppercase tag must be recognised, not treated as
    // plain text and then re-serialised into a throwing path.
    const editor = createNexusdownEditor({
      content: '<p><SPAN style="color: red">red</SPAN></p>',
      contentType: 'html',
    })
    expect(editor.getHTML()).toContain('color: red')
    const markdown = editor.getMarkdown()
    expect(markdown).toContain('red')
    editor.destroy()
  })

  it('parses a mixed-case <Span style="color">', () => {
    const editor = createNexusdownEditor({
      content: '<p><Span style="color: blue">blue</Span></p>',
      contentType: 'html',
    })
    expect(editor.getHTML()).toContain('color: blue')
    editor.destroy()
  })

  it('handles a color value containing quotes without throwing', () => {
    const editor = colorSession('[color color="re\'d"]hi[/color]')
    expect(() => editor.getMarkdown()).not.toThrow()
    editor.destroy()
  })
})

describe('markdown color tokenizer', () => {
  it('matches case-insensitively on the marker', () => {
    expect(COLOR_PATTERN.test('[COLOR color="red"]x[/COLOR]')).toBe(true)
  })

  it('accepts quoted and bare values', () => {
    expect(COLOR_PATTERN.exec('[color color=red]x[/color]')?.[3]).toBe('red')
    expect(COLOR_PATTERN.exec("[color color='red']x[/color]")?.[2]).toBe('red')
    expect(COLOR_PATTERN.exec('[color color="red"]x[/color]')?.[1]).toBe('red')
  })
})
