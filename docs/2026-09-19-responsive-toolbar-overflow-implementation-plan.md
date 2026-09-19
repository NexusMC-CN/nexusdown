# 响应式工具栏动态收纳实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让共享工具栏根据编辑器容器的真实宽度把不可见工具动态收进一个始终可访问的“更多”菜单。

**架构：** 主轨道继续挂载全部工具并测量真实 DOM 边界，超出可用右边界的工具在主栏中隐藏，同时由一个 Teleport 顶层菜单渲染可操作副本。工具渲染抽成单一组件，保证主栏和菜单共用命令、状态与复合弹窗逻辑；测量逻辑独立为 composable，使用 `ResizeObserver` 并提供 resize 回退。

**技术栈：** Vue 3、Tiptap 3、TypeScript、Vue Test Utils、Vitest、Iconify、CSS

**执行约束：** 当前 `main` 工作区包含用户未提交修改。本计划不执行 commit、push、reset、checkout 或清理；每个任务以目标测试和 `git diff --check` 作为检查点。

---

## 文件结构

- 创建 `src/vue/toolbar-controls.ts`：把 `ToolbarItem[]` 转成包含查找与粘贴模式的稳定渲染序列。
- 创建 `src/vue/composables/useToolbarOverflow.ts`：监听容器和控件尺寸，计算收纳 key。
- 创建 `src/vue/components/ToolbarControl.vue`：统一渲染主栏和菜单中的普通工具与复合工具。
- 创建 `src/vue/components/ToolbarOverflowMenu.vue`：实现“更多”按钮、Teleport 菜单、定位与键盘焦点。
- 修改 `src/vue/EditorToolbar.vue`：编排控件序列、主轨道、收纳集合和菜单命令。
- 修改 `src/vue/HeadingPicker.vue`：支持菜单模式下显示文字标签，并标记统一浮层根。
- 修改 `src/vue/LinkPicker.vue`：支持菜单模式下显示文字标签，并标记统一浮层根。
- 修改 `src/vue/components/ColorPicker.vue`：支持菜单模式下显示文字标签。
- 修改 `src/vue/components/ImagePicker.vue`：支持菜单模式下显示文字标签，并标记统一浮层根。
- 修改 `src/vue/overlay-target.ts`：增加浮层链目标判断，防止二级浮层被父菜单提前关闭。
- 修改 `src/style.css` 与 `public/style.css`：添加单行轨道、固定更多区、菜单和触屏响应样式。
- 修改 `tests/vue/NexusdownEditor.test.ts`：增加真实编辑器的宽窄切换与菜单命令回归测试。
- 创建 `tests/vue/toolbar-overflow.test.ts`：覆盖纯计算、ResizeObserver、键盘和复合浮层边界。
- 修改 `README.md`：说明工具栏会按容器宽度自动收纳。

### 任务 1：真实宽度测量与收纳状态

**文件：**
- 创建：`src/vue/composables/useToolbarOverflow.ts`
- 创建：`tests/vue/toolbar-overflow.test.ts`

- [x] **步骤 1：为纯收纳计算编写失败测试**

在 `tests/vue/toolbar-overflow.test.ts` 中先定义三类边界：全部放得下、尾部超出更多按钮左边界、极窄宽度下全部进入菜单。

```ts
import { describe, expect, it } from 'vitest'
import { calculateOverflowedKeys } from '../../src/vue/composables/useToolbarOverflow'

describe('calculateOverflowedKeys', () => {
  const controls = [
    { key: 'undo', right: 42 },
    { key: 'redo', right: 76 },
    { key: 'heading', right: 122 },
    { key: 'bold', right: 156 },
  ]

  it('returns no items when the complete track fits', () => {
    expect([...calculateOverflowedKeys(controls, 180, 140)]).toEqual([])
  })

  it('moves the tail behind the fixed more slot when the track overflows', () => {
    expect([...calculateOverflowedKeys(controls, 150, 108)]).toEqual(['heading', 'bold'])
  })

  it('keeps every command reachable at an extremely narrow width', () => {
    expect([...calculateOverflowedKeys(controls, 20, 0)]).toEqual(['undo', 'redo', 'heading', 'bold'])
  })
})
```

- [x] **步骤 2：运行纯计算测试并确认正确失败**

运行：

```powershell
npm test -- tests/vue/toolbar-overflow.test.ts
```

预期：FAIL，模块 `useToolbarOverflow` 尚不存在。

- [x] **步骤 3：实现纯函数和 composable 骨架**

创建 `src/vue/composables/useToolbarOverflow.ts`，导出精确类型和纯函数：

```ts
import { nextTick, onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue'

export interface ToolbarControlMeasurement {
  key: string
  right: number
}

export function calculateOverflowedKeys(
  controls: ToolbarControlMeasurement[],
  fullRight: number,
  moreLeft: number,
): Set<string> {
  if (controls.every(({ right }) => right <= fullRight)) return new Set()
  return new Set(controls.filter(({ right }) => right > moreLeft).map(({ key }) => key))
}

export interface ToolbarOverflowOptions {
  toolbar: Ref<HTMLElement | null>
  moreSlot: Ref<HTMLElement | null>
  controlKeys: Ref<string[]>
}

export function useToolbarOverflow(options: ToolbarOverflowOptions) {
  const overflowedKeys = ref<Set<string>>(new Set())
  const ready = ref(false)
  // Step 6 replaces this temporary no-op with the measured browser implementation.
  return { overflowedKeys: readonly(overflowedKeys), ready: readonly(ready), refresh: () => undefined }
}
```

- [x] **步骤 4：运行纯计算测试并确认通过**

运行：`npm test -- tests/vue/toolbar-overflow.test.ts`

预期：3 个纯函数测试 PASS。

- [x] **步骤 5：为 DOM 测量、ResizeObserver 和清理编写失败测试**

在同一测试文件挂载一个最小 harness，提供 `toolbar`、绝对定位的 `moreSlot` 和带 `data-nexusdown-toolbar-key` 的控件。用可控的 `getBoundingClientRect()` 与 `ResizeObserver` stub 断言：

```ts
expect([...vm.overflowedKeys]).toEqual(['heading', 'bold'])
widths.bold.right = 96
resizeCallback?.([], resizeObserver)
await nextTick()
expect([...vm.overflowedKeys]).toEqual([])
wrapper.unmount()
expect(disconnect).toHaveBeenCalledOnce()
```

另加回退测试：删除 `globalThis.ResizeObserver` 后触发 `window.resize`，结果仍会刷新；卸载后监听器被移除。

- [x] **步骤 6：实现浏览器安全的测量与监听**

在 composable 中：

```ts
let observer: ResizeObserver | undefined
let frame = 0

function measure() {
  const toolbar = options.toolbar.value
  const slot = options.moreSlot.value
  if (!toolbar || !slot) return
  const toolbarRect = toolbar.getBoundingClientRect()
  const slotRect = slot.getBoundingClientRect()
  const allowed = new Set(options.controlKeys.value)
  const measurements = Array.from(
    toolbar.querySelectorAll<HTMLElement>('[data-nexusdown-toolbar-key]'),
  ).flatMap((element) => {
    const key = element.dataset.nexusdownToolbarKey
    return key && allowed.has(key) ? [{ key, right: element.getBoundingClientRect().right }] : []
  })
  overflowedKeys.value = calculateOverflowedKeys(measurements, toolbarRect.right, slotRect.left)
  ready.value = true
}

function refresh() {
  void nextTick(() => {
    if (typeof requestAnimationFrame === 'undefined') return measure()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
  })
}
```

只在 `onMounted` 中读取 `window`、`ResizeObserver` 与 `requestAnimationFrame`。优先观察 toolbar；没有 `ResizeObserver` 时注册 `window.resize`。`onBeforeUnmount` 必须断开 observer、移除回退监听并取消待执行帧。

不要在模块加载或 setup 同步阶段访问浏览器全局，保持现有 SSR 测试成立。

- [x] **步骤 7：运行任务 1 测试与类型检查**

运行：

```powershell
npm test -- tests/vue/toolbar-overflow.test.ts tests/core/ssr-safety.test.ts
npm run typecheck
git diff --check -- src/vue/composables/useToolbarOverflow.ts tests/vue/toolbar-overflow.test.ts
```

预期：目标测试全部 PASS，TypeScript 和 diff 检查退出码为 0。

### 任务 2：统一工具控件渲染

**文件：**
- 创建：`src/vue/toolbar-controls.ts`
- 创建：`src/vue/components/ToolbarControl.vue`
- 修改：`src/vue/EditorToolbar.vue`
- 修改：`src/vue/HeadingPicker.vue`
- 修改：`src/vue/LinkPicker.vue`
- 修改：`src/vue/components/ColorPicker.vue`
- 修改：`src/vue/components/ImagePicker.vue`
- 测试：`tests/vue/toolbar-overflow.test.ts`
- 测试：`tests/vue/toolbar-heading-group.test.ts`

- [x] **步骤 1：为稳定控件序列编写失败测试**

测试自定义分组不丢失，并确认查找与粘贴模式稳定地位于 history 后、普通工具之前：

```ts
import { createToolbarControls } from '../../src/vue/toolbar-controls'

const controls = createToolbarControls(createDefaultToolbarItems())
expect(controls.map(({ key }) => key).slice(0, 5)).toEqual([
  'item:undo',
  'item:redo',
  'builtin:find',
  'builtin:paste-mode',
  'item:heading',
])

const custom = { id: 'badge', group: 'custom', icon: 'lucide:badge', label: '徽章', execute: vi.fn() }
expect(createToolbarControls([custom]).at(-1)).toMatchObject({ key: 'item:badge', group: 'custom' })
```

- [x] **步骤 2：运行序列测试并确认失败**

运行：`npm test -- tests/vue/toolbar-overflow.test.ts`

预期：FAIL，`toolbar-controls.ts` 尚不存在。

- [x] **步骤 3：实现 descriptor 类型与顺序函数**

创建 `src/vue/toolbar-controls.ts`：

```ts
import type { ToolbarGroup, ToolbarItem } from '../core/toolbar.js'

export type ToolbarControl =
  | { key: `item:${string}`; kind: 'item'; group: ToolbarGroup; label: string; icon: string; item: ToolbarItem }
  | { key: 'builtin:find'; kind: 'find'; group: 'utility'; label: '查找替换'; icon: 'lucide:search' }
  | { key: 'builtin:paste-mode'; kind: 'paste-mode'; group: 'utility'; label: '粘贴模式'; icon: string }

const GROUP_ORDER: ToolbarGroup[] = ['history', 'block', 'inline', 'extension', 'align', 'indent']

export function createToolbarControls(items: ToolbarItem[]): ToolbarControl[] {
  const declared = items.map((item) => item.group)
  const groups = [
    ...GROUP_ORDER.filter((group) => declared.includes(group)),
    ...declared.filter((group, index) => !GROUP_ORDER.includes(group) && declared.indexOf(group) === index),
  ]
  const result: ToolbarControl[] = []
  const utility: ToolbarControl[] = [
    { key: 'builtin:find', kind: 'find', group: 'utility', label: '查找替换', icon: 'lucide:search' },
    { key: 'builtin:paste-mode', kind: 'paste-mode', group: 'utility', label: '粘贴模式', icon: 'lucide:clipboard-type' },
  ]
  if (!groups.includes('history')) result.push(...utility)
  for (const group of groups) {
    result.push(...items.filter((item) => item.group === group).map((item) => ({
      key: `item:${item.id}` as const,
      kind: 'item' as const,
      group,
      label: item.label,
      icon: item.icon,
      item,
    })))
    if (group === 'history') result.push(...utility)
  }
  return result
}
```

当 items 没有 history 组时，仍在序列开头插入 utility 两项，避免自定义工具栏意外失去查找与粘贴模式。

- [x] **步骤 4：为 compact/overflow 两种控件表现编写失败测试**

直接挂载 `ToolbarControl.vue`，覆盖：

- 普通命令在 compact 模式只有图标，在 overflow 模式出现文字标签。
- `heading`、`link`、`image`、`color` 和 `highlight` 的 overflow 模式都出现对应文字。
- active、disabled、readonly 与原工具栏一致。
- 普通命令、查找、粘贴模式、标题、链接和图片 emit 正确事件。

```ts
expect(wrapper.get('button[aria-label="粗体"]').text()).toContain('粗体')
await wrapper.get('button[aria-label="粗体"]').trigger('click')
expect(wrapper.emitted('execute')?.[0]?.[0]).toBe(item)
```

- [x] **步骤 5：抽出 `ToolbarControl.vue` 并给复合组件增加标签模式**

`ToolbarControl.vue` 接收：

```ts
const props = defineProps<{
  control: ToolbarControl
  context: ToolbarContext
  display: 'compact' | 'overflow'
  pasteMode: PasteMode
  activeHeadingLevel?: number
  linkSelectedText?: string
  linkHref?: string
  readonly?: boolean
  insertImageFile?: (file: File) => Promise<boolean>
  concealed?: boolean
}>()
```

并发出：

```ts
const emit = defineEmits<{
  execute: [item: ToolbarItem]
  find: []
  togglePasteMode: []
  selectHeading: [level: number]
  applyLink: [payload: { href: string; text: string }]
  applyImage: [payload: { src: string; alt: string }]
}>()
```

普通按钮在 `display === 'overflow'` 时加入：

```vue
<span v-if="display === 'overflow'" class="nexusdown-toolbar-control__label">
  {{ control.label }}
</span>
```

给 `HeadingPicker`、`LinkPicker`、`ColorPicker` 和 `ImagePicker` 增加默认值为 `false` 的 `showLabel?: boolean` prop，在其现有触发按钮中显示同一标签。主工具栏不传该 prop，保持现有紧凑外观。

`concealed` 为 true 时把复合控件视为禁用，并让 `HeadingPicker`、`LinkPicker` 和 `ImagePicker` 监听 disabled/readonly 后关闭已打开的浮层。这样旋转屏幕或缩窄容器时，刚进入收纳区的主栏按钮不会留下悬空二级菜单。

- [x] **步骤 6：让 `EditorToolbar` 先使用统一控件，但暂不启用收纳**

把现有分散模板改为 `createToolbarControls(items)` + `ToolbarControl` 循环，所有事件仍转发到现有 `execute`、`executeHeading`、`executeLink`、`executeImage`、`emit('find')` 和 `togglePasteMode`。

每个控件包装为：

```vue
<div
  class="nexusdown-toolbar__control"
  :data-nexusdown-toolbar-key="control.key"
>
  <ToolbarControl
    :control="control"
    :context="context"
    display="compact"
    :paste-mode="pasteMode"
    :readonly="readonly"
    @execute="execute"
    @find="emit('find')"
    @toggle-paste-mode="togglePasteMode"
    @select-heading="executeHeading"
    @apply-link="executeLink"
    @apply-image="executeImage"
  />
</div>
```

按 control.group 重新生成分隔线，确保自定义分组测试继续通过。

- [x] **步骤 7：运行现有工具栏回归与任务 2 新测试**

运行：

```powershell
npm test -- tests/vue/toolbar-overflow.test.ts tests/vue/toolbar-heading-group.test.ts tests/vue/NexusdownEditor.test.ts
npm exec -- vue-tsc --noEmit
git diff --check -- src/vue/toolbar-controls.ts src/vue/components/ToolbarControl.vue src/vue/EditorToolbar.vue src/vue/HeadingPicker.vue src/vue/LinkPicker.vue src/vue/components/ColorPicker.vue src/vue/components/ImagePicker.vue tests/vue
```

预期：目标测试全部 PASS，现有工具命令行为没有变化。

### 任务 3：顶层“更多”菜单、样式与完整验收

**文件：**
- 创建：`src/vue/components/ToolbarOverflowMenu.vue`
- 修改：`src/vue/EditorToolbar.vue`
- 修改：`src/vue/overlay-target.ts`
- 修改：`src/style.css`
- 修改：`public/style.css`
- 修改：`tests/vue/toolbar-overflow.test.ts`
- 修改：`tests/vue/NexusdownEditor.test.ts`
- 修改：`README.md`

- [x] **步骤 1：编写真实编辑器收纳失败测试**

在 `tests/vue/NexusdownEditor.test.ts` 挂载真实编辑器，并 mock 工具栏、更多插槽与控件边界。触发 ResizeObserver 后断言：

```ts
expect(wrapper.find('[data-nexusdown="toolbar-more-trigger"]').exists()).toBe(true)
expect(wrapper.get('[data-nexusdown-toolbar-key="item:image"]').attributes('data-overflowed')).toBe('true')
expect(wrapper.get('[data-nexusdown-toolbar-key="item:bold"]').attributes('data-overflowed')).toBeUndefined()

await wrapper.get('[data-nexusdown="toolbar-more-trigger"]').trigger('click')
const menu = document.body.querySelector('[data-nexusdown="toolbar-overflow-menu"]')
expect(menu?.closest('.nexusdown-editor')).toBeNull()
expect(menu?.querySelector('button[aria-label="图片"]')).not.toBeNull()
```

再把容器改宽并触发 observer，断言菜单关闭、收纳属性清除、更多按钮消失且工具栏高度不变。

- [x] **步骤 2：编写菜单命令、键盘和浮层链失败测试**

在 `tests/vue/toolbar-overflow.test.ts` 覆盖：

- 点击收纳的普通命令会执行并关闭菜单。
- 打开时聚焦第一个可用项，方向键、Home、End 和 Escape 正确。
- Escape 后焦点回到更多按钮。
- 打开收纳的链接或图片二级浮层后，点击其 Teleport 内容不会关闭父菜单。
- 菜单在原生模态 `dialog` 中选择正确 Teleport 目标。
- theme/skin 变量同步到菜单。

预期这些测试因组件尚不存在而 FAIL。

- [x] **步骤 3：增加统一浮层链标记与判断**

在 `src/vue/overlay-target.ts` 增加：

```ts
export function isNexusdownOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-nexusdown-overlay-root]') !== null
}
```

给标题、链接、图片菜单以及新的更多菜单根节点增加 `data-nexusdown-overlay-root`。父菜单的外部点击判断先检查自己的 trigger/menu，再检查 `isNexusdownOverlayTarget(event.target)`，让二级浮层保持可用。

- [x] **步骤 4：实现 `ToolbarOverflowMenu.vue`**

组件复用现有浮层基础设施：

```ts
const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const overlayTarget = shallowRef<string | Element>('body')
const { viewport } = useNexusdownViewport(() => {
  if (open.value) updatePosition()
})
const { skin } = useNexusdownOverlayTheme(trigger, open, updatePosition)
```

每次打开前重新调用 `resolveOverlayTarget(trigger.value)`。定位时使用触发按钮边界、8px 视口边距、6px 间隔和菜单实测高度；下方不足且上方空间更多时向上翻转。

模板使用固定的触发插槽和菜单内容插槽：

```vue
<div ref="slot" class="nexusdown-toolbar-overflow__slot">
  <button
    v-show="hasItems"
    ref="trigger"
    data-nexusdown="toolbar-more-trigger"
    class="nexusdown-toolbar__button"
    aria-label="更多工具"
    :aria-expanded="open"
    @click="toggle"
  >
    <iconify-icon icon="lucide:ellipsis" aria-hidden="true" />
  </button>
</div>
<Teleport :to="overlayTarget">
  <div
    v-if="open && hasItems"
    ref="menu"
    data-nexusdown="toolbar-overflow-menu"
    data-nexusdown-overlay-root
    role="dialog"
    aria-label="更多工具"
    :style="menuStyle"
    @keydown="onMenuKeydown"
  >
    <slot :close="close" />
  </div>
</Teleport>
```

用 `defineExpose({ close, slot })` 暴露关闭方法和测量插槽元素。菜单内容变化为空时自动关闭。

- [x] **步骤 5：接入 `useToolbarOverflow` 和收纳菜单**

在 `EditorToolbar.vue`：

```ts
const toolbar = ref<HTMLElement | null>(null)
type ToolbarOverflowMenuExpose = { close: (restoreFocus?: boolean) => void; slot: HTMLElement | null }
const moreMenu = ref<ToolbarOverflowMenuExpose | null>(null)
const controlKeys = computed(() => controls.value.map(({ key }) => key))
const { overflowedKeys, ready, refresh } = useToolbarOverflow({
  toolbar,
  moreSlot: computed(() => moreMenu.value?.slot ?? null),
  controlKeys,
})
const overflowedControls = computed(() => controls.value.filter(({ key }) => overflowedKeys.value.has(key)))
```

主轨道控件包装器增加：

```vue
:data-overflowed="overflowedKeys.has(control.key) || undefined"
:aria-hidden="overflowedKeys.has(control.key) || undefined"
```

更多菜单按 group 分组渲染 `overflowedControls`，每项使用 `ToolbarControl display="overflow"`。普通命令执行后调用 `close()`；标题、颜色、链接和图片等复合控件完成或取消自己的二级操作后回到仍然打开的更多菜单。`watch(items)`、命令执行和粘贴模式变化后调用 `refresh()`。

当收纳集合清空或已聚焦的菜单项回到主栏时，关闭菜单并把焦点恢复到对应主栏按钮。

- [x] **步骤 6：添加发布样式并同步双样式文件**

在 `src/style.css` 中将原工具栏规则拆成：

```css
.nexusdown-toolbar { position: relative; display: flex; align-items: center; min-height: 48px; overflow: hidden; }
.nexusdown-toolbar__track { display: flex; align-items: center; min-width: max-content; }
.nexusdown-toolbar__control[data-overflowed='true'] { visibility: hidden; pointer-events: none; }
.nexusdown-toolbar-overflow__slot { position: absolute; top: 0; right: 0; bottom: 0; display: flex; align-items: center; padding: 6px 10px 6px 14px; background: linear-gradient(90deg, transparent, var(--nexus-panel) 12px); }
.nexusdown-toolbar-overflow__menu { position: fixed; z-index: 1000; width: min(320px, calc(100vw - 16px)); max-height: min(360px, calc(100vh - 16px)); overflow-y: auto; }
.nexusdown-toolbar-overflow__items { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.nexusdown-toolbar-control--overflow .nexusdown-toolbar__button { width: 100%; justify-content: flex-start; gap: 8px; }
```

未完成首次测量时通过 `data-overflow-ready="false"` 保留当前横向滚动回退。粗指针下更多按钮和菜单项保持至少 44x44；`max-width: 480px` 时菜单改为单列，防止文字挤压。

然后运行：

```powershell
npm run sync:style
```

确认 `src/style.css` 和 `public/style.css` 字节一致。

- [x] **步骤 7：补充 README 行为说明并运行目标测试**

在 README 的工具栏配置附近补充：默认工具栏会按编辑器容器宽度自动把尾部工具收进“更多”菜单；`toolbarItems` 的顺序同时决定显示优先级，自定义工具无需额外适配。

运行：

```powershell
npm test -- tests/vue/toolbar-overflow.test.ts tests/vue/NexusdownEditor.test.ts tests/vue/toolbar-heading-group.test.ts tests/vue/overlay-target.test.ts tests/vue/popup-theme.test.ts
npm run typecheck
npm exec -- vue-tsc --noEmit
```

预期：全部 PASS，无类型错误。

- [x] **步骤 8：运行完整验证矩阵**

依次运行：

```powershell
npm test
npm run typecheck
npm exec -- vue-tsc --noEmit
npm run build
npm --prefix examples/vue-demo run build
npm pack --dry-run --json
git diff --check
```

预期：所有命令退出码为 0；Vitest 无失败；包预检包含新增 Vue 源文件和构建产物，不生成本地 `.tgz`。示例构建允许仅保留既有的 500KB chunk 警告。

- [x] **步骤 9：浏览器验收**

启动 Vue 示例并在 1280px、900px、760px、390px、320px 检查：

- 工具栏始终单行，宽窄切换不改变编辑器高度。
- 每个默认工具都能从主栏或更多菜单访问。
- 更多菜单与标题、链接、图片二级浮层不被编辑器裁切。
- 390px 和 320px 没有页面横向溢出，触屏目标至少 44px。
- ArrowUp、ArrowDown、Home、End、Escape 和焦点恢复正确。
- 亮色、暗色、自定义皮肤和原生模态 dialog 行为正确。

本任务结束后再次运行 `git diff --check` 与 `git status --short --branch`，只报告本计划改动，不提交或推送。
