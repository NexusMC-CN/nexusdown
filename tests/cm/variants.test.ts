/**
 * `variantItemsFor` —— 工具栏「＋ 变体」和块悬停菜单**共用**的选项表。
 *
 * 锁两件事：
 * 1. 每种块给出的选项是预期的（列表/表格/围栏/段落）；
 * 2. 每个 `attr` 都能被 `parseAttrLine` 解析 —— 否则点一下会抛。
 */
import { describe, expect, it } from 'vitest'

import { parseAttrLine } from '../../src/shared/attrs.js'
import { variantItemsFor } from '../../src/cm/variants.js'

describe('variantItemsFor', () => {
  it('列表 → 步骤 / 卡片，且互为互斥组', () => {
    const items = variantItemsFor('list')
    expect(items.map((item) => item.attr)).toEqual(['{.steps}', '{.cards}'])
    expect(items.map((item) => item.name)).toEqual(['steps', 'cards'])
    expect(items.every((item) => item.exclusive?.includes('steps') && item.exclusive?.includes('cards'))).toBe(true)
  })

  it('表格 → 参数表（exclusive: fields）', () => {
    expect(variantItemsFor('table')).toEqual([
      { label: '参数表', attr: '{.fields}', name: 'fields', exclusive: ['fields'] },
    ])
  })

  it('围栏 → 代码标题 / 行号 / 高亮', () => {
    expect(variantItemsFor('fence').map((item) => item.label)).toEqual(['代码标题', '行号', '高亮第 2 行'])
  })

  it('段落 → 空表（普通段落没有可见变体，不再给"点了没反应"的选项）', () => {
    expect(variantItemsFor('paragraph')).toEqual([])
  })

  it('没有块 → 空表（按钮不出现）', () => {
    expect(variantItemsFor(null)).toEqual([])
  })

  it('★ 每个 attr 都是合法属性行', () => {
    for (const kind of ['list', 'table', 'fence', 'paragraph'] as const) {
      for (const item of variantItemsFor(kind)) {
        expect(parseAttrLine(item.attr), `${kind} 的 ${item.attr}`).not.toBeNull()
      }
    }
  })
})
