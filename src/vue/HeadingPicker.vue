<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{ activeLevel?: number; disabled?: boolean; readonly?: boolean }>()
const emit = defineEmits<{ select: [level: number] }>()
const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

function updatePosition() {
  const element = trigger.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  menuStyle.value = { top: `${rect.bottom + 6}px`, left: `${rect.left}px` }
}
function toggle() {
  if (props.disabled || props.readonly) return
  open.value = !open.value
}
function choose(level: number) {
  emit('select', level)
  open.value = false
}
watch(open, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  updatePosition()
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})
</script>

<template>
  <div class="nexusdown-heading-picker">
    <button ref="trigger" class="nexusdown-toolbar__button nexusdown-heading-picker__trigger" :class="{ 'is-active': activeLevel !== undefined }" :disabled="disabled || readonly" type="button" aria-label="标题" title="标题级别" :aria-expanded="open" @click="toggle">
      <span aria-hidden="true">H{{ activeLevel ?? '' }}</span>
      <component :is="'iconify-icon'" icon="lucide:chevron-down" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div v-if="open" class="nexusdown-heading-picker__menu" data-nexusdown="heading-menu" role="menu" :style="menuStyle">
        <button v-for="level in 6" :key="level" type="button" role="menuitem" :aria-label="`H${level}`" @click="choose(level)">H{{ level }}</button>
      </div>
    </Teleport>
  </div>
</template>
