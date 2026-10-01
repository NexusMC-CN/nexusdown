/**
 * URL 白名单（参考文档 4.7 节）。
 *
 * **白名单 + 默认拒绝**：只有下面三类放行，其余带 scheme 的一律拒绝。
 *   - `http(s)://`
 *   - `data:image/(gif|png|jpeg|webp);`（**和 markdown-it 的 `GOOD_DATA_RE` 逐字一致**，
 *     见下面 `safeUrl` 里的长注释；`image/apng`、`image/svg+xml` 等都不放行）
 *   - **无 scheme 的相对路径**（`./a.png`、`/a.png`、`#anchor`、`?q=1`）
 *
 * ⚠️ `mailto:` 也会被拒（和 silkdown 一致）。要做邮件链接得自己传 policy。
 * ⚠️ 协议相对 URL（`//evil.com`）显式拒绝 —— 它继承页面协议，是钓鱼常用手法。
 *    反斜杠变体（`\\evil.com`）在浏览器里等价于 `//evil.com`，一并拒掉。
 */
import type { UrlPolicy } from './types.js'

/** scheme 的形状：`javascript:`、`data:`、`https:`、`mailto:` … */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * 校验（并**可改写**）一个 URL：返回放行的字符串，或 `null` 表示拒绝。
 *
 * 返回字符串而不是 boolean，是因为「可以返回改写后的 URL」比布尔更好用
 * （比如统一补全成绝对地址、剥掉 `<>`）。默认实现只做 trim。
 */
export function safeUrl(url: string): string | null {
  const trimmed = url.trim()
  if (trimmed.length === 0) return null

  // 协议相对：`//evil.com`。浏览器把 `\` 也当 `/` 处理（对 http/https 这类
  // special scheme），所以 `\\evil.com` 同样会变成协议相对 —— 归一化后再判。
  if (trimmed.replace(/\\/g, '/').startsWith('//')) return null

  // 无 scheme：相对路径 / 绝对路径 / 锚点 / 查询串。它们**不可能跳到别的站点**，
  // 一律放行。
  if (!SCHEME_RE.test(trimmed)) return trimmed

  if (/^https?:\/\//i.test(trimmed)) return trimmed

  /*
   * 内联图片。**必须和 markdown-it 的 `GOOD_DATA_RE` 逐字一致**：
   *
   *   node_modules/markdown-it/dist/markdown-it.mjs:3532
   *     GOOD_DATA_RE = /^data:image\/(gif|png|jpeg|webp);/
   *
   * 即：只认这四种 subtype，而且后面**必须紧跟 `;`**。其余 `data:image/*`
   * （`image/apng`、`image/svg+xml`、`image/bmp`、`image/avif`…）以及缺分号的
   * 写法一律拒绝。
   *
   * ## 为什么是**收紧这里**，而不是放开 markdown-it
   *
   * 渲染侧产出的才是「发出去的东西」。编辑器放行、渲染器拒绝的写法 =
   * 作者在编辑器里看到图、一发布图没了 —— 这正是本库要消灭的那类「两侧不一致」。
   * 之前这里放行 `data:image/*`、渲染侧只认四种，于是 **APNG（`image/apng`）
   * 与 SVG（`image/svg+xml`）两侧行为相反**，就是这个 bug。
   *
   * 往哪个方向对齐两种都行，但**收紧这里**更安全：
   *   - 改 `md.validateLink` 是个**全局**开关，会连 `<a href>` 的 `data:` 一起放行
   *     （`data:` 顶层导航、SVG 载荷的面比 `<img>` 大得多）；
   *   - 只改这一个函数，影响面仅限「编辑器认不认这个 URL」这一条，不动渲染器契约。
   *
   * 收敛到「渲染器的白名单」还有个额外好处：白名单从此只有**一份**（markdown-it 内置），
   * 不需要两边各自维护。`tests/cm/media.test.ts` 里有交叉断言盯着这条不变量。
   */
  if (/^data:image\/(?:gif|png|jpeg|webp);/i.test(trimmed)) return trimmed

  // 其余带 scheme 的全部拒绝：`javascript:` / `vbscript:` / `file:` / `blob:` /
  // `mailto:` / 以及任何自定义 scheme。
  return null
}

/** 默认策略：直接委托给 `safeUrl`。装配层可用 `urlPolicy` 选项覆盖。 */
export const defaultUrlPolicy: UrlPolicy = (url) => safeUrl(url)

export type { UrlPolicy }
