import type { ToolbarGroup, ToolbarItem } from '../core/toolbar.js'

export type ToolbarControl =
  | { key: `item:${string}`; kind: 'item'; group: ToolbarGroup; label: string; icon: string; item: ToolbarItem }
  | { key: 'builtin:find'; kind: 'find'; group: 'utility'; label: '查找替换'; icon: 'lucide:search' }
  | { key: 'builtin:paste-mode'; kind: 'paste-mode'; group: 'utility'; label: '粘贴模式'; icon: string }

const GROUP_ORDER: ToolbarGroup[] = ['history', 'block', 'inline', 'extension', 'align', 'indent']

const utilityControls: ToolbarControl[] = [
  { key: 'builtin:find', kind: 'find', group: 'utility', label: '查找替换', icon: 'lucide:search' },
  { key: 'builtin:paste-mode', kind: 'paste-mode', group: 'utility', label: '粘贴模式', icon: 'lucide:clipboard-type' },
]

export function createToolbarControls(items: ToolbarItem[]): ToolbarControl[] {
  const declaredGroups = items.map((item) => item.group)
  const orderedGroups = [
    ...GROUP_ORDER.filter((group) => declaredGroups.includes(group)),
    ...declaredGroups.filter((group, index) => !GROUP_ORDER.includes(group) && declaredGroups.indexOf(group) === index),
  ]
  const controls = orderedGroups.flatMap((group) => items
    .filter((item) => item.group === group)
    .map((item): ToolbarControl => ({
      key: `item:${item.id}`,
      kind: 'item',
      group: item.group,
      label: item.label,
      icon: item.icon,
      item,
    })))
  const historyEnd = controls.reduce((end, control, index) => control.group === 'history' ? index + 1 : end, 0)

  controls.splice(historyEnd, 0, ...utilityControls)
  return controls
}
