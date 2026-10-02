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

**两条硬约束**（违反即架构事故）：

1. **不做 `Decoration.replace({ block: true })`** —— 方向键会永远进不去。
   块级视觉靠「藏掉行内字符 + 给行加 class + CSS 画」。
2. **隐藏态的 `replace` 必须同时进 `atomicRanges`**，否则光标会停在隐藏区间中间。

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
