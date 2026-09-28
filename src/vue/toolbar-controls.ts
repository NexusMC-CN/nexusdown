import type { ToolbarGroup, ToolbarItem } from '../core/toolbar.js'

export type ToolbarControl =
  | { key: `item:${string}`; kind: 'item'; group: ToolbarGroup; label: string; icon: string; item: ToolbarItem }
  | { key: 'builtin:find'; kind: 'find'; group: 'utility'; label: '查找替换'; icon: 'lucide:search' }
  | { key: 'builtin:paste-mode'; kind: 'paste-mode'; group: 'utility'; label: '粘贴模式'; icon: string }

const GROUP_ORDER: ToolbarGroup[] = ['history', 'block', 'inline', 'extension', 'indent']

/**
 * Toolbar item ids the toolbar no longer offers.
 *
 * None of these formats has a lossless standard-Markdown representation, so the
 * editor could only emit BBCode shortcodes or raw HTML for them. The product
 * decision is to drop them entirely rather than ship impure Markdown, which
 * means the toolbar must not render an entry point even when one is passed in
 * through `toolbarItems`.
 */
const UNSUPPORTED_ITEM_IDS: ReadonlySet<string> = new Set([
  'color',
  'underline',
  'superscript',
  'subscript',
  'align-left',
  'align-center',
  'align-right',
  'align-justify',
])

const utilityControls: ToolbarControl[] = [
  { key: 'builtin:find', kind: 'find', group: 'utility', label: '查找替换', icon: 'lucide:search' },
  { key: 'builtin:paste-mode', kind: 'paste-mode', group: 'utility', label: '粘贴模式', icon: 'lucide:clipboard-type' },
]

export function createToolbarControls(items: ToolbarItem[]): ToolbarControl[] {
  const supportedItems = items.filter((item) => !UNSUPPORTED_ITEM_IDS.has(item.id))
  const declaredGroups = supportedItems.map((item) => item.group)
  const orderedGroups = [
    ...GROUP_ORDER.filter((group) => declaredGroups.includes(group)),
    ...declaredGroups.filter((group, index) => !GROUP_ORDER.includes(group) && declaredGroups.indexOf(group) === index),
  ]
  const controls = orderedGroups.flatMap((group) => supportedItems
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
