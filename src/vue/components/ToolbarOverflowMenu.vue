<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useNexusdownViewport } from '../composables/useNexusdownViewport.js'
import { useNexusdownOverlayTheme } from '../composables/useNexusdownOverlayTheme.js'
import { isNexusdownOverlayTarget, nexusdownThemeVariables, resolveOverlayTarget } from '../overlay-target.js'

const props = defineProps<{ hasItems: boolean }>()
const slot = ref<HTMLElement | null>(null)
const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const overlayTarget = shallowRef<string | Element>('body')
const menuStyle = ref<Record<string, string>>({})
const { viewport } = useNexusdownViewport(() => { if (open.value) updatePosition() })
const { skin } = useNexusdownOverlayTheme(trigger, open, updatePosition)
let listeningDocument: Document | undefined

function updatePosition() {
  if (!open.value || !trigger.value || !menu.value) return
  const rect = trigger.value.getBoundingClientRect()
  const view = viewport.value
  const leftEdge = view.offsetLeft + 8
  const topEdge = view.offsetTop + 8
  const rightEdge = view.offsetLeft + view.width - 8
  const bottomEdge = view.offsetTop + view.height - 8
  const width = Math.max(0, Math.min(320, view.width - 16))
  const below = Math.max(0, bottomEdge - rect.bottom - 6)
  const above = Math.max(0, rect.top - 6 - topEdge)
  const measured = menu.value.getBoundingClientRect().height
  const desiredHeight = Math.min(360, Math.max(measured, menu.value.scrollHeight))
  const flip = below < desiredHeight && above > below
  const maxHeight = Math.min(360, flip ? above : below)
  const height = Math.min(desiredHeight, maxHeight)
  menuStyle.value = {
    ...(nexusdownThemeVariables(trigger.value) ?? {}),
    width: `${width}px`,
    left: `${Math.max(leftEdge, Math.min(rect.right - width, rightEdge - width))}px`,
    top: `${Math.max(topEdge, Math.min(flip ? rect.top - 6 - height : rect.bottom + 6, bottomEdge - height))}px`,
    maxHeight: `${maxHeight}px`,
  }
}

function controls() {
  return Array.from(menu.value?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]') ?? [])
    .filter((element) => !element.matches(':disabled, [aria-disabled="true"], [tabindex="-1"], input[type="hidden"]')
      && element.closest('[data-nexusdown-overlay-root]') === menu.value
      && !element.closest('[hidden], [aria-hidden="true"]'))
}

function focusControl(element: HTMLElement | undefined) {
  if (!element || !menu.value) return
  element.focus({ preventScroll: true })
  const bounds = menu.value.getBoundingClientRect()
  const target = element.getBoundingClientRect()
  if (target.top < bounds.top) menu.value.scrollTop += target.top - bounds.top
  else if (target.bottom > bounds.bottom) menu.value.scrollTop += target.bottom - bounds.bottom
}

function removeListeners() {
  listeningDocument?.removeEventListener('pointerdown', onPointerDown)
  listeningDocument?.removeEventListener('keydown', onDocumentKeydown)
  listeningDocument = undefined
}

function close(restoreFocus = false) {
  open.value = false
  removeListeners()
  if (restoreFocus && props.hasItems) trigger.value?.focus({ preventScroll: true })
}

function toggle() {
  if (open.value) { close(); return }
  if (!props.hasItems) return
  overlayTarget.value = resolveOverlayTarget(trigger.value)
  open.value = true
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (target && (trigger.value?.contains(target) || menu.value?.contains(target) || isNexusdownOverlayTarget(target))) return
  close()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  const target = event.target as Element | null
  // Secondary pickers can be siblings in body or descendants in a modal.
  // Their nearest overlay root owns Escape in either Teleport arrangement.
  const overlayRoot = target?.closest?.('[data-nexusdown-overlay-root]')
  if (overlayRoot && overlayRoot !== menu.value) return
  event.preventDefault()
  close(true)
}

function onMenuKeydown(event: KeyboardEvent) {
  const target = event.target as Element | null
  if (target?.closest?.('[data-nexusdown-overlay-root]') !== menu.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const items = controls()
  if (!items.length) return
  event.preventDefault()
  const index = items.indexOf(menu.value?.ownerDocument.activeElement as HTMLElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  focusControl(items[next])
}

watch(open, async (isOpen) => {
  removeListeners()
  if (!isOpen) return
  await nextTick()
  if (!open.value || !menu.value) return
  updatePosition()
  focusControl(controls()[0])
  listeningDocument = menu.value.ownerDocument
  listeningDocument.addEventListener('pointerdown', onPointerDown)
  listeningDocument.addEventListener('keydown', onDocumentKeydown)
})
watch(() => props.hasItems, (hasItems) => { if (!hasItems) close() })
onBeforeUnmount(removeListeners)
defineExpose({ close, slot })
</script>

<template>
  <div ref="slot" class="nexusdown-toolbar-overflow__slot" :data-has-items="hasItems || undefined">
    <button v-show="hasItems" ref="trigger" data-nexusdown="toolbar-more-trigger" class="nexusdown-toolbar__button" type="button" aria-label="更多工具" aria-haspopup="dialog" :aria-expanded="open" @click="toggle">
      <component :is="'iconify-icon'" icon="lucide:ellipsis" aria-hidden="true" />
    </button>
  </div>
  <Teleport :to="overlayTarget">
    <div v-if="open && hasItems" ref="menu" class="nexusdown-toolbar-overflow__menu" data-nexusdown="toolbar-overflow-menu" data-nexusdown-overlay-root :data-nexusdown-skin="skin" role="dialog" aria-label="更多工具" :style="menuStyle" @keydown="onMenuKeydown">
      <slot :close="close" />
    </div>
  </Teleport>
</template>
