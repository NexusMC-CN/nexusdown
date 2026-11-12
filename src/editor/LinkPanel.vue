<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { EditorView, LinkEditTarget, ResolveLinks, LinkDisplayMode } from '@nexusmc-cn/nexusdown/cm'
import { applyLinkEdit, extractLinkUrl } from '@nexusmc-cn/nexusdown/cm'
import type { LinkResolution } from '../render/feature.js'
import { parseEmbedUrl, embedTitle } from '../render/features/embed.js'

const props = defineProps<{view: EditorView; target: LinkEditTarget; resolveLinks?: ResolveLinks}>()
const emit = defineEmits<{close: []}>()
const input = ref(props.target.url)
const mode = ref<LinkDisplayMode>(props.target.mode)
const field = ref<HTMLInputElement | null>(null)
const resolution = shallowRef<LinkResolution | null>(null)
const loading = ref(false)
const error = ref('')
const url = computed(() => extractLinkUrl(input.value))
const embed = computed(() => parseEmbedUrl(url.value ?? '') ?? parseEmbedUrl(resolution.value?.url ?? ''))
const image = computed(() => {
  const value = resolution.value?.card?.image
  if (!value) return undefined
  try { const parsed = new URL(value); return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : undefined } catch { return undefined }
})
let request: AbortController | null = null
let generation = 0
watch(url, async (current) => {
  request?.abort()
  const token = ++generation
  resolution.value = null
  loading.value = false
  error.value = ''
  if (!current || !props.resolveLinks) return
  request = new AbortController()
  const signal = request.signal
  loading.value = true
  try {
    const results = await props.resolveLinks([current], {signal})
    if (signal.aborted || token !== generation) return
    resolution.value = results[current] ?? null
  } catch {
    if (!signal.aborted && token === generation) error.value = '预览暂不可用，仍可插入原链接。'
  } finally {
    if (token === generation) loading.value = false
  }
}, { immediate: true })
onBeforeUnmount(() => { generation++; request?.abort() })
onMounted(() => nextTick(() => field.value?.focus()))
function close() { emit('close'); props.view.focus() }
function submit() {
  if (!url.value) return
  if (!applyLinkEdit(props.view, props.target, url.value, mode.value, resolution.value ?? undefined)) {
    error.value = '正文已变化或链接不可用，请重新打开链接与媒体。'
    return
  }
  close()
}
</script>
<template>
  <form class="link-panel" aria-label="链接与媒体" @submit.prevent="submit" @keydown.esc.prevent="close">
    <label class="link-panel__label">链接或分享文案
      <input ref="field" v-model="input" type="text" autocomplete="off" placeholder="粘贴 URL 或含一个链接的分享文案" aria-label="链接或分享文案">
    </label>
    <div class="link-panel__actions">
      <select v-model="mode" aria-label="展示方式">
        <option value="link">普通链接</option>
        <option value="card">链接卡片</option>
        <option value="embed" :disabled="!embed">嵌入播放器</option>
      </select>
      <button type="submit" :disabled="!url || (mode === 'embed' && !embed)">确定</button>
      <button type="button" @click="close">取消</button>
    </div>
    <p v-if="loading" role="status">正在读取链接预览…</p>
    <p v-else-if="error" role="status">{{ error }}</p>
    <p v-else-if="input && !url" role="status">请输入一个有效的公开网页链接；多个链接请分别插入。</p>
    <div v-if="url" class="link-panel__preview">
      <img v-if="image" :src="image" alt="" loading="lazy">
      <div>
        <strong>{{ resolution?.card?.title || (embed ? embedTitle(embed) : '链接预览') }}</strong>
        <p v-if="resolution?.card?.description">{{ resolution.card.description }}</p>
        <small>{{ resolution?.card?.site || url }}</small>
        <p v-if="embed">播放器由读者点击后加载；默认不自动播放。</p>
      </div>
    </div>
  </form>
</template>
<style scoped>
.link-panel { padding: 12px 22px; border-top: 1px solid var(--nd-line, #ddd); display: grid; gap: 10px; font-size: 13px; }
.link-panel__label { display: grid; gap: 6px; }
.link-panel input, .link-panel select, .link-panel button { font: inherit; color: var(--nd-text, #222); border: 1px solid var(--nd-border, #ddd); border-radius: 6px; padding: 7px 9px; background: var(--nd-surface, white); }
.link-panel input { min-width: 0; width: 100%; box-sizing: border-box; }
.link-panel__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.link-panel button { cursor: pointer; }
.link-panel button:disabled { opacity: .5; cursor: default; }
.link-panel__preview { display: flex; gap: 12px; padding: 12px; border: 1px solid var(--nd-border, #ddd); border-radius: 8px; min-width: 0; overflow-wrap: anywhere; }
.link-panel__preview img { width: 80px; height: 64px; object-fit: cover; border-radius: 4px; }
.link-panel p { margin: 4px 0; color: var(--nd-text-3, #666); }
.link-panel small { color: var(--nd-text-3, #666); }
@media (max-width: 480px) { .link-panel { padding: 10px; } .link-panel__preview img { width: 56px; height: 56px; } }
</style>
