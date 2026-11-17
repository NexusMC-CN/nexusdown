<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { ContentReferenceCandidate, ContentReferenceProvider, ContentReferenceTarget, EditorView } from '@nexusmc-cn/nexusdown/cm'
import { contentReferenceKey, insertContentReference } from '@nexusmc-cn/nexusdown/cm'

const props = defineProps<{ view: EditorView; provider: ContentReferenceProvider }>()
const emit = defineEmits<{ close: [] }>()
const query = ref('')
const tutorial = shallowRef<ContentReferenceCandidate | null>(null)
const items = shallowRef<ContentReferenceCandidate[]>([])
const input = ref<HTMLInputElement | null>(null)
const active = ref(0)
const loading = ref(false)
const error = ref('')
const block = ref(false)
let controller: AbortController | null = null
let requestId = 0
let composing = false
let disposed = false

const kindNames = { resource: '资源', tutorial: '教程', post: '帖子' }

function validCandidate(candidate: ContentReferenceCandidate): boolean {
  try {
    contentReferenceKey(candidate.target)
    return typeof candidate.title === 'string' && (!tutorial.value || (
      candidate.target.kind === 'tutorial' && candidate.target.id === tutorial.value.target.id
    ))
  } catch { return false }
}

async function search(): Promise<void> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  const id = ++requestId
  loading.value = true
  error.value = ''
  items.value = []
  active.value = 0
  try {
    const result = await props.provider({
      query: query.value.slice(0, 100),
      ...(tutorial.value ? { target: tutorial.value.target } : {}),
      signal: current.signal,
    })
    if (disposed || current.signal.aborted || id !== requestId) return
    items.value = Array.isArray(result) ? result.filter(validCandidate).slice(0, 100) : []
  } catch {
    if (disposed || current.signal.aborted || id !== requestId) return
    error.value = '搜索失败，请重试。'
  } finally {
    if (!disposed && !current.signal.aborted && id === requestId) loading.value = false
  }
}

function close(): void {
  controller?.abort()
  ++requestId
  emit('close')
}

function insert(target: ContentReferenceTarget): void {
  if (composing || props.view.compositionStarted || props.view.composing || props.view.state.readOnly) return
  if (insertContentReference(target, { block: block.value })(props.view)) close()
}

function choose(candidate: ContentReferenceCandidate): void {
  if (composing) return
  if (candidate.target.kind === 'tutorial' && !candidate.target.fragmentType && !tutorial.value) {
    tutorial.value = candidate
    query.value = ''
    nextTick(() => input.value?.focus())
    return
  }
  insert(candidate.target)
}

function back(): void {
  tutorial.value = null
  query.value = ''
  nextTick(() => input.value?.focus())
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || composing || event.keyCode === 229) return
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  // Action buttons retain native Enter activation; only the search field navigates candidates.
  if (event.target !== input.value) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const length = items.value.length
    if (length) active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + length) % length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const candidate = items.value[active.value]
    if (!loading.value && candidate) choose(candidate)
  }
}

watch(() => [query.value, tutorial.value, props.provider], search, { immediate: true })
nextTick(() => input.value?.focus())
onBeforeUnmount(() => {
  disposed = true
  controller?.abort()
  ++requestId
})
</script>

<template>
  <section class="reference-panel" role="dialog" aria-label="插入内容引用" @keydown="onKeydown">
    <div v-if="tutorial" class="reference-panel__tutorial">
      <button type="button" @click="back">返回内容搜索</button>
      <strong>{{ tutorial.title }}</strong>
      <button type="button" data-reference-whole @click="insert(tutorial.target)">引用整篇教程</button>
    </div>
    <label class="reference-panel__search">
      {{ tutorial ? '搜索章节或段落' : '搜索资源、教程或帖子' }}
      <input
        ref="input"
        v-model="query"
        type="search"
        maxlength="100"
        :aria-label="tutorial ? '搜索章节或段落' : '搜索内容'"
        :placeholder="tutorial ? '输入章节或段落文字' : '输入标题或关键词'"
        autocomplete="off"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      >
    </label>
    <div class="reference-panel__actions">
      <label><input v-model="block" type="checkbox" aria-label="独占段落显示为卡片"> 独占段落显示为卡片</label>
      <button type="button" data-reference-cancel @click="close">取消</button>
    </div>
    <p v-if="loading" role="status">搜索中…</p>
    <div v-else-if="error" role="alert">
      {{ error }} <button type="button" data-reference-retry @click="search">重试</button>
    </div>
    <p v-else-if="!items.length" role="status">没有匹配的{{ tutorial ? '章节或段落' : '内容' }}</p>
    <ul v-else class="reference-panel__results" aria-label="引用候选">
      <li v-for="(candidate, index) in items" :key="contentReferenceKey(candidate.target)">
        <button
          type="button"
          data-reference-candidate
          :class="{ active: index === active }"
          @mouseenter="active = index"
          @click="choose(candidate)"
        >
          <small>{{ candidate.target.fragmentType === 'section' ? '章节' : candidate.target.fragmentType === 'block' ? '段落' : kindNames[candidate.target.kind] }}</small>
          <strong>{{ candidate.targetTitle || candidate.title }}</strong>
          <span v-if="candidate.summary">{{ candidate.summary }}</span>
        </button>
      </li>
    </ul>
    <p v-if="!loading && !error && items.length >= 100" data-reference-limit role="status">候选较多，请输入文字缩小查询范围。</p>
  </section>
</template>

<style scoped>
.reference-panel { display: grid; gap: 10px; padding: 12px 22px; border-top: 1px solid var(--nd-line, #ddd); font-size: 13px; }
.reference-panel__search { display: grid; gap: 6px; }
.reference-panel input[type="search"], .reference-panel button { font: inherit; color: var(--nd-text, #222); border: 1px solid var(--nd-border, #ddd); border-radius: 6px; padding: 7px 9px; background: var(--nd-surface, #fff); }
.reference-panel input[type="search"] { min-width: 0; width: 100%; box-sizing: border-box; }
.reference-panel button { cursor: pointer; text-align: start; }
.reference-panel__actions, .reference-panel__tutorial { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.reference-panel__actions { justify-content: space-between; }
.reference-panel__results { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow: auto; }
.reference-panel__results button { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; width: 100%; border-color: transparent; overflow-wrap: anywhere; }
.reference-panel__results button.active, .reference-panel__results button:focus-visible { border-color: var(--nd-accent, #2563eb); background: var(--nd-brand-soft, #eff6ff); }
.reference-panel__results small { color: var(--nd-text-3, #666); }
.reference-panel__results span { flex-basis: 100%; color: var(--nd-text-3, #666); }
.reference-panel p { margin: 0; }
@media (max-width: 480px) { .reference-panel { padding: 10px; } }
</style>
