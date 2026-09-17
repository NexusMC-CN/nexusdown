<script setup lang="ts">
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { AnyExtension } from '@tiptap/core'
import {
  createDefaultToolbarItems,
  createNexusdownEditor,
  type ContentType,
  type NexusdownEditorSession,
  type ToolbarContext,
  type ToolbarItem,
} from '../core/index.js'
import EditorToolbar from './EditorToolbar.vue'
import MarkdownEditor from './components/MarkdownEditor.vue'
import TableControls from './components/TableControls.vue'
import CodeBlockLanguage from './components/CodeBlockLanguage.vue'
import FindReplacePanel from './components/FindReplacePanel.vue'
import EditorStatusBar from './components/EditorStatusBar.vue'
import { useNexusdownTheme, type NexusdownTheme } from './composables/useNexusdownTheme.js'
import type { NexusdownEditorLayout } from './layout.js'

type EditorDimension = number | string
type MarkdownEditorHandle = {
  getScrollElement: () => HTMLTextAreaElement | null
  setScrollTop: (value: number) => void
}

const props = withDefaults(defineProps<{
  modelValue?: string
  contentType?: ContentType
  toolbarItems?: ToolbarItem[]
  readonly?: boolean
  extensions?: AnyExtension[]
  extensionResolver?: (extensions: AnyExtension[]) => AnyExtension[]
  theme?: NexusdownTheme
  layout?: NexusdownEditorLayout
  width?: EditorDimension
  height?: EditorDimension
  syncScroll?: boolean
  showStatusBar?: boolean
  imageUpload?: (file: File) => Promise<string>
  maxFileSize?: number
  pasteMode?: PasteMode
  class?: string
}>(), { modelValue: '', contentType: 'markdown', readonly: false, theme: 'system', layout: 'rich-left', width: '100%', height: 420, syncScroll: true, showStatusBar: true, pasteMode: 'plain' })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  update: [snapshot: ReturnType<NexusdownEditorSession['getSnapshot']>]
  'parse-error': [error: Error]
}>()

/**
 * Parse the bound JSON value for the initial document.
 *
 * Invalid JSON must not abort setup: throwing here would leave the component
 * unmounted, so the declared `parse-error` event could never reach the caller.
 * Fall back to an empty document and report the failure once the session (and
 * therefore the emit channel) exists.
 */
function parseInitialJson(value: string): { content: unknown; error: Error | null } {
  if (!value.trim()) return { content: undefined, error: null }
  try {
    return { content: JSON.parse(value), error: null }
  } catch (cause) {
    const error = new Error(`Invalid JSON content: ${(cause as Error).message}`)
    return { content: undefined, error }
  }
}

const initialJson = props.contentType === 'json' ? parseInitialJson(props.modelValue) : null
const initialContent = initialJson ? initialJson.content : props.modelValue
const session = shallowRef<NexusdownEditorSession>(markRaw(createNexusdownEditor({
  content: initialContent,
  contentType: props.contentType,
  extensions: props.extensions,
  extensionResolver: props.extensionResolver,
  imageUpload: props.imageUpload,
  maxFileSize: props.maxFileSize,
  pasteMode: props.pasteMode,
})))
session.value.getEditor().setEditable(!props.readonly)
const markdownValue = ref(props.modelValue)
const markdownComposing = ref(false)
const richContent = ref<HTMLElement | null>(null)
const richElement = ref<HTMLElement | null>(null)
const richPane = ref<HTMLElement | null>(null)
const markdownEditor = ref<MarkdownEditorHandle | null>(null)
const revision = ref(0)
const themeSource = computed(() => props.theme ?? 'system')
const { resolvedTheme } = useNexusdownTheme(themeSource)
const editorStyle = computed<Record<string, string>>(() => ({
  '--nexusdown-width': normalizeDimension(props.width, '100%'),
  '--nexusdown-height': normalizeDimension(props.height, '420px'),
}))
const layoutMode = computed<NexusdownEditorLayout>(() =>
  props.layout === 'markdown-left' ? 'markdown-left' : 'rich-left'
)
let unsubscribe: () => void = () => undefined
let unsubscribeError: () => void = () => undefined
let syncingScroll = false
const findReplaceOpen = ref(false)
/**
 * Text currently selected in the Markdown pane.
 *
 * The shared toolbar has a single selection concept, and it natively reflects
 * the rich-text selection. When the user selects Markdown source instead, that
 * selection should win — otherwise a formatting command silently applies to
 * whatever the rich pane last had selected.
 */
const markdownSelection = ref<{ from: number; to: number; text: string } | null>(null)

const items = computed(() => props.toolbarItems ?? createDefaultToolbarItems())
const toolbarContext = computed<ToolbarContext>(() => {
  void revision.value
  const current = session.value
  if (!current) throw new Error('Editor session is not ready')
  const markdownSelectionText = markdownSelection.value?.text ?? ''
  return {
    // Proxy the session so `getSelectedText()` reports the Markdown selection
    // while one is active, and falls through to the rich-text selection
    // otherwise. All other members are bound to the real session.
    session: {
      ...current,
      commands: current.commands,
      can: (command) => current.can(command),
      isActive: (name, attributes) => current.isActive(name, attributes),
      hasTextColor: (color) => current.hasTextColor(color),
      getSelectedText: () => markdownSelectionText || current.getSelectedText(),
      getLinkHref: () => current.getLinkHref(),
      getPasteMode: () => current.getPasteMode(),
      setPasteMode: (mode) => current.setPasteMode(mode),
      onPasteModeChange: current.onPasteModeChange?.bind(current),
    },
    insertImageFile: (file) => props.readonly || !current.getEditor().isEditable
      ? Promise.resolve(false)
      : current.insertImageFromFile(file),
  }
})

defineExpose({ session })

markdownValue.value = session.value.getMarkdown()
unsubscribe = session.value.subscribe((snapshot) => {
  // Echoing the normalised Markdown back into the textarea while the user is
  // typing into it rewrites what they wrote — an unfinished `see [link` came
  // back as `see \[link`, so `[`, `*` and friends could never be typed. The
  // panel keeps the user's own text while it is the source of the change; the
  // rich-text side still drives the value as usual.
  if (snapshot.source !== 'markdown') markdownValue.value = snapshot.markdown
  revision.value++
  const value = props.contentType === 'html'
    ? snapshot.html
    : props.contentType === 'json'
      ? JSON.stringify(snapshot.json)
      : snapshot.markdown
  emit('update:modelValue', value)
  emit('update', snapshot)
})
unsubscribeError = session.value.onError(onSessionError)
const unsubscribeSelection = session.value.onSelectionChange(() => { revision.value++ })

// Surface a malformed initial JSON value through the same channel as any other
// parse failure, now that the session is available to carry the event.
if (initialJson?.error) emit('parse-error', initialJson.error)

function normalizeDimension(value: EditorDimension | undefined, fallback: string): string {
  if (typeof value === 'number') return String(Math.max(1, value)) + 'px'
  const normalized = value?.trim()
  return normalized || fallback
}

function scrollRange(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight)
}

function syncPaneScroll(source: 'rich' | 'markdown', top: number) {
  if (!props.syncScroll || syncingScroll) return
  const sourceElement = source === 'rich' ? richPane.value : markdownEditor.value?.getScrollElement() ?? null
  const targetElement = source === 'rich' ? markdownEditor.value?.getScrollElement() ?? null : richPane.value
  if (!sourceElement || !targetElement) return

  const sourceRange = scrollRange(sourceElement)
  const targetRange = scrollRange(targetElement)
  const ratio = sourceRange > 0 ? Math.min(1, Math.max(0, top / sourceRange)) : 0
  const targetTop = ratio * targetRange
  if (Math.abs(targetElement.scrollTop - targetTop) < 0.5) return

  syncingScroll = true
  if (source === 'rich') markdownEditor.value?.setScrollTop(targetTop)
  else targetElement.scrollTop = targetTop
  syncingScroll = false
}

function onRichScroll(event: Event) {
  const target = event.currentTarget
  if (target instanceof HTMLElement) syncPaneScroll('rich', target.scrollTop)
}

function onMarkdownScroll(payload: { top: number }) {
  syncPaneScroll('markdown', payload.top)
}

/**
 * Track the Markdown-side selection so the toolbar acts on it.
 *
 * A collapsed selection clears the override, so the toolbar falls back to the
 * rich-text selection rather than acting on a stale range.
 */
function onMarkdownSelectionChange(payload: { from: number; to: number; text: string } | null) {
  markdownSelection.value = payload
  revision.value++
}

function onEditorKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    if (props.readonly) return
    event.preventDefault()
    findReplaceOpen.value = true
  }
}

function openFindReplace() {
  findReplaceOpen.value = true
}

function closeFindReplace() {
  findReplaceOpen.value = false
}

onMounted(() => {
  session.value.mountEditor(richElement.value)
})

// Switching the layout re-renders the rich pane through a different `v-if`
// branch, so Vue discards the DOM node Tiptap was mounted into and the new one
// is empty. Re-mount the live editor into whichever node is current; the
// instance (and therefore the document) is preserved.
//
// Watch the layout itself rather than the `richElement` ref: a template ref is
// reassigned on every render that remounts the node, and re-mounting on each of
// those would tear down the editor during ordinary updates.
watch(layoutMode, async () => {
  await nextTick()
  session.value.mountEditor(richElement.value)
})

watch([() => props.modelValue, () => props.contentType], ([value, contentType]) => {
  if (contentType === 'markdown') {
    if (markdownComposing.value) {
      markdownValue.value = value
      return
    }
    if (value !== session.value.getMarkdown()) session.value.setMarkdown(value)
    return
  }
  if (contentType === 'html') {
    if (value !== session.value.getHTML()) session.value.setContent(value, 'html')
    return
  }
  try {
    const json = JSON.parse(value)
    if (JSON.stringify(json) !== JSON.stringify(session.value.getJSON())) session.value.setContent(json, 'json')
  } catch (error) {
    emit('parse-error', error instanceof Error ? error : new Error(String(error)))
  }
})

watch(() => props.readonly, (readonly) => session.value.getEditor().setEditable(!readonly))
watch(() => props.imageUpload, (imageUpload) => session.value.setImageUpload(imageUpload))
watch(() => props.maxFileSize, (maxFileSize) => session.value.setMaxFileSize(maxFileSize))
watch(() => props.pasteMode, (pasteMode) => session.value.setPasteMode(pasteMode))

function onMarkdownInput(value: string) {
  markdownValue.value = value
  if (props.contentType === 'markdown') emit('update:modelValue', value)
  if (markdownComposing.value) return
  try {
    session.value?.setMarkdown(value)
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    // The session reports parse failures instead of throwing, so revert here too
    // rather than relying on the catch above.
    markdownValue.value = session.value?.getMarkdown() ?? ''
    emit('parse-error', failure)
  }
}

/**
 * Put the Markdown panel back on the last value the session accepted.
 *
 * A rejected edit left the textarea holding the draft while `v-model` and the
 * rich-text pane had already reverted, so the panel disagreed with everything
 * else and the user could not see that their text had been refused.
 */
function onSessionError(error: Error) {
  // A rejected edit left the textarea holding the refused draft: `modelValue`
  // goes back to the last accepted value, which Vue sees as "unchanged" and
  // therefore never patches into the DOM. Ask the panel to resync explicitly.
  markdownValue.value = session.value?.getMarkdown() ?? ''
  void nextTick(() => markdownEditor.value?.syncValueFromProp())
  emit('parse-error', error)
}

function onMarkdownCompositionStart() {
  markdownComposing.value = true
}

function onMarkdownCompositionEnd(value: string) {
  markdownComposing.value = false
  onMarkdownInput(value)
}

onUnmounted(() => {
  unsubscribe()
  unsubscribeError()
  unsubscribeSelection()
  session.value?.destroy()
})
</script>

<template>
  <section class="nexusdown-editor" :class="props.class" data-nexusdown="editor" :data-nexusdown-theme="resolvedTheme" :data-nexusdown-layout="layoutMode" :style="editorStyle" @keydown.capture="onEditorKeydown">
    <EditorToolbar v-if="session" :context="toolbarContext" :items="items" :readonly="readonly" @find="openFindReplace" />
    <div class="nexusdown-editor__panes">
      <template v-if="layoutMode === 'rich-left'">
        <div ref="richPane" class="nexusdown-editor__pane nexusdown-editor__pane--rich" data-nexusdown="rich-text" @scroll="onRichScroll">
          <div ref="richContent" class="nexusdown-rich-content">
            <div ref="richElement" class="nexusdown-rich-surface" />
            <TableControls :session="session" :container="richContent" :readonly="readonly" />
            <CodeBlockLanguage :session="session" :container="richContent" :readonly="readonly" />
          </div>
        </div>
        <div class="nexusdown-editor__pane nexusdown-editor__pane--markdown">
          <MarkdownEditor
            ref="markdownEditor"
            :model-value="markdownValue"
            :readonly="readonly"
            @update:model-value="onMarkdownInput"
            @compositionstart="onMarkdownCompositionStart"
            @compositionend="onMarkdownCompositionEnd"
            @scroll="onMarkdownScroll"
            @selection-change="onMarkdownSelectionChange"
          />
        </div>
      </template>
      <template v-else>
        <div class="nexusdown-editor__pane nexusdown-editor__pane--markdown">
          <MarkdownEditor
            ref="markdownEditor"
            :model-value="markdownValue"
            :readonly="readonly"
            @update:model-value="onMarkdownInput"
            @compositionstart="onMarkdownCompositionStart"
            @compositionend="onMarkdownCompositionEnd"
            @scroll="onMarkdownScroll"
            @selection-change="onMarkdownSelectionChange"
          />
        </div>
        <div ref="richPane" class="nexusdown-editor__pane nexusdown-editor__pane--rich" data-nexusdown="rich-text" @scroll="onRichScroll">
          <div ref="richContent" class="nexusdown-rich-content">
            <div ref="richElement" class="nexusdown-rich-surface" />
            <TableControls :session="session" :container="richContent" :readonly="readonly" />
            <CodeBlockLanguage :session="session" :container="richContent" :readonly="readonly" />
          </div>
        </div>
      </template>
    </div>
    <EditorStatusBar v-if="showStatusBar" :session="session" />
    <FindReplacePanel
      v-if="findReplaceOpen"
      :session="session"
      :readonly="readonly"
      @close="closeFindReplace"
    />
  </section>
</template>
