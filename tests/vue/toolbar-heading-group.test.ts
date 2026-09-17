import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EditorToolbar from '../../src/vue/EditorToolbar.vue'
import { createDefaultToolbarItems, type ToolbarItem } from '../../src/core/toolbar'
import { createNexusdownEditor } from '../../src/core/session'

/**
 * The heading control is a picker, not a plain button, so it is rendered from its
 * own branch of the template. Previously that branch required the item to sit in
 * the `block` group: a consumer who moved the heading item elsewhere — or into a
 * custom group — lost the control entirely (issue #1 comment 8/9).
 */
function mountWith(items: ToolbarItem[]) {
  const session = createNexusdownEditor({ content: '<p>hi</p>', contentType: 'html' })
  const wrapper = mount(EditorToolbar, {
    props: {
      items,
      context: {
        session: {
          commands: session.commands,
          can: (c: never) => session.can(c),
          isActive: (n: string, a?: Record<string, unknown>) => session.isActive(n, a),
          hasTextColor: (c?: string) => session.hasTextColor(c),
          getSelectedText: () => session.getSelectedText(),
          getLinkHref: () => session.getLinkHref(),
          getPasteMode: () => session.getPasteMode(),
          setPasteMode: (m: never) => session.setPasteMode(m),
        },
      },
    },
    attachTo: document.body,
  })
  return { wrapper, session }
}

function relocate(items: ToolbarItem[], id: string, group: string): ToolbarItem[] {
  return items.map((item) => (item.id === id ? { ...item, group } : item))
}

describe('heading control survives a custom toolbar group', () => {
  it('renders the heading picker in the default block group', () => {
    const { wrapper, session } = mountWith(createDefaultToolbarItems())
    expect(wrapper.find('button[aria-label="标题"]').exists()).toBe(true)
    wrapper.unmount()
    session.destroy()
  })

  for (const group of ['inline', 'history', 'extension', 'custom-group']) {
    it(`renders the heading picker when moved to "${group}"`, () => {
      const items = relocate(createDefaultToolbarItems(), 'heading', group)
      const { wrapper, session } = mountWith(items)
      expect(wrapper.find('button[aria-label="标题"]').exists()).toBe(true)
      wrapper.unmount()
      session.destroy()
    })
  }

  it('renders a custom group that is not in the built-in list', () => {
    const items = [
      ...createDefaultToolbarItems(),
      { id: 'badge', group: 'my-extras', icon: 'lucide:award', label: '徽章', execute: () => true } as ToolbarItem,
    ]
    const { wrapper, session } = mountWith(items)
    expect(wrapper.find('[data-nexusdown-command="badge"]').exists()).toBe(true)
    wrapper.unmount()
    session.destroy()
  })

  it('still renders the heading picker when no other block item exists', () => {
    const items = createDefaultToolbarItems().filter((item) => item.group !== 'block' || item.id === 'heading')
    const { wrapper, session } = mountWith(items)
    expect(wrapper.find('button[aria-label="标题"]').exists()).toBe(true)
    wrapper.unmount()
    session.destroy()
  })
})
