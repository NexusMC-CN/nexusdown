<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useNexusdownViewport } from './composables/useNexusdownViewport.js'
import { useNexusdownOverlayTheme } from './composables/useNexusdownOverlayTheme.js'
import { resolveOverlayTarget, nexusdownThemeVariables } from './overlay-target.js'

const props = withDefaults(defineProps<{
  selectedText?: string
  href?: string
  getSelectedText?: () => string
  getHref?: () => string
  active?: boolean
  disabled?: boolean
  readonly?: boolean
  showLabel?: boolean
}>(), {
  showLabel: false,
})
const emit = defineEmits<{
  apply: [payload: { href: string; text: string }]
  overlayFocus: [event: FocusEvent]
}>()

const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
// Teleport into a modal dialog when the editor lives in one: a menu teleported
// to `body` would fall outside the dialog's top layer and be inert.
const overlayTarget = computed(() => resolveOverlayTarget(trigger.value))
const { skin } = useNexusdownOverlayTheme(trigger, open, updatePosition)
const textValue = ref('')
const hrefValue = ref('')
const isDisabled = computed(() => props.disabled || props.readonly)

// Tracks visualViewport so the menu stays anchored when the soft keyboard opens
// (iOS frequently does not fire `window.resize` for keyboard transitions).
const { viewport } = useNexusdownViewport(() => {
  if (open.value) updatePosition()
})

function updatePosition() {
  const element = trigger.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const width = 286
  const estimatedHeight = 168
  const visibleHeight = viewport.value.height
  // rect is layout-viewport relative; convert to a visible-viewport offset.
  const anchorTop = rect.top - viewport.value.offsetTop
  const anchorBottom = rect.bottom - viewport.value.offsetTop
  const top = anchorBottom + estimatedHeight + 8 > visibleHeight
    ? Math.max(8, anchorTop - estimatedHeight - 8)
    : anchorBottom + 8
  const left = Math.min(
    Math.max(8, rect.left - viewport.value.offsetLeft),
    Math.max(8, viewport.value.width - width - 8),
  )
  // The menu is teleported out of `.nexusdown-editor`, which owns `--nexus-*`,
  // so mirror the resolved theme values onto it or dark mode falls back to the
  // `:root` light palette. Read fresh on every reposition so a runtime theme
  // change is reflected.
  const variables = nexusdownThemeVariables(element) ?? {}
  menuStyle.value = { top: `${top}px`, left: `${left}px`, ...variables }
}

function toggle() {
  if (props.disabled || props.readonly) return
  if (!open.value) {
    textValue.value = props.getSelectedText?.() ?? props.selectedText ?? ''
    hrefValue.value = props.getHref?.() ?? props.href ?? ''
  }
  open.value = !open.value
}

function close() {
  open.value = false
}

function apply() {
  const href = hrefValue.value.trim()
  if (!href) return
  emit('apply', { href, text: textValue.value })
  close()
}

/**
 * Enter is bound to `apply`, but with Chinese/Japanese/Korean input the Enter
 * that confirms a candidate also arrives as a keydown carrying `isComposing` —
 * submitting on it closed the dialog before the user had finished typing.
 * `keyCode === 229` covers older browsers that do not set `isComposing`.
 */
function onFieldEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  apply()
}

function remove() {
  emit('apply', { href: '', text: '' })
  close()}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (target && (menu.value?.contains(target) || trigger.value?.contains(target))) return
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  close()
  trigger.value?.focus({ preventScroll: true })
}

// Position listeners (resize/orientationchange/scroll/visualViewport) are owned
// by useNexusdownViewport, so only the dismissal listeners are managed here.
watch(open, async (isOpen) => {
  if (!isOpen) {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('keydown', onKeydown)
    return
  }
  await nextTick()
  updatePosition()
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeydown)
  menu.value?.querySelector<HTMLInputElement>('input[aria-label="链接地址"]')?.focus()
  // The menu focuses an input, so the soft keyboard opens right after layout.
  // Re-measure once the keyboard has settled to avoid a detached menu.
  requestAnimationFrame(() => {
    if (open.value) updatePosition()
  })
})

watch(isDisabled, (disabled) => {
  if (disabled) close()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="nexusdown-link-picker">
    <button
      ref="trigger"
      class="nexusdown-toolbar__button"
      :class="{ 'is-active': active }"
      :disabled="isDisabled"
      type="button"
      aria-label="链接"
      title="链接"
      :aria-expanded="open"
      @mousedown.prevent
      @click="toggle"
    >
      <component :is="'iconify-icon'" icon="lucide:link" aria-hidden="true" />
      <span v-if="showLabel">链接</span>
    </button>
    <Teleport :to="overlayTarget">
      <div
        v-if="open"
        ref="menu"
        class="nexusdown-link-picker__menu"
        data-nexusdown="link-menu"
        data-nexusdown-overlay-root
        :data-nexusdown-skin="skin"
        role="dialog"
        aria-label="链接设置"
        :style="menuStyle"
        @focusin="emit('overlayFocus', $event)"
        @mousedown.stop
      >
        <label class="nexusdown-link-picker__field">
          <span>文本</span>
          <input v-model="textValue" aria-label="链接文本" type="text" placeholder="显示文本" />
        </label>
        <label class="nexusdown-link-picker__field">
          <span>链接</span>
          <input v-model="hrefValue" aria-label="链接地址" type="url" placeholder="https://" @keydown.enter.prevent="onFieldEnter" />
        </label>
        <div class="nexusdown-link-picker__actions">
          <button v-if="active" type="button" aria-label="移除链接" @click="remove">移除</button>
          <span class="nexusdown-link-picker__spacer" />
          <button type="button" aria-label="取消链接编辑" @click="close">取消</button>
          <button type="button" aria-label="应用链接" :disabled="!hrefValue.trim()" @click="apply">应用</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
