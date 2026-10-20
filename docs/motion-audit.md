# 动效审片记录（Motion Audit）

> 对应工单：`docs/2026-10-19-motion-polish-work-order.md`
> 计划与 Endfield 经验：`docs/2026-10-19-motion-plan.md`
> 审片台：`motion-lab/`（`npm run motion` → http://127.0.0.1:5200）
> 抽帧脚本：`node scripts/motion-frames.mjs` → `.local/motion-shots/`

## 0. 这一轮怎么审的

三层证据，从便宜到贵：

| 层 | 是什么 | 抓什么 |
| --- | --- | --- |
| **静态**（CI） | `src/editor/demos/registry.test.ts` 扫 `demos.css` 的每个 `@keyframes` | "有没有 keyframes 动了 layout 属性"、"时长是不是只有一个来源" |
| **运行时**（半自动） | `scripts/motion-frames.mjs`：深链冻结 → 读 `effect.getKeyframes()` → 逐个分类 | "这个演示到底动了什么"；**减少动效下是不是终态** |
| **肉眼**（人） | 每个演示 5 帧 PNG（0 / 25 / 50 / 75 / 100%），`read_image` 实际看 | "画出来对不对" —— 静态和运行时都看不出双影、错位、糊边 |

第三层不是形式主义：这一轮**三个真 bug 全是看图才发现的**（见 §4）。

帧号换算：`2400ms ÷ 16.7ms ≈ 144 帧`，所以
**0% = 帧 0、25% = 帧 26、50% = 帧 53、75% = 帧 80、100% = 帧 107**。
下文提到"第 N 帧"都用这个换算。

## 1. 覆盖表：19 条方言语法 → 演示（19/19）

`DIALECT_SYNTAXES`（`playground/src/fixtures.ts`）的 19 条，逐条有演示；
`registry.test.ts` 锁死（少一条就红）。

| # | 语法 id | 演示 id | 备注 |
| --- | --- | --- | --- |
| 1 | `heading` | `h1` / `h2` / `h3` | 三条，同一节奏、只有目标字号不同 |
| 2 | `emphasis` | `bold` / `italic` | 粗体 / 斜体 |
| 3 | `highlight` | `highlight` | **新增** |
| 4 | `strikethrough` | `strike` | **新增** |
| 5 | `inline-code` | `inlineCode` | |
| 6 | `link` | `link` | |
| 7 | `autolink` | `autolink` | **新增** |
| 8 | `blockquote` | `quote` | |
| 9 | `callout` | `callout` | **新增** |
| 10 | `list` | `bullet` / `ordered` | 两条 |
| 11 | `task-list` | `taskList` | **新增** |
| 12 | `table` | `table` | |
| 13 | `fenced-code` | `codeBlock` | |
| 14 | `inline-math` | `inlineMath` | |
| 15 | `block-math` | `blockMath` | |
| 16 | `mention` | `mention` | |
| 17 | `embed` | `embed` | |
| 18 | `image` | `image` | **新增** |
| 19 | `carousel` | `carousel` | **新增** |
| — | （不是语法） | `undo` / `redo` | 工具栏动作，`syntax: 'action'` |

合计 **25 段演示 / 19 条语法**。Lab 左上角的徽章直接数这个数。

## 2. 四个 layout 演示的重做（P0）

| 演示 | 旧属性 | 新属性 | 帧级结论 |
| --- | --- | --- | --- |
| `h1` / `h2` / `h3` | `font-size` 13→22/18/15px、`font-weight` 400→600 | `transform: scale(0.5909 / 0.7222 / 0.8667 → 1)`；字号**全程是终值**；`font-weight: 600` 恒定 | 帧 0–47（44%）不动；44→66% 长到终值；**逐帧无重排**。⚠️ 已知观感：`transform-origin: left center` 使帧 0 的字形贴终态盒子的左边（视觉偏左约 10px），帧 71 之后落在正中 —— 这是该原点的必然结果，不是穿帮（见 §6） |
| `bold` | `font-weight` 400→700 | 粗体副本 `opacity 0→1`（44→66%），正体留在流里不动 | 帧 53 仍是 `**文字**` + 正体；帧 71 之后只有粗体副本。**字重全程 400/700 两个常量，从不插值** |
| `inlineCode` | `font-family` 硬切（`steps(1,end)`）+ `font-size` | 等宽副本 `opacity 0→1`、**正体 `opacity 1→0`**、chip 灰底 `opacity 0→1` | 帧 0–47 比例字体；帧 71 之后等宽 + 灰底。chip 宽度固定 52px → 字宽差异被吸收在内部，文字一格没动 |
| `codeBlock` | 标题栏 `height: 0→11px`、代码 `font-family` 硬切 | 标题栏 `clip-path: inset(0 0 100% 0 → 0)`、代码副本交叉淡入 | 标题栏帧 60 起从上往下"揭开"，**窗口高度全程 35px**，整摞内容一次都没被挤动 |

顺带修掉的两处同类问题（工单没点，但同一条纪律）：

- `inlineMath` 的 `2` 原来靠 `margin-left: 8px→0` 贴回 `x` —— 那是 layout 属性，
  而且改它会让整个盒子变窄、居中的文字整体右移。改成 `translateX(-8px)`。
- `blockMath` 的公式原来 `steps(1,end)` 切 `font-family` + `font-style`，
  同 `inlineCode` 的毛病。改成衬线斜体副本交叉淡入（正体同步淡出）。

## 3. 统一时间语言

| 项 | 旧 | 新 |
| --- | --- | --- |
| 时长 | 散落的 `2.8s`（18 处） | `DemoSpec.duration`（1800）→ `--demo-dur`，`demos.css` 里**只有** `var(--demo-dur)` 一处来源（测试守着） |
| 拍点 | 20/40/44/58/62/70/72/76/82… 各写各的 | 全部落在 `0 / 22 / 44 / 66 / 100` |
| 曲线 | 几乎全是 `cubic-bezier(0.22, 1, 0.36, 1)`，少数 `steps(1, end)` | 进场 `snap`、退场/机械 `mech`、普通 `ease`（`--nd-motion-*`），`steps` 全删 |
| 结束 | 停在末帧 | 停在末帧（`forwards`），不循环 |
| 减少动效 | 部分演示停在 0%（见 §4.2） | 25/25 直接终态，脚本逐元素比对 |

错开只有三档：`--nd-motion-stagger-row` 38ms（任务列表第二行、轮播左右两张）、
`--nd-motion-stagger-block` 100ms（轮播圆点）。

## 4. 看图看出来的三个 bug（都是自动审计抓不到的）

### 4.1 换字体副本"双影"

`inlineCode` / `codeBlock` / `blockMath` 用副本交叉淡入替代切字体，
但第一版**只让副本淡入、忘了让正体淡出** —— 两份不同字形的同一串字叠在一起：

- `inlineCode` 帧 107：`code` 的 o、d 有明显重影；
- `codeBlock` 帧 107：`name: build` 被画了两遍（`namе: buildd` 那种糊）；
- `blockMath` 帧 107：`E = mc²` 同问题（衬线斜体 vs system-ui，字形完全不同）。

修法：给三处正体各加一条 `opacity: 1→0`（44→66%），并补进减少动效的终态。
⚠️ **加粗那一段故意不淡出正体**：粗体字形完全包住正体，叠着反而像"墨迹变重"，
淡出会让中间几帧整段变淡（看帧 53 → 71 的过渡就知道）。

### 4.2 减少动效其实停在初始态

原来写的是 `.demo-stage * { animation-play-state: paused !important }`。
**这条不管用**：CSS 层叠里动画声明（animation origin）压过普通作者声明，
暂停在 0% 的动画会继续盖住下面那些"终态"规则 —— 于是 `h1` 停在 `scale(0.5909)`、
`bold` 的副本停在 `opacity: 0`。肉眼看到的是"减少动效时什么都没发生"。

修法：`animation: none !important`（动画整个摘掉，静态终态才生效）。

抓法：`scripts/motion-frames.mjs` 用 `Emulation.setEmulatedMedia` 模拟 reduce，
把"reduce 下帧 0"和"正常模式帧 107"的**每个元素（含伪元素）的计算样式**逐条比对。
现在是 25/25 全等 —— `rm/h1.png` 和 `h1-100.png` 的 sha256 都一模一样。

### 4.3 伪元素的动画根本没被 Lab 收集

`Element.getAnimations()` **不返回伪元素的动画**（Chrome 实测）。
演示里有 4 条挂在伪元素上：行内代码的灰底、链接 / 自动链接的下划线、高亮的记号笔。
漏掉它们不报错，只表现为"这 4 条永远停在 0%"（`demo-link-underline` 在审计表里根本不出现）。

修法：`document.getAnimations()` + `stage.contains(effect.target)` 过滤；
审计表里给名字挂上 `::before` / `::after` 后缀，一眼看得出哪条画在伪元素上。

### 4.4 还有两处小的

- `taskList` 两行的复选框没对齐：两行文字长度不同（2 字 / 3 字），各自居中
  → 框落在两条竖线上。包一层 `.demo-task__list`（行内左对齐）后列宽取最宽那行，框对齐了。
- `strike` 的删除线 1.5px 比正文重一档（真实 `<s>` 在 13px 下是 1px）。改成 1px。
  （`undo` / `redo` 保留 1.5px：那里演的是"划掉"这个动作，不是最终字形。）
- `undo` 的按键原来有一条 `scale(1.06)` 的"弹起" —— 那是果冻/回弹，在禁令清单里。删掉。

## 5. 属性审计（机器读的，25/25）

由 `document.getAnimations()` → `effect.getKeyframes()` 逐条读出来。
**`layout` 类属性：0 条**（绿 = 合成，黄 = 重绘）。

| 演示 | @keyframes → 动的属性 |
| --- | --- |
| `h1` | demo-h1-grow: transform<br>demo-syntax: opacity |
| `h2` | demo-h2-grow: transform<br>demo-syntax: opacity |
| `h3` | demo-h3-grow: transform<br>demo-syntax: opacity |
| `bold` | demo-bold-copy: opacity<br>demo-syntax: opacity<br>demo-syntax: opacity |
| `italic` | demo-italic-skew: transform<br>demo-syntax: opacity<br>demo-syntax: opacity |
| `highlight` | demo-highlight-mark::before: transform<br>demo-syntax: opacity<br>demo-syntax: opacity |
| `strike` | demo-strike-line: color + background-size<br>demo-syntax: opacity<br>demo-syntax: opacity |
| `inlineCode` | demo-inline-code-box::before: opacity<br>demo-inline-code-text: opacity<br>demo-inline-code-mono: opacity<br>demo-syntax: opacity<br>demo-syntax: opacity |
| `link` | demo-link-ink: color<br>demo-link-underline::after: transform<br>demo-syntax: opacity<br>demo-syntax: opacity |
| `autolink` | demo-autolink-ink: color<br>demo-autolink-underline::after: transform<br>demo-autolink-scan: transform + opacity |
| `quote` | demo-quote-text: color<br>demo-quote-bar: transform<br>demo-syntax: opacity |
| `callout` | demo-syntax: opacity<br>demo-callout-card: border-*-color + background-color<br>demo-callout-bar: transform<br>demo-callout-title: opacity |
| `bullet` | demo-syntax ×2: opacity<br>demo-list-marker ×2: opacity |
| `ordered` | 同 `bullet` |
| `taskList` | demo-syntax ×2: opacity<br>demo-task-box / demo-task-box-done: border-*-color + background-color + opacity<br>demo-task-tick: stroke-dashoffset |
| `table` | demo-table-cell ×2: border-*-color + background-color<br>demo-syntax ×3: opacity |
| `codeBlock` | demo-code-block-win: border-*-color + background-color<br>demo-code-block-bar: clip-path<br>demo-code-block-text / -mono: opacity<br>demo-syntax ×2: opacity |
| `inlineMath` | demo-inline-math-caret: opacity<br>demo-inline-math-sup: transform<br>demo-syntax ×2: opacity |
| `blockMath` | demo-block-math-text / -math: opacity<br>demo-syntax ×2: opacity |
| `mention` | demo-mention-pill: border-*-color + background-color<br>demo-mention-at / -ink: color |
| `embed` | demo-embed-card: border-*-color + background-color<br>demo-embed-icon: opacity<br>demo-syntax ×2: opacity |
| `image` | demo-image-card: transform + opacity<br>demo-syntax: opacity |
| `carousel` | demo-carousel-slide-l/m/r: transform + opacity<br>demo-carousel-dots: opacity<br>demo-syntax: opacity |
| `undo` | demo-undo-word: color + opacity + background-size<br>demo-undo-key: transform + opacity + background-color + border-*-color + box-shadow |
| `redo` | 同 `undo` |

属性全集（25 段合起来）：
`background-color, background-size, border-*-color, box-shadow, clip-path, color,
opacity, stroke-dashoffset, transform` —— 全在 Endfield 那份"允许动"的清单里，
**没有一个 layout 属性**。

## 6. 截图与实际目检结论

产物：`.local/motion-shots/`（125 张 5 帧 + 25 张 reduce + 2 张 Lab 整页 + 1 张工具栏卡片）。
每张是 `.demo-stage` 元素本身、`deviceScaleFactor: 3`（144×46 的画布 → 432×138）。

实际用 `read_image` 看过这些（不是"生成即通过"）：

| 图 | 看到了什么 | 结论 |
| --- | --- | --- |
| `h1-000` / `h1-100` | 帧 0 的字形贴在终态盒子左边（偏左约 10px）、字号明显小一档；帧 107 是 22px、落在正中，边缘干净无糊 | `scale` 方案成立；左偏是 `left center` 的必然结果 |
| `bold-050` | `**文字**`，标记清晰、正文仍是正体 | 第 3 拍正确 |
| `bold-100` | 只有粗体，**无重影**（对比 `inlineCode-100` 第一版就是重影） | 交叉淡入成立 |
| `highlight-050` / `-075` | 帧 53 是一根竖着的黄色窄条（`mech` 慢起，才刷了 10%）；帧 80 黄色整块铺满、`==` 已消失 | 记号笔动作读得出来；终态就是 `<mark>` 的样子 |
| `strike-075` | 整词被一条灰线划穿、文字褪灰 | 成立（线宽已从 1.5px 收到 1px） |
| `inlineCode-100` | **第一版双影** → 修完是干净的等宽 `code` + 灰底 chip | 见 §4.1 |
| `codeBlock-050` | 源码态：上下两条 ` ``` ` + 比例字体的 `name: build`，窗口无边框 | 起点和别的演示同构（都是"普通文本"） |
| `codeBlock-100` | 标题栏（三个圆点 + 文件图标 + `ci.yml` + `yaml` + 底边分隔线）+ 干净等宽代码 | `clip-path` 揭开成立；**第一版是双影**，已修 |
| `blockMath-100` | 衬线斜体 `E = mc²`、左对齐、围栏消失 | 成立（第一版双影，已修） |
| `taskList-100` | 第一行空框 + 「待办」，第二行品牌色实心框 + 白勾 + 「已完成」；**两个框在同一条竖线上** | 修完对齐了（第一版错开一格） |
| `image-100` | 圆角卡 + 山/日占位字形 + 「封面」 | 成立 |
| `carousel-100` | 三张卡扇形（中间在前、左右各让 24px）+ 底部三个圆点（第一个品牌色） | 成立 |
| `callout-100` | 蓝色左侧色条 + 淡蓝底 + 粗体「注意」+ 灰正文 | 成立 |
| `autolink-050` | 裸 URL + 一条灰色扫描线从左划过约 60% | "识别"这一拍读得出来（裸 URL 没有标记可演） |
| `undo-050` | 「你好世界」+ 下方浮出半透明的撤销键 | 因果顺序对（文字先变、按键后到） |
| `rm/h1` | 和 `h1-100` **sha256 完全相同** | 减少动效 = 终态，硬证据 |
| `inlineMath-100` | `x²`：`^` 已消失、`2` 抬起并贴回 `x`，右边缘齐平 | 成立（`translateX` 替代 `margin-left` 之后没有推字） |
| `mention-100` | 淡蓝胶囊 + 品牌色 `@nexus` | 成立 |
| `table-100` | 两个带边框的单元格，`\|` 全消失 | 成立（中间那道缝是两条 1px 边框相邻，旧版就是这样） |
| `lab-link-900` | Lab 整页：19/19 徽章、画廊分组、t=900/帧 53、时间轴拍点、绿色"无 layout 属性"、4 行审计（`demo-link-underline::after` 也在）、三条曲线 | 审片台可用 |
| `toolbar-card-0` | playground 里 hover「加粗」：卡片头 + 画布里的 `**文字**`，3 条动画 `playState: running` | Toolbar 与注册表的接线正确 |

Lab 的四个控制也逐个验过（`node .local/check-lab.mjs`，9 条断言全绿）：
初始冻结 t=0、`帧 ▶` = +16.7ms、`帧 ◀` = 回 0、scrub 到 900ms、0.1x（600ms 只走 60ms）、
播放 `running`、暂停 `paused`、`到 100%` = 2400ms。

## 7. 未决问题

1. **`h1/h2/h3` 帧 0 的视觉偏心**：`transform-origin: left center` 是工单指定的，
   代价是字形在帧 0 偏左、到 66% 才落正中。若观感不接受，改 `center center`
   即可（一行，但那时"从左边长出来"的语义就没了）—— 需要产品拍板。
2. **`Toolbar` 的悬停卡片 / 链接输入行**仍是 `grid-template-rows` 过渡
   （工单 §2.6 标"可选"）。改成 `transform: scaleY + opacity` 需要动
   `.link-clip` 的 `visibility` 收尾逻辑，风险不小，本轮没做。
   提及浮层的入场（100ms + 4px）和按钮按下的 `translateY(1px)` 已经做了。
3. **任务复选框 / 图片 / embed 的编辑器侧入场**（计划 P2）没做 —— 那些在
   `src/cm/features/**` 里，本轮禁改。
4. **`demos.css` 是全局样式**（必须如此，理由见文件头）。代价是类名进了全局命名空间；
   都带 `demo-` 前缀，暂时没有冲突，但如果以后有消费方也写 `.demo-*` 就会撞。
5. **`motion-lab/` 不在 `tsconfig.json` 的 include 里**（和 `playground/` 一样），
   所以它只有 eslint 兜着，没有 `tsc` 类型检查。要补就把 `motion-lab` 加进
   `tsconfig.json` 的 `include` —— 但那会让 `npm run typecheck` 依赖审片台的代码，
   本轮没动。
