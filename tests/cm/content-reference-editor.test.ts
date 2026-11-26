// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import NexusdownEditor from '../../src/editor/Editor.vue'
import { undo } from '../../src/cm/index.js'

vi.mock('@nexusmc-cn/nexusdown/cm', () => import('../../src/cm/index.js'))

interface Target { kind: 'resource' | 'tutorial' | 'post'; id: string; fragmentType?: 'section' | 'block'; fragmentId?: string }
interface Candidate { target: Target; title: string; summary?: string; targetTitle?: string }
interface Request { query: string; target?: Target; signal: AbortSignal }
type Provider = (request: Request) => Promise<Candidate[]>
const cleanup: (() => void)[] = []
const resource: Candidate = { target: { kind: 'resource', id: 'res-1' }, title: '资源一', summary: '资源摘要' }
const tutorial: Candidate = { target: { kind: 'tutorial', id: 'guide-1' }, title: '教程一' }
const block: Candidate = { target: { kind: 'tutorial', id: 'guide-1', fragmentType: 'block', fragmentId: 'step-1' }, title: '教程一', targetTitle: '安装步骤' }
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
})
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose())
  document.body.replaceChildren()
})
async function editor(provider: Provider, source = '正文 ', extra: Record<string, unknown> = {}) {
  const wrapper = mount(NexusdownEditor, {
    props: { modelValue: source, contentReferenceProvider: provider, ...extra },
    attachTo: document.body,
  })
  cleanup.push(() => wrapper.unmount())
  await flushPromises()
  const view = (wrapper.vm as unknown as { view: EditorView }).view
  view.dispatch({ selection: { anchor: source.length } })
  return { wrapper, view }
}

describe('content reference editor flow', () => {
  it('searches three content kinds and inserts stable source with undo', async () => {
    const requests: Request[] = []
    const { wrapper, view } = await editor(async request => {
      requests.push(request)
      return request.query === '资源' ? [resource] : [resource, tutorial, { target: { kind: 'post', id: 'p-1' }, title: '帖子一' }]
    })
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    expect(wrapper.find('button[aria-label="插入引用"]').exists()).toBe(true)
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[aria-label="插入内容引用"]').text()).toContain('帖子一')
    await wrapper.get('input[aria-label="搜索内容"]').setValue('资源')
    await flushPromises()
    expect(requests.at(-1)?.query).toBe('资源')
    expect(requests.at(-1)?.target).toBeUndefined()
    expect(wrapper.get('[aria-label="插入内容引用"]').text()).not.toContain('帖子一')
    await wrapper.get('[data-reference-candidate]').trigger('click')
    expect(view.state.doc.toString()).toBe('正文 [[resource:res-1]]')
    expect(wrapper.find('[aria-label="插入内容引用"]').exists()).toBe(false)
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('正文 ')
  })

  it('offers whole tutorial and server-searched section or block targets', async () => {
    const requests: Request[] = []
    const { wrapper, view } = await editor(async request => {
      requests.push(request)
      return request.target ? [block] : [tutorial]
    })
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-reference-candidate]').trigger('click')
    await flushPromises()
    expect(wrapper.get('button[data-reference-whole]').text()).toContain('整篇教程')
    await wrapper.get('input[aria-label="搜索章节或段落"]').setValue('安装')
    await flushPromises()
    expect(requests.at(-1)?.target).toEqual({ kind: 'tutorial', id: 'guide-1' })
    expect(requests.at(-1)?.query).toBe('安装')
    expect(wrapper.get('[data-reference-candidate]').text()).toContain('安装步骤')
    await wrapper.get('[data-reference-candidate]').trigger('click')
    expect(view.state.doc.toString()).toBe('正文 [[tutorial:guide-1#block:step-1]]')
  })

  it('aborts old searches and ignores results arriving after a newer query or cancel', async () => {
    const pending: { request: Request; resolve: (items: Candidate[]) => void }[] = []
    const { wrapper, view } = await editor(request => new Promise(resolve => pending.push({ request, resolve })))
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await wrapper.get('input[aria-label="搜索内容"]').setValue('new')
    expect(pending[0]?.request.signal.aborted).toBe(true)
    pending[1]!.resolve([resource])
    await flushPromises()
    pending[0]!.resolve([tutorial])
    await flushPromises()
    expect(wrapper.get('[aria-label="插入内容引用"]').text()).toContain('资源一')
    expect(wrapper.get('[aria-label="插入内容引用"]').text()).not.toContain('教程一')
    await wrapper.get('input[aria-label="搜索内容"]').setValue('cancel')
    await wrapper.get('button[data-reference-cancel]').trigger('click')
    expect(pending[2]?.request.signal.aborted).toBe(true)
    pending[2]!.resolve([tutorial])
    await flushPromises()
    expect(wrapper.find('[aria-label="插入内容引用"]').exists()).toBe(false)
    expect(view.state.doc.toString()).toBe('正文 ')
  })

  it('retries a failed search and bounds user queries', async () => {
    const requests: Request[] = []
    let fail = true
    const { wrapper } = await editor(async request => {
      requests.push(request)
      if (fail) throw new Error('offline')
      return [resource]
    })
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('搜索失败')
    fail = false
    await wrapper.get('button[data-reference-retry]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-reference-candidate]').text()).toContain('资源一')
    await wrapper.get('input[aria-label="搜索内容"]').setValue('a'.repeat(120))
    await flushPromises()
    expect(requests.at(-1)?.query).toHaveLength(100)
  })

  it('does not treat IME confirmation as choosing a candidate', async () => {
    const { wrapper, view } = await editor(async () => [resource])
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await flushPromises()
    const input = wrapper.get('input[aria-label="搜索内容"]')
    await input.trigger('compositionstart')
    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(view.state.doc.toString()).toBe('正文 ')
    expect(wrapper.find('[aria-label="插入内容引用"]').exists()).toBe(true)
    await input.trigger('compositionend')
    await input.trigger('keydown', { key: 'Enter' })
    expect(view.state.doc.toString()).toBe('正文 [[resource:res-1]]')
  })

  it('keeps Enter activation available on panel action buttons', async () => {
    const { wrapper, view } = await editor(async () => [])
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await flushPromises()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    wrapper.get('button[data-reference-cancel]').element.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('正文 ')
    await wrapper.get('button[data-reference-cancel]').trigger('click')
    expect(wrapper.find('[aria-label="插入内容引用"]').exists()).toBe(false)
  })

  it('inserts a whole tutorial as a separate card paragraph when requested', async () => {
    const { wrapper, view } = await editor(async () => [tutorial])
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await flushPromises()
    await wrapper.get('input[aria-label="独占段落显示为卡片"]').setValue(true)
    await wrapper.get('[data-reference-candidate]').trigger('click')
    await flushPromises()
    await wrapper.get('button[data-reference-whole]').trigger('click')
    expect(view.state.doc.toString().split('\n\n')).toContain('[[tutorial:guide-1]]')
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('正文 ')
  })

  it('refreshes current resolutions in live view and preview without changing source, selection or history', async () => {
    const source = 'intro\n\n[[resource:res-1]]\n\ntail'
    const before = new Map([['resource:res-1', { status: 'available', kind: 'resource', title: '当前标题', href: '/resources/res-1' }]])
    const after = new Map([['resource:res-1', { status: 'available', kind: 'resource', title: '已更新标题', href: '/resources/res-1' }]])
    const unavailable = new Map([['resource:res-1', { status: 'unavailable' }]])
    const { wrapper, view } = await editor(async () => [], source, { renderData: { contentReferences: before } })
    expect(wrapper.get('.cm-editor').text()).toContain('当前标题')
    view.dispatch({ changes: { from: source.length, insert: '!' }, selection: { anchor: 2 }, userEvent: 'input.type' })
    const selection = view.state.selection
    const changed = view.state.doc.toString()
    await wrapper.setProps({ renderData: { contentReferences: after } } as never)
    expect(wrapper.get('.cm-editor').text()).toContain('已更新标题')
    expect(wrapper.get('.cm-editor').text()).not.toContain('当前标题')
    expect(view.state.doc.toString()).toBe(changed)
    expect(view.state.selection.eq(selection)).toBe(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([[changed]])
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.get('.nd-editor__preview').text()).toContain('已更新标题')
    await wrapper.setProps({ contentReferences: unavailable } as never)
    expect(wrapper.get('.nd-editor__preview').text()).toContain('内容不可用')
    expect(wrapper.get('.nd-editor__preview').text()).not.toContain('已更新标题')
    await wrapper.get('[data-mode="edit"]').trigger('click')
    expect(wrapper.get('.cm-editor').text()).toContain('内容不可用')
    expect(view.state.selection.eq(selection)).toBe(true)
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(source)
  })

  it('refreshes preview when the existing reactive renderData object receives a newer map', async () => {
    const renderData = reactive({
      contentReferences: new Map([['resource:res-1', { status: 'available', kind: 'resource', title: '旧标题', href: '/resources/res-1' }]]),
    })
    const source = 'intro\n\n[[resource:res-1]]\n\ntail'
    const { wrapper, view } = await editor(async () => [], source, { renderData })
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.get('.nd-editor__preview').text()).toContain('旧标题')
    renderData.contentReferences = new Map([['resource:res-1', { status: 'available', kind: 'resource', title: '原文改名', href: '/resources/res-1' }]])
    await flushPromises()
    expect(wrapper.get('.nd-editor__preview').text()).toContain('原文改名')
    expect(wrapper.get('.nd-editor__preview').text()).not.toContain('旧标题')
    expect(view.state.doc.toString()).toBe(source)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('bounds tutorial targets, excludes other tutorials and prompts narrower searches at the limit', async () => {
    const { wrapper } = await editor(async request => request.target ? [
      { target: { kind: 'tutorial', id: 'other-guide', fragmentType: 'block', fragmentId: 'foreign' }, title: '其他教程的段落' },
      ...Array.from({ length: 101 }, (_, index): Candidate => ({
        target: { kind: 'tutorial', id: 'guide-1', fragmentType: 'block', fragmentId: 'step-' + index },
        title: '教程一', targetTitle: '步骤 ' + index,
      })),
    ] : [tutorial])
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-reference-candidate]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-reference-candidate]')).toHaveLength(100)
    expect(wrapper.get('[aria-label="插入内容引用"]').text()).not.toContain('其他教程的段落')
    expect(wrapper.get('[data-reference-limit]').text()).toContain('缩小查询范围')
  })

  it('uses a replacement provider, restores editor focus and aborts work on unmount', async () => {
    const pending: { request: Request; resolve: (items: Candidate[]) => void }[] = []
    const oldProvider: Provider = request => new Promise(resolve => pending.push({ request, resolve }))
    const { wrapper, view } = await editor(oldProvider)
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('input[aria-label="搜索内容"]').element)
    const newProvider: Provider = async () => [resource]
    await wrapper.setProps({ contentReferenceProvider: newProvider } as never)
    await flushPromises()
    expect(pending[0]!.request.signal.aborted).toBe(true)
    pending[0]!.resolve([tutorial])
    await flushPromises()
    expect(wrapper.get('[data-reference-candidate]').text()).toContain('资源一')
    expect(wrapper.get('[aria-label="插入内容引用"]').text()).not.toContain('教程一')
    await wrapper.get('button[data-reference-cancel]').trigger('click')
    expect(view.hasFocus).toBe(true)
    await wrapper.setProps({ contentReferenceProvider: oldProvider } as never)
    await wrapper.get('button[aria-label="扩展"]').trigger('click')
    await wrapper.get('button[aria-label="插入引用"]').trigger('click')
    await flushPromises()
    cleanup.pop()?.()
    expect(pending[1]!.request.signal.aborted).toBe(true)
    pending[1]!.resolve([tutorial])
    await flushPromises()
    expect(document.querySelector('[aria-label="插入内容引用"]')).toBeNull()
  })

  it('lets a direct current-data map override renderData and falls back to its latest value when cleared', async () => {
    const renderData = reactive({
      contentReferences: new Map([['resource:res-1', { status: 'available', kind: 'resource', title: '备用旧标题', href: '/resources/res-1' }]]),
    })
    const direct = new Map([['resource:res-1', { status: 'available', kind: 'resource', title: '直接数据标题', href: '/resources/res-1' }]])
    const source = 'intro\n\n[[resource:res-1]]\n\ntail'
    const { wrapper, view } = await editor(async () => [], source, { renderData, contentReferences: direct })
    await wrapper.get('[data-mode="preview"]').trigger('click')
    expect(wrapper.get('.nd-editor__preview').text()).toContain('直接数据标题')
    renderData.contentReferences = new Map([['resource:res-1', { status: 'available', kind: 'resource', title: '备用新标题', href: '/resources/res-1' }]])
    await flushPromises()
    expect(wrapper.get('.nd-editor__preview').text()).toContain('直接数据标题')
    expect(wrapper.get('.nd-editor__preview').text()).not.toContain('备用新标题')
    await wrapper.setProps({ contentReferences: undefined } as never)
    expect(wrapper.get('.nd-editor__preview').text()).toContain('备用新标题')
    await wrapper.get('[data-mode="edit"]').trigger('click')
    expect(wrapper.get('.cm-editor').text()).toContain('备用新标题')
    expect(view.state.doc.toString()).toBe(source)
  })
})
