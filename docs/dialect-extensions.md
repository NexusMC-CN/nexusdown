# 扩展方言规范

这份文档是**契约**：每个扩展的语法、编辑器侧行为、渲染侧产出都钉死在这里。
两侧实现（`src/cm/features/` 与 `src/render/features/`）必须照它来。

> **为什么需要它**：这个库存在的理由就是「编辑器和渲染器是同一套语法认知」。
> 两侧一旦各自演化，就会出现「编辑器写出渲染器读不出来的语法」。
> 所以**先定语法，再写两侧**。

## 通用约定

| 约定 | 说明 |
| --- | --- |
| 功能命名 | kebab-case，两侧同名：`table` / `math` / `emoji` / `embed` / `carousel` / `link-card` |
| 编辑器侧文件 | `src/cm/features/<name>.ts`（+ `<name>.css`） |
| 渲染侧文件 | `src/render/features/<name>.ts` |
| 测试 | `tests/cm/<name>.test.ts` / `tests/render/<name>.test.ts` |
| 转义 | 一律用渲染侧的 `ctx.escapeHtml`，不要自己写 |
| 用户输入 | **只往文本位置插**，绝不拼进标签名/属性名 |

**三条硬约束**（违反即架构事故）：

1. **隐藏态的 `replace` 必须同时进 `atomicRanges`**，否则光标会停在隐藏区间中间。
2. **块级替换只能由 `StateField` 提供** ✓ —— 插件（`ViewPlugin`）提供会**抛**
   `Block decorations may not be specified via plugins` ✗
   （实测：插件的 `decorations` 会被包成函数、标记为动态，一律禁止块级效果）。
   骨架已开好通道：功能标 `EditorFeature.block` ✓ → `plugin.ts` 的 `splitFeatures`
   分流到 `blockDecorations` ✓。
3. ★ **块级替换必须配「点开才揭示」** ✓ —— 块级区间**光标进不去** ✗
   （连程序 `dispatch(cursor(from))` 都被夹到 `from - 1` ✓），
   所以"揭示源码"只能靠停在**门口** ✓。但**门口是位置判据** ✗，
   而**空行整行都等于门口** ✓ → 光标**路过**也会命中 ✗
   （实测：公式上下是空行时，光标停在那一行 → **公式不渲染** ✗）。
   所以：**点 widget → 设 `editingBlock`** ✓，靠**意图**判据揭示 ✓。

> ⚠️ 这条**以前写的是「不做 `block: true`」** ✗ —— 那个结论已经被推翻了 ✓：
> 表格和数学围栏都用了块级替换 ✓，靠上面第 3 条绕开了方向键问题 ✓。

---

## 0. 属性行（变体层）

**定位：`{…}` 是「块的后缀」，不是「行内的替代品」。**

### 0.1 放哪

| 块 | 属性行位置 | 例 |
| --- | --- | --- |
| 围栏代码 / 围栏组件 | **info string 行尾** | ` ```ts {title="a.ts" lines=1-20} ` |
| 围栏 / 引用 | **块后一行**（独占一行） | 围栏后一行 `{title="a.ts"}` |
| 表格 | **空一行再写**（独占一行） | 见下 |
| 列表 | **空一行再写**（独占一行） | 见下 |

```md
- 第一步
- 第二步

{.steps}
```

> ⚠️ **列表和表格后面必须空一行。**
>
> - 列表：不空行的话，CommonMark 会把 `{.steps}` 当成最后一个列表项的**续行**
>   （lezer 与 markdown-it 都如此），它就不是属性行，而是列表项里的一段文字。
> - 表格：不空行的话，**markdown-it 的表格规则会把 `{.fields}` 当成一行数据**
>   （实测会多出一行 `{.fields}`），只有空行能让它结束表格。
>
> 围栏 / 引用后面不需要空行。
>
> 编辑器侧（`src/cm/features/attrs.ts`）用语法树的 `prevSibling` 判定
> 「前一个块能不能带属性」，所以空行不影响识别；渲染侧（阶段 2）要按同一条
> 规则实现：**只把紧跟块（允许隔空行）的 `{…}` 段落当属性行**。

### 0.2 语法

- 键：kebab-case（`full-width` / `line-numbers`），不写驼峰。
- 值：双引号字符串（`title="a.ts"`）或裸数字（`lines=1-20`）。
- 布尔属性：只写名字（`full-width`）。
- 类简写：`.steps` 等价于 `class="steps"`，只允许在**变体**上使用。
- 一个块**最多一行**属性；重复出现 → 后者忽略并告警（渲染侧不抛）。

### 0.3 四条硬规则

1. **行内不引入 `{}`。** 行内语义继续用定界符（`==` / `$` / `@` / `:`）。
   唯一的例外是「行内语义需要参数」时才允许 `[文本]{.mark tone="yellow"}`，
   且它是 `==` 的**等价扩展**，不是替代。
2. **类型留在围栏 info 里**（` ```math ` / ` ```mermaid `），`{}` 只放**参数**。
   不要出现 ` ```{.mermaid} ` 这种写法。
3. **形态选择靠段落位置**（独占段落链接 → 卡片、连续图片 → 轮播），
   `{}` 只做**覆盖**：`{.card}` / `{.no-card}` / `{.gallery}` / `{.no-carousel}`。
4. **最坏情况只多一行字面量。** 在 GitHub / 纯文本里，`{.steps}` 显示为一行字，
   不破坏可读性 —— 这是可接受的代价；行内属性会破坏正文，所以行内不做。

### 0.4 两侧实现约定

- **共用扫描器**：`src/shared/attrs.ts` 导出 `parseAttrLine(text)` /
  `splitTrailingAttrs(info)`，编辑器与渲染器**只认这一个解析器**。
- **解析失败 = 当普通文本**：渲染侧不抛错、不吞内容；编辑器侧保持原文并淡化。
- **渲染侧**：markdown-it 在 `core` 阶段后处理 token —— 属性行自己会变成一个
  `paragraph_open/inline/paragraph_close`，规则把它**挂到前一个块**并从输出里删掉。
- **编辑器侧**：属性行是普通 `Paragraph`，由块级通道在扫描前一个块时识别并跳过
  （不新增 lezer 节点）。

### 0.5 首批允许的属性

| 块 | 属性 | 含义 |
| --- | --- | --- |
| 围栏代码 | `title` / `lines` / `highlight` | 标题、行号区间、行高亮区间 |
| 围栏代码 / 公式 | `#id` / `label` | 锚点与编号（`{#eq-1 label="(1)"}`） |
| 列表 | `.steps` / `.cards` | 步骤 / 卡片网格 |
| 表格 | `.fields` / `caption` / `full-width` | 参数表 / 标题 / 全宽 |
| 段落 | `.card` / `.no-card` / `.gallery` / `.no-carousel` | 覆盖自动判定 |

> 未列出的属性一律**忽略并告警**（渲染侧 `console.warn` 一次，构建期可升级为错误）。
> 新增属性 = 先改本节，再改两侧 —— 和新增语法同一条纪律。

---

## 1. `table` —— 表格

**语法**：标准 GFM 管道表，**不新增语法**。

```md
| 语言 | 用途 |
| --- | --- |
| Rust | 系统 |
```

**编辑器侧**：认领 `Table` 节点（lezer GFM 已产出 `Table` / `TableHeader` / `TableDelimiter` / `TableCell` / `TableRow`）。
只做**视觉增强**：表头行加粗、`|` 与 `---` 淡化、等宽对齐。**不做单元格编辑**（越界）。
⚠️ 用 `Decoration.line` / `mark`，**不要 replace 整块**。

**渲染侧**：已有 `applyTableRules`（`renderer.ts`）—— **保持不动**，本次只补编辑器侧。

---

## 2. `math` —— 数学公式

**语法**：

- 行内：`$E = mc^2$`
- 块级（**正典**）：`$$ … $$`

  ```md
  $$
  \int_0^1 x^2 dx
  $$
  ```

- 块级（**别名**）：` ```math ` 围栏 —— 与 `$$` 产出**逐字节一致**的 HTML，保留是因为
  已有内容都这么写。

  ~~~~md
  ```math
  \int_0^1 x^2 dx
  ```
  ~~~~

> **为什么现在是 `$$` 正典**（本文件以前写的是「块级用围栏，不用 `$$`」）：
> 老理由只成立于「两侧各写一套块级判定」。现在判定只有**一份** ——
> `src/shared/math-block.ts` 的 `isMathBlockFenceLine` / `parseSingleLineMathBlock` /
> `joinMathBlockLines`，渲染侧的 block rule 与编辑器侧的 `Paragraph` 分支都调它；
> 产出则复用同一条渲染路径（`renderBlockMath`）。于是「两套语法记一件事」这个代价
> 消失了，收益是作者视角的：`$$` 在 GitHub / 绝大多数 Markdown 工具里都认，
> ` ```math ` 不认。

### 2.1 `$$` 的边界规则（写死，两侧共用同一份判定）

| 写法 | 结果 | 为什么 |
| --- | --- | --- |
| `$$` 单独一行 … `$$` 单独一行 | 多行公式 | 正典形态 |
| `$$x^2$$` 整行（闭合 `$$` 在**行尾**，允许行尾空白） | 单行公式 | 常见的一行写法 |
| `$$5` | **不是**公式 | 开 `$$` 后紧跟普通文本 —— 否则一个价格会把后面整篇吞进公式块 |
| `$$x$$ 后面还有字` | **不是**公式 | 闭合 `$$` 不在行尾 → 硬判会把后半句吞掉 |
| `$$\n$$` / `$$$$` | **不是**公式 | 空内容会产出看不见、也点不到的空块 |
| 4 个以上前导空格 | **不是**公式 | 那是缩进代码块，`$$` 是字面量 |
| 未闭合的 `$$` | **不是**公式 | 源码原样，作者看得见自己漏了 |

行内 `$…$` 的规则**不变**：开 `$` 后非空白、闭 `$` 前非空白（挡 `$5 and $6`），
闭 `$` 后不紧跟数字（挡 `$x$5`）。`$$` 一律不进行内规则。

### 2.2 两侧的覆盖差异（刻意接受）

| 写法 | 渲染侧 | 编辑器侧 |
| --- | --- | --- |
| 顶层的 `$$…$$` | 公式 | 公式（点开揭示源码） |
| 引用块 / 列表里的 `$$…$$` | 公式 | **源码**（只认顶层段落） |
| 中间夹**空行**的 `$$…$$` | 公式 | **源码**（lezer 把它切成两个段落） |
| 没注入 `mathRenderer` | 降级成 `<pre class="nd-math-source">` | 源码原样（围栏那条退回普通代码块） |

原因：`$$` 块在 lezer 里是**一个 `Paragraph`**，而块级替换会盖掉整行 ——
引用块 / 列表的行上已经有 `Decoration.line`（引用竖线、列表背景），两种装饰叠在
同一行上的表现没实测过，所以不做。**语法判定两边是同一份**，差异只在
「编辑器能覆盖到哪些位置」。

### 2.3 实现要点

- **渲染侧**：`block.ruler.before('fence', 'nd_math_block', …)`。⚠️ `silent` 必须给
  **准确答案**（先把闭合行找完再回 `true`）—— 否则没闭合的 `$$` 会被判成块开头，
  段落被硬切两半、凭空多一个 `<p>`。
- **编辑器侧**：`math` 功能认领 **`Document` + `Paragraph`**。而 `Paragraph` 同时被
  `mention` 认领 —— 这是注册表「一个节点 → 多个功能」的第一批使用者
  （见 `src/cm/feature.ts` 的 `EditorFeature.nodes`），两个功能各按自己的文本判据 no-op。
- KaTeX 仍然是**可选依赖**、仍然 `trust: false`，见下。

**编辑器侧**：
- 行内：需要新增 lezer 行内扩展产出 `InlineMath` 节点，或**退化方案** —— 用行内正则扫描（见 `decorate/link.ts` 的扫法）。**优先做退化方案**（不引入 lezer 扩展）。
- 块级 ` ```math `：走 `fence.ts` 的 `info === 'math'` 分支。
- 块级 `$$…$$`：`Paragraph` 分支（lezer 把整块解析成一个段落），走**块级通道**，点开才揭示。
- widget 必须实现 `eq`，并登记 `atomicRanges`。

**渲染侧**：`katex.renderToString(tex, { throwOnError: false, trust: false })`。
⚠️ `trust` **绝不能开**（会放行 `\href` / `\includegraphics` / `\html*`）。
⚠️ **KaTeX 字体必须随包分发**（离线环境字体缺失会静默排错）。
⚠️ KaTeX 是**可选依赖**，用 `import()` 或让消费方装 —— **不进主包**。

---

## 3. `emoji` —— 表情

**语法**：`:smile:` 短代码。

**编辑器侧**：行内正则扫描（同 `link.ts` 的扫法）。非揭示态 → `Decoration.replace` 成字形（**登记 atomic**）；
揭示态 → 保留源码。**必须跳过代码块和行内代码**。

**渲染侧**：`rules.text` 里替换，或挂 `markdown-it-emoji`。

⚠️ **两侧必须共用同一张 shortcode 表** —— 这是这个功能唯一的真风险。表放
`src/shared/emoji-data.ts`，两侧 import 同一个。
⚠️ 只收**常用集**（几百个），不要把 `full`（几千个、几十 KB）塞进主包。

---

## 4. `embed` —— 第三方嵌入（B站 / 抖音 / 网易云）

**语法**：`embed` 围栏 + **一个 URL**（**正典**）。

~~~~md
```embed https://www.bilibili.com/video/BV1xx411c7mD
```

```embed https://www.douyin.com/video/7458617091420114236
```

```embed https://music.163.com/song?id=110761
```
~~~~

**legacy**（三段位置参数，**保留**但不再推荐）：

~~~~md
```embed bilibili video BV1xx411c7mD
```

```embed netease playlist 473007041
```
~~~~

> **为什么 URL 形式是正典**：作者记不住 `provider kind id` 三段位置参数
> （`netease song 110761` 里哪段是 kind？），而**链接是作者手里本来就有的东西**。
> 更要紧的是它和「独占一段的平台链接 → 自动 embed」走**同一个 `resolveEmbedFromText`**，
> 于是「贴链接自动转」和「强制 embed」不再可能各认一套。
>
> **分支判据是段数**：`embed <url>` 是 2 段、`embed provider kind id` 是 4 段；
> 其余段数一律降级成**普通代码块**（不猜）。

**三家共用一套机制**：差异只在「provider → URL 模板」和「ID 正则」，做成一张表。

| provider | kind | ID 形态 | iframe src 模板 |
| --- | --- | --- | --- |
| `bilibili` | `video` | `BV[0-9A-Za-z]{10}` | `//player.bilibili.com/player.html?bvid={id}&autoplay=0` |
| `douyin` | `video` | `\d{15,20}` | `https://open.douyin.com/player/video?vid={id}&autoplay=0` |
| `netease` | `song` | `\d+` | `//music.163.com/outchain/player?type=2&id={id}&auto=0&height=66` |
| `netease` | `playlist` | `\d+` | `//music.163.com/outchain/player?type=0&id={id}&auto=0&height=430` |

⚠️ **ID 必须过正则校验后才拼进 URL** —— iframe 的 src **永远由我们用模板构造**，
**绝不放用户给的 URL**。这是这一块的安全底线。URL 形式也一样：从链接里**只提取 ID**，
src 仍由模板拼出来，用户给的 URL 本身**不进输出**。

**非法输入 = 普通代码块**：URL 不是已知平台、ID 不过正则、段数不对 —— 一律交回
`baseFence`（普通代码块），**绝不输出空 iframe**。作者一眼能看见自己写错了。

**链接自动识别**：作者贴一行链接时，若匹配到已知平台的长链，**自动**转成 embed。
- `www.bilibili.com/video/BVxxx` → 提取 BV 号
- `www.douyin.com/video/{19位}` → 提取数字
- `music.163.com/song?id=` / `/playlist?id=` → 提取数字

**短链**（`b23.tv` / `v.douyin.com` / `163cn.tv`）**渲染期解不了**（同步、不联网）：
走 `RenderData.links` —— 消费方预先解析好传进来；没传就**降级成普通链接**（不要报错）。
` ```embed <短链> ` 同理：有数据 → 播放器，没数据 → 普通代码块。

**编辑器侧**：复用 `fence.ts` 的逐行装饰（**不碰 block widget**）。
非揭示态显示一张占位卡（provider 图标 + 标题），揭示态显示源码。
⚠️ **不加载真实 iframe**（编辑器里嵌第三方播放器会抢焦点、拖慢输入）。
⚠️ **编辑器没有 `env`**，所以 ` ```embed <短链> ` 在编辑器里显示成**代码块**
（渲染侧有数据时是播放器）—— 这是刻意的降级，因为编辑器不联网、也没有 `RenderData`。

**渲染侧**：输出 `<div class="nd-embed">` + `<iframe>`：
```
sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
allow="fullscreen; autoplay"
referrerpolicy="strict-origin-when-cross-origin"
loading="lazy"
```
⚠️ **默认点击才加载**（防首屏第三方追踪）：先渲染占位，用户点了才注入 iframe。
⚠️ 离线时 iframe 空白 —— 必须有**可控的降级占位**。

---

## 5. `carousel` —— 媒体轮播

**语法**：**独占一段的连续图片**，不新增语法。

```md
![图一](a.png)
![图二](b.png)
```

（两张以上、同一段、中间没有空行 → 轮播）

**编辑器侧**：**每张图仍是独立的 `ImageWidget`**（跨行 widget 做不到，见硬约束 1）。
只在首行加一个切换栏（`1/3` + 左右箭头）作为**视觉提示**，点击走 `Decoration` 之外的路径
（改选中的 `index`）—— 本次**只做静态提示**，不做真切换。

**渲染侧**：输出**零 JS** 的 `scroll-snap` 结构 + `<a href="#slide-N">` 锚点，
**无 JS 也能滑**（移动端原生手势 / 键盘 Tab）。

```html
<div class="nd-carousel">
  <ul class="nd-carousel__track">
    <li id="nd-c-1"><img …></li>
    …
  </ul>
  <ol class="nd-carousel__dots">…</ol>
</div>
```

⚠️ 不要引入运行时 JS（库不带运行时；带了 SSR 就复杂了）。

---

## 6. `link-card` —— SEO 卡片

**语法**：**独占一段的单个链接**。

```md
https://example.com/post
```

或

```md
[标题](https://example.com/post)
```

**边界（重要）**：**库绝不抓取。** 服务端抓用户给的任意 URL 就是 SSRF 面
（内网地址 / `169.254.169.254` / `file:`）。所以：

| 谁 | 做什么 |
| --- | --- |
| **库** | 识别「独占一段的链接」→ 从 `RenderData.links` 取元数据 → 渲染卡片；**取不到就降级成普通 `<a>`** |
| **消费方** | 抓取、缓存、超时、robots、**SSRF 防御**（禁内网/私有地址/非 http(s) 协议） |

**渲染侧**：`<a class="nd-card" href>` + 缩略图 + 标题 + 描述 + 站点名。
⚠️ 缩略图 URL 也**必须过 URL 白名单**（消费方预取时就该过滤）。

**编辑器侧**：非揭示态把该链接换成行内卡片 widget（**要登记 atomic**）。

---

## 7. `media` —— 动态图

**不新增语法**，`![x](a.gif)` 照旧。

要做的只是**对齐两侧的白名单**：
- `src/cm/util/url.ts` 放行 `data:image/*`
- markdown-it 内置只认 `gif|png|jpeg|webp`

→ 让两侧对 **APNG（`image/apng`）** 与 **SVG** 的行为一致。

⚠️ 另外加 `prefers-reduced-motion` 的暂停能力（CSS 做不到暂停 GIF，
只能提示；真正的暂停要 JS，本次不做，只留注释说明）。

---

## 8. `mention` —— 提及（站内实体引用）

**语法**：`@` + slug（可选 `#` + 子定位）。

~~~~md
这句话里提到 @nexus-optimizer 很好用      ← 行内提及（小胶囊）

@nexus-optimizer                          ← 独占一段 → **大卡片**

@nexus-optimizer#block-install            ← 带子定位（fragment）
~~~~

**「独占一段 → 卡片、在句中 → 行内」是从 `link-card` 抄的** ✓ ——
它自己的规则就是「独占一段的链接 → 卡片」✓。**一个 token 两种形态** ✓，
用户不用记两套语法 ✓，写作时"换个段落"就换形态 ✓。

### 和另外两种「引用」的区别（重要）

| | `>` 引用块 | `link-card` | **`mention`** |
| --- | --- | --- | --- |
| 指向什么 | 一段**文字** | **外站 URL** | **站内实体**（`resource` / `tutorial` / `post`） |
| 数据从哪来 | 正文里就有 | 服务端抓 OG | **查库** |
| 对象删了 | 无影响 | 链接可能 404 | **「已失效」墓碑** ✓（和 `p.ref.missing` 同一套） |
| 数据库里留痕 | 没有 | **没有** | ★ **有** —— 落一条 `reference` |

★ **最后一行是本质区别** ✓：`link-card` 抓完 OG 就完了 ✓，**库里什么也没留下** ✗；
而提及落一条 **`reference`**（`relation: 'mentions'` ✓）✓ —— 于是
**「谁引用了这个资源」「这个资源影响了哪些帖」** 才答得出来 ✓✓。

**叫法**：`>` 保留「引用」（Markdown 标准叫法 ✓）；新的叫**「提及」** ✓ ——
用项目自己的词 ✓（`backend-spec` 的 `relation` 里就有 `mentions` ✓）。

### 边界（重要）

| 谁 | 做什么 |
| --- | --- |
| **库** | 认 `@slug` ✓ → 从 `RenderData.mentions` 取解析结果 ✓ → 渲染胶囊/卡片；**取不到就降级成纯文本** ✓ |
| **消费方** | 查库解析 slug ✓（**作者不用写显示名** ✓ —— 这是站内引用独有的优势 ✓）、**落 `reference`** ✓、墓碑 ✓ |

⚠️ **slug 必须过正则**（`[a-z0-9][a-z0-9-]*` ✓）且 `@` 必须在**词边界** ✓ ——
否则 `a@b.com` 这种邮箱会被误认 ✓。

⚠️ **库不查库** ✓ —— 和 `link-card` 同一条：库只认文本、从 `RenderData` 取结果 ✓。

### `RenderData` 契约

```ts
export interface RenderData {
  links?: ReadonlyMap<string, LinkResolution>     // 已有 ✓
  mentions?: ReadonlyMap<string, MentionResolution>  // 新增 ✓
}

/**
 * key = **作者写的 slug，不含 `#fragment`** ✓（`@a/b#x` → key 是 `a/b` ✓）。
 *
 * ⚠️ **这条以前没写死，是真歧义** ✗ —— `#fragment` 是**子定位** ✓
 * （"引用某个视频的第 30 秒" ✓），指向的还是**同一个实体** ✓，
 * 所以 key 用实体、fragment 拼到 `href` 尾部 ✓。
 * 消费方按 `slug#fragment` 建表的话会**取不到** ✓。
 */
export interface MentionResolution {
  title: string                 // 显示名（查库得到 ✓）
  href: string                  // 站内路径
  kind: 'resource' | 'tutorial' | 'post'
  summary?: string              // 卡片用
  image?: string                // 卡片用（同样要过 URL 白名单 ✓）
  byline?: string               // 作者 / 维护者
  badges?: string[]             // 站内才有的角标（版本号 / 下载量 ✓）
  missing?: boolean             // 目标已删 → 渲染成「已失效」墓碑 ✓
}
```

### 渲染侧

- **行内**：`<a class="nd-mention" href>` + 显示名（小胶囊 ✓）
- **卡片**：`<a class="nd-mention-card" href>` + 图标 + 显示名 + 摘要 + 角标
- **`missing: true`** → `<span class="nd-mention nd-mention--missing">已失效</span>` ✓
  （**不能**渲染成链接 ✗ —— 点了就 404 ✓）

### 编辑器侧

- **行内**：换成行内 widget ✓（**要登记 atomic** ✓）
- **卡片**：整段是一个 `Paragraph` ✓ → **不跨行** ✗ → **不需要块级通道** ✓✓
  （这是刻意的 ✓：能不用块级就不用 ✓）
- **揭示**：光标进到那一段就露出源码 ✓（行内 widget 用现有那套 ✓）

### ★ 两侧共用一份样式（`@nexusmc-cn/nexusdown/dialect.css`）

`mention`（以及以后的 `nd-card` / `nd-embed` / `nd-carousel`）的类名**两侧都产**，
所以样式放在**一个文件**里：`src/shared/dialect.css`。

- **编辑器**：`@nexusmc-cn/nexusdown/cm/theme.css` 顶部 `@import '../shared/dialect.css'` ✓，
  再由 `@nexusmc-cn/nexusdown/editor` 的 `.vue` 引 `theme.css` ✓。
- **渲染侧**：消费方直接引 `@nexusmc-cn/nexusdown/dialect.css` ✓（只渲染不编辑的页面**不用**背上
  整个编辑器主题 ✓）。
- 编辑器专属的几何差异（卡片要 `inline-flex` + `width: 100%`，见下）写在
  `.cm-editor` 前缀的选择器里 ✓ —— 渲染侧天然不吃 ✓。

⚠️ 这条是**本次修复的核心** ✓：以前 mention 的样式在 `src/cm/features/mention.css`
（名字上像"编辑器专属" ✓），渲染侧引不到 ✗ → 发出来的卡片没有样式 ✗ → 两侧必然不一样 ✗。

### 编辑器侧的卡片：注入 `mentions` 才和发布侧同构

编辑器**不查库** ✓（同 `mathRenderer` / `RenderData`）。要让卡片显示
「标题 / 图标 / 角标 / 缩略图」✓，消费方把**和渲染侧同一份**的解析结果也喂给编辑器 ✓：

```ts
// 同一份数据喂两侧 —— 形状就是 RenderData.mentions
mountEditor({ parent, doc, mentions: data.mentions })
renderMarkdown(src, { data })
```

- **注入了** ✓：卡片 DOM 逐节点对齐 `renderCard()` ✓（图标 + 标题 + 摘要 + 署名 +
  角标 + 缩略图 ✓），`image` 同样**过 URL 白名单** ✓。
- **没注入** ✓：卡片照画，但**不画 `__icon`** ✓ —— 一个空的方块看起来就是"图标坏了" ✗，
  比没有图标更糟 ✓。
- **`missing: true`** ✓：**不做卡片** ✓（退回行内、套 `--missing` ✓），
  对齐渲染侧 core 规则的 `if (!res || res.missing) continue` ✓。
- ⚠️ **行内胶囊仍然显示源码 `@slug`** ✓（不显示显示名 ✓）—— 编辑器里它是
  「你写的那个语法」的提示 ✓；渲染侧才换成 `<a href>显示名</a>` ✓。
  两侧的**颜色/底色共用同一套** ✓，所以"同一个胶囊"的观感一致 ✓。

### ⚠️ 消费方要装 `@codemirror/autocomplete`

编辑器侧「打 `@` 就地弹候选」依赖 **`@codemirror/autocomplete`** ✓ ——
它是本包的 **`optional` peer** ✗：**不装不会报错** ✗，
而是**静默不挂补全** ✓（和 `@codemirror/language` 那个坑同款 ✓）。

⚠️ 而且**消费方还必须把它列进 `optimizeDeps.include`** ✗ ——
不列的话它会像 `@codemirror/language` 当初一样被**内联进别人的 chunk** ✓，
导致补全拿到的 `CompletionContext` 和编辑器那份**不是同一个实例** ✓
→ **打 `@` 什么都不弹、控制台零报错** ✓（最难查的那种 ✓）。

### ⚠️ 已知覆盖差异（编辑器侧只认段落）

编辑器侧认领 `Paragraph` ✓（`Document` 归 `math`；`$$` 块级数学也认 `Paragraph` ——
注册表现在允许**一个节点被多个功能认领**，两个功能各按自己的文本判据 no-op ✓），
而**标题 / 表格单元格不是 `Paragraph`** ✗ —— 所以那里的提及**编辑器里不渲染** ✓，
但**渲染侧会** ✓（`rules.text` 扫全文 ✓）。

**这是刻意接受的** ✓：两边覆盖范围不同 ✓，但**同一处文本的判定一致** ✓
（共用 `src/shared/mention.ts` 的 `scanMentions` ✓）。要对齐得让 mention 认领标题节点 ✓
并代理 `decorateHeading` ✓ —— 耦合太深 ✓，暂不做 ✓。

---

## 9. `callout` —— 提示块（`> [!NOTE]`）

**语法**：引用块的**第一行**是 `[!TYPE]`。

```md
> [!NOTE]
> 正文可以有多行，里面照常有 **行内标记**。
```

**10 种类型**（`src/shared/callouts.ts` 是**唯一的表**，两侧 import 同一个）：

| `[!TYPE]` | 显示名 | 图标 |
| --- | --- | --- |
| `note` | 注意 | ℹ |
| `tip` | 提示 | ✦ |
| `important` | 重要 | ❗ |
| `warning` | 警告 | ⚠ |
| `caution` | 小心 | ⊘ |
| `danger` | 危险 | ⛔ |
| `info` | 信息 | ⓘ |
| `success` | 成功 | ✓ |
| `question` | 疑问 | ? |
| `example` | 示例 | ≡ |

### 9.1 判定规则

| 写法 | 结果 |
| --- | --- |
| `> [!NOTE]` + 正文 | callout |
| `> [!note]`（小写） | callout（大小写不敏感） |
| `> [!NOTE] 正文同一行` | callout，标记被摘掉、正文留下 |
| `> [!FOO]`（未知类型） | **普通 `<blockquote>`**，`[!FOO]` 原样留着（不报错、不吞内容） |
| `> [!NOTE]x`（`]` 后没有空白） | 普通引用块（那是「链接后接字」，不是声明） |
| `> 正文` / `> [!NOTE]` 不在首行 | 普通引用块 |
| `> > [!NOTE]`（嵌套引用） | 外层普通引用块，**内层**才是 callout |
| `> - 一项` 之类首段不是段落 | 普通引用块 |

### 9.2 两侧产出（类名逐个相同）

| 谁 | 结构 |
| --- | --- |
| 渲染侧 | `<div class="nd-callout nd-callout--note"><p class="nd-callout__title"><span class="nd-callout__icon" aria-hidden="true">ℹ</span><span class="nd-callout__label">注意</span></p><p>正文</p></div>` |
| 编辑器侧 | 整块每行 `.cm-line.nd-callout.nd-callout--note`（首/末行加 `nd-callout-first` / `nd-callout-last` 圆角），首行标记换成同一个 `__title` 结构的**行内** `<span>` |

- **样式**：`src/shared/dialect.css`（两侧共用）。颜色一律
  `var(--nd-*, var(--站令牌, 字面量))` 两级回退，10 类型 = 色板 + 图标。
- **揭示态**：编辑器里露出源码 `[!NOTE]`（淡化），和行内标记同一套「光标碰到就揭示」。
- ⚠️ 编辑器侧的 `__title` 是**行内** widget，`display` 必须是 `inline-flex`
  —— 块级 widget 会和 CM6 插的 `cm-widgetBuffer` 垂直堆叠，把高度表搞坏
  （同 `.nd-mention-card` 那条注释）。


## 10. `tabs` —— 页签组

**语法**：**相邻的围栏**，每个围栏后面跟一行 `{tab="…"}`。

````md
```bash
apt install nginx
```
{tab="Ubuntu"}

```bash
brew install nginx
```
{tab="macOS"}
````

**判定**：

- 连续的 `fence` token，每个都带 `tab` 属性；
- 围栏之间**只允许空行**（空行不是 token，不影响相邻）；夹了别的块就断开；
- 只有 1 段时**不组**，照常渲染成代码块。

**渲染侧**：零 JS —— `input[type=radio]` + `label` + 相邻兄弟选择器；
每组替换成一个 `html_block` token。当前页签的 label 高亮用 `:has()`（最多 6 个）。

**编辑器侧**：整组是一个**块级 replace**，内容来自 `renderMarkdown(整组源码)`
（和表格/公式同一套「原子节点共用 HTML 投影器」）。点**页签栏**切换页签；
点面板/其它区域 → 揭示源码（`editingBlock`）。

**为什么整组换成一个 widget，而不是自己画页签 UI**：页签是跨 `FencedCode` 的组，
CM6 没有「组」节点；自己画一套 UI 要重写选中态、键盘切换、源码同步、揭示态，
而且很难和渲染侧逐字一致。复用 `renderMarkdown` 是**结构性保证**。
