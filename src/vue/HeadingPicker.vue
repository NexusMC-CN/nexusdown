<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useNexusdownViewport } from './composables/useNexusdownViewport.js'

const props = defineProps<{ activeLevel?: number; disabled?: boolean; readonly?: boolean }>()
const emit = defineEmits<{ select: [level: number] }>()
const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

// Tracks visualViewport so the menu stays anchored through keyboard and
// orientation changes.
const { viewport } = useNexusdownViewport(() => {
  if (open.value) updatePosition()
})

function updatePosition() {
  const element = trigger.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const width = 74
  // Convert layout-viewport coords into visible-viewport coords, then clamp so a
  // right-docked trigger cannot push the menu off-screen.
  const anchorLeft = rect.left - viewport.value.offsetLeft
  const anchorTop = rect.bottom - viewport.value.offsetTop
  const left = Math.min(Math.max(8, anchorLeft), Math.max(8, viewport.value.width - width - 8))
  menuStyle.value = { top: `${anchorTop + 6}px`, left: `${left}px` }
}

function toggle() {
  if (props.disabled || props.readonly) return
  open.value = !open.value
}

function choose(level: number) {
  emit('select', level)
  open.value = false
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!open.value) return
  if (target && (menu.value?.contains(target) || trigger.value?.contains(target))) return
  open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
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
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="nexusdown-heading-picker">
    <button ref="trigger" class="nexusdown-toolbar__button nexusdown-heading-picker__trigger" :class="{ 'is-active': activeLevel !== undefined }" :disabled="disabled || readonly" type="button" aria-label="标题" title="标题级别" :aria-expanded="open" @click="toggle">
      <span aria-hidden="true">H{{ activeLevel ?? '' }}</span>
      <component :is="'iconify-icon'" icon="lucide:chevron-down" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div v-if="open" ref="menu" class="nexusdown-heading-picker__menu" data-nexusdown="heading-menu" role="menu" :style="menuStyle">
        <button v-for="level in 6" :key="level" type="button" role="menuitem" :aria-label="`H${level}`" @click="choose(level)">H{{ level }}</button>
      </div>
    </Teleport>
  </div>
</template>
