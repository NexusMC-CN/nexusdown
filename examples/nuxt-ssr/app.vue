<script setup lang="ts">
import { ref } from 'vue'
import NexusdownEditor from 'nexusdown/vue'
import 'nexusdown/style.css'

const value = ref('# Nuxt SSR\n\nThis editor is rendered by Nuxt before hydration.')
</script>

<template>
  <main class="nuxt-ssr-demo">
    <h1>Nexusdown Nuxt SSR</h1>
    <p>The editor is rendered by Nuxt SSR and becomes interactive in the browser.</p>
    <NexusdownEditor
      v-model="value"
      content-type="markdown"
      height="420px"
      sync-scroll
    />
    <pre aria-label="当前 Markdown 内容">{{ value }}</pre>
  </main>
</template>
