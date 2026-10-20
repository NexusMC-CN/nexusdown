/**
 * Playground —— 直接吃 `src/` 的开发页（不经过 `dist/`）。
 *
 * ## 为什么必须 alias
 *
 * `src/editor/Editor.vue` 里的 `@nexusmc-cn/nexusdown/cm` 是给**消费方**解析的
 * （它按 `package.json#exports` 走 `dist/`）。如果 playground 不 alias，
 * 就会出现「Editor.vue 来自 src、CM6 来自 dist」——正是 Editor.vue 顶部
 * 那段注释警告的「两份 CM6 实例」故障。
 *
 * 所以这里把 `@nexusmc-cn/nexusdown*` 全部指回 `src/`，让整棵依赖树同源，
 * 改 `src/**` 任意文件（含 `.vue` / `.css`）都能 HMR。
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
    port: 5199,
    strictPort: true,
  },
})
