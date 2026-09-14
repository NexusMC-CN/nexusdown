export type { ToolbarItem } from '../core/toolbar.js'
export type { NexusdownEditorLayout } from './layout.js'
export { useNexusdownTheme, type NexusdownTheme, type ResolvedNexusdownTheme } from './composables/useNexusdownTheme.js'
export const vueSfcEntrypoints = {
  editor: './NexusdownEditor.vue',
  toolbar: './EditorToolbar.vue',
  linkPicker: './LinkPicker.vue',
  markdownEditor: './components/MarkdownEditor.vue',
  colorPicker: './components/ColorPicker.vue',
  imagePicker: './components/ImagePicker.vue',
  tableControls: './components/TableControls.vue',
} as const
