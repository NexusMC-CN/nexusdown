import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ColorPicker from '../../src/vue/components/ColorPicker.vue'
import type { ToolbarContext, ToolbarItem } from '../../src/core/toolbar'

const iconStub = { template: '<span />' }

function setup(isActive: boolean) {
  const setColor = vi.fn(() => true)
  const execute = vi.fn((_context: ToolbarContext) => true)
  const item: ToolbarItem = {
    id: 'color',
    group: 'extension',
    icon: 'lucide:palette',
    label: '文字颜色',
    // A consumer callback that refuses the action; it must still be consulted.
    execute,
    isActive: () => isActive,
  }
  const context = {
    session: { commands: { setColor } },
  } as unknown as ToolbarContext
  const wrapper = mount(ColorPicker, {
    props: { item, context, kind: 'color' as const, readonly: false },
    global: { stubs: { 'iconify-icon': iconStub } },
  })
  return { wrapper, execute, setColor }
}

describe('colour picker clear action', () => {
  it('routes the clear click through the item callback', async () => {
    // Regression: the clear branch called `session.commands.setColor()` directly,
    // so a consumer's `execute` callback — which may validate, record, or refuse
    // the action — was skipped and the formatting was removed anyway.
    const { wrapper, execute, setColor } = setup(true)

    await wrapper.find('[data-nexusdown="color-picker"] button').trigger('click')

    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][0]).toMatchObject({ color: undefined })
    expect(setColor).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('applies a colour through the item callback', async () => {
    const { wrapper, execute, setColor } = setup(false)

    await wrapper.find('[data-nexusdown="color-picker"] button').trigger('click')

    expect(execute).toHaveBeenCalledOnce()
    expect(setColor).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
