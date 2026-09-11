# nexusdown

基于 Tiptap 的双视图富文本与 Markdown 编辑器。核心会话保持纯 TypeScript，Vue 3 组件作为独立适配层。

## Vue 用法

```ts
import NexusdownEditor from 'nexusdown/vue'
import 'nexusdown/style.css'
```

在应用中直接使用 `NexusdownEditor`、`v-model` 和 `contentType="markdown"`。组件提供共享工具栏、富文本面板和 Markdown 面板。

## 核心用法

```ts
import { createNexusdownEditor } from 'nexusdown/core'
const editor = createNexusdownEditor({ content: '# Hello', contentType: 'markdown' })
editor.setMarkdown('# Updated')
```

工具栏模型可通过 `createDefaultToolbarItems()` 扩展；发布前运行 `npm run pack:check`。
