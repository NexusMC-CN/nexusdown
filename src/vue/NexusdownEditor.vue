<script setup lang="ts">
import { computed, markRaw, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import {
  createDefaultToolbarItems,
  createNexusdownEditor,
  type ContentType,
  type NexusdownEditorSession,
  type ToolbarContext,
  type ToolbarItem,
} from '../core/index.js'
import EditorToolbar from './EditorToolbar.vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  contentType?: ContentType
  toolbarItems?: ToolbarItem[]
  readonly?: boolean
  class?: string
}>(), { modelValue: '', contentType: 'markdown', readonly: false })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  update: [snapshot: ReturnType<NexusdownEditorSession['getSnapshot']>]
  'parse-error': [error: Error]
}>()

const initialContent = props.contentType === 'json' ? JSON.parse(props.modelValue || '{}') : props.modelValue
const session = shallowRef<NexusdownEditorSession>(markRaw(createNexusdownEditor({ content: initialContent, contentType: props.contentType })))
session.value.getEditor().setEditable(!props.readonly)
const markdownValue = ref(props.modelValue)
const richElement = ref<HTMLElement | null>(null)
const revision = ref(0)
let unsubscribe: () => void = () => undefined
let unsubscribeError: () => void = () => undefined

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

onMounted(() => {
  if (richElement.value) session.value.getEditor().mount(richElement.value)
})

watch([() => props.modelValue, () => props.contentType], ([value, contentType]) => {
  if (contentType === 'markdown') {
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

function onMarkdownInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value
  markdownValue.value = value
  if (props.contentType === 'markdown') emit('update:modelValue', value)
  try {
    session.value?.setMarkdown(value)
  } catch (error) {
    emit('parse-error', error instanceof Error ? error : new Error(String(error)))
  }
}

onUnmounted(() => {
  unsubscribe()
  unsubscribeError()
  unsubscribeSelection()
  session.value?.destroy()
})
</script>

<template>
  <section class="nexusdown-editor" :class="props.class" data-nexusdown="editor">
    <EditorToolbar v-if="session" :context="toolbarContext" :items="items" :readonly="readonly" />
    <div class="nexusdown-editor__panes">
      <div class="nexusdown-editor__pane nexusdown-editor__pane--rich" data-nexusdown="rich-text">
        <div ref="richElement" class="nexusdown-rich-content" />
      </div>
      <div class="nexusdown-editor__pane nexusdown-editor__pane--markdown">
        <textarea
          data-nexusdown="markdown"
          class="nexusdown-markdown-input"
          :value="markdownValue"
          :readonly="readonly"
          spellcheck="false"
          aria-label="Markdown 编辑器"
          @input="onMarkdownInput"
        />
      </div>
    </div>
  </section>
</template>
