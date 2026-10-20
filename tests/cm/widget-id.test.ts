import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('editor widget IDs', () => {
  it('uses browser UUIDs to isolate separately loaded entry points', async () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('674c311e-3e07-473e-8f24-26d4c0a41f2d')
      .mockReturnValueOnce('8807ed2f-dd91-468f-b66c-3afac9d64442')
    vi.stubGlobal('crypto', { randomUUID })

    const rootEntry = await import('../../src/cm/util/widget-id.js')
    const first = rootEntry.createWidgetId('diagram')
    vi.resetModules()
    const cmEntry = await import('../../src/cm/util/widget-id.js')
    const second = cmEntry.createWidgetId('diagram')

    expect(first).not.toBe(second)
    expect(randomUUID).toHaveBeenCalledTimes(2)
    expect(first).toMatch(/^diagram-[\w-]+$/)
    expect(second).toMatch(/^diagram-[\w-]+$/)
  })

  it('isolates separate entry points when randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', {})
    vi.spyOn(Date, 'now').mockReturnValue(42)
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.75)

    const rootEntry = await import('../../src/cm/util/widget-id.js')
    const first = rootEntry.createWidgetId('tabs')
    vi.resetModules()
    const cmEntry = await import('../../src/cm/util/widget-id.js')
    const second = cmEntry.createWidgetId('tabs')

    expect(first).not.toBe(second)
    expect(first).toMatch(/^tabs-[\w-]+$/)
    expect(second).toMatch(/^tabs-[\w-]+$/)
  })

  it('does not reuse a fallback ID during repeated mounts with equal random values', async () => {
    vi.stubGlobal('crypto', undefined)
    vi.spyOn(Date, 'now').mockReturnValue(42)
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    const { createWidgetId } = await import('../../src/cm/util/widget-id.js')

    const ids = Array.from({ length: 20 }, () => createWidgetId('diagram'))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
