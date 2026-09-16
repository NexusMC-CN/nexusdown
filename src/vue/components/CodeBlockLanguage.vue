<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NexusdownEditorSession } from '../../core/session/index.js'
import 'iconify-icon'

const props = defineProps<{
  session: NexusdownEditorSession
  container: HTMLElement | null
  readonly?: boolean
}>()

const LANGUAGES = [
  { label: '纯文本', value: 'plaintext' },
  { label: 'JavaScript', value: 'js' },
  { label: 'TypeScript', value: 'ts' },
  { label: 'Python', value: 'python' },
  { label: 'Bash', value: 'bash' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'JSON', value: 'json' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'YAML', value: 'yaml' },
  { label: 'SQL', value: 'sql' },
  { label: 'Java', value: 'java' },
  { label: 'C', value: 'c' },
  { label: 'C++', value: 'cpp' },
  { label: 'Rust', value: 'rust' },
  { label: 'Go', value: 'go' },
  { label: 'PHP', value: 'php' },
] as const

const visible = ref(false)
const open = ref(false)
const triggerStyle = ref<Record<string, string>>({})
const menuStyle = ref<Record<string, string>>({})
const currentLanguage = ref('plaintext')
const root = ref<HTMLElement | null>(null)

function getContainer(): HTMLElement | null {
  return props.container ?? root.value?.parentElement ?? null
}

function findActiveCodeBlock(): HTMLElement | null {
  const editor = props.session.getEditor()
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'codeBlock') continue
    const dom = editor.view.nodeDOM($from.before(depth))
    if (!(dom instanceof HTMLElement)) return null
    return dom
  }
  return null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function refresh() {
  const container = getContainer()
  if (props.readonly || !container) {
    visible.value = false
    open.value = false
    return
  }
  const block = findActiveCodeBlock()
  if (!block) {
    visible.value = false
    open.value = false
    return
  }
  const language = props.session.getEditor().getAttributes('codeBlock').language
  currentLanguage.value = typeof language === 'string' && language ? language : 'plaintext'

  const containerRect = container.getBoundingClientRect()
  const blockRect = block.getBoundingClientRect()
  const width = 148
  const left = clamp(
    blockRect.right - containerRect.left - width - 4,
    4,
    Math.max(4, container.clientWidth - width - 4),
  )
  const top = Math.max(4, blockRect.top - containerRect.top + 4)
  triggerStyle.value = { left: `${left}px`, top: `${top}px` }
  menuStyle.value = { left: `${left}px`, top: `${top + 30}px` }
  visible.value = true
}

function scheduleRefresh() {
  void nextTick(refresh)
}

function toggle() {
  open.value = !open.value
}

function select(language: string) {
  open.value = false
  if (language === currentLanguage.value) return
  props.session.commands.setCodeBlockLanguage(language)
  currentLanguage.value = language
  scheduleRefresh()
}

const selectedLabel = computed(
  () => LANGUAGES.find((entry) => entry.value === currentLanguage.value)?.label ?? currentLanguage.value,
)

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!open.value) return
  if (target && (root.value?.contains(target) || menu.value?.contains(target))) return
  open.value = false
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

const menu = ref<HTMLElement | null>(null)

let unsubscribeSelection: () => void = () => undefined

onMounted(() => {
  const editor = props.session.getEditor()
  unsubscribeSelection = props.session.onSelectionChange(scheduleRefresh)
  editor.on('update', scheduleRefresh)
  window.addEventListener('resize', scheduleRefresh)
  window.addEventListener('scroll', scheduleRefresh, true)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
  scheduleRefresh()
})

onBeforeUnmount(() => {
  unsubscribeSelection()
  props.session.getEditor().off('update', scheduleRefresh)
  window.removeEventListener('resize', scheduleRefresh)
  window.removeEventListener('scroll', scheduleRefresh, true)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})

watch(() => props.container, scheduleRefresh, { immediate: true })
watch(() => props.readonly, scheduleRefresh)
</script>

<template>
  <div ref="root" class="nexusdown-codeblock-language" data-nexusdown="codeblock-language">
    <template v-if="visible && !readonly">
      <button
        class="nexusdown-codeblock-language__trigger"
        :style="triggerStyle"
        type="button"
        aria-label="代码块语言"
        title="代码块语言"
        @mousedown.prevent
        @click="toggle"
      >
        <span class="nexusdown-codeblock-language__value">{{ selectedLabel }}</span>
        <iconify-icon icon="lucide:chevron-down" aria-hidden="true" />
      </button>
      <div
        v-if="open"
        ref="menu"
        class="nexusdown-codeblock-language__menu"
        data-nexusdown="codeblock-language-menu"
        :style="menuStyle"
      >
        <button
          v-for="entry in LANGUAGES"
          :key="entry.value"
          type="button"
          :aria-label="entry.label"
          :class="{ 'is-active': entry.value === currentLanguage }"
          @mousedown.prevent
          @click="select(entry.value)"
        >
          {{ entry.label }}
        </button>
      </div>
    </template>
  </div>
</template>
