<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import 'iconify-icon'
import type { PasteMode, ToolbarContext, ToolbarGroup, ToolbarItem } from '../core/toolbar.js'
import HeadingPicker from './HeadingPicker.vue'
import LinkPicker from './LinkPicker.vue'
import ColorPicker from './components/ColorPicker.vue'
import ImagePicker from './components/ImagePicker.vue'

const props = defineProps<{ context: ToolbarContext; items: ToolbarItem[]; readonly?: boolean }>()
const emit = defineEmits<{ executed: []; find: [] }>()
// Canonical ordering for the built-in groups. Any *other* group a consumer
// declares is rendered too, appended after these in first-seen order — an item
// whose group was missing from a fixed allow-list used to be dropped silently,
// so moving (say) the heading item into a custom group made its button vanish.
const GROUP_ORDER: ToolbarGroup[] = ['history', 'block', 'inline', 'extension', 'align', 'indent']
const tick = ref(0)
const pasteMode = ref<PasteMode>(props.context.session.getPasteMode?.() ?? 'plain')
let unsubscribePasteMode: () => void = () => undefined
watch(() => props.context.session, (session) => {
  unsubscribePasteMode()
  pasteMode.value = session.getPasteMode()
  unsubscribePasteMode = session.onPasteModeChange?.((mode) => { pasteMode.value = mode }) ?? (() => undefined)
}, { immediate: true })
onBeforeUnmount(() => unsubscribePasteMode())

/** Cycle plain -> structured -> markdown -> plain. */
const PASTE_MODE_ORDER: PasteMode[] = ['plain', 'structured', 'markdown']
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
function togglePasteMode() {
  if (props.readonly) return
  const index = PASTE_MODE_ORDER.indexOf(pasteMode.value)
  const next = PASTE_MODE_ORDER[(index + 1) % PASTE_MODE_ORDER.length]
  props.context.session.setPasteMode(next)
  pasteMode.value = next
}
const grouped = computed(() => {
  void tick.value
  // Preserve the canonical order, then append any custom groups in the order the
  // consumer declared them so nothing is silently dropped.
  const declared = props.items.map((item) => item.group)
  const ordered = [...GROUP_ORDER.filter((group) => declared.includes(group)), ...declared.filter((group, index) => !GROUP_ORDER.includes(group) && declared.indexOf(group) === index)]
  return ordered.map((group) => ({ group, items: props.items.filter((item) => item.group === group) })).filter((entry) => entry.items.length)
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
            :data-nexusdown-command="item.id"
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
          <ImagePicker v-if="item.id === 'image'" :disabled="item.isDisabled?.(context)" :readonly="readonly" :upload="context.insertImageFile" @apply="executeImage" />
          <!-- The heading picker replaces the plain heading button, so it must
               render in whichever group the heading item declares rather than
               only in `block`: a consumer moving it to another group otherwise
               lost the control entirely. -->
          <HeadingPicker v-if="item.id === 'heading'" :active-level="activeHeadingLevel" :disabled="item.isDisabled?.(context)" :readonly="readonly" @select="executeHeading" />
        </template>
        <LinkPicker v-if="linkItem && entry.items.some((item) => item.id === 'link')" :selected-text="linkSelectedText" :href="linkHref" :get-selected-text="readSelectedText" :get-href="readLinkHref" :active="linkItem.isActive?.(context)" :disabled="linkItem.isDisabled?.(context)" :readonly="readonly" @apply="executeLink" />
      </div>
      <span v-if="entry.group === 'history'" class="nexusdown-toolbar__separator nexusdown-toolbar__separator--find" aria-hidden="true" />
      <div v-if="entry.group === 'history'" class="nexusdown-toolbar__group">
        <button
          class="nexusdown-toolbar__button"
          :disabled="readonly"
          type="button"
          aria-label="查找替换"
          title="查找替换 (Ctrl+F)"
          @click="emit('find')"
        >
          <component :is="'iconify-icon'" icon="lucide:search" aria-hidden="true" />
        </button>
        <button
          class="nexusdown-toolbar__button"
          :class="{ 'is-active': pasteMode !== 'plain' }"
          data-nexusdown-command="paste-mode"
          :disabled="readonly"
          type="button"
          :aria-label="`粘贴模式：${PASTE_MODE_LABELS[pasteMode]}`"
          :title="`粘贴模式：${PASTE_MODE_LABELS[pasteMode]}（点击切换到${PASTE_MODE_LABELS[PASTE_MODE_ORDER[(PASTE_MODE_ORDER.indexOf(pasteMode) + 1) % PASTE_MODE_ORDER.length]]}）`"
          @click="togglePasteMode"
        >
          <component :is="'iconify-icon'" :icon="PASTE_MODE_ICONS[pasteMode]" aria-hidden="true" />
        </button>
      </div>
    </template>
  </div>
</template>
