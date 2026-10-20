/**
 * 功能注册表（`indexFeatures`）的测试。
 *
 * ## 为什么要有这个文件
 *
 * 以前注册表是一条**硬规则**：两个功能认领同一个节点名就启动即抛。那条规则把
 * 一个正常需求堵死了 —— **两个语法落在同一个 lezer 节点上**：
 *
 * - `$$…$$` 块级数学：lezer 把整个块解析成**一个 `Paragraph`**；
 * - `@slug` 提及：也认 `Paragraph`。
 *
 * 现在注册表改成 `节点名 → 功能列表`，各功能按**自己的文本判据 no-op**。
 * 这个文件把新行为钉住，免得日后有人「顺手改回抛错」：
 *
 * 1. 不同功能共享节点 → **允许**；
 * 2. 列表顺序 = **执行顺序**，`priority` 大的先跑，同优先级按注册顺序（稳定）；
 * 3. **同一个功能重复认领同一节点** → 仍然**抛**（那是装配错误，不是共享）。
 */
import { describe, expect, it } from 'vitest'

import {
  indexFeatures,
  normalizeFeatures,
  toFeatureList,
  type EditorFeature,
} from '../../src/cm/feature.js'

/** 造一个只记录「谁跑过」的假功能。 */
function fakeFeature(name: string, nodes: string[], extra: Partial<EditorFeature> = {}): EditorFeature {
  return {
    name,
    nodes,
    decorate: () => {},
    ...extra,
  }
}

/** 列表里每个功能的 `name`（断言顺序用）。 */
const names = (list: readonly EditorFeature[] | undefined): string[] =>
  (list ?? []).map((feature) => feature.name)

describe('indexFeatures —— 一个节点可以被多个功能认领', () => {
  it('★ 两个功能认领同一节点：不抛，按注册顺序进同一个列表', () => {
    const map = indexFeatures([fakeFeature('math', ['Document', 'Paragraph']), fakeFeature('mention', ['Paragraph'])])

    expect(names(map.get('Paragraph'))).toEqual(['math', 'mention'])
    expect(names(map.get('Document'))).toEqual(['math'])
  })

  it('★ 注册顺序就是执行顺序（稳定 —— 不因为 Map 的迭代顺序而变化）', () => {
    const map = indexFeatures([fakeFeature('a', ['X']), fakeFeature('b', ['X']), fakeFeature('c', ['X'])])
    expect(names(map.get('X'))).toEqual(['a', 'b', 'c'])
  })

  it('★ `priority` 大的先跑；同优先级保持注册顺序', () => {
    const map = indexFeatures([
      fakeFeature('low', ['X'], { priority: -1 }),
      fakeFeature('normal', ['X']),
      fakeFeature('high', ['X'], { priority: 10 }),
      fakeFeature('normal2', ['X']),
    ])

    // high(10) → normal(0, 注册在前) → normal2(0, 注册在后) → low(-1)
    expect(names(map.get('X'))).toEqual(['high', 'normal', 'normal2', 'low'])
  })

  it('★ 同一个功能重复认领同一节点 → 仍然抛（装配错误：会推两条 replace）', () => {
    const math = fakeFeature('math', ['Document', 'Paragraph'])
    expect(() => indexFeatures([math, fakeFeature('math', ['Paragraph'])])).toThrow(/重复认领/)
  })

  it('一个功能认领多个节点是合法的（`math` 就是 `Document` + `Paragraph`）', () => {
    const math = fakeFeature('math', ['Document', 'Paragraph'])
    const map = indexFeatures([math])
    expect(names(map.get('Document'))).toEqual(['math'])
    expect(names(map.get('Paragraph'))).toEqual(['math'])
  })

  it('空表 → 空 Map（不抛）', () => {
    expect(indexFeatures([]).size).toBe(0)
  })
})

describe('normalizeFeatures —— 兼容「单个功能」这种历史形态', () => {
  it('单个功能 → 单元素数组；数组原样保留', () => {
    const a = fakeFeature('a', ['X'])
    const b = fakeFeature('b', ['X'])

    expect(toFeatureList(a)).toEqual([a])
    expect(toFeatureList([a, b])).toEqual([a, b])

    const normalized = normalizeFeatures(
      new Map<string, EditorFeature | readonly EditorFeature[]>([
        ['X', a],
        ['Y', [a, b]],
      ]),
    )
    expect(names(normalized.get('X'))).toEqual(['a'])
    expect(names(normalized.get('Y'))).toEqual(['a', 'b'])
  })
})
