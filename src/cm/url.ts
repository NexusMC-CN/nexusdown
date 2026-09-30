/**
 * URL 白名单（参考文档 4.7 节）。
 *
 * **白名单 + 默认拒绝**：只有下面三类放行，其余带 scheme 的一律拒绝。
 *   - `http(s)://`
 *   - `data:image/*`
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
  // 内联图片。`data:image/*` 放在 <img src> 里不会执行脚本。
  if (/^data:image\//i.test(trimmed)) return trimmed

  // 其余带 scheme 的全部拒绝：`javascript:` / `vbscript:` / `file:` / `blob:` /
  // `mailto:` / 以及任何自定义 scheme。
  return null
}

/** 默认策略：直接委托给 `safeUrl`。装配层可用 `urlPolicy` 选项覆盖。 */
export const defaultUrlPolicy: UrlPolicy = (url) => safeUrl(url)

export type { UrlPolicy }
