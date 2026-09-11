<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  selectedText?: string
  href?: string
  getSelectedText?: () => string
  getHref?: () => string
  active?: boolean
  disabled?: boolean
  readonly?: boolean
}>()
const emit = defineEmits<{
  apply: [payload: { href: string; text: string }]
}>()

const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const textValue = ref('')
const hrefValue = ref('')

function updatePosition() {
  const element = trigger.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const width = 286
  const estimatedHeight = 168
  const top = rect.bottom + estimatedHeight + 8 > window.innerHeight
    ? Math.max(8, rect.top - estimatedHeight - 8)
    : rect.bottom + 8
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
  menuStyle.value = { top: `${top}px`, left: `${left}px` }
}

function toggle() {
  if (props.disabled || props.readonly) return
  if (!open.value) {
    textValue.value = props.getSelectedText?.() ?? props.selectedText ?? ''
    hrefValue.value = props.getHref?.() ?? props.href ?? ''
  }
  open.value = !open.value
}

function close() {
  open.value = false
}

function apply() {
  const href = hrefValue.value.trim()
  if (!href) return
  emit('apply', { href, text: textValue.value })
  close()
}

function remove() {
  emit('apply', { href: '', text: '' })
  close()
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
    return
  }
  await nextTick()
  updatePosition()
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeydown)
  menu.value?.querySelector<HTMLInputElement>('input[aria-label="链接地址"]')?.focus()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})

watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
  } else {
    window.removeEventListener('resize', updatePosition)
    window.removeEventListener('scroll', updatePosition, true)
  }
})
</script>

<template>
  <div class="nexusdown-link-picker">
    <button
      ref="trigger"
      class="nexusdown-toolbar__button"
      :class="{ 'is-active': active }"
      :disabled="disabled || readonly"
      type="button"
      aria-label="链接"
      title="链接"
      :aria-expanded="open"
      @mousedown.prevent
      @click="toggle"
    >
      <component :is="'iconify-icon'" icon="lucide:link" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        class="nexusdown-link-picker__menu"
        data-nexusdown="link-menu"
        role="dialog"
        aria-label="链接设置"
        :style="menuStyle"
        @mousedown.stop
      >
        <label class="nexusdown-link-picker__field">
          <span>文本</span>
          <input v-model="textValue" aria-label="链接文本" type="text" placeholder="显示文本" />
        </label>
        <label class="nexusdown-link-picker__field">
          <span>链接</span>
          <input v-model="hrefValue" aria-label="链接地址" type="url" placeholder="https://" @keydown.enter.prevent="apply" />
        </label>
        <div class="nexusdown-link-picker__actions">
          <button v-if="active" type="button" aria-label="移除链接" @click="remove">移除</button>
          <span class="nexusdown-link-picker__spacer" />
          <button type="button" aria-label="取消链接编辑" @click="close">取消</button>
          <button type="button" aria-label="应用链接" :disabled="!hrefValue.trim()" @click="apply">应用</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
