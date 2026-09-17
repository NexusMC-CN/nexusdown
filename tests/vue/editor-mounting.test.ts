import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NexusdownEditor from '../../src/vue/NexusdownEditor.vue'
import { createNexusdownEditor } from '../../src/core/session'

describe('editor mounting', () => {
  it('creates the headless view in a detached element, never the document', () => {
    const editor = createNexusdownEditor({ content: 'hi', contentType: 'markdown' })
    // The session must stay usable without a component, so it mounts into a
    // throwaway element — but that element must never be in the live document.
    expect(editor.getEditor().view).not.toBeNull()
    expect(editor.getMountedElement()?.isConnected).toBe(false)
    editor.destroy()
  })

  it('unmounts the previous view before mounting a new target', () => {
    const editor = createNexusdownEditor({ content: 'hi', contentType: 'markdown' })
    const events: string[] = []
    editor.getEditor().on('mount', () => events.push('mount'))
    editor.getEditor().on('unmount', () => events.push('unmount'))

    const first = document.createElement('div')
    const second = document.createElement('div')
    document.body.append(first, second)

    editor.mountEditor(first)
    expect(editor.getMountedElement()).toBe(first)
    // Regression: the constructor's throwaway view was never unmounted here.
    expect(events).toEqual(['unmount', 'mount'])

    editor.mountEditor(second)
    expect(events).toEqual(['unmount', 'mount', 'unmount', 'mount'])
    expect(editor.getMountedElement()).toBe(second)

    // Re-mounting into the same element is a no-op, not another mount.
    editor.mountEditor(second)
    expect(events).toEqual(['unmount', 'mount', 'unmount', 'mount'])

    editor.destroy()
    first.remove()
    second.remove()
  })

  it('re-mounts only once per layout switch in the component', async () => {
    const wrapper = mount(NexusdownEditor, {
      props: { modelValue: 'Hello', layout: 'rich-left' },
      attachTo: document.body,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const vm = wrapper.vm as unknown as { session: { getEditor: () => { on: (n: string, f: () => void) => void } } }
    const events: string[] = []
    const editor = vm.session.getEditor()
    editor.on('mount', () => events.push('mount'))
    editor.on('unmount', () => events.push('unmount'))

    await wrapper.setProps({ layout: 'markdown-left' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The component moves the view from its throwaway element to the real host,
    // so exactly one balanced pair of events is expected per switch.
    expect(events, 'one balanced remount').toEqual(['unmount', 'mount'])

    await wrapper.setProps({ layout: 'rich-left' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['unmount', 'mount', 'unmount', 'mount'])

    // Content survives every remount.
    const surface = wrapper.find('[data-nexusdown="rich-text"] .nexusdown-rich-surface').element
    expect(surface.querySelector('.ProseMirror')).not.toBeNull()
    expect(surface.textContent).toContain('Hello')
    wrapper.unmount()
  })
})
