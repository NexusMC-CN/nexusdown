# 动效打磨计划（Motion Plan）

> 目标：把 nexusdown 的动效**从 0 到 1** 重做一遍——不是"加几个过渡"，而是建立
> 一套可审片、可回放、可验收的动效系统，然后**逐条、逐帧**打磨。
>
> 范围：工具栏 18 个演示动画 + 编辑器交互动效（折叠、浮层、补全、复选框、入场）。
> 不含：OINK 式视觉预设（另开）、方言功能（两个代理在做）。

---

## 0. 事实盘点（先量，再改）

### 0.1 工具栏演示（18 个 / 28 条 keyframes）

| 项 | 现状 |
| --- | --- |
| 演示数 | 18：bold / italic / inlineCode / inlineMath / h1 / h2 / h3 / bullet / ordered / quote / table / link / mention / codeBlock / blockMath / embed / undo / redo |
| 时长 | 统一 `2.8s` |
| 缓动 | 多数 `cubic-bezier(0.22, 1, 0.36, 1)`；少数 `steps(1, end)` |
| 播放 | 动画名常驻、默认 `paused`；悬停时 JS `getAnimations()` 重置并 `play()`；移开停在末帧 |
| 降级 | `prefers-reduced-motion: reduce` 直接呈现第 4 拍 |
| **动了 layout 属性的（抖动根源）** | **h1/h2/h3**（`font-size` 13→22/18/15px）、**inlineCode**（`font-size` + `font-weight`）、**bold**（`font-weight` 400→700）、**codeBlock**（标题栏 `height: 0→11px`） |
| 只动合成属性的（健康） | italic（skew）、list/quote/link/mention/table/math/embed/undo/redo 的位移与透明度 |

### 0.2 编辑器交互动效

| 位置 | 现状 | 问题 |
| --- | --- | --- |
| 代码块折叠 | `height` + `padding` + `opacity`，`0.28s`，`interpolate-size` | layout 动画；**没有 reduced-motion 降级** |
| 工具栏按钮 hover | 颜色 + `translateY(0.5px)`，100ms | `0.5px` 非整数位移 → 文字亚像素发虚 |
| 悬停卡片 | `grid-template-rows` 0fr→1fr + opacity + visibility 延迟 | layout 动画；进出不对称 |
| 链接输入行 | 同上（grid rows） | 同上 |
| 提及选择器 | 无入场动画，瞬时出现 | 突兀；和卡片不同语言 |
| 任务复选框 | 无动画 | 勾选瞬间无反馈 |
| 图片 / embed / 表格 / 公式块 | 无入场；表格/公式 reveal 是瞬时切换 | 切换时跳变 |
| 主题切换（未来预设） | 无 | 需要统一 200ms 颜色过渡 |

### 0.3 令牌现状

`--nd-dur: 160ms`、`--nd-dur-fast: 100ms`、`--nd-ease`、`--nd-ease-out`（`theme.css`）。
**缺**：位移/缩放尺度、enter/exit 分离缓动、stagger、动效开关。

---

## 1. 动效系统（tokens + 规则）

### 1.1 令牌

```css
--nd-motion-dur-1: 60ms;    /* 即时反馈：按下、勾选 */
--nd-motion-dur-2: 100ms;   /* 小状态：hover、focus */
--nd-motion-dur-3: 160ms;   /* 浮层、展开 */
--nd-motion-dur-4: 240ms;   /* 卡片、面板 */
--nd-motion-dur-5: 280ms;   /* 折叠（仅限小块） */

--nd-motion-ease-standard: cubic-bezier(0.2, 0, 0, 1);   /* 位移/尺寸 */
--nd-motion-ease-enter:    cubic-bezier(0.05, 0.7, 0.1, 1); /* 进场：快起慢收 */
--nd-motion-ease-exit:     cubic-bezier(0.3, 0, 0.8, 0.15); /* 退场：慢起快收 */

--nd-motion-dist-1: 2px;
--nd-motion-dist-2: 4px;
--nd-motion-dist-3: 8px;
--nd-motion-scale-1: 0.98;
--nd-motion-scale-2: 0.96;
```

### 1.2 四条规则

1. **合成层优先**：只动 `transform` / `opacity`。动 layout 属性（`width` / `height` /
   `font-size` / `font-weight` / `grid-template-rows`）必须**在审片里证明不抖**，否则换方案。
2. **可打断**：状态切换用 transition（天然可打断）；一次性演示用 keyframes/WAAPI，
   但必须能"停在任意帧"（工具栏的 paused + 末帧方案保留）。
3. **进出分离**：进场用 `ease-enter`（快起），退场用 `ease-exit`（快收），不要一个曲线走天下。
4. **降级到终态**：`prefers-reduced-motion: reduce` 时**直接呈现最终画面**，不是回到初始态
   （工具栏已经是这个约定，编辑器要补齐）。

---

## 2. 工具：Motion Lab（帧级审片）

新建 `motion-lab/`（独立 Vite 页，**不碰 playground**，避免和代理冲突）：

- **清单**：所有动画一行——名称、文件、触发、时长、缓动、动的属性、是否合成层。
- **回放控制**：重播 / 暂停 / 0.1x 慢放 / **逐帧步进（±16.7ms）** / 时间轴 scrub。
  实现：`document.getAnimations()` → `anim.pause()` → 设 `anim.currentTime`。
- **属性审计**：读 `effect.getKeyframes()`，自动标出动了 layout 属性的动画（红/黄/绿）。
- **位移叠加**：网格 + 基线 + 动画元素描边，肉眼定位"跳 1px"。
- **A/B 对比**：同一演示的 before/after 两套 keyframes 并排，逐帧同步。
- **录制**：每帧截图导出（PNG），审片记录写进 `docs/motion-audit.md`。

> 这个 lab 就是"一针一针看"的工作台：2.8s 的演示 = 168 帧，
> 逐帧走一遍，把每处跳变记成 `frame 47: 文字右移 1px`。

---

## 3. 逐项打磨（按优先级）

### P0 · 先修"抖"（4 个 demo 动了 layout）

| demo | 现状 | 方案 |
| --- | --- | --- |
| h1 / h2 / h3 | `font-size` 13→22/18/15 | 换成 `transform: scale()`（`transform-origin: left center`），字号固定为终值、初始 scale 反推 |
| bold | `font-weight` 400→700 | 双层文字交叉淡入（粗体副本 `opacity`），或 `text-shadow` 模拟；**不动字重** |
| inlineCode | `font-size` + `font-weight` | 等宽副本叠在原文上交叉淡入；chip 尺寸只由终态决定 |
| codeBlock | 标题栏 `height: 0→11px` | 改 `clip-path: inset()` 或 `scaleY` + `overflow: hidden` |

### P1 · 交互一致性

- 工具栏按钮：`translateY(0.5px)` → `translateY(1px)`（整数）或去掉位移只改颜色；
  补 `:active` 按下反馈（60ms）。
- 悬停卡片 / 链接输入行：`grid-template-rows` → `transform: scaleY` + `opacity`
  （或 `clip-path`），进出用不同缓动；关闭延迟对齐时长。
- 提及选择器：补 100ms 淡入 + 4px 上移（`ease-enter`）。
- 任务复选框：勾选时 120ms 对勾描边（`stroke-dashoffset`）+ 背景色过渡。
- 代码块复制按钮：点击 60ms 缩放反馈 + "已复制"状态 160ms 交叉淡入。

### P2 · 入场与切换

- 图片：`opacity` 淡入（不占位变化）；加载前保留宽高比，避免 CLS。
- embed：点击加载后 iframe `opacity` 淡入。
- 表格/公式块 reveal：源码 ↔ widget 切换用交叉淡入（不动高度）；
  若做不到，至少加 80ms opacity，避免"闪一下"。
- 主题切换（未来）：颜色 200ms 过渡，只过渡 `color` / `background-color` / `border-color`。

### P3 · 细节

- `:focus-visible` 环：出现用 60ms opacity，不位移。
- 折叠：补 reduced-motion 降级；大代码块（> 20 行）直接瞬时，不做 height 动画。
- 光标/选区：不加速动画（CM6 自带）。
- 滚动：不写 smooth scroll（会和输入抢焦点）。

---

## 4. 验收标准（每条动画都要过）

| 项 | 标准 |
| --- | --- |
| 帧率 | DevTools Performance：无 > 16.7ms 的长任务；动画期间无 layout（或已证明必要） |
| 位移 | 逐帧走查，元素边缘不出现 1px 级跳动 |
| 可打断 | hover 进/出、快速连点不出现"回到初始态"的穿帮 |
| 降级 | `prefers-reduced-motion` 下直接终态，无动画残留 |
| 一致性 | 所有时长/缓动来自令牌；`grep -n "[0-9]\+ms"` 只能命中令牌定义 |
| 记录 | 每条动画在 `docs/motion-audit.md` 有一行审片结论（含帧号） |

---

## 5. 排期与依赖

| 阶段 | 内容 | 依赖 | 冲突面 |
| --- | --- | --- | --- |
| 0 | 盘点 + 本计划 | 无 | 无 |
| 1 | tokens + 规则 | 无 | 新建 `src/shared/motion.css` |
| 2 | Motion Lab | 无 | 新建 `motion-lab/` |
| 3-P0 | 4 个 layout demo | Lab 可用 | `Toolbar.vue`（空闲） |
| 3-P1 | 交互一致性 | tokens | `Toolbar.vue`；编辑器项等代理结束 |
| 3-P2/P3 | 入场/细节 | 代理结束 | `cm/features/*.css`、`theme.css` |

> `theme.css` 归渲染契约代理（它只加一行 `@import`），`cm/features/*.css` 归方言代理。
> 这两处**等它们交活**再动；Toolbar.vue 和 motion-lab 现在就能开工。

---

## 6. 交付物

- `docs/motion-audit.md`：逐条审片记录（帧号 + 结论）。
- `src/shared/motion.css`：令牌。
- `motion-lab/`：帧级审片工作台。
- 代码改动：`Toolbar.vue` 的 4 个 layout demo + 交互项；编辑器动效（代理结束后）。

---

## 7. 参考：Endfield UI 的动效系统（2026-10-19 吸收）

来源：[hhikr/endfield-ui-skill](https://github.com/hhikr/endfield-ui-skill) 的
`references/motion.md`、`assets/fx.js`、`assets/tokens.json`、`templates/motion.html`。

### 7.1 三条曲线（已落到 `src/shared/motion.css`）

| token | 曲线 | 用途 |
| --- | --- | --- |
| `snap` | `cubic-bezier(0.16, 1, 0.3, 1)` | 出现、列表行、FLIP 补位 —— 快到位后稳住 |
| `mech` | `cubic-bezier(0.7, 0, 0.2, 1)` | 快门、擦入、灌满、面板、**所有退出** —— 慢起硬停 |
| `ease` | `cubic-bezier(0.2, 0.7, 0.1, 1)` | 普通过渡、颜色 |

`linear` 只给"逐位锁定"这类本身就是节奏的效果。

### 7.2 时长与编排

- 一次操作：100–400ms；单个入场 ≤650ms；整段序列 ≤1000ms；
- **退出 = 进入的 60–70%，一律 `mech`**；
- 错开只有三档：38ms（行）/ 45ms（段）/ 100ms（块）；同组超过 6 个时**缩小间隔**，不拉长总时长；
- 顺序：骨架 → 主角（0ms）→ 说明（约 420ms）→ 数据（+120ms）→ 可见列表行。

### 7.3 只动合成属性

`transform / opacity / clip-path / background-size / stroke-dashoffset`。
需要"让出位置"时用 **FLIP**：先记旧位置 → 改布局 → 用 transform 从旧位置动回来。

### 7.4 状态语言

- 忙碌：按钮铺斜线纹，**不转圈**；
- 完成：黄光扫过一次（600ms）+ 短暂改文案；
- 出错：从左擦入 + 旗标，**不抖动、不变红**；
- 骨架屏：硬切成内容，不闪光。

### 7.5 退出要等演完

`settled(el)`：`getAnimations().finished` 全部结束再 `close()` / `remove()`；
减少动效时立即移除。

### 7.6 主题切换

View Transitions：从按钮位置 `clip-path: circle()` 揭开新主题，
约 3000px/s，240–600ms（给未来的视觉预设用）。

### 7.7 禁用清单（进 lint）

弹跳、弹簧、果冻、逐字缩放弹出、发光脉冲、视差背景、滚动触发逐段淡入、
抖动报错、Material 涟漪。

### 7.8 对我们计划的修正

1. 工具栏演示从"一条缓动"改成 **snap / mech / ease** 三条；退出统一 `mech`、时长取进入的 60–70%。
2. 4 个 layout 演示：h1/h2/h3 → `transform: scale`（原点左上）；bold → 粗体副本交叉淡入；inlineCode → 等宽副本交叉淡入；codeBlock 标题栏 → `clip-path`。
3. 演示时长 2.8s → **约 2.4s**，统一拍点网格（0 / 22% / 44% / 66% / 100%），总预算 ≤2s。
4. 加 `settled()`，hover 卡片 / 折叠 / 浮层卸载前等动画结束。
5. Motion Lab 参考 `motion.html`：重放按钮 + 三条贝塞尔曲线绘制 + 时间线。
6. **不抄皮**：黄黑、斜切、乱码、滚动条是 Endfield 的游戏语言；只抄机制。

