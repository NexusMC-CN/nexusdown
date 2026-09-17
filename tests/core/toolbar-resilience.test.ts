import { describe, expect, it } from 'vitest'
import { createNexusdownEditor } from '../../src/core/session'
import { createDefaultToolbarItems } from '../../src/core/toolbar'

/**
 * A consumer may remove optional extensions. Every default toolbar item must
 * then degrade to "disabled / did nothing" rather than throwing out of its
 * `isDisabled`, `isActive` or `execute` handler — a throw there broke the whole
 * toolbar render path.
 */
const REMOVAL_SETS: Array<[string, string[]]> = [
  ['table/tasklist/image/color/highlight', ['table', 'tableKit', 'taskList', 'taskItem', 'image', 'color', 'highlight']],
  ['underline/superscript/subscript', ['underline', 'superscript', 'subscript']],
  ['nothing at all', ['paragraph', 'heading', 'text', 'doc', 'bold', 'italic', 'strike', 'code', 'link', 'history', 'dropcursor', 'gapcursor']],
]

function contextFor(session: ReturnType<typeof createNexusdownEditor>) {
  return {
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
  }
}

describe('toolbar resilience when optional extensions are removed', () => {
  for (const [label, removed] of REMOVAL_SETS) {
    it(`no toolbar item throws with ${label} removed`, () => {
      const session = createNexusdownEditor({
        content: '<p>hello</p>',
        contentType: 'html',
        extensionResolver: (ext) => ext.filter((e) => !removed.includes(e.name ?? '')),
      })
      const ctx = contextFor(session)
      const threw: string[] = []

      for (const item of createDefaultToolbarItems()) {
        try { item.isDisabled?.(ctx as never) } catch (e) { threw.push(`${item.id}.isDisabled: ${String(e)}`) }
        try { item.isActive?.(ctx as never) } catch (e) { threw.push(`${item.id}.isActive: ${String(e)}`) }
        try { item.execute(ctx as never) } catch (e) { threw.push(`${item.id}.execute: ${String(e)}`) }
      }

      expect(threw).toEqual([])
      session.destroy()
    })
  }

  it('can() returns false rather than throwing for unavailable commands', () => {
    const session = createNexusdownEditor({
      content: '<p>hello</p>',
      contentType: 'html',
      extensionResolver: (ext) => ext.filter((e) => !['table', 'tableKit', 'taskList', 'taskItem'].includes(e.name ?? '')),
    })
    for (const command of ['table', 'task-list', 'image', 'highlight', 'color', 'heading'] as const) {
      expect(() => session.can(command)).not.toThrow()
      expect(typeof session.can(command)).toBe('boolean')
    }
    // An unrecognised name reaches the same path from untyped JavaScript, and must
    // still be a boolean rather than `undefined`.
    expect((session.can as (c: string) => unknown)('nope')).toBe(false)
    session.destroy()
  })
})
