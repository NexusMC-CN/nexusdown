# 编辑器布局与样式配置设计

## 目标

为 Vue 适配层提供可配置的双栏顺序和样式入口，同时保持核心编辑会话与框架无关。默认布局为“左侧富文本、右侧 Markdown”，调用方可以切换为“左侧 Markdown、右侧富文本”。

## API

`NexusdownEditor` 增加以下配置：

```ts
type EditorLayout = 'rich-left' | 'markdown-left'
type EditorDimension = number | string

layout?: EditorLayout
width?: EditorDimension
height?: EditorDimension
class?: string
style?: string | Record<string, string | number>
theme?: 'light' | 'dark' | 'system'
```

- `layout` 默认值为 `rich-left`，只负责面板顺序，不改变共享工具栏和同步滚动逻辑。
- 数字尺寸按像素处理，字符串尺寸原样交给 CSS，允许 `px`、`%`、`vh`、`calc()` 等表达式。
- `class` 和 `style` 透传到编辑器根节点，便于接入宿主设计系统。
- `theme` 继续提供亮色、暗色和跟随系统三种基线。
- CSS 变量作为稳定的局部换肤接口，至少保留背景、面板、边框、正文、弱化文字和强调色变量。

## 布局与数据流

Vue 组件根据 `layout` 计算两个面板的渲染顺序；富文本和 Markdown 仍共享同一个 `NexusdownEditorSession`。滚动同步按源面板与目标面板的可滚动范围计算比例，因此面板顺序变化不会影响同步行为。

布局、尺寸和样式只属于 Vue 适配层，核心 TypeScript API 不增加浏览器或 Vue 依赖。未来迁移到其他框架时，可以复用 `width`、`height`、`layout` 和 CSS 变量约定。

## 样式边界

组件提供默认结构类名和 CSS 变量，但不锁定宿主的外层布局。调用方可以通过根节点的 `class` / `style` 修改边框、圆角、间距和颜色；内部滚动层仍由组件样式保证，避免长内容改变外框尺寸。

## 错误处理

未知的 `layout` 值回退到 `rich-left`。空的尺寸字符串回退到默认值；数字尺寸至少为 `1px`。样式变量不参与内容解析，不会影响 Markdown 或 Tiptap 文档错误处理。

## 验证范围

- 默认布局渲染为富文本在左、Markdown 在右。
- `layout="markdown-left"` 交换面板顺序后，输入、工具栏、表格控件和滚动同步仍保持正确目标。
- 自定义 `class`、内联 `style`、`width`、`height` 和 CSS 变量可以覆盖默认外观。
- 长内容下外框尺寸保持不变，两个面板内部滚动；`syncScroll="false"` 时两侧互不驱动。
- 运行单元测试、TypeScript/Vue 类型检查、库构建、示例构建和 `npm pack --dry-run`。
