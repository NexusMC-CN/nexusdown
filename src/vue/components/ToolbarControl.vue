<script setup lang="ts">
import { computed } from 'vue'
import 'iconify-icon'
import type { PasteMode, ToolbarContext, ToolbarItem } from '../../core/toolbar.js'
import type { ToolbarControl } from '../toolbar-controls.js'
import HeadingPicker from '../HeadingPicker.vue'
import LinkPicker from '../LinkPicker.vue'
import ColorPicker from './ColorPicker.vue'
import ImagePicker from './ImagePicker.vue'

const props = defineProps<{
  control: ToolbarControl
  context: ToolbarContext
  display: 'compact' | 'overflow'
  pasteMode: PasteMode
  activeHeadingLevel?: number
  linkSelectedText?: string
  linkHref?: string
  colorValue?: string
  readonly?: boolean
  insertImageFile?: (file: File) => Promise<boolean>
  concealed?: boolean
}>()

const emit = defineEmits<{
  execute: [item: ToolbarItem]
  find: []
  togglePasteMode: []
  selectHeading: [level: number]
  applyLink: [payload: { href: string; text: string }]
  applyImage: [payload: { src: string; alt: string }]
  'update:colorValue': [value: string]
  overlayFocus: [event: FocusEvent]
}>()

const PASTE_MODE_LABELS: Record<PasteMode, string> = {
  plain: '纯文本',
  structured: '富文本',
  markdown: 'Markdown',
}
const PASTE_MODE_ICONS: Record<PasteMode, string> = {
  plain: 'lucide:clipboard-type',
  structured: 'lucide:clipboard-paste',
  markdown: 'lucide:clipboard-list',
}
const NEXT_PASTE_MODE: Record<PasteMode, PasteMode> = {
  plain: 'structured',
  structured: 'markdown',
  markdown: 'plain',
}

const item = computed(() => props.control.kind === 'item' ? props.control.item : undefined)
const isCompound = computed(() => ['heading', 'link', 'color', 'highlight', 'image'].includes(item.value?.id ?? ''))
const isItemDisabled = computed(() => Boolean(
  props.readonly
  || item.value?.isDisabled?.(props.context)
  || (props.concealed && isCompound.value),
))
const pasteModeLabel = computed(() => PASTE_MODE_LABELS[props.pasteMode])
const pasteModeIcon = computed(() => PASTE_MODE_ICONS[props.pasteMode])
const pasteModeTitle = computed(() => `粘贴模式：${pasteModeLabel.value}（点击切换到${PASTE_MODE_LABELS[NEXT_PASTE_MODE[props.pasteMode]]}）`)

function execute() {
  if (!item.value || isItemDisabled.value) return
  emit('execute', item.value)
}
</script>

<template>
  <HeadingPicker
    v-if="item?.id === 'heading'"
    :active-level="activeHeadingLevel"
    :disabled="isItemDisabled"
    :readonly="readonly"
    :show-label="display === 'overflow'"
    @select="emit('selectHeading', $event)"
    @overlay-focus="emit('overlayFocus', $event)"
  />
  <LinkPicker
    v-else-if="item?.id === 'link'"
    :selected-text="linkSelectedText"
    :href="linkHref"
    :get-selected-text="() => props.context.session.getSelectedText?.() ?? ''"
    :get-href="() => props.context.session.getLinkHref?.() ?? ''"
    :active="item.isActive?.(context)"
    :disabled="isItemDisabled"
    :readonly="readonly"
    :show-label="display === 'overflow'"
    @apply="emit('applyLink', $event)"
    @overlay-focus="emit('overlayFocus', $event)"
  />
  <ColorPicker
    v-else-if="item?.id === 'color' || item?.id === 'highlight'"
    :context="context"
    :item="item"
    :disabled="isItemDisabled"
    :readonly="readonly"
    :kind="item.id === 'color' ? 'color' : 'highlight'"
    :show-label="display === 'overflow'"
    :model-value="colorValue"
    @update:model-value="emit('update:colorValue', $event)"
  />
  <ImagePicker
    v-else-if="item?.id === 'image'"
    :disabled="isItemDisabled"
    :readonly="readonly"
    :upload="insertImageFile"
    :show-label="display === 'overflow'"
    @apply="emit('applyImage', $event)"
    @overlay-focus="emit('overlayFocus', $event)"
  />
  <button
    v-else-if="control.kind === 'item'"
    class="nexusdown-toolbar__button"
    :data-nexusdown-command="control.item.id"
    :class="{ 'is-active': control.item.isActive?.(context) }"
    :disabled="isItemDisabled"
    type="button"
    :aria-label="control.label"
    :title="control.label"
    @click="execute"
  >
    <component :is="'iconify-icon'" :icon="control.icon" aria-hidden="true" />
    <span v-if="display === 'overflow'" class="nexusdown-toolbar-control__label">
      {{ control.label }}
    </span>
  </button>
  <button
    v-else-if="control.kind === 'find'"
    class="nexusdown-toolbar__button"
    :disabled="readonly"
    type="button"
    :aria-label="control.label"
    title="查找替换 (Ctrl+F)"
    @click="emit('find')"
  >
    <component :is="'iconify-icon'" :icon="control.icon" aria-hidden="true" />
    <span v-if="display === 'overflow'" class="nexusdown-toolbar-control__label">{{ control.label }}</span>
  </button>
  <button
    v-else
    class="nexusdown-toolbar__button"
    :class="{ 'is-active': pasteMode !== 'plain' }"
    data-nexusdown-command="paste-mode"
    :disabled="readonly"
    type="button"
    :aria-label="`粘贴模式：${pasteModeLabel}`"
    :title="pasteModeTitle"
    @click="emit('togglePasteMode')"
  >
    <component :is="'iconify-icon'" :icon="pasteModeIcon" aria-hidden="true" />
    <span v-if="display === 'overflow'" class="nexusdown-toolbar-control__label">粘贴模式：{{ pasteModeLabel }}</span>
  </button>
</template>
