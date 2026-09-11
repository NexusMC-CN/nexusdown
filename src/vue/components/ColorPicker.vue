<script setup lang="ts">
import { ref } from 'vue'
import type { ToolbarContext, ToolbarItem } from '../../core/toolbar.js'

const props = defineProps<{
  context: ToolbarContext
  item: ToolbarItem
  readonly?: boolean
  kind: 'color' | 'highlight'
}>()

const value = ref(props.kind === 'color' ? '#2563eb' : '#fef08a')
const label = props.kind === 'color' ? '文字颜色' : '高亮'
const contextKey = props.kind === 'color' ? 'color' : 'highlightColor'

function apply(source: 'button' | 'input') {
  if (props.readonly || props.item.isDisabled?.(props.context)) return
  if (source === 'button' && props.item.isActive?.(props.context)) {
    if (props.kind === 'color') props.context.session.commands.setColor()
    else props.context.session.commands.setHighlight()
    return
  }
  props.item.execute({ ...props.context, [contextKey]: value.value })
}
</script>

<template>
  <div class="nexusdown-color-picker" :data-nexusdown="`${kind}-picker`">
    <button
      class="nexusdown-toolbar__button"
      :class="{ 'is-active': item.isActive?.(context) }"
      :disabled="readonly || item.isDisabled?.(context)"
      type="button"
      :aria-label="label"
      :title="label"
      @mousedown.prevent
      @click="apply('button')"
    >
      <component :is="'iconify-icon'" :icon="item.icon" aria-hidden="true" />
    </button>
    <input
      v-model="value"
      class="nexusdown-color-picker__input"
      type="color"
      :aria-label="`${label}颜色`"
      :disabled="readonly || item.isDisabled?.(context)"
      @input="apply('input')"
    />
  </div>
</template>
