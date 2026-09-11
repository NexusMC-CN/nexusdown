<script setup lang="ts">
import { computed, ref } from 'vue'
import 'iconify-icon'
import type { ToolbarContext, ToolbarGroup, ToolbarItem } from '../core/toolbar.js'

const props = defineProps<{ context: ToolbarContext; items: ToolbarItem[]; readonly?: boolean }>()
const emit = defineEmits<{ executed: [] }>()
const groups: ToolbarGroup[] = ['history', 'block', 'inline', 'extension']
const tick = ref(0)
const headingMenuOpen = ref(false)
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
  headingMenuOpen.value = false
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
        <div v-if="entry.group === 'block' && headingItem" class="nexusdown-heading-picker">
          <button
            class="nexusdown-toolbar__button nexusdown-heading-picker__trigger"
            :class="{ 'is-active': activeHeadingLevel !== undefined }"
            :disabled="readonly || headingItem.isDisabled?.(context)"
            type="button"
            aria-label="标题"
            title="标题级别"
            :aria-expanded="headingMenuOpen"
            @click="headingMenuOpen = !headingMenuOpen"
          >
            <span aria-hidden="true">H{{ activeHeadingLevel ?? '' }}</span>
            <component :is="'iconify-icon'" icon="lucide:chevron-down" aria-hidden="true" />
          </button>
          <div v-if="headingMenuOpen" class="nexusdown-heading-picker__menu" data-nexusdown="heading-menu" role="menu">
            <button v-for="level in 6" :key="level" type="button" role="menuitem" :aria-label="`H${level}`" @click="executeHeading(level)">
              H{{ level }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
