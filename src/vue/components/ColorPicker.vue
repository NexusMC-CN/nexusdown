<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolbarContext, ToolbarItem } from '../../core/toolbar.js'

const props = withDefaults(defineProps<{
  context: ToolbarContext
  item: ToolbarItem
  disabled?: boolean
  readonly?: boolean
  kind: 'color' | 'highlight'
  showLabel?: boolean
  modelValue?: string
}>(), {
  showLabel: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const fallbackValue = ref(props.kind === 'color' ? '#2563eb' : '#fef08a')
const value = computed(() => props.modelValue ?? fallbackValue.value)
const label = props.kind === 'color' ? '文字颜色' : '高亮'
const contextKey = props.kind === 'color' ? 'color' : 'highlightColor'

function apply(source: 'button' | 'input', selectedValue = value.value) {
  if (props.disabled || props.readonly || props.item.isDisabled?.(props.context)) return
  // Clearing goes through `item.execute` as well. Calling the command directly
  // bypassed the item's own callback, so a consumer whose `execute` validates or
  // records the action (or refuses it) still had the formatting removed.
  if (source === 'button' && props.item.isActive?.(props.context)) {
    props.item.execute({ ...props.context, [contextKey]: undefined })
    return
  }
  props.item.execute({ ...props.context, [contextKey]: selectedValue })
}

function onInput(event: Event) {
  if (props.disabled || props.readonly || props.item.isDisabled?.(props.context)) return
  const selectedValue = (event.target as HTMLInputElement).value
  fallbackValue.value = selectedValue
  emit('update:modelValue', selectedValue)
  apply('input', selectedValue)
}
</script>

<template>
  <div class="nexusdown-color-picker" :data-nexusdown="`${kind}-picker`">
    <button
      class="nexusdown-toolbar__button"
      :class="{ 'is-active': item.isActive?.(context) }"
      :disabled="disabled || readonly || item.isDisabled?.(context)"
      type="button"
      :aria-label="label"
      :title="label"
      @mousedown.prevent
      @click="apply('button')"
    >
      <component :is="'iconify-icon'" :icon="item.icon" aria-hidden="true" />
      <span v-if="showLabel">{{ label }}</span>
    </button>
    <input
      :value="value"
      class="nexusdown-color-picker__input"
      type="color"
      :aria-label="`${label}颜色`"
      :disabled="disabled || readonly || item.isDisabled?.(context)"
      @input="onInput"
    />
  </div>
</template>
