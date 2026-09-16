<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NexusdownEditorSession } from '../../core/session/index.js'
import 'iconify-icon'

const props = defineProps<{
  session: NexusdownEditorSession
  container: HTMLElement | null
  readonly?: boolean
}>()

const visible = ref(false)
const menuOpen = ref(false)
const rowStyle = ref<Record<string, string>>({})
const columnStyle = ref<Record<string, string>>({})
const menuButtonStyle = ref<Record<string, string>>({})
const menuStyle = ref<Record<string, string>>({})
const root = ref<HTMLElement | null>(null)

function getContainer(): HTMLElement | null {
  return props.container ?? root.value?.parentElement ?? null
}

function findActiveTable(): HTMLTableElement | null {
  const editor = props.session.getEditor()
  const { $from } = editor.state.selection

  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'table') continue
    const dom = editor.view.nodeDOM($from.before(depth))
    if (!(dom instanceof HTMLElement)) return null
    return dom instanceof HTMLTableElement ? dom : dom.closest('table') ?? dom.querySelector('table')
  }

  return null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function refresh() {
  const container = getContainer()
  if (props.readonly || !container) {
    visible.value = false
    menuOpen.value = false
    return
  }

  const table = findActiveTable()
  if (!table) {
    visible.value = false
    menuOpen.value = false
    return
  }

  const containerRect = container.getBoundingClientRect()
  const tableRect = table.getBoundingClientRect()
  const maxLeft = Math.max(4, container.clientWidth - 64)
  const maxTop = Math.max(4, container.clientHeight - 28)
  const rowLeft = clamp(tableRect.left - containerRect.left + tableRect.width / 2 - 26, 4, maxLeft)
  const rowTop = Math.max(4, tableRect.bottom - containerRect.top + 4)
  const columnLeft = Math.min(tableRect.right - containerRect.left + 4, Math.max(4, container.clientWidth - 28))
  const columnTop = clamp(tableRect.top - containerRect.top + tableRect.height / 2 - 14, 4, maxTop)
  const menuButtonTop = Math.max(4, tableRect.top - containerRect.top - 10)
  const menuButtonLeft = clamp(tableRect.right - containerRect.left - 14, 4, maxLeft)

  rowStyle.value = { left: `${rowLeft}px`, top: `${rowTop}px` }
  columnStyle.value = { left: `${columnLeft}px`, top: `${columnTop}px` }
  menuButtonStyle.value = { left: `${menuButtonLeft}px`, top: `${menuButtonTop}px` }
  menuStyle.value = {
    left: `${clamp(menuButtonLeft, 4, Math.max(4, container.clientWidth - 148))}px`,
    top: `${Math.max(4, menuButtonTop + 24)}px`,
  }
  visible.value = true
}

function scheduleRefresh() {
  void nextTick(refresh)
}

function can(command: 'deleteRow' | 'deleteColumn' | 'deleteTable' | 'mergeCells' | 'splitCell'): boolean {
  if (props.readonly || !visible.value) return false
  const editor = props.session.getEditor()
  return editor.can().chain().focus()[command]().run()
}

const canDeleteRow = computed(() => can('deleteRow'))
const canDeleteColumn = computed(() => can('deleteColumn'))
const canDeleteTable = computed(() => can('deleteTable'))
const canMergeCells = computed(() => can('mergeCells'))
const canSplitCell = computed(() => can('splitCell'))

function addRow() {
  if (props.readonly) return
  props.session.commands.addTableRow()
  scheduleRefresh()
}

function addColumn() {
  if (props.readonly) return
  props.session.commands.addTableColumn()
  scheduleRefresh()
}

function deleteRow() {
  if (props.readonly) return
  props.session.commands.deleteTableRow()
  scheduleRefresh()
}

function deleteColumn() {
  if (props.readonly) return
  props.session.commands.deleteTableColumn()
  scheduleRefresh()
}

function closeMenu() {
  menuOpen.value = false
}

function deleteTable() {
  if (props.readonly) return
  closeMenu()
  props.session.commands.deleteTable()
  scheduleRefresh()
}

function mergeCells() {
  if (props.readonly) return
  closeMenu()
  props.session.commands.mergeCells()
  scheduleRefresh()
}

function splitCell() {
  if (props.readonly) return
  closeMenu()
  props.session.commands.splitCell()
  scheduleRefresh()
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!menuOpen.value) return
  if (target && root.value?.contains(target)) return
  closeMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

let unsubscribeSelection: () => void = () => undefined

onMounted(() => {
  const editor = props.session.getEditor()
  unsubscribeSelection = props.session.onSelectionChange(scheduleRefresh)
  editor.on('update', scheduleRefresh)
  window.addEventListener('resize', scheduleRefresh)
  window.addEventListener('scroll', scheduleRefresh, true)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
  scheduleRefresh()
})

onBeforeUnmount(() => {
  unsubscribeSelection()
  props.session.getEditor().off('update', scheduleRefresh)
  window.removeEventListener('resize', scheduleRefresh)
  window.removeEventListener('scroll', scheduleRefresh, true)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})

watch(() => props.container, scheduleRefresh, { immediate: true })
watch(() => props.readonly, scheduleRefresh)
</script>

<template>
  <div ref="root" class="nexusdown-table-controls" data-nexusdown="table-controls">
    <template v-if="visible && !readonly">
      <div class="nexusdown-table-controls__group nexusdown-table-controls__group--row" :style="rowStyle">
        <button
          class="nexusdown-table-controls__button"
          type="button"
          aria-label="增加一行"
          title="增加一行"
          @mousedown.prevent
          @click="addRow"
        >
          <iconify-icon icon="lucide:plus" aria-hidden="true" />
        </button>
        <button
          class="nexusdown-table-controls__button"
          type="button"
          aria-label="删除一行"
          title="删除一行"
          :disabled="!canDeleteRow"
          @mousedown.prevent
          @click="deleteRow"
        >
          <iconify-icon icon="lucide:minus" aria-hidden="true" />
        </button>
      </div>
      <div class="nexusdown-table-controls__group nexusdown-table-controls__group--column" :style="columnStyle">
        <button
          class="nexusdown-table-controls__button"
          type="button"
          aria-label="增加一列"
          title="增加一列"
          @mousedown.prevent
          @click="addColumn"
        >
          <iconify-icon icon="lucide:plus" aria-hidden="true" />
        </button>
        <button
          class="nexusdown-table-controls__button"
          type="button"
          aria-label="删除一列"
          title="删除一列"
          :disabled="!canDeleteColumn"
          @mousedown.prevent
          @click="deleteColumn"
        >
          <iconify-icon icon="lucide:minus" aria-hidden="true" />
        </button>
      </div>
      <button
        class="nexusdown-table-controls__button nexusdown-table-controls__button--menu"
        :style="menuButtonStyle"
        type="button"
        aria-label="表格操作"
        title="表格操作"
        @mousedown.prevent
        @click="menuOpen = !menuOpen"
      >
        <iconify-icon icon="lucide:more-horizontal" aria-hidden="true" />
      </button>
      <div v-if="menuOpen" class="nexusdown-table-controls__menu" data-nexusdown="table-menu" :style="menuStyle">
        <button type="button" aria-label="删除表格" :disabled="!canDeleteTable" @click="deleteTable">删除表格</button>
        <button type="button" aria-label="合并单元格" :disabled="!canMergeCells" @click="mergeCells">合并单元格</button>
        <button type="button" aria-label="拆分单元格" :disabled="!canSplitCell" @click="splitCell">拆分单元格</button>
      </div>
    </template>
  </div>
</template>