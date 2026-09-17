import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * A Markdown table row with more cells than its header loses the surplus.
 *
 * The upstream tokenizer sizes each row from the header, so `| 1 | 2 | 3 |`
 * under a two-column header silently becomes `| 1 | 2 |` — the parse succeeds
 * and nothing tells the user their content is gone. The session reports it so
 * the loss is at least visible; the parse itself is left to the upstream
 * tokenizer.
 */
function parseWith(markdown: string) {
  const editor = createNexusdownEditor({ content: '<p>ok</p>', contentType: 'html' })
  const errors: string[] = []
  editor.onError((error) => errors.push(error.message))
  editor.setMarkdown(markdown)
  const result = { errors, markdown: editor.getMarkdown() }
  editor.destroy()
  return result
}

describe('table column loss reporting (issue #1 comments)', () => {
  it('reports a row carrying more cells than the header', () => {
    const { errors, markdown } = parseWith('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('3 cells')
    expect(errors[0]).toContain('2')
    // The upstream parser really does drop it — the report is not hypothetical.
    expect(markdown).not.toContain('3')
  })

  it('stays silent for a well-formed table', () => {
    expect(parseWith('| a | b |\n| --- | --- |\n| 1 | 2 |\n').errors).toEqual([])
  })

  it('stays silent for a short row, which is padded rather than truncated', () => {
    const { errors, markdown } = parseWith('| a | b | c |\n| --- | --- | --- |\n| 1 |\n')
    expect(errors).toEqual([])
    // Nothing is lost: the row is padded out to the header width.
    expect(markdown).toContain('| 1   |')
  })

  it('does not treat an escaped pipe as a cell boundary', () => {
    expect(parseWith('| a | b |\n| --- | --- |\n| x \\| y | 2 |\n').errors).toEqual([])
  })

  it('does not report pipe-containing prose that is not a table', () => {
    expect(parseWith('a | b\nc | d | e\n').errors).toEqual([])
  })

  it('does not report a table with aligned delimiters', () => {
    expect(parseWith('| a | b |\n| :--- | ---: |\n| 1 | 2 |\n').errors).toEqual([])
  })
})
