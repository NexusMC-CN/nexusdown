/**
 * `nexusdown/editor` 的类型。
 *
 * 运行时入口是同目录的 `index.js`（为什么是 `.js` 见那里的注释）。
 * **两个文件要一起改** —— 这里只有两个导出。
 *
 * 类型写得**宽松**是故意的：这两个是 `.vue` SFC，精确推导 props 需要在
 * 这里手抄一遍组件的泛型参数 —— 那又是一处会漂的副本。
 * 想要精确类型就在自己的项目里 `import` 组件（Vue 的 volar 能从 SFC 推出来）。
 */
import type { DefineComponent } from 'vue'

/** 成品编辑器：CM6 宿主 + 工具栏 + 正文排版。 */
export declare const NexusdownEditor: DefineComponent<{ modelValue: string }>

/** 只要工具栏（想自己管编辑器时用）。 */
export declare const NexusdownToolbar: DefineComponent<{ view: unknown }>
