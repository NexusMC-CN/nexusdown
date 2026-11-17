<script setup lang="ts">
defineOptions({ name: 'NexusdownEditor' })
import type { ContentReferenceProvider, EditorView, MentionCandidate, MentionResolutions, NexusdownOptions, ResolveLinks } from '@nexusmc-cn/nexusdown/cm'
import type { KatexLike, RenderData } from '@nexusmc-cn/nexusdown/render'
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { createWidgetId } from '../cm/util/widget-id.js'
import NexusdownToolbar from './Toolbar.vue'
import '../cm/theme.css'
import '../shared/dialect.css'

const props = defineProps<{
  modelValue: string
  codeLanguages?: NexusdownOptions['codeLanguages']
  mathRenderer?: KatexLike
  mentionCandidates?: () => Promise<MentionCandidate[]>
  mentions?: MentionResolutions
  resolveLinks?: ResolveLinks
  contentReferenceProvider?: ContentReferenceProvider
  /** Current resolutions; replacing this map never replaces editor text. */
  contentReferences?: RenderData['contentReferences']
  /** Stable namespace for preview anchors; generated after mount when omitted. */
  idPrefix?: string
  /** Display heading numbers in preview. Defaults to false. */
  headingNumbers?: boolean
  /** Pre-resolved renderer data. Preview never fetches URLs. */
  renderData?: RenderData
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const host = ref<HTMLElement | null>(null)
// The /cm entry creates all CM objects; shallowRef preserves their identity.
const view = shallowRef<EditorView | null>(null)
const error = ref('')
const mode = ref<'edit' | 'preview'>('edit')
const previewHtml = ref('')
const documentSource = ref(props.modelValue)
const generatedPrefix = ref('')
const composing = ref(false)
let engine: typeof import('@nexusmc-cn/nexusdown/cm') | null = null
let unmounted = false

function refreshPreview(): void {
  if (!engine || mode.value !== 'preview') return
  previewHtml.value = engine.renderEditorPreview(documentSource.value, {
    idPrefix: props.idPrefix || generatedPrefix.value,
    headingNumbers: props.headingNumbers,
    mathRenderer: props.mathRenderer,
    data: {
      ...props.renderData,
      mentions: props.mentions ?? props.renderData?.mentions,
      contentReferences: props.contentReferences ?? props.renderData?.contentReferences,
    },
  })
}
async function selectMode(next: 'edit' | 'preview'): Promise<void> {
  const current = view.value
  if (!current || composing.value || current.compositionStarted || current.composing) return
  mode.value = next
  if (next === 'preview') {
    documentSource.value = current.state.doc.toString()
    refreshPreview()
  } else {
    await nextTick()
    if (unmounted) return
    current.requestMeasure()
    current.focus()
  }
}
async function mount(): Promise<void> {
  try {
    const loaded = await import('@nexusmc-cn/nexusdown/cm')
    if (unmounted || !host.value) return
    engine = loaded
    generatedPrefix.value = createWidgetId('nd-editor-preview')
    view.value = engine.mountEditor({
      parent: host.value,
      doc: props.modelValue,
      codeLanguages: props.codeLanguages,
      mathRenderer: props.mathRenderer,
      mentions: props.mentions ?? props.renderData?.mentions,
      mentionCandidates: props.mentionCandidates,
      contentReferences: props.contentReferences ?? props.renderData?.contentReferences,
      onDocChange: (value) => {
        documentSource.value = value
        emit('update:modelValue', value)
      },
    })
    documentSource.value = view.value.state.doc.toString()
  } catch (cause) {
    if (unmounted) return
    console.error('[nexusdown] 编辑器初始化失败：', cause)
    error.value = '编辑器没能加载：' + (cause instanceof Error ? cause.message : String(cause))
  }
}
watch(
  () => props.modelValue,
  (next) => {
    if (!engine || !view.value) {
      documentSource.value = next
      return
    }
    // The engine defers external replacements until IME composition has ended.
    engine.setEditorValue(view.value, next)
    if (!view.value.compositionStarted) documentSource.value = view.value.state.doc.toString()
  },
)
watch(documentSource, refreshPreview)
watch(() => [props.idPrefix, props.headingNumbers, props.mathRenderer, props.renderData, props.mentions, props.contentReferences], refreshPreview)
watch(
  () => props.contentReferences ?? props.renderData?.contentReferences,
  current => {
    if (engine && view.value) engine.updateContentReferences(view.value, current)
    refreshPreview()
  },
)
onMounted(mount)
onBeforeUnmount(() => {
  unmounted = true
  view.value?.destroy()
  view.value = null
})
defineExpose({ view })
</script>

<template>
  <div class="nd-editor">
    <div class="nd-editor__mode" role="group" aria-label="编辑器视图">
      <button type="button" data-mode="edit" :aria-pressed="mode === 'edit'" :disabled="!view || composing" @mousedown.prevent @click="selectMode('edit')">编辑</button>
      <button type="button" data-mode="preview" :aria-pressed="mode === 'preview'" :disabled="!view || composing" @mousedown.prevent @click="selectMode('preview')">预览</button>
    </div>
    <div v-show="mode === 'edit'" class="nd-editor__editing" @compositionstart.capture="composing = true" @compositionend.capture="composing = false">
      <NexusdownToolbar :view="view" :mention-candidates="mentionCandidates" :resolve-links="resolveLinks" :content-reference-provider="contentReferenceProvider" />
      <div ref="host" class="nd-editor__content" />
    </div>
    <div v-if="mode === 'preview'" class="nd-editor__preview" data-testid="nd-editor-preview" role="region" aria-label="Markdown 预览" v-html="previewHtml" />
    <p v-if="error" class="nd-editor__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.nd-editor { display: flex; flex-direction: column; min-height: 0; }
.nd-editor__mode { display: flex; gap: 6px; padding: 8px 12px; }
.nd-editor__mode button {
  border: 1px solid var(--nd-border, #d0d7de);
  border-radius: 6px;
  background: var(--nd-editor-bg, #fff);
  color: inherit;
  padding: 4px 10px;
  cursor: pointer;
}
.nd-editor__mode button[aria-pressed="true"] { background: var(--nd-accent, #2563eb); color: #fff; }
.nd-editor__mode button:disabled { opacity: 0.6; cursor: default; }
.nd-editor__content { height: var(--nd-editor-height, 420px); background: var(--nd-editor-bg, #fff); overflow: hidden; }
.nd-editor__preview {
  box-sizing: border-box;
  height: var(--nd-editor-height, 420px);
  overflow: auto;
  padding: 18px 28px 28px;
  background: var(--nd-editor-bg, #fff);
  font-family: var(--nd-font-body, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  font-size: var(--nd-font-size, 14.5px);
  line-height: var(--nd-line-height, 1.8);
}
.nd-editor :deep(.cm-editor) { height: 100%; background: var(--nd-editor-bg, #fff); }
.nd-editor :deep(.cm-editor.cm-focused) { outline: none; }
.nd-editor :deep(.cm-content) {
  font-family: var(--nd-font-body, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  font-size: var(--nd-font-size, 14.5px);
  padding: 18px 28px 28px;
}
.nd-editor :deep(.cm-scroller) { line-height: var(--nd-line-height, 1.8); }
.nd-editor :deep(.nd-h1) { font-size: 1.5em; }
.nd-editor :deep(.nd-h2) { font-size: 1.3em; }
.nd-editor :deep(.nd-h3) { font-size: 1.15em; }
.nd-editor__error { margin: 8px 0 0; color: var(--nd-danger, #cf222e); font-size: 0.9em; }
</style>
