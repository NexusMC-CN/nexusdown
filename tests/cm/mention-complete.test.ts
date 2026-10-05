/**
 * `mention` 的**自动补全**（打 `@` 就地弹候选）测试。
 *
 * ## 为什么这些用例要等
 *
 * CM6 的补全有两级防抖（`activateOnTypingDelay` 100ms → 源；异步结果回来后再
 * `updateSyncTime` 100ms 才落到 state）。所以每个"打字 → 断言"之间都要
 * `settle()` 一下。这不是测试写得笨，而是补全本来就是异步的。
 *
 * ## 挂的是真入口 `mountEditor`
 *
 * 不用裸 `EditorState.create` —— 那样测不到「`mentionCandidates` 从消费方一路
 * 透传到补全源」这条链（那正是本次接线最容易断的地方）。
 */
import {
  acceptCompletion,
  currentCompletions,
  completionStatus,
  moveCompletionSelection,
} from '@codemirror/autocomplete'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MentionCandidate } from '../../src/cm/commands.js'
import { mountEditor } from '../../src/cm/mount.js'
import { mentionPrefixAt } from '../../src/shared/mention.js'

const CANDIDATES: MentionCandidate[] = [
  { slug: 'rei', title: 'REI 物品管理器', kind: 'resource' },
  { slug: 'nexus-optimizer', title: 'Nexus 优化器', kind: 'resource' },
  { slug: 'install-guide', title: '安装指南', kind: 'tutorial' },
]

const views: Array<{ destroy(): void }> = []

afterEach(() => {
  for (const v of views.splice(0)) v.destroy()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** 等过 CM6 的两级防抖（100ms + 100ms），再加一点余量。 */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 240))
}

function mount(candidates: () => Promise<MentionCandidate[]>) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = mountEditor({ parent, doc: '', mentionCandidates: candidates })
  views.push(view)
  return view
}

/**
 * 模拟用户打字：把整篇内容换成 `text`、光标落在末尾，并标上 `input.type`
 * （补全靠这个 userEvent 触发）。
 *
 * 每次都是**整篇替换**（`0..doc.length`）—— 只插不删的话第二次调用会在
 * 已有内容前面再插一段，测的就不是"用户又打了一个字"了。
 */
function type(view: ReturnType<typeof mount>, text: string, cursor?: number) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: cursor ?? text.length },
    userEvent: 'input.type',
  })
}

const labels = (view: ReturnType<typeof mount>) =>
  currentCompletions(view.state).map((c) => c.label)

describe('mentionPrefixAt（补全与扫描器共用的触发判定）', () => {
  it('刚打完 `@` → 空查询', () => {
    expect(mentionPrefixAt('@', 1)).toEqual({ from: 0, slug: '' })
  })

  it('`@` 后打了几个字符 → 那串就是查询', () => {
    expect(mentionPrefixAt('你好 @nexus', 9)).toEqual({ from: 3, slug: 'nexus' })
  })

  it('★ 词边界：`a@b` 不触发（邮箱）', () => {
    expect(mentionPrefixAt('a@b', 3)).toBeNull()
  })

  it('★ `a@b.com` 里光标停在 `b` 后也不触发', () => {
    expect(mentionPrefixAt('a@b.com', 3)).toBeNull()
  })

  it('光标和 `@` 之间有空格 → 不触发', () => {
    expect(mentionPrefixAt('@foo ', 5)).toBeNull()
  })

  it('`#fragment` 里不补（那里补的是子定位，不是 slug）', () => {
    expect(mentionPrefixAt('@foo#bar', 8)).toBeNull()
  })

  it('`@-foo` 不触发（slug 不能以 `-` 开头）', () => {
    expect(mentionPrefixAt('@-foo', 5)).toBeNull()
  })

  it('`@@` 触发在第二个 `@` 上（前一个 `@` 不是词字符）', () => {
    expect(mentionPrefixAt('@@', 2)).toEqual({ from: 1, slug: '' })
  })
})

describe('mention 自动补全', () => {
  it('★ 打 `@` 弹出全部候选', async () => {
    const view = mount(() => Promise.resolve(CANDIDATES))
    type(view, '@')
    await settle()

    expect(completionStatus(view.state)).toBe('active')
    expect(labels(view)).toEqual(['@rei', '@nexus-optimizer', '@install-guide'])
  })

  it('★ 继续打字 → 实时过滤', async () => {
    const view = mount(() => Promise.resolve(CANDIDATES))

    type(view, '@nex')
    await settle()
    expect(labels(view)).toEqual(['@nexus-optimizer'])

    // 再收窄一格，还是同一条（过滤是"每次按键重算"，不是一次性快照）。
    type(view, '@nexus')
    await settle()
    expect(labels(view)).toEqual(['@nexus-optimizer'])

    // 换成另一条候选的前缀 —— 结果跟着换。
    type(view, '@install')
    await settle()
    expect(labels(view)).toEqual(['@install-guide'])
  })

  it('★ 显示名也参与匹配（不只是 slug）', async () => {
    /*
     * ⚠️ 查询串本身只能是 slug 字符（`[a-z0-9-]`，见 `mentionPrefixAt`）——
     * 所以「显示名参与匹配」的用处是：slug 里没有、但**显示名里有**这串字母时也能命中。
     * 这里 `@rei` 只出现在 `rei` 的 slug 里，`nd-editor` 靠显示名「REI 编辑器」命中。
     */
    const view = mount(() =>
      Promise.resolve([
        { slug: 'nd-editor', title: 'REI 编辑器', kind: 'resource' },
        { slug: 'rei', title: 'REI 物品管理器', kind: 'resource' },
      ]),
    )

    type(view, '@rei')
    await settle()
    expect(labels(view)).toEqual(['@nd-editor', '@rei'])
  })

  it('★ `a@b.com` 不弹候选（词边界，和渲染侧同一套判定）', async () => {
    const view = mount(() => Promise.resolve(CANDIDATES))
    type(view, 'a@b.com', 3)
    await settle()

    expect(completionStatus(view.state)).not.toBe('active')
    expect(labels(view)).toEqual([])
  })

  it('★ 一条都没匹配 → 弹「没有匹配的资源」', async () => {
    const view = mount(() => Promise.resolve(CANDIDATES))
    type(view, '@zzzzz')
    await settle()

    expect(completionStatus(view.state)).toBe('active')
    expect(labels(view)).toEqual(['没有匹配的资源'])
    // 面板真的画出来了（不只是 state 里有个结果）。
    expect(view.dom.textContent).toContain('没有匹配的资源')
  })

  it('★ 空态不可插入：回车不改文档（提示文字不会被写进正文）', async () => {
    const view = mount(() => Promise.resolve(CANDIDATES))
    type(view, '@zzzzz')
    await settle()

    // `acceptCompletion` 就是回车键绑的命令 —— 它返回 true 表示"这个回车我处理了"，
    // 所以既不会插提示文字，也不会插换行。
    expect(acceptCompletion(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('@zzzzz')
  })

  it('★ 空态下方向键也选不走（只有一条，动不了）', async () => {
    const view = mount(() => Promise.resolve(CANDIDATES))
    type(view, '@zzzzz')
    await settle()

    moveCompletionSelection(true)(view)
    moveCompletionSelection(false)(view)
    expect(acceptCompletion(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('@zzzzz')
  })

  it('★ 选中一条 → 用 `@slug` 替换掉 `@查询`', async () => {
    const view = mount(() => Promise.resolve(CANDIDATES))
    type(view, '@nexus')
    await settle()

    expect(acceptCompletion(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('@nexus-optimizer')
  })

  it('★ 取候选失败 → 不抛、不弹（返回 null），只 warn 一条', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = mount(() => Promise.reject(new Error('查库炸了')))

    // 打字这一步绝不能抛（补全源抛异常会把编辑器带垮）。
    expect(() => type(view, '@')).not.toThrow()
    await settle()

    expect(completionStatus(view.state)).not.toBe('active')
    expect(warn).toHaveBeenCalled()
  })

  it('★ 候选只拉一次（打一串字不会发一串请求）', async () => {
    let calls = 0
    const view = mount(() => {
      calls++
      return Promise.resolve(CANDIDATES)
    })

    for (const text of ['@', '@n', '@ne', '@nex', '@nexus']) {
      type(view, text)
      await settle()
    }

    expect(calls).toBe(1)
    expect(labels(view)).toEqual(['@nexus-optimizer'])
  })

  it('★ 失败不缓存：下一次打 `@` 会重试', async () => {
    let calls = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = mount(() => {
      calls++
      return calls === 1 ? Promise.reject(new Error('第一次失败')) : Promise.resolve(CANDIDATES)
    })

    type(view, '@')
    await settle()
    expect(completionStatus(view.state)).not.toBe('active')

    type(view, '@')
    await settle()
    expect(calls).toBe(2)
    expect(labels(view)).toEqual(['@rei', '@nexus-optimizer', '@install-guide'])
    expect(warn).toHaveBeenCalled()
  })

  it('没注入候选 → 连补全扩展都不挂（打 `@` 什么都不弹）', async () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = mountEditor({ parent, doc: '' })
    views.push(view)

    type(view, '@')
    await settle()

    expect(completionStatus(view.state)).toBeNull()
  })
})
