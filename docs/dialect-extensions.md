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
- 块级：用**围栏**，不用 `$$`

  ~~~~md
  ```math
  \int_0^1 x^2 dx
  ```
  ~~~~

> **为什么块级用围栏而不是 `$$`**：`$$` 要两侧各写一个块级解析器（lezer 扩展 + markdown-it block rule），
> 而围栏两侧**都已经解析好了**，只是换个 `info`。省掉一整类解析工作。

**编辑器侧**：
- 行内：需要新增 lezer 行内扩展产出 `InlineMath` 节点，或**退化方案** —— 用行内正则扫描（见 `decorate/link.ts` 的扫法）。**优先做退化方案**（不引入 lezer 扩展）。
- 块级：走 `fence.ts` 的 `info === 'math'` 分支。
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

**语法**：`embed` 围栏 + 三段 `provider kind id`。

~~~~md
```embed bilibili video BV1xx411c7mD
```

```embed douyin video 7458617091420114236
```

```embed netease song 110761
```

```embed netease playlist 473007041
```
~~~~

**三家共用一套机制**：差异只在「provider → URL 模板」和「ID 正则」，做成一张表。

| provider | kind | ID 形态 | iframe src 模板 |
| --- | --- | --- | --- |
| `bilibili` | `video` | `BV[0-9A-Za-z]{10}` | `//player.bilibili.com/player.html?bvid={id}&autoplay=0` |
| `douyin` | `video` | `\d{15,20}` | `https://open.douyin.com/player/video?vid={id}&autoplay=0` |
| `netease` | `song` | `\d+` | `//music.163.com/outchain/player?type=2&id={id}&auto=0&height=66` |
| `netease` | `playlist` | `\d+` | `//music.163.com/outchain/player?type=0&id={id}&auto=0&height=430` |

⚠️ **ID 必须过正则校验后才拼进 URL** —— iframe 的 src **永远由我们用模板构造**，
**绝不放用户给的 URL**。这是这一块的安全底线。

**链接自动识别**：作者贴一行链接时，若匹配到已知平台的长链，**自动**转成 embed。
- `www.bilibili.com/video/BVxxx` → 提取 BV 号
- `www.douyin.com/video/{19位}` → 提取数字
- `music.163.com/song?id=` / `/playlist?id=` → 提取数字

**短链**（`b23.tv` / `v.douyin.com` / `163cn.tv`）**渲染期解不了**（同步、不联网）：
走 `RenderData.links` —— 消费方预先解析好传进来；没传就**降级成普通链接**（不要报错）。

**编辑器侧**：复用 `fence.ts` 的逐行装饰（**不碰 block widget**）。
非揭示态显示一张占位卡（provider 图标 + 标题），揭示态显示源码。
⚠️ **不加载真实 iframe**（编辑器里嵌第三方播放器会抢焦点、拖慢输入）。

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

/** key = 作者写的 slug（`@` 后面那串 ✓），不是显示名 ✓。 */
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
