# 代码块语言菜单顶层浮窗实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将代码块语言菜单提升为不会影响或被编辑器布局裁切的页面顶层智能浮窗。

**架构：** 触发按钮继续在富文本内容层内跟随当前代码块，菜单通过现有 `resolveOverlayTarget()` 传送到 `body` 或所属模态 `dialog`。菜单使用可视视口数据完成右对齐、边缘约束和上下翻转，并复用现有主题桥接能力。

**技术栈：** Vue 3、Tiptap 3、TypeScript、Vitest、Vue Test Utils、CSS

---

## 文件结构

- 修改 `tests/vue/NexusdownEditor.test.ts`：增加真实编辑器集成回归测试，并更新发布样式契约。
- 修改 `src/vue/components/CodeBlockLanguage.vue`：实现菜单 Teleport、视口定位、主题桥接和可访问性状态。
- 修改 `src/style.css`：将语言菜单改为页面级固定浮层。
- 修改 `public/style.css`：同步 npm 包公开样式，与 `src/style.css` 保持字节一致。

### 任务 1：代码块语言菜单顶层浮窗

**文件：**
- 修改：`tests/vue/NexusdownEditor.test.ts`
- 修改：`src/vue/components/CodeBlockLanguage.vue`
- 修改：`src/style.css`
- 修改：`public/style.css`

- [x] **步骤 1：编写失败的真实行为测试**

在现有代码块语言测试附近增加测试：挂载真实 `NexusdownEditor`，把语言按钮放到可视视口底部，展开菜单后断言菜单不再位于 `.nexusdown-editor` 内，并且菜单顶部小于按钮顶部。这个测试专门捕获“移除 Teleport 或上下翻转逻辑后菜单重新被编辑器裁切”的回归。

```ts
it('teleports the code language menu above the editor when space below is constrained', async () => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 260 })
  const wrapper = mount(NexusdownEditor, {
    attachTo: document.body,
    props: { modelValue: '```js\nconst value = 1\n```' },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const trigger = wrapper.get('button[aria-label="代码块语言"]')
  vi.spyOn(trigger.element, 'getBoundingClientRect').mockReturnValue({
    x: 400, y: 220, left: 400, top: 220, right: 548, bottom: 246,
    width: 148, height: 26, toJSON: () => ({}),
  })

  await trigger.trigger('click')
  await new Promise((resolve) => setTimeout(resolve, 0))
  const menu = document.body.querySelector<HTMLElement>('[data-nexusdown="codeblock-language-menu"]')!
  expect(menu.closest('.nexusdown-editor')).toBeNull()
  expect(Number.parseFloat(menu.style.top)).toBeLessThan(220)
  wrapper.unmount()
})
```

同时把两份样式表的语言菜单契约从 `position: absolute` 更新为 `position: fixed`。

- [x] **步骤 2：运行目标测试并确认正确失败**

运行：`npm test -- tests/vue/NexusdownEditor.test.ts`

预期：新增测试 FAIL，原因是菜单仍位于 `.nexusdown-editor` 内；现有实现尚未 Teleport。

- [x] **步骤 3：实现最少的顶层浮窗行为**

在 `CodeBlockLanguage.vue` 中：

```ts
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const overlayTarget = computed(() => resolveOverlayTarget(trigger.value))
const { viewport } = useNexusdownViewport(() => {
  if (open.value) updateMenuPosition()
  scheduleRefresh()
})
const { skin } = useNexusdownOverlayTheme(trigger, open, updateMenuPosition)
```

打开菜单后 `await nextTick()` 测量触发按钮；宽度固定为 148px，最大高度为 220px，左右保留 8px，下方空间不足且上方空间更多时翻到按钮上方。将主题变量合入菜单内联样式：

```ts
menuStyle.value = {
  left: `${left}px`,
  top: `${top}px`,
  maxHeight: `${maxHeight}px`,
  ...nexusdownThemeVariables(trigger.value),
}
```

模板中仅 Teleport 菜单，触发按钮仍留在原容器：

```vue
<Teleport :to="overlayTarget">
  <div v-if="open" ref="menu" role="menu" :style="menuStyle">
    <!-- language options -->
  </div>
</Teleport>
```

给触发按钮增加 `:aria-expanded="open"`；语言选项使用 `role="menuitemradio"` 与 `:aria-checked`。

- [x] **步骤 4：更新两份发布样式**

在 `src/style.css` 与 `public/style.css` 中把菜单规则改成：

```css
.nexusdown-codeblock-language__menu { position: fixed; z-index: 1000; display: grid; max-height: 220px; min-width: 148px; }
```

其余颜色、间距、阴影和滚动样式不变，确保两份文件保持字节一致。

- [x] **步骤 5：运行目标测试并确认通过**

运行：`npm test -- tests/vue/NexusdownEditor.test.ts`

预期：该测试文件全部 PASS；代码语言仍能切换，新增菜单位于编辑器外且在底部空间不足时向上展开。

- [x] **步骤 6：运行完整验证矩阵**

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

预期：所有命令退出码为 0；Vitest 无失败；npm dry-run 包含 Vue 源组件与构建产物，且不生成本地 `.tgz`。

- [x] **步骤 7：浏览器视觉验收**

启动 Vue 示例，在桌面和窄视口中选中代码块并展开语言菜单。确认菜单浮于编辑器上方、不改变编辑器高度、不被状态栏或分栏裁切，滚动后仍锚定语言按钮，亮暗主题与编辑器一致。

本任务不自动提交或推送；当前工作区包含用户的其他未提交改动，仅报告本次修改和验证结果。

### 任务 2：代码审查边界修复

**文件：**
- 修改：`tests/vue/NexusdownEditor.test.ts`
- 修改：`src/vue/components/CodeBlockLanguage.vue`

- [x] **步骤 1：增加动态模态目标与键盘操作失败测试**

模拟编辑器挂载后原生 `dialog` 才进入 `:modal` 状态，断言每次打开菜单时重新解析 Teleport 目标。另一个测试断言打开菜单后聚焦当前语言，方向键循环切换焦点，Home/End 跳转首尾，Escape 关闭并把焦点还给触发按钮。

- [x] **步骤 2：运行目标测试确认两条路径失败**

运行：`npm test -- tests/vue/NexusdownEditor.test.ts`

预期：动态模态测试因菜单仍传送到 `body` 失败；键盘测试因焦点仍停在触发按钮失败。

- [x] **步骤 3：实现每次打开重算目标与菜单焦点管理**

打开菜单前同步调用 `resolveOverlayTarget(trigger.value)`；挂载浮层后聚焦当前语言。菜单处理 ArrowUp、ArrowDown、Home、End、Escape，关闭时按需恢复触发按钮焦点。

- [x] **步骤 4：运行目标测试和完整验证矩阵**

目标测试与任务 1 的完整命令全部通过，并重新进行浏览器视觉验收。
