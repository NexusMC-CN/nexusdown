import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import LinkPanel from '../../src/editor/LinkPanel.vue'
import Toolbar from '../../src/editor/Toolbar.vue'
import { mountEditor } from '../../src/cm/mount.js'
import { captureLinkEditTarget } from '../../src/cm/link-edit.js'

const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach(dispose => dispose()))
function setup(resolveLinks?: (urls: string[], options: {signal: AbortSignal}) => Promise<Record<string, {card?: {title: string}}>>) {
  const view = mountEditor({ parent: document.createElement('div'), doc: 'chosen text' })
  view.dispatch({ selection: { anchor: 0, head: 11 } })
  const wrapper = mount(LinkPanel, { props: { view, target: captureLinkEditTarget(view), resolveLinks } })
  disposers.push(() => { wrapper.unmount(); view.destroy() })
  return { view, wrapper }
}
it('accepts share prose, previews real metadata and inserts selected text', async () => {
  const resolve = vi.fn(async () => ({ 'https://example.com/post': {card: {title: 'Resolved article title'}} }))
  const {wrapper, view} = setup(resolve)
  await wrapper.get('input').setValue('共享 https://example.com/post 打开查看')
  await flushPromises()
  expect(wrapper.text()).toContain('Resolved article title')
  await wrapper.get('select').setValue('link')
  await wrapper.get('form').trigger('submit')
  expect(view.state.doc.toString()).toContain('[chosen text](https://example.com/post)')
  expect(wrapper.emitted('close')).toHaveLength(1)
})
it('aborts old URL resolution and ignores late data after input changes', async () => {
  let oldResolve!: (data: Record<string, {card: {title: string}}>) => void
  const signals: AbortSignal[] = []
  const resolver = (urls: string[], {signal}: {signal: AbortSignal}) => {
    signals.push(signal)
    if (urls[0] === 'https://first.com') return new Promise<Record<string, {card: {title: string}}>>(resolve => oldResolve = resolve)
    return Promise.resolve({ 'https://second.com': {card: {title: 'Current title'}} })
  }
  const {wrapper} = setup(resolver)
  await wrapper.get('input').setValue('https://first.com')
  await wrapper.get('input').setValue('https://second.com')
  await flushPromises()
  expect(signals[0]!.aborted).toBe(true)
  oldResolve({'https://first.com': {card: {title: 'Stale title'}}})
  await flushPromises()
  expect(wrapper.text()).toContain('Current title')
  expect(wrapper.text()).not.toContain('Stale title')
})
it('keeps resolver failure usable as an ordinary link and never previews an iframe', async () => {
  const {wrapper, view} = setup(async () => { throw new Error('offline') })
  await wrapper.get('input').setValue('https://example.com')
  await flushPromises()
  expect(wrapper.find('iframe').exists()).toBe(false)
  await wrapper.get('form').trigger('submit')
  expect(view.state.doc.toString()).toContain('https://example.com')
})
it('works without resolver and closes on Escape without changing the source', async () => {
  const {wrapper, view} = setup()
  await wrapper.get('input').setValue('https://www.bilibili.com/video/BV1xx411c7mD/')
  expect(wrapper.text()).toContain('哔哩哔哩')
  expect(wrapper.find('iframe').exists()).toBe(false)
  await wrapper.get('form').trigger('keydown', {key: 'Escape'})
  expect(wrapper.emitted('close')).toHaveLength(1)
  expect(view.state.doc.toString()).toBe('chosen text')
})
it('aborts a pending resolver when closed or unmounted', async () => {
  let signal!: AbortSignal
  const {wrapper} = setup((_urls, options) => { signal = options.signal; return new Promise(() => {}) })
  await wrapper.get('input').setValue('https://example.com')
  wrapper.unmount()
  expect(signal.aborted).toBe(true)
})
it('opens the unified panel from the toolbar and restores focus on cancel', async () => {
  const view = mountEditor({ parent: document.createElement('div'), doc: 'selected' })
  const wrapper = mount(Toolbar, {props: {view}})
  disposers.push(() => {wrapper.unmount(); view.destroy()})
  await wrapper.get('button[aria-label="链接与媒体"]').trigger('click')
  expect(wrapper.find('form[aria-label="链接与媒体"]').exists()).toBe(true)
  await wrapper.get('form').trigger('keydown', {key: 'Escape'})
  expect(wrapper.find('form').exists()).toBe(false)
  expect(view.state.doc.toString()).toBe('selected')
})
it('disables the media button until an editor exists', () => {
  const wrapper = mount(Toolbar, {props: {view: null}})
  disposers.push(() => wrapper.unmount())
  expect(wrapper.get('button[aria-label="链接与媒体"]').attributes('disabled')).toBeDefined()
})
it('reopens an already-open panel with the newly captured source', async () => {
  const doc = 'https://example.com/first\n\nhttps://example.com/second'
  const view = mountEditor({parent: document.createElement('div'), doc})
  const wrapper = mount(Toolbar, {props: {view}})
  disposers.push(() => {wrapper.unmount(); view.destroy()})
  await wrapper.get('button[aria-label="链接与媒体"]').trigger('click')
  expect((wrapper.get('form input').element as HTMLInputElement).value).toContain('/first')
  view.dispatch({selection: {anchor: doc.length}})
  await wrapper.get('button[aria-label="链接与媒体"]').trigger('click')
  expect((wrapper.get('form input').element as HTMLInputElement).value).toContain('/second')
})
it('persists the original shortlink after resolving and choosing embed mode', async () => {
  const view = mountEditor({parent: document.createElement('div'), doc: ''})
  const wrapper = mount(LinkPanel, {props: {view, target: captureLinkEditTarget(view), resolveLinks: async () => ({'https://b23.tv/abc': {url: 'https://www.bilibili.com/video/BV1xx411c7mD/'}})}})
  disposers.push(() => {wrapper.unmount(); view.destroy()})
  await wrapper.get('input').setValue('https://b23.tv/abc')
  await flushPromises()
  await wrapper.get('select').setValue('embed')
  await wrapper.get('form').trigger('submit')
  expect(view.state.doc.toString()).toBe('```embed https://b23.tv/abc\n```')
})
