<script setup lang="ts">
import { ref } from 'vue'
import { NexusdownEditor } from 'nexusdown/editor'

const props = defineProps<{
  initialValue: string
  label: string
}>()

const value = ref(props.initialValue)
</script>

<template>
  <section class="demo-editor">
    <div class="demo-editor__heading">
      <div>
        <p class="demo-editor__eyebrow">Astro + Vue</p>
        <h2>{{ label }}</h2>
      </div>
      <output class="demo-editor__status" aria-live="polite">{{ value.length }} characters</output>
    </div>
    <NexusdownEditor
      v-model="value"
      style="--nd-editor-height: 420px"
    />
    <pre class="demo-editor__value" aria-label="当前 Markdown 内容">{{ value }}</pre>
  </section>
</template>
