import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'

describe('can() contract (issue #1 comments)', () => {
  it('returns a boolean for every declared command', () => {
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    const commands = [
      'undo', 'redo', 'heading', 'blockquote', 'bullet-list', 'ordered-list',
      'task-list', 'code-block', 'horizontal-rule', 'bold', 'italic', 'strike',
      'code', 'underline', 'superscript', 'subscript', 'color', 'highlight',
      'link', 'table', 'image', 'align-left', 'align-center', 'align-right',
      'align-justify', 'indent', 'outdent',
    ] as const
    for (const command of commands) {
      expect(editor.can(command), `can(${command})`).toBeTypeOf('boolean')
    }
    editor.destroy()
  })

  it('returns false rather than undefined for an unknown command', () => {
    // Regression: the switch had no default, so an unrecognised name fell
    // through and returned `undefined` from a `boolean`-declared method.
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    expect(editor.can('heading1' as never)).toBe(false)
    expect(editor.can('nonsense' as never)).toBe(false)
    editor.destroy()
  })

  it('returns false for every command once destroyed', () => {
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    editor.destroy()
    for (const command of ['bold', 'heading', 'undo', 'indent'] as const) {
      expect(editor.can(command), `destroyed can(${command})`).toBe(false)
    }
  })
})
