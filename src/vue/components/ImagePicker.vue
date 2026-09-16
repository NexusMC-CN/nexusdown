<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import 'iconify-icon'

const props = defineProps<{
  disabled?: boolean
  readonly?: boolean
  upload?: (file: File) => Promise<boolean>
}>()
const emit = defineEmits<{
  apply: [payload: { src: string; alt: string }]
}>()

const open = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const fileInput = ref<HTMLInputElement | null>(null)
const srcValue = ref('')
const altValue = ref('')

function updatePosition() {
  const element = trigger.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const width = 300
  const estimatedHeight = 220
  const top = rect.bottom + estimatedHeight + 8 > window.innerHeight
    ? Math.max(8, rect.top - estimatedHeight - 8)
    : rect.bottom + 8
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
  menuStyle.value = { top: `${top}px`, left: `${left}px` }
}

function toggle() {
  if (props.disabled || props.readonly) return
  open.value = !open.value
}

function close() {
  open.value = false
  uploadError.value = ''
}

function apply() {
  if (props.readonly) return
  const src = srcValue.value.trim()
  if (!src) return
  emit('apply', { src, alt: altValue.value.trim() })
  close()
}

function pickFile() {
  if (props.readonly || !props.upload) return
  uploadError.value = ''
  fileInput.value?.click()
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (props.readonly || !file || !props.upload) return
  uploading.value = true
  uploadError.value = ''
  try {
    const ok = await props.upload(file)
    if (ok) close()
    else uploadError.value = '无法插入该图片'
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : '图片上传失败'
  } finally {
    uploading.value = false
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (target && (menu.value?.contains(target) || trigger.value?.contains(target))) return
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

watch(open, async (isOpen) => {
  if (!isOpen) {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', updatePosition)
    window.removeEventListener('scroll', updatePosition, true)
    return
  }
  await nextTick()
  updatePosition()
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  menu.value?.querySelector<HTMLInputElement>('input[aria-label="图片地址"]')?.focus()
})

watch(() => props.readonly, (readonly) => {
  if (readonly) close()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})
</script>

<template>
  <div class="nexusdown-image-picker">
    <button
      ref="trigger"
      class="nexusdown-toolbar__button"
      :disabled="disabled || readonly"
      type="button"
      aria-label="图片"
      title="图片"
      :aria-expanded="open"
      @mousedown.prevent
      @click="toggle"
    >
      <component :is="'iconify-icon'" icon="lucide:image" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        class="nexusdown-image-picker__menu"
        data-nexusdown="image-menu"
        role="dialog"
        aria-label="图片设置"
        :style="menuStyle"
        @mousedown.stop
      >
        <label class="nexusdown-image-picker__field">
          <span>图片地址</span>
          <input v-model="srcValue" aria-label="图片地址" type="url" placeholder="https://" :disabled="readonly" @keydown.enter.prevent="apply" />
        </label>
        <label class="nexusdown-image-picker__field">
          <span>替代文本</span>
          <input v-model="altValue" aria-label="图片描述" type="text" placeholder="图片描述" :disabled="readonly" @keydown.enter.prevent="apply" />
        </label>
        <div v-if="upload" class="nexusdown-image-picker__upload">
          <button
            type="button"
            aria-label="上传本地图片"
            :disabled="uploading || readonly"
            @click="pickFile"
          >
            <iconify-icon icon="lucide:upload" aria-hidden="true" />
            {{ uploading ? '上传中…' : '上传本地图片' }}
          </button>
          <input
            ref="fileInput"
            class="nexusdown-image-picker__file"
            type="file"
            accept="image/*"
            aria-label="图片文件"
            :disabled="readonly"
            @change="onFileSelected"
          />
        </div>
        <p v-if="uploadError" class="nexusdown-image-picker__error" role="alert">{{ uploadError }}</p>
        <div class="nexusdown-image-picker__actions">
          <span class="nexusdown-image-picker__spacer" />
          <button type="button" aria-label="取消图片编辑" @click="close">取消</button>
          <button type="button" aria-label="应用图片" :disabled="readonly || !srcValue.trim()" @click="apply">应用</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
