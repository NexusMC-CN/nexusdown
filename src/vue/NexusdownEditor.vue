<script setup lang="ts">
import { computed, markRaw, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
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
  class?: string
}>(), { modelValue: '', contentType: 'markdown', readonly: false, theme: 'system', layout: 'rich-left', width: '100%', height: 420, syncScroll: true })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  update: [snapshot: ReturnType<NexusdownEditorSession['getSnapshot']>]
  'parse-error': [error: Error]
}>()

const initialContent = props.contentType === 'json' ? JSON.parse(props.modelValue || '{}') : props.modelValue
const session = shallowRef<NexusdownEditorSession>(markRaw(createNexusdownEditor({
  content: initialContent,
  contentType: props.contentType,
  extensions: props.extensions,
  extensionResolver: props.extensionResolver,
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

const items = computed(() => props.toolbarItems ?? createDefaultToolbarItems())
const toolbarContext = computed<ToolbarContext>(() => {
  void revision.value
  const current = session.value
  if (!current) throw new Error('Editor session is not ready')
  return { session: current }
})

defineExpose({ session })

markdownValue.value = session.value.getMarkdown()
unsubscribe = session.value.subscribe((snapshot) => {
  markdownValue.value = snapshot.markdown
  revision.value++
  const value = props.contentType === 'html'
    ? snapshot.html
    : props.contentType === 'json'
      ? JSON.stringify(snapshot.json)
      : snapshot.markdown
  emit('update:modelValue', value)
  emit('update', snapshot)
})
unsubscribeError = session.value.onError((error) => emit('parse-error', error))
const unsubscribeSelection = session.value.onSelectionChange(() => { revision.value++ })

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

onMounted(() => {
  if (richElement.value) session.value.getEditor().mount(richElement.value)
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

function onMarkdownInput(value: string) {
  markdownValue.value = value
  if (props.contentType === 'markdown') emit('update:modelValue', value)
  if (markdownComposing.value) return
  try {
    session.value?.setMarkdown(value)
  } catch (error) {
    emit('parse-error', error instanceof Error ? error : new Error(String(error)))
  }
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
  <section class="nexusdown-editor" :class="props.class" data-nexusdown="editor" :data-nexusdown-theme="resolvedTheme" :data-nexusdown-layout="layoutMode" :style="editorStyle">
    <EditorToolbar v-if="session" :context="toolbarContext" :items="items" :readonly="readonly" />
    <div class="nexusdown-editor__panes">
      <template v-if="layoutMode === 'rich-left'">
        <div ref="richPane" class="nexusdown-editor__pane nexusdown-editor__pane--rich" data-nexusdown="rich-text" @scroll="onRichScroll">
          <div ref="richContent" class="nexusdown-rich-content">
            <div ref="richElement" class="nexusdown-rich-surface" />
            <TableControls :session="session" :container="richContent" :readonly="readonly" />
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
          />
        </div>
        <div ref="richPane" class="nexusdown-editor__pane nexusdown-editor__pane--rich" data-nexusdown="rich-text" @scroll="onRichScroll">
          <div ref="richContent" class="nexusdown-rich-content">
            <div ref="richElement" class="nexusdown-rich-surface" />
            <TableControls :session="session" :container="richContent" :readonly="readonly" />
          </div>
        </div>
      </template>
    </div>
  </section>
</template>
