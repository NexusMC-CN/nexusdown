/*
 * GENERATED FILE - DO NOT EDIT.
 * Produced from ./entry.ts by scripts/generate-vue-entry.mjs (runs on `npm run build`).
 * Edit entry.ts instead; this shim exists only so plain-Node tooling can resolve
 * the `nexusdown/vue` subpath export.
 */
/**
 * Public Vue entry for nexusdown.
 *
 * `package.json#exports["./vue"]` resolves here so that
 * `import NexusdownEditor from 'nexusdown/vue'` works without pointing at a bare
 * `.vue` specifier.
 *
 * The SFCs are intentionally shipped un-compiled: the consumer's bundler (Vite,
 * webpack + vue-loader, ...) must compile them alongside the consumer's own Vue
 * runtime so exactly one Vue instance is shared. Pre-compiling here is not
 * possible because @vue/compiler-sfc output is bundler-specific and would
 * duplicate Vue.
 *
 * Consequence: this entry only works inside a bundler. No bare-Node
 * `require`/`import` can load `.vue` files - that is by design, and `./core` is
 * the pre-compiled entry for plain Node use.
 */
import NexusdownEditor from './NexusdownEditor.vue'
import EditorToolbar from './EditorToolbar.vue'
import HeadingPicker from './HeadingPicker.vue'
import LinkPicker from './LinkPicker.vue'
import ColorPicker from './components/ColorPicker.vue'
import ImagePicker from './components/ImagePicker.vue'
import MarkdownEditor from './components/MarkdownEditor.vue'
import TableControls from './components/TableControls.vue'
import CodeBlockLanguage from './components/CodeBlockLanguage.vue'
import FindReplacePanel from './components/FindReplacePanel.vue'
import EditorStatusBar from './components/EditorStatusBar.vue'

const Editor = NexusdownEditor

export default Editor

export {
  Editor as NexusdownEditor,
  EditorToolbar,
  HeadingPicker,
  LinkPicker,
  ColorPicker,
  ImagePicker,
  MarkdownEditor,
  TableControls,
  CodeBlockLanguage,
  FindReplacePanel,
  EditorStatusBar,
}

export { useNexusdownTheme } from './composables/useNexusdownTheme.js'
