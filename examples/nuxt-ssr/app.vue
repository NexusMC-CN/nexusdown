<script setup lang="ts">
import { computed, ref } from 'vue'
import { NexusdownEditor } from '@nexusmc-cn/nexusdown/editor'
import { renderMarkdown } from '@nexusmc-cn/nexusdown/render'
import '@nexusmc-cn/nexusdown/editor/style.css'

const value = ref('# Nuxt SSR\n\nThis editor is rendered by Nuxt before hydration.\n\n```mermaid\nflowchart LR\n  A[SSR] --> B[Hydration]\n```')
const html = computed(() => renderMarkdown(value.value, { diagramIdPrefix: 'nuxt-preview' }))
</script>

<template>
  <main class="nuxt-ssr-demo">
    <h1>Nexusdown Nuxt SSR</h1>
    <p>The editor is rendered by Nuxt SSR and becomes interactive in the browser.</p>
    <NexusdownEditor
      v-model="value"
      style="--nd-editor-height: 420px"
    />
    <pre aria-label="当前 Markdown 内容">{{ value }}</pre>
    <article aria-label="Markdown 预览" v-html="html" />
  </main>
</template>
