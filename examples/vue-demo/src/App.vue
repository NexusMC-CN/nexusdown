<script setup lang="ts">
import { ref } from 'vue'
import { NexusdownEditor, defaultToolbarGroups, type ToolbarConfig } from '@nexusmc-cn/nexusdown/editor'
import '@nexusmc-cn/nexusdown/editor/style.css'
const value = ref('# Getting started\n\nUse the common actions, or open an extension category.\n\n' + 'A longer paragraph demonstrates page scrolling and the bounded sticky toolbar.\n\n'.repeat(25))
const scrollMode = ref<'container' | 'page'>('container')
const sticky = ref(true)
const toolbar: ToolbarConfig = {
  groups: [...defaultToolbarGroups, {
    id: 'templates', label: 'Templates', display: 'dropdown', items: [{
      id: 'insert-checklist', label: 'Insert checklist',
      run({runCommand}) {
        runCommand(view => {
          view.dispatch(view.state.replaceSelection('- [ ] First task\n- [ ] Second task\n'))
          return true
        })
      },
    }],
  }],
}
</script>
<template>
  <main class="demo">
    <h1>Nexusdown</h1>
    <p>Configure categories and custom actions after importing the library.</p>
    <div class="controls">
      <label>Scrolling <select v-model="scrollMode"><option value="container">Inside editor</option><option value="page">With page</option></select></label>
      <label><input v-model="sticky" type="checkbox"> Sticky toolbar</label>
    </div>
    <NexusdownEditor v-model="value" :toolbar="toolbar" :scroll-mode="scrollMode" :sticky-toolbar="sticky" style="--nd-editor-height: 420px" />
  </main>
</template>
<style scoped>
.demo { max-width: 1100px; margin: 40px auto; padding: 0 20px; }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: 20px; margin-bottom: 16px; }
.controls select { margin-left: 8px; }
</style>
