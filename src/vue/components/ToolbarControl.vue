<script setup lang="ts">
import { computed } from 'vue'
import 'iconify-icon'
import type { PasteMode, ToolbarContext, ToolbarItem } from '../../core/toolbar.js'
import type { ToolbarControl } from '../toolbar-controls.js'
import HeadingPicker from '../HeadingPicker.vue'
import LinkPicker from '../LinkPicker.vue'
import ImagePicker from './ImagePicker.vue'

const props = defineProps<{
  control: ToolbarControl
  context: ToolbarContext
  display: 'compact' | 'overflow'
  pasteMode: PasteMode
  activeHeadingLevel?: number
  linkSelectedText?: string
  linkHref?: string
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
const isCompound = computed(() => ['heading', 'link', 'image'].includes(item.value?.id ?? ''))
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
  <ImagePicker
    v-else-if="item?.id === 'image'"
    :disabled="isItemDisabled"
    :readonly="readonly"
    :upload="insertImageFile"
    :show-label="display === 'overflow'"
    @apply="emit('applyImage', $event)"
    @overlay-focus="emit('overlayFocus', $event)"
  />
  <!--
    ⚠️ 提示用 `data-tooltip` + CSS 伪元素，**不用原生 `title`**。两个原因：

    1. **原生 title 要悬停 1-2 秒才出现**，用户的感觉就是"没有提示"。
    2. **`:title` 是动态绑定**，而这个按钮的 `is-active` 会随光标移动频繁变化，
       每次重渲染都重设一遍 `title` 属性 —— 浏览器会把 tooltip 的计时器**重置**，
       于是它经常永远等不到那 1-2 秒（用户原话："有时候出来有时候不出来，
       悬浮久也不出来"）。静态的 `data-tooltip` 不会被重渲染打断。

    `aria-label` 保留：读屏要靠它，`data-tooltip` 只是视觉层。
    溢出菜单里已经带了文字标签，所以那里不再挂 tooltip。
  -->
  <button
    v-else-if="control.kind === 'item'"
    class="nexusdown-toolbar__button"
    :data-nexusdown-command="control.item.id"
    :class="{ 'is-active': control.item.isActive?.(context) }"
    :disabled="isItemDisabled"
    type="button"
    :aria-label="control.label"
    :data-tooltip="display === 'compact' ? control.label : undefined"
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
    data-tooltip="查找替换 (Ctrl+F)"
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
    :data-tooltip="display === 'compact' ? pasteModeTitle : undefined"
    @click="emit('togglePasteMode')"
  >
    <component :is="'iconify-icon'" :icon="pasteModeIcon" aria-hidden="true" />
    <span v-if="display === 'overflow'" class="nexusdown-toolbar-control__label">粘贴模式：{{ pasteModeLabel }}</span>
  </button>
</template>
