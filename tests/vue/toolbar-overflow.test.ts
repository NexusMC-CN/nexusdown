import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOMWrapper, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { calculateOverflowedKeys } from '../../src/vue/composables/useToolbarOverflow'
import { useToolbarOverflow } from '../../src/vue/composables/useToolbarOverflow'
import { createDefaultToolbarItems, type ToolbarContext, type ToolbarItem } from '../../src/core/toolbar'
import { createToolbarControls, type ToolbarControl as ToolbarControlDescriptor } from '../../src/vue/toolbar-controls'
import ToolbarControl from '../../src/vue/components/ToolbarControl.vue'
import EditorToolbar from '../../src/vue/EditorToolbar.vue'
import ToolbarOverflowMenu from '../../src/vue/components/ToolbarOverflowMenu.vue'

function mountMore(attachTo: Element = document.body) {
  return mount(ToolbarOverflowMenu, {
    props: { hasItems: true }, attachTo,
    slots: { default: () => [h('button', { disabled: true }, 'Disabled'), h('button', { id: 'more-first' }, 'First'), h('button', { id: 'more-last' }, 'Last')] },
  })
}

async function settleMore() { await nextTick(); await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0)) }

function mountModalMore() {
  const dialog = document.createElement('dialog')
  const matches = dialog.matches.bind(dialog)
  dialog.matches = (selector) => selector === ':modal' ? true : matches(selector)
  document.body.append(dialog)
  const componentErrors: unknown[] = []
  const wrapper = mount(ToolbarOverflowMenu, {
    props: { hasItems: true },
    attachTo: dialog,
    global: { config: { errorHandler: (error) => componentErrors.push(error) } },
    slots: {
      default: () => ['heading', 'link', 'image'].map((id) => h(ToolbarControl, {
        control: itemControl(id), context: createContext(), display: 'overflow', pasteMode: 'plain',
      })),
    },
  })
  return { dialog, wrapper, componentErrors }
}

describe('ToolbarOverflowMenu', () => {
  it('focuses enabled controls, wraps navigation, scrolls only its menu, and restores trigger on Escape', async () => {
    const wrapper = mountMore()
    try {
      const trigger = wrapper.get('[data-nexusdown="toolbar-more-trigger"]')
      await trigger.trigger('click')
      await settleMore()
      const menu = document.querySelector<HTMLElement>('[data-nexusdown="toolbar-overflow-menu"]')!
      const first = menu.querySelector<HTMLButtonElement>('#more-first')!
      const last = menu.querySelector<HTMLButtonElement>('#more-last')!
      expect(document.activeElement).toBe(first)
      for (const [key, target] of [['ArrowUp', last], ['ArrowDown', first], ['End', last], ['Home', first], ['ArrowDown', last], ['ArrowUp', first]] as const) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        document.activeElement!.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(target)
      }
      Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 80 })
      vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ ...createRect(0, 320), top: 0, bottom: 80 } as DOMRect)
      vi.spyOn(last, 'getBoundingClientRect').mockReturnValue({ ...createRect(0, 100), top: 150, bottom: 180 } as DOMRect)
      await new DOMWrapper(first).trigger('keydown', { key: 'End' })
      expect(menu.scrollTop).toBe(100)
      await new DOMWrapper(last).trigger('keydown', { key: 'Escape' })
      expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger.element)
    } finally { wrapper.unmount() }
  })

  it('keeps presses in its trigger, menu and overlay descendants, but closes outside and when empty', async () => {
    const wrapper = mountMore()
    try {
      const trigger = wrapper.get('[data-nexusdown="toolbar-more-trigger"]')
      await trigger.trigger('click'); await settleMore()
      const menu = document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')!
      const secondary = document.createElement('div')
      secondary.dataset.nexusdownOverlayRoot = ''
      secondary.innerHTML = '<button>Secondary</button>'
      document.body.append(secondary)
      for (const target of [trigger.element, menu.querySelector('button')!, secondary.querySelector('button')!]) {
        target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        await nextTick()
        expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBe(menu)
      }
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await nextTick()
      expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
      await trigger.trigger('click'); await settleMore()
      await wrapper.setProps({ hasItems: false })
      expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
      expect(wrapper.find('.nexusdown-toolbar-overflow__slot').exists()).toBe(true)
      expect(trigger.isVisible()).toBe(false)
      secondary.remove()
    } finally { wrapper.unmount() }
  })

  it('resolves modal target again on every opening', async () => {
    const dialog = document.createElement('dialog')
    let modal = false
    const matches = dialog.matches.bind(dialog)
    dialog.matches = (selector) => selector === ':modal' ? modal : matches(selector)
    document.body.append(dialog)
    const wrapper = mountMore(dialog)
    try {
      const trigger = wrapper.get('[data-nexusdown="toolbar-more-trigger"]')
      await trigger.trigger('click'); await settleMore()
      expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')?.parentElement).toBe(document.body)
      await trigger.trigger('click')
      modal = true
      await trigger.trigger('click'); await settleMore()
      expect(dialog.querySelector('[data-nexusdown="toolbar-overflow-menu"]')?.parentElement).toBe(dialog)
    } finally { wrapper.unmount(); dialog.remove() }
  })

  it('closes a modal overflow menu with a real compound control without Teleport patch errors', async () => {
    const dialog = document.createElement('dialog')
    const matches = dialog.matches.bind(dialog)
    dialog.matches = (selector) => selector === ':modal' ? true : matches(selector)
    document.body.append(dialog)
    const componentErrors: unknown[] = []
    const wrapper = mount(ToolbarOverflowMenu, {
      props: { hasItems: true },
      attachTo: dialog,
      global: { config: { errorHandler: (error) => componentErrors.push(error) } },
      slots: {
        default: () => h(ToolbarControl, {
          control: itemControl('heading'),
          context: createContext(),
          display: 'overflow',
          pasteMode: 'plain',
        }),
      },
    })
    try {
      await wrapper.get('[data-nexusdown="toolbar-more-trigger"]').trigger('click')
      await settleMore()
      const menu = document.querySelector<HTMLElement>('[data-nexusdown="toolbar-overflow-menu"]')!
      expect(menu.parentElement).toBe(dialog)

      await new DOMWrapper(menu).get('button[aria-label="标题"]').trigger('keydown', { key: 'Escape' })
      await settleMore()

      expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
      expect(componentErrors.filter((error) => error instanceof DOMException && error.name === 'NotFoundError')).toEqual([])
    } finally { wrapper.unmount(); dialog.remove() }
  })

  it('clamps to viewport margins, flips above, constrains height, and follows resize/scroll', async () => {
    vi.stubGlobal('innerWidth', 300)
    vi.stubGlobal('innerHeight', 260)
    let top = 220
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.nexusdown === 'toolbar-more-trigger') return { x: 270, y: top, left: 270, right: 302, top, bottom: top + 32, width: 32, height: 32, toJSON: () => ({}) } as DOMRect
      return { ...createRect(0, 284), height: 240, bottom: 240 } as DOMRect
    })
    const wrapper = mountMore()
    try {
      await wrapper.get('button').trigger('click'); await settleMore()
      const menu = document.querySelector<HTMLElement>('[data-nexusdown="toolbar-overflow-menu"]')!
      expect(menu.style.left).toBe('8px')
      expect(menu.style.top).toBe('8px')
      expect(menu.style.maxHeight).toBe('206px')
      top = 10
      window.dispatchEvent(new Event('resize')); await nextTick()
      expect(menu.style.top).toBe('48px')
      expect(menu.style.maxHeight).toBe('204px')
      top = 20
      window.dispatchEvent(new Event('scroll')); await nextTick()
      expect(menu.style.top).toBe('58px')
    } finally { wrapper.unmount() }
  })

  for (const [id, label, focusSelector] of [
    ['heading', '标题', 'button[role="menuitem"]'],
    ['link', '链接', 'input[aria-label="链接地址"]'],
    ['image', '图片', 'input[aria-label="图片地址"]'],
  ] as const) {
    it(`closes only the real ${id} child of a modal overflow menu on Escape`, async () => {
      const { dialog, wrapper, componentErrors } = mountModalMore()
      try {
        const moreTrigger = wrapper.get('[data-nexusdown="toolbar-more-trigger"]')
        await moreTrigger.trigger('click'); await settleMore()
        const menu = dialog.querySelector<HTMLElement>('[data-nexusdown="toolbar-overflow-menu"]')!
        const childTrigger = new DOMWrapper(menu).get(`button[aria-label="${label}"]`)
        await childTrigger.trigger('click'); await settleMore()
        const child = dialog.querySelector<HTMLElement>(`[data-nexusdown="${id}-menu"]`)!
        expect(child.parentElement).toBe(menu)
        const target = child.querySelector<HTMLElement>(focusSelector)!
        target.focus()
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        target.dispatchEvent(escape)
        await settleMore()

        expect(escape.defaultPrevented).toBe(true)
        expect(dialog.querySelector(`[data-nexusdown="${id}-menu"]`)).toBeNull()
        expect(dialog.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBe(menu)
        expect(document.activeElement).toBe(childTrigger.element)
        expect(componentErrors).toEqual([])

        await childTrigger.trigger('keydown', { key: 'Escape' }); await settleMore()
        expect(dialog.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
        expect(document.activeElement).toBe(moreTrigger.element)
        expect(componentErrors).toEqual([])
      } finally { wrapper.unmount(); dialog.remove() }
    })
  }

  for (const [id, label, field] of [
    ['link', '链接', '链接文本'], ['link', '链接', '链接地址'],
    ['image', '图片', '图片地址'], ['image', '图片', '图片描述'],
  ] as const) {
    it.each(['ArrowUp', 'ArrowDown', 'Home', 'End'])(`preserves %s in the real ${field} field inside a modal overflow menu`, async (key) => {
      const { dialog, wrapper, componentErrors } = mountModalMore()
      try {
        await wrapper.get('[data-nexusdown="toolbar-more-trigger"]').trigger('click'); await settleMore()
        const menu = dialog.querySelector<HTMLElement>('[data-nexusdown="toolbar-overflow-menu"]')!
        await new DOMWrapper(menu).get(`button[aria-label="${label}"]`).trigger('click'); await settleMore()
        const child = menu.querySelector<HTMLElement>(`[data-nexusdown="${id}-menu"]`)!
        const input = child.querySelector<HTMLInputElement>(`input[aria-label="${field}"]`)!
        input.focus()
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        input.dispatchEvent(event)
        await nextTick()

        expect(event.defaultPrevented).toBe(false)
        expect(document.activeElement).toBe(input)
        expect(dialog.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBe(menu)
        expect(menu.querySelector(`[data-nexusdown="${id}-menu"]`)).toBe(child)
        expect(componentErrors).toEqual([])
      } finally { wrapper.unmount(); dialog.remove() }
    })
  }

  it('navigates only its own controls while a real modal child is open', async () => {
    const { dialog, wrapper } = mountModalMore()
    try {
      await wrapper.get('[data-nexusdown="toolbar-more-trigger"]').trigger('click'); await settleMore()
      const menu = dialog.querySelector<HTMLElement>('[data-nexusdown="toolbar-overflow-menu"]')!
      const heading = menu.querySelector<HTMLButtonElement>('button[aria-label="标题"]')!
      const link = menu.querySelector<HTMLButtonElement>('button[aria-label="链接"]')!
      const image = menu.querySelector<HTMLButtonElement>('button[aria-label="图片"]')!
      await new DOMWrapper(link).trigger('click'); await settleMore()
      link.focus()
      for (const [key, target] of [['End', image], ['Home', heading], ['ArrowUp', image], ['ArrowDown', heading]] as const) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        document.activeElement!.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(target)
      }
    } finally { wrapper.unmount(); dialog.remove() }
  })

  for (const [id, label, expectedLeft] of [
    ['link', '链接', { 320: 26, 390: 96 }],
    ['image', '图片', { 320: 12, 390: 82 }],
  ] as const) {
    it.each([320, 390] as const)(`applies the real ${id} popup border box contract at %ipx`, async (viewportWidth) => {
      vi.stubGlobal('innerWidth', viewportWidth)
      const stylesheet = document.createElement('style')
      stylesheet.textContent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/style.css'), 'utf8')
      document.head.append(stylesheet)
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(createRect(viewportWidth - 36, viewportWidth - 4))
      const { dialog, wrapper } = mountModalMore()
      try {
        await wrapper.get('[data-nexusdown="toolbar-more-trigger"]').trigger('click'); await settleMore()
        const menu = dialog.querySelector<HTMLElement>('[data-nexusdown="toolbar-overflow-menu"]')!
        await new DOMWrapper(menu).get(`button[aria-label="${label}"]`).trigger('click'); await settleMore()
        const child = menu.querySelector<HTMLElement>(`[data-nexusdown="${id}-menu"]`)!
        const style = getComputedStyle(child)

        // jsdom exposes box sizing and the inline clamp, but does not lay out min()/vw.
        // The declared widths must include padding/borders for the 8px clamp to fit.
        expect(style.boxSizing).toBe('border-box')
        expect(child.style.left).toBe(`${expectedLeft[viewportWidth]}px`)
        expect(style.position).toBe('fixed')
      } finally { wrapper.unmount(); dialog.remove(); stylesheet.remove() }
    })
  }

  it('mirrors and updates theme variables and skin while open', async () => {
    const editor = document.createElement('section')
    editor.className = 'nexusdown-editor'
    editor.dataset.nexusdownSkin = 'custom'
    editor.style.setProperty('--nexus-bg', '#111827')
    document.body.append(editor)
    const wrapper = mountMore(editor)
    try {
      await wrapper.get('button').trigger('click'); await settleMore()
      const menu = document.querySelector<HTMLElement>('[data-nexusdown="toolbar-overflow-menu"]')!
      expect(menu.dataset.nexusdownSkin).toBe('custom')
      expect(menu.style.getPropertyValue('--nexus-bg')).toBe('#111827')
      editor.dataset.nexusdownSkin = 'light-skin'
      editor.style.setProperty('--nexus-bg', '#ffffff')
      await settleMore()
      expect(menu.dataset.nexusdownSkin).toBe('light-skin')
      expect(menu.style.getPropertyValue('--nexus-bg')).toBe('#ffffff')
    } finally { wrapper.unmount(); editor.remove() }
  })

  for (const [id, label, selector] of [['heading', '标题', 'heading-menu'], ['link', '链接', 'link-menu'], ['image', '图片', 'image-menu']] as const) {
    it(`keeps the parent open while operating the real ${id} secondary Teleport`, async () => {
      const editor = document.createElement('section')
      editor.className = 'nexusdown-editor'
      editor.dataset.nexusdownSkin = 'nested-skin'
      editor.style.setProperty('--nexus-bg', '#111827')
      document.body.append(editor)
      const wrapper = mount(ToolbarOverflowMenu, {
        props: { hasItems: true }, attachTo: editor,
        slots: { default: () => h(ToolbarControl, { control: itemControl(id), context: createContext(), display: 'overflow', pasteMode: 'plain' }) },
      })
      try {
        await wrapper.get('button').trigger('click'); await settleMore()
        const menu = document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')!
        await new DOMWrapper(menu).get(`button[aria-label="${label}"]`).trigger('click')
        const secondary = document.querySelector(`[data-nexusdown="${selector}"]`)!
        expect(secondary.parentElement).toBe(document.body)
        secondary.querySelector('input, button')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        await nextTick()
        expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBe(menu)
        expect((secondary as HTMLElement).style.getPropertyValue('--nexus-bg')).toBe('#111827')
        expect((secondary as HTMLElement).dataset.nexusdownSkin).toBe('nested-skin')
        editor.style.setProperty('--nexus-bg', '#ffffff')
        editor.dataset.nexusdownSkin = 'updated-skin'
        await settleMore()
        expect((secondary as HTMLElement).style.getPropertyValue('--nexus-bg')).toBe('#ffffff')
        expect((secondary as HTMLElement).dataset.nexusdownSkin).toBe('updated-skin')
      } finally { wrapper.unmount(); editor.remove() }
    })

    it(`closes the real ${id} secondary Teleport on Escape without closing the parent`, async () => {
      const editor = document.createElement('section')
      editor.className = 'nexusdown-editor'
      document.body.append(editor)
      const wrapper = mount(ToolbarOverflowMenu, {
        props: { hasItems: true }, attachTo: editor,
        slots: { default: () => h(ToolbarControl, { control: itemControl(id), context: createContext(), display: 'overflow', pasteMode: 'plain' }) },
      })
      try {
        await wrapper.get('button').trigger('click'); await settleMore()
        const menu = document.querySelector<HTMLElement>('[data-nexusdown="toolbar-overflow-menu"]')!
        const childTrigger = new DOMWrapper(menu).get(`button[aria-label="${label}"]`)
        await childTrigger.trigger('click'); await nextTick()
        const secondary = document.querySelector<HTMLElement>(`[data-nexusdown="${selector}"]`)!
        const focusTarget = secondary.querySelector<HTMLElement>(id === 'heading' ? 'button[role="menuitem"]' : 'input')!
        focusTarget.focus()

        await new DOMWrapper(focusTarget).trigger('keydown', { key: 'Escape' })
        await nextTick()

        expect(document.querySelector(`[data-nexusdown="${selector}"]`)).toBeNull()
        expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBe(menu)
        expect(document.activeElement).toBe(childTrigger.element)
      } finally { wrapper.unmount(); editor.remove() }
    })
  }
})

describe('createToolbarControls', () => {
  it('keeps the default command sequence and inserts utilities after history', () => {
    const controls = createToolbarControls(createDefaultToolbarItems())

    expect(controls.map(({ key }) => key).slice(0, 5)).toEqual([
      'item:undo',
      'item:redo',
      'builtin:find',
      'builtin:paste-mode',
      'item:heading',
    ])
  })

  it('keeps custom groups and puts utilities first without history', () => {
    const custom = {
      id: 'badge',
      group: 'custom',
      icon: 'lucide:badge',
      label: '徽章',
      execute: vi.fn(),
    }

    const controls = createToolbarControls([custom])

    expect(controls.slice(0, 2).map(({ key }) => key)).toEqual(['builtin:find', 'builtin:paste-mode'])
    expect(controls.at(-1)).toMatchObject({ key: 'item:badge', group: 'custom' })
  })

  it('orders every known group canonically while preserving each group declaration order', () => {
    const items = [
      itemControl('indent', { group: 'indent' }).item,
      itemControl('bold', { group: 'inline' }).item,
      itemControl('blockquote', { group: 'block' }).item,
      itemControl('align-left', { group: 'align' }).item,
      itemControl('table', { group: 'extension' }).item,
      itemControl('undo', { group: 'history' }).item,
    ]

    expect(createToolbarControls(items).map(({ key, group }) => ({ key, group }))).toEqual([
      { key: 'item:undo', group: 'history' },
      { key: 'builtin:find', group: 'utility' },
      { key: 'builtin:paste-mode', group: 'utility' },
      { key: 'item:blockquote', group: 'block' },
      { key: 'item:bold', group: 'inline' },
      { key: 'item:table', group: 'extension' },
      { key: 'item:align-left', group: 'align' },
      { key: 'item:indent', group: 'indent' },
    ])
  })

  it('keeps multiple custom groups in first-seen order and their item declaration order', () => {
    const items = [
      itemControl('first-a', { group: 'custom-first' }).item,
      itemControl('second-a', { group: 'custom-second' }).item,
      itemControl('first-b', { group: 'custom-first' }).item,
      itemControl('second-b', { group: 'custom-second' }).item,
    ]

    expect(createToolbarControls(items).map(({ key }) => key)).toEqual([
      'builtin:find',
      'builtin:paste-mode',
      'item:first-a',
      'item:first-b',
      'item:second-a',
      'item:second-b',
    ])
  })
})

function createContext(): ToolbarContext {
  const command = vi.fn(() => true)
  return {
    session: {
      commands: {
        undo: command,
        redo: command,
        setHeading: command,
        toggleBlockquote: command,
        toggleBulletList: command,
        toggleOrderedList: command,
        toggleTaskList: command,
        toggleCodeBlock: command,
        setHorizontalRule: command,
        toggleBold: command,
        toggleItalic: command,
        toggleStrike: command,
        toggleCode: command,
        toggleUnderline: command,
        toggleSuperscript: command,
        toggleSubscript: command,
        setColor: command,
        setHighlight: command,
        setLink: command,
        insertTable: command,
        insertImage: command,
        setTextAlign: command,
        indent: command,
        outdent: command,
      },
      can: () => true,
      isActive: () => false,
      hasTextColor: () => false,
      getSelectedText: () => '已选文本',
      getLinkHref: () => 'https://old.example',
      getPasteMode: () => 'plain',
      setPasteMode: vi.fn(),
    },
  }
}

function itemControl(id: string, overrides: Partial<ToolbarItem> = {}): Extract<ToolbarControlDescriptor, { kind: 'item' }> {
  const item: ToolbarItem = {
    id,
    group: 'inline',
    icon: `lucide:${id}`,
    label: `${id}标签`,
    execute: vi.fn(() => true),
    ...overrides,
  }
  return { key: `item:${id}`, kind: 'item', group: item.group, label: item.label, icon: item.icon, item }
}

function mountControl(control: ToolbarControlDescriptor, props: Record<string, unknown> = {}) {
  return mount(ToolbarControl, {
    props: {
      control,
      context: createContext(),
      display: 'compact',
      pasteMode: 'plain',
      ...props,
    },
    attachTo: document.body,
  })
}

describe('ToolbarControl', () => {
  it('renders command labels only for overflow and forwards normal commands', async () => {
    const control = itemControl('bold', { label: '粗体' })
    const compact = mountControl(control)
    expect(compact.find('.nexusdown-toolbar-control__label').exists()).toBe(false)
    await compact.get('button[aria-label="粗体"]').trigger('click')
    expect(compact.emitted('execute')).toEqual([[control.item]])
    compact.unmount()

    const overflow = mountControl(control, { display: 'overflow' })
    expect(overflow.get('.nexusdown-toolbar-control__label').text()).toBe('粗体')
    overflow.unmount()
  })

  it('shows overflow labels for compound controls and preserves active, disabled, and readonly states', () => {
    for (const id of ['heading', 'link', 'image', 'color', 'highlight']) {
      const wrapper = mountControl(itemControl(id, { label: `${id}标签` }), { display: 'overflow' })
      const expectedLabel = id === 'color' ? '文字颜色' : id === 'highlight' ? '高亮' : id === 'heading' ? '标题' : id === 'link' ? '链接' : '图片'
      expect(wrapper.get('button').text()).toContain(expectedLabel)
      wrapper.unmount()
    }

    const active = mountControl(itemControl('bold', { isActive: () => true }))
    expect(active.get('button').classes()).toContain('is-active')
    active.unmount()

    const disabled = mountControl(itemControl('bold', { isDisabled: () => true }))
    expect(disabled.get('button').attributes('disabled')).toBeDefined()
    disabled.unmount()

    const readonly = mountControl(itemControl('bold'), { readonly: true })
    expect(readonly.get('button').attributes('disabled')).toBeDefined()
    readonly.unmount()
  })

  it('forwards find, paste mode, heading, link, and image interactions', async () => {
    const find = mountControl({ key: 'builtin:find', kind: 'find', group: 'utility', label: '查找替换', icon: 'lucide:search' })
    await find.get('button[aria-label="查找替换"]').trigger('click')
    expect(find.emitted('find')).toEqual([[]])
    find.unmount()

    const paste = mountControl({ key: 'builtin:paste-mode', kind: 'paste-mode', group: 'utility', label: '粘贴模式', icon: 'lucide:clipboard-type' }, { pasteMode: 'markdown' })
    await paste.get('button[aria-label="粘贴模式：Markdown"]').trigger('click')
    expect(paste.emitted('togglePasteMode')).toEqual([[]])
    paste.unmount()

    const heading = mountControl(itemControl('heading', { label: '标题' }), { activeHeadingLevel: 2 })
    await heading.get('button[aria-label="标题"]').trigger('click')
    await new DOMWrapper(document.querySelector('[data-nexusdown="heading-menu"]')!).get('button[aria-label="H3"]').trigger('click')
    expect(heading.emitted('selectHeading')).toEqual([[3]])
    heading.unmount()

    const link = mountControl(itemControl('link', { label: '链接' }), { linkSelectedText: '选中文本', linkHref: 'https://before.example' })
    await link.get('button[aria-label="链接"]').trigger('click')
    const linkMenu = new DOMWrapper(document.querySelector('[data-nexusdown="link-menu"]')!)
    await linkMenu.get('input[aria-label="链接地址"]').setValue('https://after.example')
    await linkMenu.get('button[aria-label="应用链接"]').trigger('click')
    expect(link.emitted('applyLink')).toEqual([[{ href: 'https://after.example', text: '已选文本' }]])
    link.unmount()

    const image = mountControl(itemControl('image', { label: '图片' }))
    await image.get('button[aria-label="图片"]').trigger('click')
    const imageMenu = new DOMWrapper(document.querySelector('[data-nexusdown="image-menu"]')!)
    await imageMenu.get('input[aria-label="图片地址"]').setValue('https://image.example/a.png')
    await imageMenu.get('input[aria-label="图片描述"]').setValue('示例')
    await imageMenu.get('button[aria-label="应用图片"]').trigger('click')
    expect(image.emitted('applyImage')).toEqual([[{ src: 'https://image.example/a.png', alt: '示例' }]])
    image.unmount()
  })

  it('reads link values through the session receiver', async () => {
    const context = createContext()
    const session = context.session as typeof context.session & { selectedText: string; currentHref: string }
    session.selectedText = '依赖 this 的选中文本'
    session.currentHref = 'https://receiver.example'
    session.getSelectedText = function (this: typeof session) { return this.selectedText }
    session.getLinkHref = function (this: typeof session) { return this.currentHref }

    const link = mountControl(itemControl('link', { label: '链接' }), { context })
    await link.get('button[aria-label="链接"]').trigger('click')
    const linkMenu = new DOMWrapper(document.querySelector('[data-nexusdown="link-menu"]')!)

    expect((linkMenu.get('input[aria-label="链接文本"]').element as HTMLInputElement).value).toBe('依赖 this 的选中文本')
    expect((linkMenu.get('input[aria-label="链接地址"]').element as HTMLInputElement).value).toBe('https://receiver.example')
    link.unmount()
  })

  it('disables a concealed compound control and closes its open picker', async () => {
    const wrapper = mountControl(itemControl('heading', { label: '标题' }))
    await wrapper.get('button[aria-label="标题"]').trigger('click')
    expect(document.querySelector('[data-nexusdown="heading-menu"]')).not.toBeNull()

    await wrapper.setProps({ concealed: true })
    await nextTick()

    expect(wrapper.get('button[aria-label="标题"]').attributes('disabled')).toBeDefined()
    expect(document.querySelector('[data-nexusdown="heading-menu"]')).toBeNull()
    wrapper.unmount()
  })

  for (const [id, menu] of [['link', 'link-menu'], ['image', 'image-menu']] as const) {
    it(`disables a concealed ${id} control and closes its open picker`, async () => {
      const label = id === 'link' ? '链接' : '图片'
      const wrapper = mountControl(itemControl(id, { label }))
      await wrapper.get(`button[aria-label="${label}"]`).trigger('click')
      expect(document.querySelector(`[data-nexusdown="${menu}"]`)).not.toBeNull()

      await wrapper.setProps({ concealed: true })
      await nextTick()

      expect(wrapper.get(`button[aria-label="${label}"]`).attributes('disabled')).toBeDefined()
      expect(document.querySelector(`[data-nexusdown="${menu}"]`)).toBeNull()
      wrapper.unmount()
    })
  }
})

function installEditorToolbarGeometry(width: number, rights: Record<string, number>) {
  const geometry = { width, rights }
  const observed = new Set<Element>()
  let resize: ResizeObserverCallback | undefined
  let observer: ResizeObserver
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback; observer = this as unknown as ResizeObserver }
    observe(target: Element) { observed.add(target) }
    disconnect() { observed.clear() }
  })
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.nexusdown === 'toolbar') return createRect(0, geometry.width)
    if (this.classList.contains('nexusdown-toolbar-overflow__slot')) return createRect(geometry.width - 56, geometry.width)
    if (this.classList.contains('nexusdown-toolbar__track')) return createRect(0, Math.max(...Object.values(geometry.rights)))
    return createRect(0, geometry.rights[this.dataset.nexusdownToolbarKey ?? ''] ?? 32)
  })
  return {
    geometry,
    observed,
    notify(target: Element) {
      if (observed.has(target)) resize?.([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], observer)
    },
    async flush() {
      await nextTick()
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback(0))
      await nextTick()
      await nextTick()
    },
  }
}

describe('EditorToolbar durable overflow behavior', () => {
  it('remeasures intrinsic track changes while the toolbar width stays fixed', async () => {
    const layout = installEditorToolbarGeometry(240, { 'item:bold': 150, 'item:image': 200 })
    const wrapper = mount(EditorToolbar, {
      props: { context: createContext(), items: [itemControl('bold').item, itemControl('image').item] }, attachTo: document.body,
    })
    try {
      await layout.flush()
      const image = wrapper.get('[data-nexusdown-toolbar-key="item:image"]')
      const track = wrapper.get('.nexusdown-toolbar__track').element
      expect(image.attributes('data-overflowed')).toBeUndefined()
      expect(layout.observed.has(wrapper.element)).toBe(true)
      layout.geometry.rights['item:image'] = 270
      layout.notify(track)
      await layout.flush()
      expect(wrapper.element.getBoundingClientRect().width).toBe(240)
      expect(image.attributes('data-overflowed')).toBe('true')
      expect(layout.observed.has(track)).toBe(true)
      layout.geometry.rights['item:image'] = 200
      layout.notify(track)
      await layout.flush()
      expect(image.attributes('data-overflowed')).toBeUndefined()
    } finally { wrapper.unmount() }
    expect(layout.observed.size).toBe(0)
  })

  for (const [id, label, contextKey, defaultColor] of [
    ['color', '文字颜色', 'color', '#2563eb'], ['highlight', '高亮', 'highlightColor', '#fef08a'],
  ] as const) {
    it(`shares durable ${id} selection across compact and overflow copies`, async () => {
      const applied: unknown[] = []
      const item = itemControl(id, { execute: (context) => { applied.push(context[contextKey]); return true } }).item
      const layout = installEditorToolbarGeometry(240, { [`item:${id}`]: 400 })
      const wrapper = mount(EditorToolbar, { props: { context: createContext(), items: [item] }, attachTo: document.body })
      try {
        await layout.flush()
        const more = wrapper.get('[data-nexusdown="toolbar-more-trigger"]')
        const mainInput = wrapper.get<HTMLInputElement>('input[type="color"]')
        expect(mainInput.element.value).toBe(defaultColor)
        await more.trigger('click'); await layout.flush()
        let menu = new DOMWrapper(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')!)
        await menu.get('input[type="color"]').setValue('#123456')
        expect(applied).toEqual(['#123456'])
        expect.soft(mainInput.element.value).toBe('#123456')
        expect(wrapper.emitted('executed')).toBeUndefined()
        await more.trigger('click'); await layout.flush()
        await more.trigger('click'); await layout.flush()
        menu = new DOMWrapper(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')!)
        expect.soft(menu.get<HTMLInputElement>('input[type="color"]').element.value).toBe('#123456')
        await menu.get(`button[aria-label="${label}"]`).trigger('click')
        expect(applied).toEqual(['#123456', '#123456'])

        await more.trigger('click'); await layout.flush()
        layout.geometry.width = 500
        layout.notify(wrapper.element); await layout.flush()
        expect(mainInput.attributes('disabled')).toBeUndefined()
        await mainInput.setValue('#abcdef')
        expect(applied.at(-1)).toBe('#abcdef')
        layout.geometry.width = 240
        layout.notify(wrapper.element); await layout.flush()
        await more.trigger('click'); await layout.flush()
        menu = new DOMWrapper(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')!)
        expect(menu.get<HTMLInputElement>('input[type="color"]').element.value).toBe('#abcdef')
        await menu.get(`button[aria-label="${label}"]`).trigger('click')
        expect(applied).toEqual(['#123456', '#123456', '#abcdef', '#abcdef'])
      } finally { wrapper.unmount() }
    })
  }

  for (const modal of [false, true]) {
    for (const [id, label, field] of [['link', '链接', '链接地址'], ['image', '图片', '图片地址']] as const) {
      it(`recovers ${id} child focus after widening with other overflow items in ${modal ? 'modal' : 'body'}`, async () => {
        const host = document.createElement(modal ? 'dialog' : 'div')
        if (modal) host.setAttribute('open', '')
        const matches = host.matches.bind(host)
        host.matches = (selector) => selector === ':modal' ? modal : matches(selector)
        document.body.append(host)
        const layout = installEditorToolbarGeometry(240, { [`item:${id}`]: 300, 'item:tail': 600 })
        const wrapper = mount(EditorToolbar, {
          props: { context: createContext(), items: [itemControl(id).item, itemControl('tail').item] }, attachTo: host,
        })
        try {
          await layout.flush()
          const more = wrapper.get('[data-nexusdown="toolbar-more-trigger"]')
          await more.trigger('click'); await layout.flush()
          const menu = document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')!
          await new DOMWrapper(menu).get(`button[aria-label="${label}"]`).trigger('click'); await layout.flush()
          const child = document.querySelector(`[data-nexusdown="${id}-menu"]`)!
          const input = child.querySelector<HTMLInputElement>(`input[aria-label="${field}"]`)!
          input.focus()
          expect(document.activeElement).toBe(input)
          layout.geometry.width = 400
          layout.notify(wrapper.element); await layout.flush()

          expect(document.querySelector(`[data-nexusdown="${id}-menu"]`)).toBeNull()
          expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
          expect(document.activeElement).toBe(wrapper.get(`button[aria-label="${label}"]`).element)
          expect(more.isVisible()).toBe(true)
        } finally { wrapper.unmount(); host.remove() }
      })
    }

    it(`recovers focus when a real focused Link child is removed in ${modal ? 'modal' : 'body'}`, async () => {
      const host = document.createElement(modal ? 'dialog' : 'div')
      if (modal) host.setAttribute('open', '')
      const matches = host.matches.bind(host)
      host.matches = (selector) => selector === ':modal' ? modal : matches(selector)
      document.body.append(host)
      const tail = itemControl('tail').item
      const layout = installEditorToolbarGeometry(240, { 'item:link': 300, 'item:tail': 600 })
      const wrapper = mount(EditorToolbar, {
        props: { context: createContext(), items: [itemControl('link').item, tail] }, attachTo: host,
      })
      try {
        await layout.flush()
        const more = wrapper.get('[data-nexusdown="toolbar-more-trigger"]')
        await more.trigger('click'); await layout.flush()
        const menu = document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')!
        await new DOMWrapper(menu).get('button[aria-label="链接"]').trigger('click'); await layout.flush()
        document.querySelector<HTMLInputElement>('input[aria-label="链接地址"]')!.focus()
        await wrapper.setProps({ items: [tail] })
        await layout.flush()
        expect(document.querySelector('[data-nexusdown="link-menu"]')).toBeNull()
        expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
        expect(document.activeElement).toBe(more.element)
      } finally { wrapper.unmount(); host.remove() }
    })

    it.each([
      ['external input', true], ['external input', false],
      ['another toolbar overlay', true], ['another toolbar overlay', false],
    ] as const)(`preserves host focus after removal before measurement in ${modal ? 'modal' : 'body'}: %s, More remaining %s`, async (destination, keepOverflow) => {
      const host = document.createElement(modal ? 'dialog' : 'div')
      if (modal) host.setAttribute('open', '')
      const matches = host.matches.bind(host)
      host.matches = (selector) => selector === ':modal' ? modal : matches(selector)
      document.body.append(host)
      const removed = itemControl('custom[0]."menu', { label: '移除项' }).item
      const survivor = itemControl('survivor', { label: '保留项' }).item
      const layout = installEditorToolbarGeometry(240, {
        [`item:${removed.id}`]: 400, 'item:survivor': keepOverflow ? 450 : 140, 'item:link': 140,
      })
      const wrapper = mount(EditorToolbar, {
        props: { context: createContext(), items: [survivor, removed] }, attachTo: host,
      })
      const otherToolbar = destination === 'another toolbar overlay' ? mount(EditorToolbar, {
        props: { context: createContext(), items: [itemControl('link').item] }, attachTo: host,
      }) : undefined
      const external = document.createElement('input')
      host.append(external)
      try {
        await layout.flush()
        await wrapper.get('[data-nexusdown="toolbar-more-trigger"]').trigger('click'); await layout.flush()
        document.querySelector<HTMLButtonElement>('[data-nexusdown="toolbar-overflow-menu"] button[aria-label="移除项"]')!.focus()

        await wrapper.setProps({ items: [survivor] })
        await nextTick()
        expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
        if (otherToolbar) {
          await otherToolbar.get('button[aria-label="链接"]').trigger('click')
          await nextTick()
        }
        const target = otherToolbar ? document.querySelector<HTMLInputElement>('input[aria-label="链接地址"]')! : external
        target.focus()
        expect(document.activeElement).toBe(target)

        // Only now run the removal-triggered requestAnimationFrame measurement.
        await layout.flush()
        expect(document.activeElement).toBe(target)
        expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
      } finally { wrapper.unmount(); otherToolbar?.unmount(); host.remove() }
    })
  }

  it.each([true, false])('recovers removal of a focused punctuation-key item with More remaining: %s', async (keepOverflow) => {
    const removed = itemControl('custom[0]."menu', { label: '移除项' }).item
    const survivor = itemControl('survivor', { label: '保留项' }).item
    const layout = installEditorToolbarGeometry(240, { [`item:${removed.id}`]: 400, 'item:survivor': keepOverflow ? 450 : 140 })
    const wrapper = mount(EditorToolbar, {
      props: { context: createContext(), items: [survivor, removed] }, attachTo: document.body,
    })
    try {
      await layout.flush()
      const more = wrapper.get('[data-nexusdown="toolbar-more-trigger"]')
      await more.trigger('click'); await layout.flush()
      document.querySelector<HTMLButtonElement>('[data-nexusdown="toolbar-overflow-menu"] button[aria-label="移除项"]')!.focus()
      await wrapper.setProps({ items: [survivor] })
      await layout.flush()
      expect(document.querySelector('[data-nexusdown="toolbar-overflow-menu"]')).toBeNull()
      expect(document.activeElement).toBe(keepOverflow ? more.element : wrapper.get('button[aria-label="保留项"]').element)
    } finally { wrapper.unmount() }
  })
})

describe('EditorToolbar control layout', () => {
  it('keeps groups and separators as direct track children around keyed controls', () => {
    const wrapper = mount(EditorToolbar, {
      props: { context: createContext(), items: createDefaultToolbarItems() },
      attachTo: document.body,
    })
    const toolbar = wrapper.get('.nexusdown-toolbar__track').element
    const children = [...toolbar.children]
    const groups = children.filter((child) => child.classList.contains('nexusdown-toolbar__group'))
    const separators = children.filter((child) => child.classList.contains('nexusdown-toolbar__separator'))

    expect(groups).toHaveLength(7)
    expect(separators).toHaveLength(6)
    expect(groups[0].querySelectorAll(':scope > .nexusdown-toolbar__control')).toHaveLength(2)
    expect(groups[1].querySelectorAll(':scope > .nexusdown-toolbar__control')).toHaveLength(2)
    expect([...groups[0].querySelectorAll<HTMLElement>(':scope > .nexusdown-toolbar__control')].map((control) => control.dataset.nexusdownToolbarKey)).toEqual(['item:undo', 'item:redo'])
    expect([...groups[1].querySelectorAll<HTMLElement>(':scope > .nexusdown-toolbar__control')].map((control) => control.dataset.nexusdownToolbarKey)).toEqual(['builtin:find', 'builtin:paste-mode'])
    wrapper.unmount()
  })

  it('uses unique group keys when a custom group is named utility', async () => {
    const items = [
      ...createDefaultToolbarItems(),
      itemControl('utility-badge', { group: 'utility', label: '工具徽章' }).item,
    ]
    const wrapper = mount(EditorToolbar, {
      props: { context: createContext(), items },
      attachTo: document.body,
    })

    await wrapper.setProps({ items: [...items] })

    const groups = wrapper.findAll('.nexusdown-toolbar__track > .nexusdown-toolbar__group')
    expect(groups).toHaveLength(8)
    expect(groups[1].findAll('[data-nexusdown-toolbar-key]')).toHaveLength(2)
    expect(groups.at(-1)!.get('[data-nexusdown-toolbar-key]').attributes('data-nexusdown-toolbar-key')).toBe('item:utility-badge')
    expect(wrapper.findAll('[data-nexusdown-toolbar-key="item:utility-badge"]')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('calculateOverflowedKeys', () => {
  const controls = [
    { key: 'undo', right: 42 },
    { key: 'redo', right: 76 },
    { key: 'heading', right: 122 },
    { key: 'bold', right: 156 },
  ]

  it('returns no items when the complete track fits', () => {
    expect([...calculateOverflowedKeys(controls, 180, 140)]).toEqual([])
  })

  it('moves the tail behind the fixed more slot when the track overflows', () => {
    expect([...calculateOverflowedKeys(controls, 150, 108)]).toEqual(['heading', 'bold'])
  })

  it('keeps every command reachable at an extremely narrow width', () => {
    expect([...calculateOverflowedKeys(controls, 20, 0)]).toEqual(['undo', 'redo', 'heading', 'bold'])
  })
})

type Geometry = {
  toolbarRight: number
  moreLeft: number
  controls: Record<string, number>
}

type ToolbarOverflowHarnessVm = {
  overflowedKeys: Set<string>
  ready: boolean
  setControlKeys: (keys: string[]) => void
}

function createRect(left: number, right: number): DOMRect {
  return {
    x: left,
    y: 0,
    width: right - left,
    height: 24,
    top: 0,
    right,
    bottom: 24,
    left,
    toJSON: () => ({}),
  } as DOMRect
}

function mockLayout(geometry: Geometry) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.toolbarOverflowToolbar !== undefined) return createRect(0, geometry.toolbarRight)
    if (this.dataset.toolbarOverflowMoreSlot !== undefined) return createRect(geometry.moreLeft, geometry.toolbarRight)
    const key = this.dataset.nexusdownToolbarKey
    return createRect(0, key ? (geometry.controls[key] ?? 0) : 0)
  })
}

function installAnimationFrame() {
  let callback: FrameRequestCallback | undefined
  const request = vi.fn((next: FrameRequestCallback) => {
    callback = next
    return 7
  })
  const cancel = vi.fn()
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  return {
    cancel,
    async flush() {
      await nextTick()
      const next = callback
      callback = undefined
      next?.(0)
      await nextTick()
    },
  }
}

function mountHarness(initialKeys: string[]) {
  return mount(defineComponent({
    setup(_props, { expose }) {
      const toolbar = ref<HTMLElement | null>(null)
      const moreSlot = ref<HTMLElement | null>(null)
      const controlKeys = ref(initialKeys)
      const overflow = useToolbarOverflow({ toolbar, moreSlot, controlKeys })
      expose({
        overflowedKeys: overflow.overflowedKeys,
        ready: overflow.ready,
        setControlKeys: (keys: string[]) => {
          controlKeys.value = keys
        },
      })
      return () => h('div', { ref: toolbar, 'data-toolbar-overflow-toolbar': '' }, [
        h('div', { ref: moreSlot, 'data-toolbar-overflow-more-slot': '' }),
        ...controlKeys.value.map((key) => h('button', { 'data-nexusdown-toolbar-key': key }, key)),
      ])
    },
  }), { attachTo: document.body }) as unknown as {
    vm: ToolbarOverflowHarnessVm
    unmount: () => void
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useToolbarOverflow', () => {
  const initialKeys = ['undo', 'redo', 'heading', 'bold']

  it('updates the overflow tail in both directions after ResizeObserver notifications', async () => {
    const geometry: Geometry = {
      toolbarRight: 150,
      moreLeft: 108,
      controls: { undo: 42, redo: 76, heading: 122, bold: 156 },
    }
    mockLayout(geometry)
    const animation = installAnimationFrame()
    let callback: ResizeObserverCallback | undefined
    const disconnect = vi.fn()
    class TestResizeObserver {
      constructor(next: ResizeObserverCallback) {
        callback = next
      }

      observe = vi.fn()
      disconnect = disconnect
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const wrapper = mountHarness(initialKeys)

    await animation.flush()
    expect([...wrapper.vm.overflowedKeys]).toEqual(['heading', 'bold'])
    expect(wrapper.vm.ready).toBe(true)

    geometry.controls.bold = 96
    callback?.([], {} as ResizeObserver)
    await animation.flush()
    expect([...wrapper.vm.overflowedKeys]).toEqual([])

    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('matches selector punctuation only through the data attribute value', async () => {
    const key = 'item:custom[0].menu'
    const geometry: Geometry = {
      toolbarRight: 150,
      moreLeft: 108,
      controls: { [key]: 156 },
    }
    mockLayout(geometry)
    const animation = installAnimationFrame()
    class TestResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}

      observe = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const wrapper = mountHarness([key])

    await animation.flush()
    expect([...wrapper.vm.overflowedKeys]).toEqual([key])
    wrapper.unmount()
  })

  it('measures again when the allowed control keys change', async () => {
    const geometry: Geometry = {
      toolbarRight: 150,
      moreLeft: 108,
      controls: { visible: 96, newlyAllowed: 156 },
    }
    mockLayout(geometry)
    const animation = installAnimationFrame()
    class TestResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}

      observe = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const wrapper = mountHarness(['visible'])

    await animation.flush()
    expect([...wrapper.vm.overflowedKeys]).toEqual([])

    wrapper.vm.setControlKeys(['visible', 'newlyAllowed'])
    await nextTick()
    await animation.flush()
    expect([...wrapper.vm.overflowedKeys]).toEqual(['newlyAllowed'])
    wrapper.unmount()
  })

  it('uses window resize when ResizeObserver is unavailable and removes the fallback on unmount', async () => {
    const geometry: Geometry = {
      toolbarRight: 150,
      moreLeft: 108,
      controls: { undo: 42, redo: 76, heading: 122, bold: 96 },
    }
    mockLayout(geometry)
    const animation = installAnimationFrame()
    vi.stubGlobal('ResizeObserver', undefined)
    const remove = vi.spyOn(window, 'removeEventListener')
    const wrapper = mountHarness(initialKeys)

    await animation.flush()
    expect([...wrapper.vm.overflowedKeys]).toEqual([])

    geometry.controls.bold = 156
    window.dispatchEvent(new Event('resize'))
    await animation.flush()
    expect([...wrapper.vm.overflowedKeys]).toEqual(['heading', 'bold'])

    wrapper.unmount()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  it('cancels a pending animation frame when unmounted', async () => {
    const geometry: Geometry = {
      toolbarRight: 150,
      moreLeft: 108,
      controls: { undo: 42, redo: 76, heading: 122, bold: 156 },
    }
    mockLayout(geometry)
    const animation = installAnimationFrame()
    class TestResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}

      observe = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const wrapper = mountHarness(initialKeys)

    await nextTick()
    wrapper.unmount()
    expect(animation.cancel).toHaveBeenCalledWith(7)
  })
})
