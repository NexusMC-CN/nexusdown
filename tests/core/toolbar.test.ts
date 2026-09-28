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
        toggleHighlight: vi.fn(() => true),
        setLink: vi.fn(() => true),
        insertTable: vi.fn(() => true),
        insertImage: vi.fn(() => true),
        indent: vi.fn(() => true),
        outdent: vi.fn(() => true),
      },
      can: vi.fn(() => true),
      isActive: vi.fn(() => false),
      getSelectedText: vi.fn(() => ''),
      getLinkHref: vi.fn(() => ''),
      getPasteMode: vi.fn(() => 'plain' as const),
      setPasteMode: vi.fn(),
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
      'strike', 'code', 'highlight', 'link', 'table', 'image', 'outdent', 'indent',
    ])
    expect(items.find((item) => item.id === 'bold')).toMatchObject({
      group: 'inline',
      icon: 'lucide:bold',
      label: '粗体',
    })
    expect(items.find((item) => item.id === 'indent')).toMatchObject({
      group: 'indent',
      icon: 'lucide:indent',
    })
  })

  it('does not offer the formats that have no Markdown syntax', () => {
    // Colour, underline, superscript, subscript and text alignment were removed:
    // each could only serialise as a BBCode shortcode or raw HTML, which the
    // dialect contract forbids.
    //
    // Highlight is deliberately NOT in this list any more — it came back on the
    // plain-text `==text==` syntax, so it *does* have Markdown syntax.
    const ids = new Set(createDefaultToolbarItems().map((item) => item.id))
    for (const removed of [
      'color', 'underline', 'superscript', 'subscript',
      'align-left', 'align-center', 'align-right', 'align-justify',
    ]) {
      expect(ids.has(removed), `toolbar must not offer ${removed}`).toBe(false)
    }
    expect(ids.has('highlight'), 'toolbar must offer highlight').toBe(true)
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

  it('exposes the built-in inline formatting commands for marks', () => {
    const ctx = context()
    const items = createDefaultToolbarItems()
    items.find((item) => item.id === 'strike')!.execute(ctx)
    items.find((item) => item.id === 'code')!.execute(ctx)

    expect(ctx.session.commands.toggleStrike).toHaveBeenCalledOnce()
    expect(ctx.session.commands.toggleCode).toHaveBeenCalledOnce()
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

  it('reports the active strike mark via isActive', () => {
    const ctx = context({ isActive: vi.fn((name: string) => name === 'strike') })
    const item = createDefaultToolbarItems().find((entry) => entry.id === 'strike')!

    expect(item.isActive!(ctx)).toBe(true)
    expect(ctx.session.isActive).toHaveBeenCalledWith('strike')
  })

  it('exposes indent and outdent commands', () => {
    const ctx = context()
    const items = createDefaultToolbarItems()

    items.find((item) => item.id === 'indent')!.execute(ctx)
    items.find((item) => item.id === 'outdent')!.execute(ctx)

    expect(ctx.session.commands.indent).toHaveBeenCalledOnce()
    expect(ctx.session.commands.outdent).toHaveBeenCalledOnce()
  })

  it('disables indent controls when can() reports false', () => {
    const ctx = context({ can: vi.fn(() => false) })
    const items = createDefaultToolbarItems()

    expect(items.find((item) => item.id === 'indent')!.isDisabled!(ctx)).toBe(true)
    expect(items.find((item) => item.id === 'outdent')!.isDisabled!(ctx)).toBe(true)
  })
})
