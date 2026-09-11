<script setup lang="ts">
import { ref } from 'vue'
import NexusdownEditor from '../../../src/vue/NexusdownEditor.vue'
const value = ref('# Getting started\n\nWrite in either pane.')
</script>
<template><main style="max-width:1100px;margin:40px auto;padding:0 20px"><h1>nexusdown</h1><NexusdownEditor v-model="value" /></main></template>
