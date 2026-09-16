<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { NexusdownEditorSession } from '../../core/session/index.js'

const props = defineProps<{
  session: NexusdownEditorSession
}>()

const characters = ref(0)
const charactersNoSpaces = ref(0)
const lines = ref(0)

function refresh() {
  const editor = props.session.getEditor()
  const storage = editor.storage.characterCount as
    | { characters: () => number }
    | undefined
  characters.value = storage?.characters?.() ?? 0
  charactersNoSpaces.value = editor.state.doc.textContent.replace(/\s/g, '').length

  let textBlockLines = 0
  editor.state.doc.descendants((node) => {
    if (!node.isTextblock) return true
    let blockLines = 1
    node.descendants((child) => {
      if (child.type.name === 'hardBreak') blockLines++
      if (child.isText && child.text) blockLines += child.text.split('\n').length - 1
    })
    textBlockLines += blockLines
    return false
  })
  lines.value = Math.max(1, textBlockLines)
}

let unsubscribe: () => void = () => undefined
let unsubscribeSelection: () => void = () => undefined

onMounted(() => {
  const editor = props.session.getEditor()
  refresh()
  unsubscribe = props.session.subscribe(refresh)
  unsubscribeSelection = props.session.onSelectionChange(refresh)
  editor.on('update', refresh)
})

onBeforeUnmount(() => {
  unsubscribe()
  unsubscribeSelection()
  props.session.getEditor().off('update', refresh)
})
</script>

<template>
  <div class="nexusdown-status-bar" data-nexusdown="status-bar" aria-live="polite">
    <span class="nexusdown-status-bar__item" data-nexusdown="characters">字符 {{ characters }}</span>
    <span class="nexusdown-status-bar__item nexusdown-status-bar__item--no-space" data-nexusdown="characters-no-spaces">
      不含空格 {{ charactersNoSpaces }}
    </span>
    <span class="nexusdown-status-bar__item" data-nexusdown="lines">行 {{ lines }}</span>
  </div>
</template>
