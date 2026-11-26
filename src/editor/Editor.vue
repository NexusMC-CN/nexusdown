<script setup lang="ts">
defineOptions({ name: 'NexusdownEditor' })
import type { ContentReferenceProvider, EditorView, Extension, MentionCandidate, MentionResolutions, NexusdownOptions, ResolveLinks } from '@nexusmc-cn/nexusdown/cm'
import type { KatexLike, MarkdownItPlugin, RenderData } from '@nexusmc-cn/nexusdown/render'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch } from 'vue'
import { createWidgetId } from '../cm/util/widget-id.js'
import NexusdownToolbar from './Toolbar.vue'
import type { ToolbarActionError, ToolbarConfig } from './toolbar.js'
import '../cm/theme.css'
import '../shared/dialect.css'

const props = withDefaults(defineProps<{
  modelValue: string
  toolbar?: ToolbarConfig
  /** Installed when the editor mounts; replace the component to change setup. */
  extensions?: Extension
  previewPlugins?: MarkdownItPlugin[]
  scrollMode?: 'container' | 'page'
  stickyToolbar?: boolean
  /** Sticky top inset. Numbers use pixels; omitted values preserve the CSS variable. */
  toolbarOffset?: string | number
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
}>(), { scrollMode: 'container', stickyToolbar: true })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'action-error': [payload: ToolbarActionError]
}>()
const host = ref<HTMLElement | null>(null)
const chrome = ref<HTMLElement | null>(null)
const editorStyle = computed(() => props.toolbarOffset === undefined ? undefined : {
  '--nd-editor-sticky-top': typeof props.toolbarOffset === 'number' ? `${props.toolbarOffset}px` : props.toolbarOffset,
})
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
let chromeResizeObserver: ResizeObserver | null = null

/** Only DOM measurements cross into /cm; the engine owns the actual CM facet. */
function scrollMargins(current: EditorView): { top: number } | null {
  const header = chrome.value
  if (unmounted || !props.stickyToolbar || mode.value !== 'edit' || !header || !current.dom.isConnected) return null
  const win = header.ownerDocument.defaultView
  if (!win) return null
  const bar = header.getBoundingClientRect()
  const scroller = current.scrollDOM.getBoundingClientRect()
  let top = Math.max(0, scroller.top)
  let bottom = Math.min(win.innerHeight, scroller.bottom)
  let left = Math.max(0, scroller.left)
  let right = Math.min(win.innerWidth, scroller.right)
  let outerScrollTop = 0
  // Measure against the visible scroll viewport, not the potentially thousands
  // of pixels above it in a page-mode document. Nested scrollports can clip it.
  for (let parent = current.scrollDOM.parentElement; parent; parent = parent.parentElement) {
    const style = win.getComputedStyle(parent)
    const clipY = /auto|scroll|hidden|clip|overlay/.test(style.overflowY || style.overflow)
    const clipX = /auto|scroll|hidden|clip|overlay/.test(style.overflowX || style.overflow)
    if (!clipY && !clipX) continue
    const rect = parent.getBoundingClientRect()
    if (clipY) {
      top = Math.max(top, rect.top + parent.clientTop)
      bottom = Math.min(bottom, parent.clientHeight ? rect.top + parent.clientTop + parent.clientHeight : rect.bottom)
      // The content host can clip the scroller without containing the header.
      // Only shared ancestors define the viewport the sticky header returns to.
      if (parent.contains(header)) outerScrollTop = Math.max(outerScrollTop, rect.top + parent.clientTop)
    }
    if (clipX) {
      left = Math.max(left, rect.left + parent.clientLeft)
      right = Math.min(right, parent.clientWidth ? rect.left + parent.clientLeft + parent.clientWidth : rect.right)
    }
  }
  if (scroller.bottom <= outerScrollTop) {
    // Scrolling back to an editor above the viewport brings its header back
    // into view too. Reserve that future obstruction before CM starts scrolling.
    const inset = Number.parseFloat(win.getComputedStyle(header).top) || 0
    return { top: Math.max(0, bar.height + inset) }
  }
  const overlaps = right > left && bottom > top && bar.right > left && bar.left < right && bar.top < bottom
  return { top: overlaps ? Math.max(0, Math.min(bar.bottom, bottom) - top) : 0 }
}

function refreshPreview(): void {
  if (!engine || mode.value !== 'preview') return
  previewHtml.value = engine.renderEditorPreview(documentSource.value, {
    idPrefix: props.idPrefix || generatedPrefix.value,
    headingNumbers: props.headingNumbers,
    mathRenderer: props.mathRenderer,
    plugins: props.previewPlugins,
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
      // CM extensions use object identity, including plugins in reactive arrays.
      extensions: toRaw(props.extensions),
      scrollMargins,
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
watch(() => [props.idPrefix, props.headingNumbers, props.mathRenderer, props.previewPlugins, props.renderData, props.mentions, props.contentReferences], refreshPreview)
watch(() => [props.scrollMode, props.stickyToolbar, props.toolbarOffset, props.toolbar], async () => {
  await nextTick()
  if (!unmounted) view.value?.requestMeasure()
})
watch(
  () => props.contentReferences ?? props.renderData?.contentReferences,
  current => {
    if (engine && view.value) engine.updateContentReferences(view.value, current)
    refreshPreview()
  },
)
onMounted(() => {
  const header = chrome.value
  const Observer = header?.ownerDocument.defaultView?.ResizeObserver
  if (header && Observer) {
    // A wrapped row or an expanded inline panel changes cursor obstruction
    // without necessarily resizing the CM scroller itself.
    chromeResizeObserver = new Observer(() => {
      if (!unmounted) view.value?.requestMeasure()
    })
    chromeResizeObserver.observe(header)
  }
  return mount()
})
onBeforeUnmount(() => {
  unmounted = true
  chromeResizeObserver?.disconnect()
  chromeResizeObserver = null
  view.value?.destroy()
  view.value = null
})
defineExpose({ view })
</script>

<template>
  <div class="nd-editor" :class="`nd-editor--${scrollMode}`" :style="editorStyle">
    <div ref="chrome" class="nd-editor__chrome" :class="{ 'nd-editor__chrome--sticky': stickyToolbar }">
      <div class="nd-editor__mode" role="group" aria-label="编辑器视图">
        <button type="button" data-mode="edit" :aria-pressed="mode === 'edit'" :disabled="!view || composing" @mousedown.prevent @click="selectMode('edit')">编辑</button>
        <button type="button" data-mode="preview" :aria-pressed="mode === 'preview'" :disabled="!view || composing" @mousedown.prevent @click="selectMode('preview')">预览</button>
      </div>
      <NexusdownToolbar v-show="mode === 'edit'" :view="view" :config="toolbar" :mention-candidates="mentionCandidates" :resolve-links="resolveLinks" :content-reference-provider="contentReferenceProvider" @action-error="emit('action-error', $event)" />
    </div>
    <div v-show="mode === 'edit'" class="nd-editor__editing" @compositionstart.capture="composing = true" @compositionend.capture="composing = false">
      <div ref="host" class="nd-editor__content" />
    </div>
    <div v-if="mode === 'preview'" class="nd-editor__preview" data-testid="nd-editor-preview" role="region" aria-label="Markdown 预览" v-html="previewHtml" />
    <p v-if="error" class="nd-editor__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.nd-editor { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.nd-editor__chrome { flex: 0 0 auto; z-index: var(--nd-editor-sticky-z-index, 10); background: var(--nd-editor-bg, #fff); }
.nd-editor__chrome--sticky { position: sticky; top: var(--nd-editor-sticky-top, 0px); }
.nd-editor__editing { min-width: 0; min-height: 0; }
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
/* Reset both overflow axes: a remaining overflow-x:auto also captures vertical
   scrolling and prevents the page from being the editor's scroll surface. */
.nd-editor--page,
.nd-editor--page .nd-editor__editing,
.nd-editor--page .nd-editor__content,
.nd-editor--page .nd-editor__preview,
.nd-editor--page :deep(.cm-editor),
.nd-editor--page :deep(.cm-scroller) {
  height: auto;
  max-height: none;
  overflow: visible;
}
.nd-editor--page :deep(.cm-content),
.nd-editor--page .nd-editor__preview { box-sizing: border-box; min-height: var(--nd-editor-min-height, 420px); }
.nd-editor :deep(.nd-h1) { font-size: 1.5em; }
.nd-editor :deep(.nd-h2) { font-size: 1.3em; }
.nd-editor :deep(.nd-h3) { font-size: 1.15em; }
.nd-editor__error { margin: 8px 0 0; color: var(--nd-danger, #cf222e); font-size: 0.9em; }
</style>
