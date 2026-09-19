<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { NexusdownEditorSession } from '../../core/session/index.js'
import { useNexusdownOverlayTheme } from '../composables/useNexusdownOverlayTheme.js'
import { useNexusdownViewport } from '../composables/useNexusdownViewport.js'
import { nexusdownThemeVariables, resolveOverlayTarget } from '../overlay-target.js'
import 'iconify-icon'

const props = defineProps<{
  session: NexusdownEditorSession
  container: HTMLElement | null
  readonly?: boolean
}>()

const LANGUAGES = [
  { label: '纯文本', value: 'plaintext' },
  { label: 'JavaScript', value: 'js' },
  { label: 'TypeScript', value: 'ts' },
  { label: 'Python', value: 'python' },
  { label: 'Bash', value: 'bash' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'JSON', value: 'json' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'YAML', value: 'yaml' },
  { label: 'SQL', value: 'sql' },
  { label: 'Java', value: 'java' },
  { label: 'C', value: 'c' },
  { label: 'C++', value: 'cpp' },
  { label: 'Rust', value: 'rust' },
  { label: 'Go', value: 'go' },
  { label: 'PHP', value: 'php' },
] as const

const visible = ref(false)
const open = ref(false)
const triggerStyle = ref<Record<string, string>>({})
const menuStyle = ref<Record<string, string>>({})
const currentLanguage = ref('plaintext')
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)

const MENU_WIDTH = 148
const MAX_MENU_HEIGHT = 220
const VIEWPORT_MARGIN = 8
const MENU_GAP = 6

const overlayTarget = shallowRef<string | Element>('body')
const { viewport } = useNexusdownViewport(scheduleRefresh)
const { skin } = useNexusdownOverlayTheme(trigger, open, updateMenuPosition)

function getContainer(): HTMLElement | null {
  return props.container ?? root.value?.parentElement ?? null
}

function findActiveCodeBlock(): HTMLElement | null {
  const editor = props.session.getEditor()
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'codeBlock') continue
    const dom = editor.view.nodeDOM($from.before(depth))
    if (!(dom instanceof HTMLElement)) return null
    return dom
  }
  return null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function updateMenuPosition() {
  const element = trigger.value
  if (!open.value || !element) return
  const rect = element.getBoundingClientRect()
  const currentViewport = viewport.value
  const anchorLeft = rect.right - currentViewport.offsetLeft
  const anchorTop = rect.top - currentViewport.offsetTop
  const anchorBottom = rect.bottom - currentViewport.offsetTop
  const availableBelow = Math.max(0, currentViewport.height - anchorBottom - MENU_GAP - VIEWPORT_MARGIN)
  const availableAbove = Math.max(0, anchorTop - MENU_GAP - VIEWPORT_MARGIN)
  const desiredHeight = Math.min(menu.value?.scrollHeight || MAX_MENU_HEIGHT, MAX_MENU_HEIGHT)
  const placeAbove = availableBelow < desiredHeight && availableAbove > availableBelow
  const availableHeight = placeAbove ? availableAbove : availableBelow
  const maxHeight = Math.min(MAX_MENU_HEIGHT, availableHeight)
  const renderedHeight = Math.min(desiredHeight, maxHeight)
  const left = clamp(
    anchorLeft - MENU_WIDTH,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, currentViewport.width - MENU_WIDTH - VIEWPORT_MARGIN),
  )
  const top = placeAbove
    ? Math.max(VIEWPORT_MARGIN, anchorTop - MENU_GAP - renderedHeight)
    : Math.max(VIEWPORT_MARGIN, anchorBottom + MENU_GAP)

  menuStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    maxHeight: `${maxHeight}px`,
    ...(nexusdownThemeVariables(element) ?? {}),
  }
}

function refresh() {
  const container = getContainer()
  if (props.readonly || !container) {
    visible.value = false
    open.value = false
    return
  }
  const block = findActiveCodeBlock()
  if (!block) {
    visible.value = false
    open.value = false
    return
  }
  const language = props.session.getEditor().getAttributes('codeBlock').language
  currentLanguage.value = typeof language === 'string' && language ? language : 'plaintext'

  const containerRect = container.getBoundingClientRect()
  const blockRect = block.getBoundingClientRect()
  const width = MENU_WIDTH
  const left = clamp(
    blockRect.right - containerRect.left - width - 4,
    4,
    Math.max(4, container.clientWidth - width - 4),
  )
  const top = Math.max(4, blockRect.top - containerRect.top + 4)
  triggerStyle.value = { left: `${left}px`, top: `${top}px` }
  visible.value = true
  if (open.value) void nextTick(updateMenuPosition)
}

function scheduleRefresh() {
  void nextTick(refresh)
}

function getMenuItems(): HTMLButtonElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
}

function focusMenuItem(index: number) {
  const items = getMenuItems()
  if (items.length === 0) return
  const normalized = (index + items.length) % items.length
  const item = items[normalized]
  const container = menu.value
  if (!item || !container) return
  item.focus({ preventScroll: true })
  const itemTop = item.offsetTop
  const itemBottom = itemTop + item.offsetHeight
  const visibleTop = container.scrollTop
  const visibleBottom = visibleTop + container.clientHeight
  if (itemTop < visibleTop) container.scrollTop = itemTop
  else if (itemBottom > visibleBottom) container.scrollTop = itemBottom - container.clientHeight
}

async function openMenu() {
  // A dialog may become modal after this component mounts. Resolve immediately
  // before every open instead of caching the previous top-layer state.
  overlayTarget.value = resolveOverlayTarget(trigger.value)
  open.value = true
  await nextTick()
  if (!open.value) return
  updateMenuPosition()
  const selectedIndex = LANGUAGES.findIndex((entry) => entry.value === currentLanguage.value)
  focusMenuItem(Math.max(0, selectedIndex))
}

function closeMenu(restoreFocus = false) {
  open.value = false
  if (restoreFocus) void nextTick(() => trigger.value?.focus({ preventScroll: true }))
}

function toggle() {
  if (open.value) closeMenu()
  else void openMenu()
}

function select(language: string) {
  closeMenu()
  if (language === currentLanguage.value) return
  props.session.commands.setCodeBlockLanguage(language)
  currentLanguage.value = language
  scheduleRefresh()
}

const selectedLabel = computed(
  () => LANGUAGES.find((entry) => entry.value === currentLanguage.value)?.label ?? currentLanguage.value,
)

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!open.value) return
  if (target && (root.value?.contains(target) || menu.value?.contains(target))) return
  closeMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) closeMenu(true)
}

function onMenuKeydown(event: KeyboardEvent) {
  const items = getMenuItems()
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
    return
  }
  let targetIndex: number | undefined
  if (event.key === 'ArrowDown') targetIndex = currentIndex + 1
  else if (event.key === 'ArrowUp') targetIndex = currentIndex < 0 ? items.length - 1 : currentIndex - 1
  else if (event.key === 'Home') targetIndex = 0
  else if (event.key === 'End') targetIndex = items.length - 1
  if (targetIndex === undefined) return
  event.preventDefault()
  focusMenuItem(targetIndex)
}

let unsubscribeSelection: () => void = () => undefined

onMounted(() => {
  const editor = props.session.getEditor()
  unsubscribeSelection = props.session.onSelectionChange(scheduleRefresh)
  editor.on('update', scheduleRefresh)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
  scheduleRefresh()
})

onBeforeUnmount(() => {
  unsubscribeSelection()
  props.session.getEditor().off('update', scheduleRefresh)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})

watch(() => props.container, scheduleRefresh, { immediate: true })
watch(() => props.readonly, scheduleRefresh)
</script>

<template>
  <div ref="root" class="nexusdown-codeblock-language" data-nexusdown="codeblock-language">
    <template v-if="visible && !readonly">
      <button
        ref="trigger"
        class="nexusdown-codeblock-language__trigger"
        :style="triggerStyle"
        type="button"
        aria-label="代码块语言"
        title="代码块语言"
        :aria-expanded="open"
        @mousedown.prevent
        @click="toggle"
      >
        <span class="nexusdown-codeblock-language__value">{{ selectedLabel }}</span>
        <iconify-icon icon="lucide:chevron-down" aria-hidden="true" />
      </button>
    </template>
  </div>
  <Teleport :to="overlayTarget">
    <div
      v-if="open && visible && !readonly"
      ref="menu"
      class="nexusdown-codeblock-language__menu"
      data-nexusdown="codeblock-language-menu"
      :data-nexusdown-skin="skin"
      role="menu"
      aria-label="代码块语言"
      :style="menuStyle"
      @mousedown.stop
      @keydown="onMenuKeydown"
    >
      <button
        v-for="entry in LANGUAGES"
        :key="entry.value"
        type="button"
        role="menuitemradio"
        :aria-label="entry.label"
        :aria-checked="entry.value === currentLanguage"
        :class="{ 'is-active': entry.value === currentLanguage }"
        @mousedown.prevent
        @click="select(entry.value)"
      >
        {{ entry.label }}
      </button>
    </div>
  </Teleport>
</template>
