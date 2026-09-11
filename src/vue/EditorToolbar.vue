<script setup lang="ts">
import { computed, ref } from 'vue'
import 'iconify-icon'
import type { ToolbarContext, ToolbarGroup, ToolbarItem } from '../core/toolbar.js'
import HeadingPicker from './HeadingPicker.vue'
import LinkPicker from './LinkPicker.vue'
import ColorPicker from './components/ColorPicker.vue'
import ImagePicker from './components/ImagePicker.vue'

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
const linkItem = computed(() => props.items.find((item) => item.id === 'link'))
const imageItem = computed(() => props.items.find((item) => item.id === 'image'))
const activeHeadingLevel = computed(() => {
  void tick.value
  return [1, 2, 3, 4, 5, 6].find((level) => props.context.session.isActive('heading', { level }))
})
const linkSelectedText = computed(() => {
  void tick.value
  return props.context.session.getSelectedText()
})
const linkHref = computed(() => {
  void tick.value
  return props.context.session.getLinkHref()
})
const readSelectedText = () => props.context.session.getSelectedText()
const readLinkHref = () => props.context.session.getLinkHref()
function executeHeading(level: number) {
  const item = headingItem.value
  if (!item || props.readonly || item.isDisabled?.(props.context)) return
  item.execute({ ...props.context, headingLevel: level })
  tick.value++
  emit('executed')
}
function executeLink(payload: { href: string; text: string }) {
  const item = linkItem.value
  if (!item || props.readonly || item.isDisabled?.(props.context)) return
  item.execute({ ...props.context, linkHref: payload.href, linkText: payload.text })
  tick.value++
  emit('executed')
}
function executeImage(payload: { src: string; alt: string }) {
  const item = imageItem.value
  if (!item || props.readonly || item.isDisabled?.(props.context)) return
  item.execute({ ...props.context, imageSrc: payload.src, imageAlt: payload.alt })
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
            v-if="item.id !== 'heading' && item.id !== 'link' && item.id !== 'color' && item.id !== 'highlight' && item.id !== 'image'"
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
          <ColorPicker v-if="item.id === 'color' || item.id === 'highlight'" :context="context" :item="item" :readonly="readonly" :kind="item.id" />
          <ImagePicker v-if="item.id === 'image'" :disabled="item.isDisabled?.(context)" :readonly="readonly" @apply="executeImage" />
        </template>
        <HeadingPicker v-if="entry.group === 'block' && headingItem" :active-level="activeHeadingLevel" :disabled="headingItem.isDisabled?.(context)" :readonly="readonly" @select="executeHeading" />
        <LinkPicker v-if="linkItem && entry.items.some((item) => item.id === 'link')" :selected-text="linkSelectedText" :href="linkHref" :get-selected-text="readSelectedText" :get-href="readLinkHref" :active="linkItem.isActive?.(context)" :disabled="linkItem.isDisabled?.(context)" :readonly="readonly" @apply="executeLink" />
      </div>
    </template>
  </div>
</template>
