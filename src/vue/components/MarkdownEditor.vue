<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import hljs from 'highlight.js/lib/core'
import markdown from 'highlight.js/lib/languages/markdown'

// Registering the same grammar twice is a no-op in highlight.js, so this runs
// unconditionally at module scope. (A previous `if (!flag)` guard was dead code:
// the flag was reassigned to false immediately before being tested.)
hljs.registerLanguage('markdown', markdown)

const props = withDefaults(defineProps<{
  modelValue?: string
  readonly?: boolean
  ariaLabel?: string
}>(), { modelValue: '', readonly: false, ariaLabel: 'Markdown 编辑器' })

const emit = defineEmits<{
  'update:modelValue': [value: string]
  compositionstart: []
  compositionend: [value: string]
  scroll: [payload: { top: number; left: number }]
  /** Selection range within the Markdown source, or `null` when collapsed. */
  'selection-change': [payload: { from: number; to: number; text: string } | null]
}>()
const textarea = ref<HTMLTextAreaElement | null>(null)
const highlight = ref<HTMLElement | null>(null)
const highlightedMarkdown = ref('')
const composing = ref(false)

function highlightSegment(value: string) {
  return value ? hljs.highlight(value, { language: 'markdown' }).value : ''
}

function sanitizeColor(value: string) {
  const color = value.trim()
  if (/^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]*\)|[a-z]+)$/i.test(color)) return color
  return 'currentColor'
}

function renderMarkdown(value: string) {
  const colorMarkup = /<span\s+style\s*=\s*(["'])\s*color\s*:\s*([^"']+)\1\s*>[\s\S]*?<\/span>|\[color\s+color\s*=\s*("|')([^"']+)\3\][\s\S]*?\[\/color\]/gi
  let cursor = 0
  let output = ''
  let match: RegExpExecArray | null

  while ((match = colorMarkup.exec(value))) {
    output += highlightSegment(value.slice(cursor, match.index))
    const source = match[0]
    const isHtml = match[2] !== undefined
    const openingEnd = isHtml ? source.indexOf('>') + 1 : source.indexOf(']') + 1
    // The regex match ends at the ASCII closing tag. Keep offsets in the
    // original source: Unicode lowercasing can expand a character such as İ.
    const closingStart = source.length - (isHtml ? '</span>'.length : '[/color]'.length)
    const opening = source.slice(0, openingEnd)
    const inner = source.slice(openingEnd, closingStart)
    const closing = source.slice(closingStart)
    // The regex requires one color capture in either its HTML or shortcode arm.
    const color = (match[2] ?? match[4])!
    output += highlightSegment(opening)
    output += `<span data-nexusdown="markdown-color" style="color: ${sanitizeColor(color)}">${highlightSegment(inner)}</span>`
    output += highlightSegment(closing)
    cursor = match.index + source.length
  }

  highlightedMarkdown.value = output + highlightSegment(value.slice(cursor))
  void nextTick(syncScroll)
}

function syncScroll() {
  if (!textarea.value || !highlight.value) return
  const pre = highlight.value.parentElement
  if (!pre) return
  pre.scrollTop = textarea.value.scrollTop
  pre.scrollLeft = textarea.value.scrollLeft
}

function getScrollElement() {
  return textarea.value
}

function setScrollTop(value: number) {
  if (!textarea.value) return
  textarea.value.scrollTop = value
  syncScroll()
}

defineExpose({ getScrollElement, setScrollTop, getSelection, syncValueFromProp })

function onInput(event: Event) {
  if ((event as InputEvent).isComposing && !composing.value) onCompositionStart()
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

/**
 * Publish the textarea's selection so the shared toolbar can act on it.
 *
 * Without this the toolbar kept reading the rich-text selection, so choosing a
 * formatting command after selecting Markdown text silently modified whatever
 * the rich pane had selected instead.
 */
function onSelectionChange() {
  const element = textarea.value
  if (!element) {
    emit('selection-change', null)
    return
  }
  const { selectionStart, selectionEnd, value } = element
  if (selectionStart === selectionEnd) {
    emit('selection-change', null)
    return
  }
  emit('selection-change', {
    from: selectionStart,
    to: selectionEnd,
    text: value.slice(selectionStart, selectionEnd),
  })
}

/** Selection range currently active in the textarea, or `null` when collapsed. */
function getSelection() {
  const element = textarea.value
  if (!element || element.selectionStart === element.selectionEnd) return null
  return {
    from: element.selectionStart,
    to: element.selectionEnd,
    text: element.value.slice(element.selectionStart, element.selectionEnd),
  }
}

function onCompositionStart() {
  composing.value = true
  emit('compositionstart')
}

function onCompositionEnd(event: CompositionEvent) {
  composing.value = false
  emit('compositionend', (event.target as HTMLTextAreaElement).value)
}

function onScroll() {
  syncScroll()
  if (textarea.value) emit('scroll', { top: textarea.value.scrollTop, left: textarea.value.scrollLeft })
}

watch(() => props.modelValue, renderMarkdown, { immediate: true })

/**
 * Force the DOM value back in line with `modelValue`.
 *
 * Vue skips the DOM patch when the bound value is unchanged, so restoring the
 * prop after a rejected edit would otherwise leave the refused draft on screen.
 * Exposed for the parent to call once it has rejected an edit.
 */
function syncValueFromProp() {
  if (textarea.value && textarea.value.value !== props.modelValue) {
    textarea.value.value = props.modelValue
  }
  renderMarkdown(props.modelValue)
}

onMounted(syncScroll)
</script>

<template>
  <div class="nexusdown-markdown-editor" data-nexusdown="markdown-editor">
    <pre ref="highlight" class="nexusdown-markdown-highlight" data-nexusdown="markdown-highlight" aria-hidden="true"><code class="hljs" v-html="highlightedMarkdown" /></pre>
    <textarea
      ref="textarea"
      data-nexusdown="markdown"
      class="nexusdown-markdown-input"
      :value="props.modelValue"
      :readonly="props.readonly"
      spellcheck="false"
      :aria-label="props.ariaLabel"
      @input="onInput"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @scroll="onScroll"
      @select="onSelectionChange"
      @keyup="onSelectionChange"
      @mouseup="onSelectionChange"
      @focus="onSelectionChange"
      @blur="emit('selection-change', null)"
    />
  </div>
</template>
