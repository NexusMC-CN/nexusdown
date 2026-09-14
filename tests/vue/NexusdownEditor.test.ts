import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Extension } from '@tiptap/core'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'
import type { NexusdownEditorSession } from '../../src/core/session'

describe('NexusdownEditor', () => {
  it('renders rich text before the Markdown editor by default (rich-left layout)', () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '# Hello' } })
    const rich = wrapper.get('[data-nexusdown="rich-text"]').element
    const markdown = wrapper.get('[data-nexusdown="markdown-editor"]').element

    expect(rich.compareDocumentPosition(markdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.get('[data-nexusdown="editor"]').attributes('data-nexusdown-layout')).toBe('rich-left')
    wrapper.unmount()
  })

  it('reverses pane DOM order for the markdown-left layout', () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '# Hello', layout: 'markdown-left' },
    })
    const rich = wrapper.get('[data-nexusdown="rich-text"]').element
    const markdown = wrapper.get('[data-nexusdown="markdown-editor"]').element

    expect(markdown.compareDocumentPosition(rich) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.get('[data-nexusdown="editor"]').attributes('data-nexusdown-layout')).toBe('markdown-left')
    wrapper.unmount()
  })

  it('falls back to rich-left for an unknown layout value', () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '# Hello', layout: 'sideways' as never },
    })
    const rich = wrapper.get('[data-nexusdown="rich-text"]').element
    const markdown = wrapper.get('[data-nexusdown="markdown-editor"]').element

    expect(rich.compareDocumentPosition(markdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.get('[data-nexusdown="editor"]').attributes('data-nexusdown-layout')).toBe('rich-left')
    wrapper.unmount()
  })

  it('preserves custom class and style while exposing dimension CSS variables', () => {
    const wrapper = mount(NexusdownEditor, {
      attrs: { class: 'custom-editor', style: '--nexusdown-accent: #7c3aed' },
      props: { modelValue: '# Hello', width: 900, height: '70vh' },
    })
    const editor = wrapper.get('[data-nexusdown="editor"]')

    expect(editor.classes()).toContain('custom-editor')
    const editorStyle = (editor.element as HTMLElement).style
    expect(editorStyle.getPropertyValue('--nexusdown-accent')).toBe('#7c3aed')
    expect(editorStyle.getPropertyValue('--nexusdown-width')).toBe('900px')
    expect(editorStyle.getPropertyValue('--nexusdown-height')).toBe('70vh')
    wrapper.unmount()
  })

  it('renders rich text, markdown, and one shared toolbar', () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '# Hello', contentType: 'markdown' } })
    expect(wrapper.find('[data-nexusdown="rich-text"]').exists()).toBe(true)
    expect(wrapper.find('[data-nexusdown="markdown"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-nexusdown="toolbar"]').length).toBe(1)
    expect(wrapper.findAll('iconify-icon').length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('keeps a fixed default size and accepts custom width and height', () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '# Hello', width: 900, height: '70vh' },
    })
    const editor = wrapper.get('[data-nexusdown="editor"]').element as HTMLElement
    expect(editor.style.getPropertyValue('--nexusdown-width')).toBe('900px')
    expect(editor.style.getPropertyValue('--nexusdown-height')).toBe('70vh')
    wrapper.unmount()

    const defaults = mount(NexusdownEditor, { props: { modelValue: '# Hello' } })
    const defaultEditor = defaults.get('[data-nexusdown="editor"]').element as HTMLElement
    expect(defaultEditor.style.getPropertyValue('--nexusdown-width')).toBe('100%')
    expect(defaultEditor.style.getPropertyValue('--nexusdown-height')).toBe('420px')
    defaults.unmount()
  })

  it('syncs rich and Markdown scrolling in both directions using their rendered ranges', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: `${'# Heading\n\n'}${'Long content\n'.repeat(40)}` },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const richPane = wrapper.get('[data-nexusdown="rich-text"]').element as HTMLElement
    const textarea = wrapper.get('[data-nexusdown="markdown"]').element as HTMLTextAreaElement
    Object.defineProperties(richPane, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1000 },
    })
    Object.defineProperties(textarea, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 800 },
    })

    richPane.scrollTop = 450
    await wrapper.get('[data-nexusdown="rich-text"]').trigger('scroll')
    expect(textarea.scrollTop).toBe(300)

    textarea.scrollTop = 300
    await wrapper.get('[data-nexusdown="markdown"]').trigger('scroll')
    expect(richPane.scrollTop).toBe(450)
    wrapper.unmount()
  })

  it('can disable linked scrolling without affecting either editor', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '# Heading\n\nContent', syncScroll: false },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const richPane = wrapper.get('[data-nexusdown="rich-text"]').element as HTMLElement
    const textarea = wrapper.get('[data-nexusdown="markdown"]').element as HTMLTextAreaElement
    Object.defineProperties(richPane, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1000 },
    })
    Object.defineProperties(textarea, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 800 },
    })
    richPane.scrollTop = 450
    await wrapper.get('[data-nexusdown="rich-text"]').trigger('scroll')
    expect(textarea.scrollTop).toBe(0)
    wrapper.unmount()
  })

  it('emits markdown updates from the markdown surface', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '# Hello' } })
    await wrapper.get('[data-nexusdown="markdown"]').setValue('# Updated')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['# Updated'])
    wrapper.unmount()
  })

  it('mounts the rich text surface as a Tiptap EditorView', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '**Bold**' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.find('[data-nexusdown="rich-text"] .ProseMirror').exists()).toBe(true)
    wrapper.unmount()
  })

  it('uses html when an external html model value changes', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '<p>First</p>', contentType: 'html' },
    })
    await wrapper.setProps({ modelValue: '<h2>Second</h2>' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.find('[data-nexusdown="rich-text"] h2').text()).toBe('Second')
    wrapper.unmount()
  })

  it('makes the Tiptap surface readonly when readonly is enabled', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Text', readonly: true } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.get('.ProseMirror').attributes('contenteditable')).toBe('false')
    wrapper.unmount()
  })

  it('applies toolbar formatting to the selection in the visible EditorView', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Selected text' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    vm.session.getEditor().commands.selectAll()
    await wrapper.get('button[aria-label="粗体"]').trigger('click')
    expect(wrapper.get('.ProseMirror strong').text()).toBe('Selected text')
    wrapper.unmount()
  })

  it('applies an explicit theme and accepts custom Tiptap extensions', () => {
    const custom = Extension.create({ name: 'vueCustomExtension' })
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '# Hello', theme: 'dark', extensions: [custom] },
    })
    expect(wrapper.get('[data-nexusdown="editor"]').attributes('data-nexusdown-theme')).toBe('dark')
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    expect(vm.session.getEditor().extensionManager.extensions.map((extension) => extension.name)).toContain('vueCustomExtension')
    wrapper.unmount()
  })

  it('renders the syntax-highlight mirror alongside the markdown input', () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '# Heading\n\n**bold**' } })
    expect(wrapper.find('[data-nexusdown="markdown-editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-nexusdown="markdown-highlight"] .hljs-section').exists()).toBe(true)
    expect(wrapper.find('[data-nexusdown="markdown-highlight"] .hljs-strong').exists()).toBe(true)
    wrapper.unmount()
  })

  it('applies the built-in text color action from the shared toolbar', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Colored' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    vm.session.getEditor().commands.selectAll()
    await wrapper.get('button[aria-label="文字颜色"]').trigger('click')
    expect(wrapper.get('.ProseMirror [style*="color"]').text()).toBe('Colored')
    wrapper.unmount()
  })

  it('shows rich text color in the editable Markdown pane', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Colored' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    vm.session.getEditor().commands.selectAll()
    await wrapper.get('button[aria-label="文字颜色"]').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect((wrapper.get('[data-nexusdown="markdown"]').element as HTMLTextAreaElement).value).toContain('[color color="#2563eb"]Colored[/color]')
    expect(wrapper.get('[data-nexusdown="markdown-color"]').text()).toBe('Colored')
    expect(wrapper.get('[data-nexusdown="markdown-color"]').attributes('style')).toContain('color: #2563eb')
    wrapper.unmount()
  })

  it('keeps color and highlight available on an empty line and toggles active marks off', async () => {
    const empty = mount(NexusdownEditor, { props: { modelValue: '<p></p>', contentType: 'html' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(empty.get('button[aria-label="文字颜色"]').attributes('disabled')).toBeUndefined()
    expect(empty.get('button[aria-label="高亮"]').attributes('disabled')).toBeUndefined()
    await empty.get('button[aria-label="文字颜色"]').trigger('click')
    ;(empty.vm as unknown as { session: NexusdownEditorSession }).session.getEditor().commands.insertContent('Empty line')
    expect(empty.get('.ProseMirror [style*="color"]').text()).toBe('Empty line')
    empty.unmount()

    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Colored' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    vm.session.getEditor().commands.selectAll()
    await wrapper.get('button[aria-label="文字颜色"]').trigger('click')
    expect(wrapper.find('.ProseMirror [style*="color"]').exists()).toBe(true)
    await wrapper.get('button[aria-label="文字颜色"]').trigger('click')
    expect(wrapper.find('.ProseMirror [style*="color"]').exists()).toBe(false)

    vm.session.getEditor().commands.selectAll()
    await wrapper.get('button[aria-label="高亮"]').trigger('click')
    expect(wrapper.find('.ProseMirror mark').exists()).toBe(true)
    await wrapper.get('button[aria-label="高亮"]').trigger('click')
    expect(wrapper.find('.ProseMirror mark').exists()).toBe(false)
    wrapper.unmount()
  })

  it('inserts a table from the shared toolbar', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Before' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.get('button[aria-label="表格"]').trigger('click')
    expect(wrapper.find('.ProseMirror table').exists()).toBe(true)
    expect(wrapper.findAll('.ProseMirror table tr')).toHaveLength(3)
    wrapper.unmount()
  })

  it('shows table controls for the active table and adds rows or columns', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: '| A | B |\n| --- | --- |\n| C | D |' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    let textPosition = 0
    vm.session.getEditor().state.doc.descendants((node, position) => {
      if (!textPosition && node.isText) textPosition = position
    })
    vm.session.getEditor().commands.setTextSelection({ from: textPosition, to: textPosition })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.find('[data-nexusdown="table-controls"]').exists()).toBe(true)
    await wrapper.get('button[aria-label="增加一行"]').trigger('click')
    expect(wrapper.findAll('.ProseMirror table tr')).toHaveLength(3)
    await wrapper.get('button[aria-label="增加一列"]').trigger('click')
    expect(wrapper.findAll('.ProseMirror table tr:first-child th')).toHaveLength(3)
    wrapper.unmount()
  })

  it('opens the image popup and inserts an image with alt text', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Before' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.get('button[aria-label="图片"]').trigger('click')

    const menu = document.body.querySelector('[data-nexusdown="image-menu"]') as HTMLElement | null
    expect(menu).not.toBeNull()
    const src = menu?.querySelector('input[aria-label="图片地址"]') as HTMLInputElement
    const alt = menu?.querySelector('input[aria-label="图片描述"]') as HTMLInputElement
    src.value = 'https://example.com/image.png'
    src.dispatchEvent(new Event('input', { bubbles: true }))
    alt.value = 'Example image'
    alt.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    ;(menu?.querySelector('button[aria-label="应用图片"]') as HTMLButtonElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.get('.ProseMirror img').attributes('src')).toBe('https://example.com/image.png')
    expect(wrapper.get('.ProseMirror img').attributes('alt')).toBe('Example image')
    wrapper.unmount()
  })

  it('updates block formatting state when the caret moves between lines', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '> Quote\n\nPlain' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    const quoteButton = wrapper.get('button[aria-label="引用"]')
    vm.session.getEditor().commands.setTextSelection({ from: 2, to: 2 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(quoteButton.classes()).toContain('is-active')
    vm.session.getEditor().commands.setTextSelection({ from: 10, to: 10 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(quoteButton.classes()).not.toContain('is-active')
    wrapper.unmount()
  })

  it('offers H1 through H6 and applies the selected heading level', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Section' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await wrapper.get('button[aria-label="标题"]').trigger('click')
    expect(document.body.querySelectorAll('[data-nexusdown="heading-menu"] button')).toHaveLength(6)
    expect(wrapper.find('[data-nexusdown="toolbar"] [data-nexusdown="heading-menu"]').exists()).toBe(false)
    const h3 = document.body.querySelector('[data-nexusdown="heading-menu"] button[aria-label="H3"]') as HTMLButtonElement
    h3.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.get('.ProseMirror h3').text()).toBe('Section')
    wrapper.unmount()
  })

  it('opens an independent link popup with display text and URL fields', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: 'Selected text' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    vm.session.getEditor().commands.selectAll()

    await wrapper.get('button[aria-label="链接"]').trigger('click')

    const menu = document.body.querySelector('[data-nexusdown="link-menu"]') as HTMLElement | null
    expect(menu).not.toBeNull()
    expect(wrapper.find('[data-nexusdown="toolbar"] [data-nexusdown="link-menu"]').exists()).toBe(false)
    expect((menu?.querySelector('input[aria-label="链接文本"]') as HTMLInputElement).value).toBe('Selected text')
    expect((menu?.querySelector('input[aria-label="链接地址"]') as HTMLInputElement).value).toBe('')

    const hrefInput = document.body.querySelector('[data-nexusdown="link-menu"] input[aria-label="链接地址"]') as HTMLInputElement
    hrefInput.value = 'https://example.com'
    hrefInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const applyButton = document.body.querySelector('[data-nexusdown="link-menu"] button[aria-label="应用链接"]') as HTMLButtonElement
    applyButton.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.get('.ProseMirror a').attributes('href')).toBe('https://example.com')
    expect(wrapper.get('.ProseMirror a').text()).toBe('Selected text')
    wrapper.unmount()
  })

  it('renders task items with a clickable checkbox and editable text beside it', async () => {
    const wrapper = mount(NexusdownEditor, { props: { modelValue: '- [ ] First task' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const item = wrapper.get('[data-type="taskList"] li')
    expect(item.find('input[type="checkbox"]').exists()).toBe(true)
    expect(item.find('div p').text()).toBe('First task')

    const checkbox = item.get('input[type="checkbox"]')
    ;(checkbox.element as HTMLInputElement).checked = true
    await checkbox.trigger('change')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect((checkbox.element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.vm as unknown as { session: NexusdownEditorSession }).session.getMarkdown()).toContain('- [x] First task')
    wrapper.unmount()
  })

  it('defers markdown parsing while a table cell is under IME composition', async () => {
    const initial = '| A | B |\n| --- | --- |\n|  |  |'
    const wrapper = mount(NexusdownEditor, { props: { modelValue: initial } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const vm = wrapper.vm as unknown as { session: NexusdownEditorSession }
    const baseline = vm.session.getMarkdown()
    const textarea = wrapper.get('[data-nexusdown="markdown"]')

    await textarea.trigger('compositionstart')
    ;(textarea.element as HTMLTextAreaElement).value = '| A | B |\n| --- | --- |\n| 中 |  |'
    await textarea.trigger('input')
    expect(vm.session.getMarkdown()).toBe(baseline)

    await textarea.trigger('compositionend')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(vm.session.getMarkdown()).toContain('中')
    wrapper.unmount()
  })

  it('keeps the link apply action blue while hovering', () => {
    for (const path of ['../../src/style.css', '../../public/style.css']) {
      const css = readFileSync(new URL(path, import.meta.url), 'utf8')
      expect(css).toMatch(/\.nexusdown-link-picker__actions button:last-child:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--nexus-accent\)/)
    }
  })
})
