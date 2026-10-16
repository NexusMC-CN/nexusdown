<script setup lang="ts">
import { ref } from 'vue'
import { NexusdownEditor } from '@nexusmc-cn/nexusdown/editor'
import '@nexusmc-cn/nexusdown/editor/style.css'

const value = ref('# Nuxt SSR\n\nThis editor is rendered by Nuxt before hydration.')
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
  </main>
</template>
