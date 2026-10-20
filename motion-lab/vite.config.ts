/**
 * Motion Lab —— 帧级审片工作台（开发用，不进发布产物）。
 *
 * 直接吃 `src/`，和 playground 同一套 alias（理由见 playground/vite.config.ts：
 * Editor.vue 里的 `@nexusmc-cn/nexusdown/cm` 必须指回 src，否则两份 CM6 实例）。
 */
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const src = fileURLToPath(new URL('../src', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^@nexusmc-cn\/nexusdown\/cm$/, replacement: `${src}/cm/index.ts` },
      { find: /^@nexusmc-cn\/nexusdown\/render$/, replacement: `${src}/render/index.ts` },
      { find: /^@nexusmc-cn\/nexusdown\/editor$/, replacement: `${src}/editor/index.js` },
      { find: /^@nexusmc-cn\/nexusdown$/, replacement: `${src}/index.ts` },
    ],
  },
  server: {
    port: 5200,
    strictPort: true,
  },
})
