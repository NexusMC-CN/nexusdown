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
        toggleUnderline: vi.fn(() => true),
        toggleSuperscript: vi.fn(() => true),
        toggleSubscript: vi.fn(() => true),
        setColor: vi.fn(() => true),
        setHighlight: vi.fn(() => true),
        setLink: vi.fn(() => true),
        insertTable: vi.fn(() => true),
        insertImage: vi.fn(() => true),
      },
      can: vi.fn(() => true),
      isActive: vi.fn(() => false),
      getSelectedText: vi.fn(() => ''),
      getLinkHref: vi.fn(() => ''),
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
      'strike', 'code', 'underline', 'superscript', 'subscript', 'color', 'highlight', 'link', 'table', 'image',
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

  it('passes link text and href through the link toolbar item', () => {
    const ctx = context()
    const link = createDefaultToolbarItems().find((item) => item.id === 'link')!

    link.execute({ ...ctx, linkHref: 'https://example.com', linkText: 'Docs' })

    expect(ctx.session.commands.setLink).toHaveBeenCalledWith('https://example.com', 'Docs')
  })

  it('exposes built-in inline formatting commands for marks and colors', () => {
    const ctx = context()
    const items = createDefaultToolbarItems()
    items.find((item) => item.id === 'underline')!.execute(ctx)
    items.find((item) => item.id === 'superscript')!.execute(ctx)
    items.find((item) => item.id === 'subscript')!.execute(ctx)
    items.find((item) => item.id === 'color')!.execute({ ...ctx, color: '#ff0000' })
    items.find((item) => item.id === 'highlight')!.execute({ ...ctx, highlightColor: '#ffff00' })

    expect(ctx.session.commands.toggleUnderline).toHaveBeenCalledOnce()
    expect(ctx.session.commands.toggleSuperscript).toHaveBeenCalledOnce()
    expect(ctx.session.commands.toggleSubscript).toHaveBeenCalledOnce()
    expect(ctx.session.commands.setColor).toHaveBeenCalledWith('#ff0000')
    expect(ctx.session.commands.setHighlight).toHaveBeenCalledWith('#ffff00')
  })

  it('exposes table and image insertion commands', () => {
    const ctx = context()
    const items = createDefaultToolbarItems()
    items.find((item) => item.id === 'table')!.execute(ctx)
    items.find((item) => item.id === 'image')!.execute({
      ...ctx,
      imageSrc: 'https://example.com/image.png',
      imageAlt: 'Example',
    })

    expect(ctx.session.commands.insertTable).toHaveBeenCalledOnce()
    expect(ctx.session.commands.insertImage).toHaveBeenCalledWith('https://example.com/image.png', 'Example', undefined)
  })
})
