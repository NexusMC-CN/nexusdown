<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  createDefaultToolbarItems,
  createNexusdownEditor,
  type ContentType,
  type NexusdownEditorSession,
  type ToolbarContext,
  type ToolbarItem,
} from 'nexusdown/core'
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

const session = ref<NexusdownEditorSession>(createNexusdownEditor({ content: props.modelValue, contentType: props.contentType }))
const markdownValue = ref(props.modelValue)
const revision = ref(0)
let unsubscribe: () => void = () => undefined
let unsubscribeError: () => void = () => undefined

const items = computed(() => props.toolbarItems ?? createDefaultToolbarItems())
const richHTML = computed(() => {
  void revision.value
  return session.value?.getHTML() ?? ''
})
const toolbarContext = computed<ToolbarContext>(() => {
  void revision.value
  const current = session.value
  if (!current) throw new Error('Editor session is not ready')
  return { session: current }
})

markdownValue.value = session.value.getMarkdown()
unsubscribe = session.value.subscribe((snapshot) => {
  markdownValue.value = snapshot.markdown
  revision.value++
  emit('update:modelValue', snapshot.markdown)
  emit('update', snapshot)
})
unsubscribeError = session.value.onError((error) => emit('parse-error', error))

watch(() => props.modelValue, (value) => {
  if (session.value && value !== session.value.getMarkdown()) session.value.setMarkdown(value)
})

function onMarkdownInput(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value
  markdownValue.value = value
  emit('update:modelValue', value)
  try {
    session.value?.setMarkdown(value)
  } catch (error) {
    emit('parse-error', error instanceof Error ? error : new Error(String(error)))
  }
}

function onRichTextInput(event: Event) {
  const html = (event.target as HTMLElement).innerHTML
  session.value?.setContent(html, 'html')
}

onBeforeUnmount(() => {
  unsubscribe()
  unsubscribeError()
  session.value?.destroy()
})
</script>

<template>
  <section class="nexusdown-editor" :class="props.class" data-nexusdown="editor">
    <EditorToolbar v-if="session" :context="toolbarContext" :items="items" :readonly="readonly" />
    <div class="nexusdown-editor__panes">
      <div class="nexusdown-editor__pane nexusdown-editor__pane--rich" data-nexusdown="rich-text">
        <div
          v-if="session"
          class="nexusdown-rich-content"
          :contenteditable="readonly ? 'false' : 'true'"
          role="textbox"
          aria-multiline="true"
          @input="onRichTextInput"
          v-html="richHTML"
        />
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
