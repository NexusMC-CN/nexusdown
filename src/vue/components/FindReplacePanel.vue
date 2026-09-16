<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NexusdownEditorSession } from '../../core/session/index.js'
import 'iconify-icon'

const props = defineProps<{
  session: NexusdownEditorSession
  readonly?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const term = ref('')
const replace = ref('')
const caseSensitive = ref(false)
const currentIndex = ref(0)
const total = ref(0)
const findInput = ref<HTMLInputElement | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | undefined

function refreshCounts() {
  const storage = props.session.getEditor().storage.findReplace
  currentIndex.value = storage.currentIndex
  total.value = storage.matches.length
}

function runFind() {
  const editor = props.session.getEditor()
  const storage = editor.storage.findReplace
  if (!term.value) {
    editor.commands.clearFind()
    currentIndex.value = 0
    total.value = 0
    return
  }
  storage.caseSensitive = caseSensitive.value
  editor.commands.find(term.value)
  refreshCounts()
}

function onTermInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined
    runFind()
  }, 300)
}

function flushFind() {
  if (!debounceTimer) return
  clearTimeout(debounceTimer)
  debounceTimer = undefined
  runFind()
}

function next() {
  flushFind()
  props.session.getEditor().commands.findNext()
  refreshCounts()
}

function prev() {
  flushFind()
  props.session.getEditor().commands.findPrev()
  refreshCounts()
}

function replaceCurrent() {
  flushFind()
  props.session.getEditor().commands.replaceCurrent(replace.value)
  refreshCounts()
}

function replaceAll() {
  flushFind()
  props.session.getEditor().commands.replaceAll(replace.value)
  refreshCounts()
}

function close() {
  props.session.getEditor().commands.clearFind()
  emit('close')
}

function onPanelKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close()
  }
}

function onFindKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  if (event.shiftKey) prev()
  else next()
  event.preventDefault()
}

watch(caseSensitive, () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = undefined
  }
  runFind()
})
watch(() => props.readonly, (readonly) => {
  if (readonly) close()
})

let unsubscribeSelection: () => void = () => undefined

onMounted(() => {
  const editor = props.session.getEditor()
  unsubscribeSelection = props.session.onSelectionChange(refreshCounts)
  editor.on('update', refreshCounts)
  findInput.value?.focus()
})

onBeforeUnmount(() => {
  unsubscribeSelection()
  props.session.getEditor().off('update', refreshCounts)
  if (debounceTimer) clearTimeout(debounceTimer)
})
</script>

<template>
  <div
    class="nexusdown-find-replace"
    data-nexusdown="find-replace"
    role="search"
    aria-label="查找替换"
    @keydown="onPanelKeydown"
  >
    <div class="nexusdown-find-replace__field">
      <input
        ref="findInput"
        v-model="term"
        aria-label="查找内容"
        type="text"
        placeholder="查找"
        @input="onTermInput"
        @keydown="onFindKeydown"
      />
      <span v-if="total" class="nexusdown-find-replace__count">{{ currentIndex + 1 }}/{{ total }}</span>
      <span v-else-if="term" class="nexusdown-find-replace__count nexusdown-find-replace__count--empty">无结果</span>
    </div>
    <div class="nexusdown-find-replace__actions">
      <button
        type="button"
        aria-label="上一个"
        title="上一个 (Shift+Enter)"
        :disabled="!total"
        @click="prev"
      >
        <iconify-icon icon="lucide:chevron-up" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="下一个"
        title="下一个 (Enter)"
        :disabled="!total"
        @click="next"
      >
        <iconify-icon icon="lucide:chevron-down" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="区分大小写"
        title="区分大小写"
        :class="{ 'is-active': caseSensitive }"
        @click="caseSensitive = !caseSensitive"
      >
        <iconify-icon icon="lucide:case-sensitive" aria-hidden="true" />
      </button>
    </div>
    <div class="nexusdown-find-replace__field">
      <input
        v-model="replace"
        aria-label="替换内容"
        type="text"
        placeholder="替换为"
        @keydown.enter.prevent="replaceCurrent"
      />
    </div>
    <div class="nexusdown-find-replace__actions">
      <button type="button" aria-label="替换" title="替换" :disabled="!total" @click="replaceCurrent">替换</button>
      <button type="button" aria-label="全部替换" title="全部替换" :disabled="!total" @click="replaceAll">全部替换</button>
      <button type="button" aria-label="关闭查找" title="关闭 (Esc)" @click="close">
        <iconify-icon icon="lucide:x" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
