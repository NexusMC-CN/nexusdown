/**
 * Motion Lab 入口。
 *
 * ⚠️ **它只 import 两样"生产代码"**：
 * - `src/cm/theme.css` —— 演示的颜色/尺寸令牌（`--nd-*`）都在那里。
 *   审片必须看**真实颜色**，否则"高亮变黄了没有""链接变蓝了没有"根本审不出来。
 * - `src/editor/demos/` —— 通过 `App.vue` 的注册表 import 拿到演示本体
 *   （样式由 `demos.ts` 自己 import，见那个文件的注释）。
 *
 * 不 import `Editor.vue` / CM6 —— 演示是**纯展示**的，审片页不需要编辑器实例。
 */
import { createApp } from 'vue'
import '../src/cm/theme.css'
import './lab.css'
import App from './App.vue'

createApp(App).mount('#app')
