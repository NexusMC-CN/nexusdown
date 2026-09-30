import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
    'render/index': 'src/render/index.ts',
    'vue/index': 'src/vue/index.ts',
    // CodeMirror 6 引擎（「文本为真相」路线）
    'cm/index': 'src/cm/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  clean: true,
  // ⚠️ `@codemirror/*` 和 `@lezer/*` **必须 external** —— 它们是 peerDependencies。
  //    打进产物会造出第二份 `@codemirror/state`，而 CM6 的 facet 按模块标识比较，
  //    两份会让装饰**静默失效**（不报错，就是不渲染）。
  external: ['vue', /^@codemirror\//, /^@lezer\//],
  publicDir: 'public',
});
