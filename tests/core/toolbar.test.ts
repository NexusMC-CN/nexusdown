import { describe, expect, it, vi } from 'vitest'
import { createDefaultToolbarItems, type ToolbarContext } from '../../src/core/toolbar'

function context(overrides: Partial<ToolbarContext['session']> = {}): ToolbarContext {
  return {
    session: {
      commands: {
        undo: vi.fn(() => true),
        redo: vi.fn(() => true),
        setHeading: vi.fn(() => true),
        toggleBlockquote: vi.fn(() => true),
        toggleBulletList: vi.fn(() => true),
        toggleOrderedList: vi.fn(() => true),
        toggleTaskList: vi.fn(() => true),
        toggleCodeBlock: vi.fn(() => true),
        setHorizontalRule: vi.fn(() => true),
        toggleBold: vi.fn(() => true),
        toggleItalic: vi.fn(() => true),
        toggleStrike: vi.fn(() => true),
        toggleCode: vi.fn(() => true),
        setLink: vi.fn(() => true),
      },
      can: vi.fn(() => true),
      isActive: vi.fn(() => false),
      ...overrides,
    },
  }
}

describe('default toolbar', () => {
  it('groups supported commands and exposes stable icon names', () => {
    const items = createDefaultToolbarItems()
    expect(items.map((item) => item.id)).toEqual([
      'undo', 'redo', 'heading', 'blockquote', 'bullet-list', 'ordered-list',
      'task-list', 'code-block', 'horizontal-rule', 'bold', 'italic',
      'strike', 'code', 'link',
    ])
    expect(items.find((item) => item.id === 'bold')).toMatchObject({
      group: 'inline',
      icon: 'lucide:bold',
      label: '粗体',
    })
  })

  it('exposes state and invokes the session command contract', () => {
    const items = createDefaultToolbarItems()
    const ctx = context()
    const bold = items.find((item) => item.id === 'bold')!
    const undo = items.find((item) => item.id === 'undo')!

    expect(bold.isActive?.(ctx)).toBe(false)
    expect(bold.isDisabled?.(ctx)).toBe(false)
    bold.execute(ctx)
    undo.execute(ctx)
    expect(ctx.session.commands.toggleBold).toHaveBeenCalledOnce()
    expect(ctx.session.commands.undo).toHaveBeenCalledOnce()
  })

  it('uses can and isActive for history and formatting state', () => {
    const ctx = context({
      can: vi.fn((command) => command !== 'undo'),
      isActive: vi.fn((name) => name === 'bold'),
    })
    const items = createDefaultToolbarItems()
    const undo = items.find((item) => item.id === 'undo')!
    const bold = items.find((item) => item.id === 'bold')!

    expect(undo.isDisabled?.(ctx)).toBe(true)
    expect(bold.isActive?.(ctx)).toBe(true)
  })
})
