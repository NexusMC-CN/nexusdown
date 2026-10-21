import { describe, expect, it } from 'vitest'

import { renderMarkdown } from '../../src/render/index.js'

function taskItems(source: string): HTMLLIElement[] {
  const root = document.createElement('div')
  root.innerHTML = renderMarkdown(source)
  return [...root.querySelectorAll<HTMLLIElement>('ul[data-type="taskList"] > li')]
}

describe('empty task list items', () => {
  it('keeps the continued blank item a task checkbox after Enter', () => {
    const items = taskItems('- [ ] todo\n- [ ] ')

    expect(items).toHaveLength(2)
    expect(items.map((item) => item.getAttribute('data-type'))).toEqual(['taskItem', 'taskItem'])
    expect(items.map((item) => item.querySelector('input[type="checkbox"]') !== null)).toEqual([true, true])
    expect(items[1]?.textContent).toBe('')
  })

  it.each([
    ['- [ ]', false],
    ['- [x]', true],
  ])('renders %s as a task checkbox without trailing whitespace', (source, checked) => {
    const [item] = taskItems(source)

    expect(item?.getAttribute('data-type')).toBe('taskItem')
    expect(item?.getAttribute('data-checked')).toBe(String(checked))
    expect(item?.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(item?.textContent).toBe('')
  })
})
