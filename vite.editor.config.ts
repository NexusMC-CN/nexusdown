/**
 * 把 `nexusdown/editor`（Vue SFC）**构建成 JS**。
 *
 * ## ★ 为什么必须构建，不能发原始 `.vue`
 *
 * 发原始源码时，消费方的打包器要**逐个解析**它的 import ✗ ——
 * 而 `@codemirror/*` 有一堆互相依赖的包 ✗，打包器很容易**只优化其中几个** ✗
 * （实测：Nuxt 下只有 `@codemirror/language` 被预构建 ✗，
 *   而预构建会把它依赖的 `@codemirror/state` **内联**进去 ✗
 *   → 于是 `markdownLanguage` 带来的 Facet 来自"预构建那份 state" ✗，
 *     而 `EditorState.create` 用的是"原始那份" ✗
 *   → CM6 的 facet / StateField 按模块标识比较 → `instanceof` 对不上 ✗
 *   → `Unrecognized extension value in extension set ([object Object])`）。
 *
 * 构建成 JS 之后：`@codemirror/*` 在产物里是 **external** ✓
 * → 消费方的打包器**统一**处理它们 ✓（要么全预构建、要么全不 ✓）
 * → 不可能出现"一半一半" ✓。
 *
 * 顺带：消费方**不再需要 `build.transpile: ['nexusdown']`** ✓
 * （那是"要转译 node_modules 里的源码"才需要的 ✓）。
 *
 * ⚠️ `nexusdown/cm` 也要 **external** —— 它是本包自己的另一个入口 ✓，
 * 由消费方通过 `exports` 解析 ✓（这样 `mountEditor` 和消费方拿到的是**同一份** ✓）。
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist/editor',
    emptyOutDir: true,
    lib: {
      entry: 'src/editor/index.js',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      /*
       * 全部 external —— 一个都不打进产物。
       *
       * `vue` / `@codemirror/*` / `@lezer/*` 是 peer（由消费方提供 ✓）；
       * `nexusdown/cm` 是本包自己的入口（自引用 ✓）。
       */
      external: [
        'vue',
        /^@codemirror\//,
        /^@lezer\//,
        'nexusdown/cm',
      ],
    },
  },
})
