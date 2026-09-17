<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useNexusdownViewport } from '../composables/useNexusdownViewport.js'
import { resolveOverlayTarget, nexusdownThemeVariables } from '../overlay-target.js'
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
// Teleport into a modal dialog when the editor lives in one: a menu teleported
// to `body` would fall outside the dialog's top layer and be inert.
const overlayTarget = computed(() => resolveOverlayTarget(trigger.value))
const fileInput = ref<HTMLInputElement | null>(null)
const srcValue = ref('')
const altValue = ref('')

// Tracks visualViewport so the menu stays anchored when the soft keyboard opens
// (iOS frequently does not fire `window.resize` for keyboard transitions).
const { viewport } = useNexusdownViewport(() => {
  if (open.value) updatePosition()
})

function updatePosition() {
  const element = trigger.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const width = 300
  const estimatedHeight = 220
  const visibleHeight = viewport.value.height
  // rect is layout-viewport relative; convert to a visible-viewport offset.
  const anchorTop = rect.top - viewport.value.offsetTop
  const anchorBottom = rect.bottom - viewport.value.offsetTop
  const top = anchorBottom + estimatedHeight + 8 > visibleHeight
    ? Math.max(8, anchorTop - estimatedHeight - 8)
    : anchorBottom + 8
  const left = Math.min(
    Math.max(8, rect.left - viewport.value.offsetLeft),
    Math.max(8, viewport.value.width - width - 8),
  )
  // The menu is teleported out of `.nexusdown-editor`, which owns `--nexus-*`,
  // so mirror the resolved theme values onto it or dark mode falls back to the
  // `:root` light palette. Read fresh on every reposition so a runtime theme
  // change is reflected.
  const variables = nexusdownThemeVariables(element) ?? {}
  menuStyle.value = { top: `${top}px`, left: `${left}px`, ...variables }
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

/**
 * Enter submits the dialog — but not the Enter that confirms an IME candidate.
 *
 * With Chinese/Japanese/Korean input the Enter that picks a candidate arrives as
 * a keydown carrying `isComposing`, and applying on it submitted the dialog
 * before the user had finished typing. `keyCode === 229` covers older browsers
 * that do not set `isComposing`.
 */
function onFieldEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  apply()
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

// Position listeners (resize/orientationchange/scroll/visualViewport) are owned
// by useNexusdownViewport, so only the dismissal listeners are managed here.
watch(open, async (isOpen) => {
  if (!isOpen) {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('keydown', onKeydown)
    return
  }
  await nextTick()
  updatePosition()
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeydown)
  menu.value?.querySelector<HTMLInputElement>('input[aria-label="图片地址"]')?.focus()
  // The menu focuses an input, so the soft keyboard opens right after layout.
  // Re-measure once the keyboard has settled to avoid a detached menu.
  requestAnimationFrame(() => {
    if (open.value) updatePosition()
  })
})

watch(() => props.readonly, (readonly) => {
  if (readonly) close()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
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
    <Teleport :to="overlayTarget">
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
          <input v-model="srcValue" aria-label="图片地址" type="url" placeholder="https://" :disabled="readonly" @keydown.enter.prevent="onFieldEnter" />
        </label>
        <label class="nexusdown-image-picker__field">
          <span>替代文本</span>
          <input v-model="altValue" aria-label="图片描述" type="text" placeholder="图片描述" :disabled="readonly" @keydown.enter.prevent="onFieldEnter" />
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
