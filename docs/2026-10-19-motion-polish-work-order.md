# 动效打磨工单 · Motion Lab + 全语法演示（帧级）

> 给实现代理（subagent）。先读：
> `docs/2026-10-19-motion-plan.md`（含 §7 Endfield 经验）、`src/shared/motion.css`（已落的令牌）、
> `src/editor/Toolbar.vue`（现有 18 个演示）。
>
> 目标一句话：**把演示系统从 0 到 1 重做一遍——所有语法都有演示，所有演示都能逐帧审片，
> 且按 Endfield 的机制修正（snap/mech/ease、只动合成属性、退出等演完）。**

---

## 1. 硬约束

1. **不换引擎、不动方言实现**：禁止改 `src/cm/features/**`、`src/render/**`、`src/shared/dialect.css`、
   `src/shared/blocks.css`、`playground/**`（主代理正在用 playground 做视觉 QA）。
2. **不 commit**；保持现有 577 个测试全绿；`npm run typecheck` / `lint` / `build` 必须过。
3. 注释风格与仓库一致：中文、`⚠️` 标坑、写「为什么」。
4. **禁止**弹跳 / 弹簧 / 果冻 / 逐字缩放弹出 / 发光脉冲 / 视差 / 滚动触发入场 / 抖动 / 涟漪。
5. 减少动效：`prefers-reduced-motion: reduce` 时**直接终态**，不是回到初始态。

---

## 2. 交付物

### 2.1 演示注册表（单一事实源）

新建 `src/editor/demos/`：

- `demos.ts`：`DemoSpec` 数组。每条：
  ```ts
  interface DemoSpec {
    id: string                 // 与方言语法 id 对齐（heading / bold / highlight / callout / …）
    syntax: string             // 对应 DIALECT_SYNTAXES 的 id；一个语法可有多条演示
    label: string
    duration: number           // ms，教学演示统一 ~1800
    beats: number[]            // 拍点百分比，默认 [0, 22, 44, 66, 100]
    render: () => VNode        // 演示画面（纯展示，不依赖 EditorView）
    layoutProps?: string[]     // 已知会动 layout 的属性（默认空；有就必须在审片里解释）
  }
  ```
- `DemoStage.vue`：画布外壳（固定尺寸、居中、`demo-cam` 运镜层）。
- `demos.css`：所有演示的样式与 keyframes（从 Toolbar.vue 迁出来，**不要留两份**）。
- `registry.test.ts`：断言 **19 条方言语法每条至少一个演示**（从 `playground/src/fixtures.ts`
  的 `DIALECT_SYNTAXES` 导入 id 列表；只 import 数据，不 import Vue 组件）。

> Toolbar.vue 改成从注册表取 `render`（按钮 → 演示 id 的映射保留在 Toolbar 里）。
> 这是本次唯一允许的大改：**演示的 DOM/CSS 必须只有一份**。

### 2.2 Motion Lab（`motion-lab/`）

`vite.config.ts` 已存在（端口 5200，alias 已配）。补：

- `index.html` / `main.ts` / `App.vue`：
  - 左：全部演示的画廊（按语法分组，19/19 覆盖徽章）；
  - 右：选中演示的**帧级控制台**：
    - 重播 / 暂停 / `0.1x` 慢放；
    - **逐帧步进 ±16.7ms**（显示当前帧号 / 总帧数）；
    - 时间轴 scrub（`document.getAnimations()` → `pause()` → `currentTime`）；
    - **属性审计**：读 `effect.getKeyframes()`，列出动的属性；动 layout 属性的标红；
    - 三条贝塞尔曲线绘制（snap / mech / ease，参考 Endfield `templates/motion.html`）；
  - 深链：`?demo=<id>&t=<ms>` 冻结在该帧（给截图脚本用）。
- `scripts/motion-frames.mjs`：用本机 Chrome 无头截图
  （`chrome --headless=new --screenshot=… --window-size=… "http://127.0.0.1:5200/?demo=…&t=…"`），
  每个演示抽 0/25/50/75/100% 五帧，存 `.local/motion-shots/`。
  **必须真的看一眼这些 PNG**（有 `read_image` 就用；没有就说明"未目检"，别谎报）。

### 2.3 4 个 layout 演示重做（P0）

| 演示 | 现在 | 改成 |
| --- | --- | --- |
| h1 / h2 / h3 | `font-size` 13→22/18/15 | 字号固定为终值，初始 `transform: scale(终值/初始)`，`transform-origin: left center` |
| bold | `font-weight` 400→700 | 粗体副本叠在原文上，`opacity` 交叉淡入；**不动字重** |
| inlineCode | `font-size` + `font-weight` | 等宽副本交叉淡入；chip 尺寸只由终态决定 |
| codeBlock | 标题栏 `height: 0→11px` | `clip-path: inset()` 或 `scaleY` + `overflow: hidden` |

改完在 Lab 的属性审计里必须是「无 layout 属性」。

### 2.4 补齐缺失语法演示（19/19）

现有 18 个工具栏演示覆盖不到这些语法，**必须新增**：

- `highlight`（`==高亮==`）
- `strikethrough`（`~~删除线~~`）
- `callout`（`> [!NOTE]`）
- `task-list`（`- [ ]` / `- [x]`）
- `image`（`![alt](url)`）
- `carousel`（同段连续图片）
- `autolink`（裸 URL）

加上已有的 18 条，确保 `DIALECT_SYNTAXES` 19 条全部有演示（`registry.test.ts` 锁死）。

### 2.5 统一时间语言

- 全部演示时长 ~1800ms，拍点 `[0, 22, 44, 66, 100]`；
- 进场用 `--nd-motion-snap`，退场/机械动作用 `--nd-motion-mech`，普通过渡用 `--nd-motion-ease`；
- 删掉 `animation-duration: 2.8s` 的散落字面量，统一从 `DemoSpec.duration` 注入；
- 演示结束停在**终态**（和现在"停在第 4 拍"一致）。

### 2.6 编辑器交互动效（可选，时间够再做）

- hover 卡片 / 链接输入行：`grid-template-rows` 过渡 → `transform: scaleY` + `opacity`（或 `clip-path`）；
- 提及选择器：补 100ms 淡入 + 4px 上移（`--nd-motion-ease`）；
- 任务复选框：勾选 120ms 对勾描边；
- 按钮按下：`--nd-motion-dur-1` + `translateY(1px)`（整数，别用 0.5px）。

---

## 3. 文件所有权

**可改 / 新建**：`src/editor/**`（含 `demos/`）、`src/shared/motion.css`、`src/cm/theme.css`（仅动效相关）、
`motion-lab/**`、`scripts/motion-frames.mjs`、`package.json`（加 `"motion": "vite --config motion-lab/vite.config.ts"`）、
`docs/motion-audit.md`。

**禁止**：`src/cm/features/**`、`src/render/**`、`src/shared/dialect.css`、`src/shared/blocks.css`、
`playground/**`、`tests/dialect/**`、`docs/dialect-extensions.md`。

---

## 4. 验证

```bash
npm test          # 577+ 全绿（含新的 registry.test.ts）
npm run typecheck
npm run lint
npm run build
```

再跑 `node scripts/motion-frames.mjs`，确认：
- 每个演示 5 帧 PNG 都生成；
- 属性审计里**没有 layout 属性**（除非 DemoSpec 显式声明并解释）；
- 减少动效模拟（`--force-prefers-reduced-motion` 或 DevTools 协议）下演示直接终态。

## 5. 报告格式

1. 演示覆盖表：19 条语法 → 演示 id（必须 19/19）；
2. 每个改动过的演示：旧属性 → 新属性 + 关键帧结论；
3. Lab 的截图路径（`.local/motion-shots/`）+ 你实际看了哪几张、发现了什么；
4. 测试结果；
5. 未决问题。
