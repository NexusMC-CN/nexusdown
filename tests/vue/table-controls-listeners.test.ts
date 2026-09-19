import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createNexusdownEditor } from '../../src/core/session'
import TableControls from '../../src/vue/components/TableControls.vue'

describe('table controls listeners (issue #1 comments)', () => {
  it('adds window listeners on mount and removes every one on unmount', () => {
    const editor = createNexusdownEditor({ content: '<p>x</p>', contentType: 'html' })
    const addWindow = vi.spyOn(window, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')

    const wrapper = mount(TableControls, {
      props: { session: editor, container: null },
      attachTo: document.body,
    })
    wrapper.unmount()

    const addedWindow = addWindow.mock.calls.map((call) => `${call[0]}:${String(call[2])}`)
    const removedWindow = removeWindow.mock.calls.map((call) => `${call[0]}:${String(call[2])}`)
    const addedDocument = addDocument.mock.calls.map((call) => `${call[0]}:${String(call[2])}`)
    const removedDocument = removeDocument.mock.calls.map((call) => `${call[0]}:${String(call[2])}`)

    // Every listener registered on mount must be released on unmount, or a
    // remounted editor keeps repositioning controls for a destroyed session.
    for (const listener of addedWindow) expect(removedWindow).toContain(listener)
    for (const listener of addedDocument) expect(removedDocument).toContain(listener)

    // The capture-phase scroll listener must be removed with the same flag.
    expect(addedWindow).toContain('scroll:true')
    expect(removedWindow).toContain('scroll:true')

    addWindow.mockRestore()
    removeWindow.mockRestore()
    addDocument.mockRestore()
    removeDocument.mockRestore()
    editor.destroy()
  })

  it('stays hidden without an active table', () => {
    const editor = createNexusdownEditor({ content: '<p>no table</p>', contentType: 'html' })
    const wrapper = mount(TableControls, {
      props: { session: editor, container: null },
      attachTo: document.body,
    })
    // The root element is always present; the controls inside it are not
    // rendered until a table is active under the selection.
    expect(wrapper.find('[data-nexusdown="table-controls"]').exists()).toBe(true)
    expect(wrapper.find('[data-nexusdown="table-menu"]').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(0)
    wrapper.unmount()
    editor.destroy()
  })
})
