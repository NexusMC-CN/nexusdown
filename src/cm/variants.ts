/**
 * 「块变体」菜单项 —— 工具栏按钮和编辑器里的「＋ 变体」共用**同一份**。
 *
 * 为什么单独一个文件：两处入口（工具栏 / 块悬停）如果各写一个 switch，
 * 迟早出现「工具栏有步骤、悬停菜单没有」这种漂移。列表只有一份，
 * 加变体只改这里。
 *
 * ⚠️ 只列**两侧都已实现**的属性：
 * - 列表 → 步骤 / 卡片；
 * - 表格 → 参数表；
 * - 围栏 → 代码标题（先落占位文件名）；
 * - 段落 → 卡片 / 取消卡片。
 *
 * `lines` / `highlight` / `caption` / `tab` 等编辑器侧还没接，等接上再加 ——
 * 菜单里出现一个点了没反应的选项，比没有这个选项更糟。
 */
import type { BlockKind } from './commands.js'

export interface VariantItem {
  /** 菜单上给人看的名字。 */
  label: string
  /** 要插入的属性行（`docs/dialect-extensions.md` §0）。 */
  attr: string
  /** 菜单显示“已应用”用的名字（class 名或 key 名）。 */
  name: string
  /**
   * 互斥组：应用新变体时先移除同组旧 class。
   *
   * 典型：步骤 ↔ 卡片 —— 旧实现只合并，`{.steps .cards}` 会同时存在，
   * 渲染侧步骤优先，卡片被静默吞掉（用户实测“第二次点了没用”）。
   */
  exclusive?: string[]
}

export function variantItemsFor(kind: BlockKind | null): VariantItem[] {
  switch (kind) {
    case 'list':
      return [
        { label: '步骤', attr: '{.steps}', name: 'steps', exclusive: ['steps', 'cards'] },
        { label: '卡片', attr: '{.cards}', name: 'cards', exclusive: ['steps', 'cards'] },
      ]
    case 'table':
      return [{ label: '参数表', attr: '{.fields}', name: 'fields', exclusive: ['fields'] }]
    case 'fence':
      return [
        { label: '代码标题', attr: '{title="文件名"}', name: 'title' },
        { label: '行号', attr: '{lines}', name: 'lines' },
        { label: '高亮第 2 行', attr: '{highlight="2"}', name: 'highlight' },
      ]
    default:
      return []
  }
}
