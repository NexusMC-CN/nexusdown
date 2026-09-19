<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import 'iconify-icon'
import type { PasteMode, ToolbarContext, ToolbarItem } from '../core/toolbar.js'
import { createToolbarControls } from './toolbar-controls.js'
import ToolbarControl from './components/ToolbarControl.vue'
import ToolbarOverflowMenu from './components/ToolbarOverflowMenu.vue'
import { useToolbarOverflow } from './composables/useToolbarOverflow.js'

const props = defineProps<{ context: ToolbarContext; items: ToolbarItem[]; readonly?: boolean }>()
const emit = defineEmits<{ executed: []; find: [] }>()
const tick = ref(0)
const selectedColors = ref<Record<string, string>>({ 'item:color': '#2563eb', 'item:highlight': '#fef08a' })
const pasteMode = ref<PasteMode>(props.context.session.getPasteMode?.() ?? 'plain')
let unsubscribePasteMode: () => void = () => undefined
watch(() => props.context.session, (session) => {
  unsubscribePasteMode()
  pasteMode.value = session.getPasteMode()
  unsubscribePasteMode = session.onPasteModeChange?.((mode) => { pasteMode.value = mode }) ?? (() => undefined)
}, { immediate: true })
onBeforeUnmount(() => unsubscribePasteMode())

/** Cycle plain -> structured -> markdown -> plain. */
const NEXT_PASTE_MODE: Record<PasteMode, PasteMode> = {
  plain: 'structured',
  structured: 'markdown',
  markdown: 'plain',
}
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
  const next = NEXT_PASTE_MODE[pasteMode.value]
  props.context.session.setPasteMode(next)
  pasteMode.value = next
  refresh()
}
const controls = computed(() => {
  void tick.value
  return createToolbarControls(props.items)
})
const toolbar = ref<HTMLElement | null>(null)
type ToolbarOverflowMenuExpose = { close: (restoreFocus?: boolean) => void; slot: HTMLElement | null }
const moreMenu = ref<ToolbarOverflowMenuExpose | null>(null)
const controlKeys = computed(() => controls.value.map(({ key }) => key))
const { overflowedKeys, ready, refresh } = useToolbarOverflow({
  toolbar,
  moreSlot: computed(() => moreMenu.value?.slot ?? null),
  controlKeys,
})
const overflowedControls = computed(() => controls.value.filter(({ key }) => overflowedKeys.value.has(key)))
type ToolbarFocus = { key: (typeof controls.value)[number]['key']; element: Element; overflow: boolean }
let lastFocus: ToolbarFocus | undefined
let removedFocus: { key: string; index: number } | undefined

function rememberFocus(key: ToolbarFocus['key'], event: FocusEvent, overflow: boolean) {
  // Vue events retain the control's stable key across both body and modal Teleports.
  if (event.target) lastFocus = { key, element: event.target as Element, overflow }
}

function currentFocus() {
  return lastFocus?.element === toolbar.value?.ownerDocument.activeElement ? lastFocus : undefined
}

watch(controlKeys, (keys, previousKeys) => {
  const focused = currentFocus()
  if (focused && !keys.includes(focused.key)) {
    // Capture before Vue removes the focused node; measurement runs in a later frame.
    removedFocus = { key: focused.key, index: previousKeys.indexOf(focused.key) }
    moreMenu.value?.close()
  }
}, { flush: 'pre' })

function restoreControlFocus(key: string, index: number, removed: boolean) {
  const main = Array.from(toolbar.value?.querySelectorAll<HTMLElement>('.nexusdown-toolbar__track [data-nexusdown-toolbar-key]') ?? [])
  const enabledControl = (element: HTMLElement | undefined) => element?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? undefined
  const matching = !removed && main.find((element) => element.dataset.nexusdownToolbarKey === key && element.dataset.overflowed !== 'true')
  let target = enabledControl(matching || undefined)
  if (!target && overflowedControls.value.length) target = moreMenu.value?.slot?.querySelector<HTMLElement>('button') ?? undefined
  if (!target) {
    target = main.map((element, position) => ({ element, position }))
      .filter(({ element }) => element.dataset.overflowed !== 'true')
      .sort((a, b) => Math.abs(a.position - index) - Math.abs(b.position - index))
      .map(({ element }) => enabledControl(element)).find((element) => element !== undefined)
  }
  ;(target ?? toolbar.value)?.focus({ preventScroll: true })
}

watch(overflowedKeys, async (keys) => {
  const focused = currentFocus()
  const recovery = removedFocus ?? (focused?.overflow && !keys.has(focused.key)
    ? { key: focused.key, index: controlKeys.value.indexOf(focused.key) } : undefined)
  if (recovery) {
    const removed = removedFocus !== undefined
    removedFocus = undefined
    moreMenu.value?.close()
    await nextTick()
    const root = toolbar.value
    const active = root?.ownerDocument.activeElement
    // Removal falls back to body. A new outside focus belongs to the host;
    // only this toolbar's own recorded overlay focus can retain ownership.
    if (removed && active && active !== root?.ownerDocument.body && !root?.contains(active) && !currentFocus()) return
    restoreControlFocus(recovery.key, recovery.index, removed)
  } else if (!keys.size) moreMenu.value?.close()
})
watch(() => props.context, refresh, { flush: 'post' })
const controlGroups = computed(() => {
  const groups: Array<{ key: string; group: string; controls: typeof controls.value }> = []
  for (const control of controls.value) {
    const last = groups.at(-1)
    if (last?.group === control.group) last.controls.push(control)
    else groups.push({ key: control.key, group: control.group, controls: [control] })
  }
  return groups
})
function execute(item: ToolbarItem) {
  if (props.readonly || item.isDisabled?.(props.context)) return
  item.execute(props.context)
  tick.value++
  refresh()
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
  refresh()
  emit('executed')
}
function executeLink(payload: { href: string; text: string }) {
  const item = linkItem.value
  if (!item || props.readonly || item.isDisabled?.(props.context)) return
  item.execute({ ...props.context, linkHref: payload.href, linkText: payload.text })
  tick.value++
  refresh()
  emit('executed')
}
function executeImage(payload: { src: string; alt: string }) {
  const item = imageItem.value
  if (!item || props.readonly || item.isDisabled?.(props.context)) return
  item.execute({ ...props.context, imageSrc: payload.src, imageAlt: payload.alt })
  tick.value++
  refresh()
  emit('executed')
}
</script>

<template>
  <div ref="toolbar" class="nexusdown-toolbar" data-nexusdown="toolbar" :data-overflow-ready="ready" role="toolbar" tabindex="-1" aria-label="编辑工具栏">
    <div class="nexusdown-toolbar__track">
    <template v-for="(entry, index) in controlGroups" :key="entry.key">
      <span v-if="index" class="nexusdown-toolbar__separator" aria-hidden="true" />
      <div class="nexusdown-toolbar__group">
        <div
          v-for="control in entry.controls"
          :key="control.key"
          class="nexusdown-toolbar__control"
          :data-nexusdown-toolbar-key="control.key"
          :data-overflowed="overflowedKeys.has(control.key) || undefined"
          :aria-hidden="overflowedKeys.has(control.key) || undefined"
          @focusin="rememberFocus(control.key, $event, false)"
        >
          <ToolbarControl
            :control="control"
            :context="context"
            display="compact"
            :concealed="overflowedKeys.has(control.key)"
            :paste-mode="pasteMode"
            :readonly="readonly"
            :active-heading-level="activeHeadingLevel"
            :link-selected-text="linkSelectedText"
            :link-href="linkHref"
            :color-value="selectedColors[control.key]"
            @update:color-value="selectedColors[control.key] = $event"
            :insert-image-file="context.insertImageFile"
            @execute="execute"
            @find="emit('find')"
            @toggle-paste-mode="togglePasteMode"
            @select-heading="executeHeading"
            @apply-link="executeLink"
            @apply-image="executeImage"
            @overlay-focus="rememberFocus(control.key, $event, false)"
          />
        </div>
      </div>
    </template>
    </div>
    <ToolbarOverflowMenu ref="moreMenu" :has-items="overflowedControls.length > 0">
      <template #default="{ close }">
        <template v-for="entry in controlGroups" :key="entry.key">
          <div v-if="entry.controls.some((control) => overflowedKeys.has(control.key))" class="nexusdown-toolbar-overflow__items" role="group">
            <div v-for="control in entry.controls.filter((control) => overflowedKeys.has(control.key))" :key="control.key" class="nexusdown-toolbar-control--overflow" :data-nexusdown-toolbar-key="control.key" @focusin="rememberFocus(control.key, $event, true)">
              <ToolbarControl
                :control="control"
                :context="context"
                display="overflow"
                :paste-mode="pasteMode"
                :readonly="readonly"
                :active-heading-level="activeHeadingLevel"
                :link-selected-text="linkSelectedText"
                :link-href="linkHref"
                :color-value="selectedColors[control.key]"
                @update:color-value="selectedColors[control.key] = $event"
                :insert-image-file="context.insertImageFile"
                @execute="execute($event); close()"
                @find="emit('find'); close()"
                @toggle-paste-mode="togglePasteMode(); close()"
                @select-heading="executeHeading"
                @apply-link="executeLink"
                @apply-image="executeImage"
                @overlay-focus="rememberFocus(control.key, $event, true)"
              />
            </div>
          </div>
        </template>
      </template>
    </ToolbarOverflowMenu>
  </div>
</template>
