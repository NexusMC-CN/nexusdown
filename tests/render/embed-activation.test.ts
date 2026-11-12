import { expect, it, vi } from 'vitest'
import { mountEmbeds } from '../../src/embed/index.js'
import { renderMarkdown } from '../../src/render/index.js'

it('creates no iframe on mount or synthetic click, and disposes listener', () => {
  const root = document.createElement('div')
  root.innerHTML = renderMarkdown('https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=42')
  const remove = vi.spyOn(root, 'removeEventListener')
  const dispose = mountEmbeds(root)
  expect(root.querySelector('iframe')).toBeNull()
  root.querySelector<HTMLButtonElement>('button')!.click()
  expect(root.querySelector('iframe')).toBeNull()
  expect(root.querySelector('a')?.href).toContain('bilibili.com/video/')
  dispose()
  expect(remove).toHaveBeenCalledWith('click', expect.any(Function))
})
it('revalidates provider URL, uses fixed template, and removes created frames', () => {
  const root = document.createElement('div')
  root.innerHTML = renderMarkdown('https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=42')
  const add = vi.spyOn(root, 'addEventListener')
  const dispose = mountEmbeds(root)
  // Invoke the captured production listener with the browser-delivered event shape.
  const listener = add.mock.calls.find(([name]) => name === 'click')![1] as (event: Event) => void
  const button = root.querySelector('button')!
  const activate = () => listener({ isTrusted: true, target: button, preventDefault() {} } as unknown as Event)
  const block = root.querySelector<HTMLElement>('.nd-embed')!
  const canonical = block.dataset.ndEmbedCanonical!
  block.dataset.ndEmbedCanonical = 'https://evil.com/player'
  activate()
  expect(root.querySelector('iframe')).toBeNull()
  block.dataset.ndEmbedCanonical = canonical
  activate()
  const frame = root.querySelector('iframe')!
  expect(frame.src).toContain('player.bilibili.com/player.html?bvid=BV1xx411c7mD')
  expect(frame.src).toContain('autoplay=0')
  expect(frame.src).toContain('&p=2')
  expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
  expect(frame.getAttribute('allow')).not.toContain('autoplay')
  activate()
  expect(root.querySelectorAll('iframe')).toHaveLength(1)
  dispose()
  expect(root.querySelector('iframe')).toBeNull()
})
it('does not retain detached frames across document replacements', () => {
  const root = document.createElement('div')
  const source = renderMarkdown('https://music.163.com/song?id=110761')
  root.innerHTML = source
  const add = vi.spyOn(root, 'addEventListener')
  const dispose = mountEmbeds(root)
  const listener = add.mock.calls.find(([name]) => name === 'click')![1] as (event: Event) => void
  const removed = []
  for (let index = 0; index < 3; index++) {
    listener({isTrusted: true, target: root.querySelector('button'), preventDefault() {}} as unknown as Event)
    removed.push(vi.spyOn(root.querySelector('iframe')!, 'remove'))
    root.innerHTML = source
  }
  dispose()
  expect(removed.every(remove => remove.mock.calls.length === 0)).toBe(true)
})
