<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NexusdownEditorSession } from '../../core/session/index.js'
import 'iconify-icon'

const props = defineProps<{
  session: NexusdownEditorSession
  container: HTMLElement | null
  readonly?: boolean
}>()

const visible = ref(false)
const rowStyle = ref<Record<string, string>>({})
const columnStyle = ref<Record<string, string>>({})
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
    return
  }

  const table = findActiveTable()
  if (!table) {
    visible.value = false
    return
  }

  const containerRect = container.getBoundingClientRect()
  const tableRect = table.getBoundingClientRect()
  const maxLeft = Math.max(4, container.clientWidth - 28)
  const maxTop = Math.max(4, container.clientHeight - 28)
  const rowLeft = clamp(tableRect.left - containerRect.left + tableRect.width / 2 - 12, 4, maxLeft)
  const rowTop = Math.max(4, tableRect.bottom - containerRect.top + 4)
  const columnLeft = Math.min(tableRect.right - containerRect.left + 4, Math.max(4, container.clientWidth - 28))
  const columnTop = clamp(tableRect.top - containerRect.top + tableRect.height / 2 - 12, 4, maxTop)

  rowStyle.value = { left: `${rowLeft}px`, top: `${rowTop}px` }
  columnStyle.value = { left: `${columnLeft}px`, top: `${columnTop}px` }
  visible.value = true
}

function scheduleRefresh() {
  void nextTick(refresh)
}

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

let unsubscribeSelection: () => void = () => undefined

onMounted(() => {
  const editor = props.session.getEditor()
  unsubscribeSelection = props.session.onSelectionChange(scheduleRefresh)
  editor.on('update', scheduleRefresh)
  window.addEventListener('resize', scheduleRefresh)
  window.addEventListener('scroll', scheduleRefresh, true)
  scheduleRefresh()
})

onBeforeUnmount(() => {
  unsubscribeSelection()
  props.session.getEditor().off('update', scheduleRefresh)
  window.removeEventListener('resize', scheduleRefresh)
  window.removeEventListener('scroll', scheduleRefresh, true)
})

watch(() => props.container, scheduleRefresh, { immediate: true })
watch(() => props.readonly, scheduleRefresh)
</script>

<template>
  <div ref="root" class="nexusdown-table-controls" data-nexusdown="table-controls">
    <template v-if="visible && !readonly">
      <button
        class="nexusdown-table-controls__button nexusdown-table-controls__button--row"
        :style="rowStyle"
        type="button"
        aria-label="增加一行"
        title="增加一行"
        @mousedown.prevent
        @click="addRow"
      >
        <iconify-icon icon="lucide:plus" aria-hidden="true" />
      </button>
      <button
        class="nexusdown-table-controls__button nexusdown-table-controls__button--column"
        :style="columnStyle"
        type="button"
        aria-label="增加一列"
        title="增加一列"
        @mousedown.prevent
        @click="addColumn"
      >
        <iconify-icon icon="lucide:plus" aria-hidden="true" />
      </button>
    </template>
  </div>
</template>
