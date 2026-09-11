<script setup lang="ts">
import { computed, ref } from 'vue'
import 'iconify-icon'
import type { ToolbarContext, ToolbarGroup, ToolbarItem } from '../core/toolbar.js'
import HeadingPicker from './HeadingPicker.vue'

const props = defineProps<{ context: ToolbarContext; items: ToolbarItem[]; readonly?: boolean }>()
const emit = defineEmits<{ executed: [] }>()
const groups: ToolbarGroup[] = ['history', 'block', 'inline', 'extension']
const tick = ref(0)
const grouped = computed(() => {
  void tick.value
  return groups.map((group) => ({ group, items: props.items.filter((item) => item.group === group) })).filter((entry) => entry.items.length)
})
function execute(item: ToolbarItem) {
  if (props.readonly || item.isDisabled?.(props.context)) return
  item.execute(props.context)
  tick.value++
  emit('executed')
}
const headingItem = computed(() => props.items.find((item) => item.id === 'heading'))
const activeHeadingLevel = computed(() => {
  void tick.value
  return [1, 2, 3, 4, 5, 6].find((level) => props.context.session.isActive('heading', { level }))
})
function executeHeading(level: number) {
  const item = headingItem.value
  if (!item || props.readonly || item.isDisabled?.(props.context)) return
  item.execute({ ...props.context, headingLevel: level })
  tick.value++
  emit('executed')
}
</script>

<template>
  <div class="nexusdown-toolbar" data-nexusdown="toolbar" role="toolbar" aria-label="编辑工具栏">
    <template v-for="(entry, index) in grouped" :key="entry.group">
      <span v-if="index" class="nexusdown-toolbar__separator" aria-hidden="true" />
      <div class="nexusdown-toolbar__group">
        <template v-for="item in entry.items" :key="item.id">
          <button
            v-if="item.id !== 'heading'"
            class="nexusdown-toolbar__button"
            :class="{ 'is-active': item.isActive?.(context) }"
            :disabled="readonly || item.isDisabled?.(context)"
            type="button"
            :aria-label="item.label"
            :title="item.label"
            @click="execute(item)"
          >
            <component :is="'iconify-icon'" :icon="item.icon" aria-hidden="true" />
          </button>
        </template>
        <HeadingPicker v-if="entry.group === 'block' && headingItem" :active-level="activeHeadingLevel" :disabled="headingItem.isDisabled?.(context)" :readonly="readonly" @select="executeHeading" />
      </div>
    </template>
  </div>
</template>
