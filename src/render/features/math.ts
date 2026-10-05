/**
 * `math` —— 渲染侧（契约：`docs/dialect-extensions.md` 第 2 节）。
 *
 * 语法：行内 `$E = mc^2$`；块级用 **` ```math ` 围栏**（不是 `$$`）。
 *
 * ## 最难的设计点：KaTeX 是可选依赖，而渲染是同步的
 *
 * 三条约束互相打架：
 *
 * 1. **KaTeX 不能进主包**（契约）—— 它 unpacked 有 **~4 MB**（实测
 *    `npm view katex dist.unpackedSize` → `4041580`，绝大多数是字体文件），
 *    绝大多数消费方用不到数学公式，不该替它们付这个体积。
 * 2. **`renderMarkdown` 是同步的**（`render/index.ts`），所以**不能**用
 *    `await import('katex')` 动态加载 —— 一 await 就把同步 API 变成异步，
 *    整条 SSR 链路都得跟着改。
 * 3. `RenderFeature.install(ctx)` 的 `ctx` 里**没有** KaTeX（只有
 *    `md` / `rules` / `escapeHtml`），而且它**只在建解析器时跑一次**
 *    （解析器还被 `resolveParser` 缓存），不能把「每次渲染都可能不同的东西」烤进去。
 *
 * ### 选定的方案：消费方通过 `plugins` 注入渲染函数
 *
 * 导出 `katexRenderer(katex)` —— 一个普通的 markdown-it 插件，消费方塞进
 * `renderMarkdown` 的 `plugins` 数组即可：
 *
 * ```ts
 * import katex from 'katex'                 // 消费方自己装（可选依赖）
 * import 'katex/dist/katex.min.css'         // ⚠️ 字体 CSS 也必须由消费方引入
 * import { katexRenderer } from 'nexusdown/render'
 *
 * renderMarkdown(src, { plugins: [katexRenderer(katex)] })
 * ```
 *
 * 为什么是这个方案，而不是别的：
 *
 * - **为什么不 `import katex from 'katex'` 静态导入**：会把它变成硬依赖、
 *   打进主包，违反约束 1；而且没装 KaTeX 的消费方连 `tsc` 都过不了。
 * - **为什么不用 `RenderData`（env）通道**：`RenderData` 是**每次渲染的数据**
 *   （短链解析结果、卡片元数据），而 KaTeX 渲染函数是**装配期配置**，两者生命周期
 *   不同；而且往 `RenderData` 里塞函数会逼着改 `render/feature.ts`（接线文件，
 *   本次不许动）。
 * - **为什么能「装一次、用很久」**：`katexRenderer` 把函数挂在 `md` 实例的一个
 *   `Symbol` 键上，而**规则是在 `render` 时才去读它**（不是 `install` 时读）。
 *   所以即便消费方的插件在 `applyNexusdownRenderer`（安装本功能）**之后**才跑，
 *   顺序也无关紧要 —— 只要渲染前挂上就行。
 *
 * ### 没有注入时怎么办：**降级成源码文本，绝不抛**
 *
 * 见 `renderMath`。这保证「没装 KaTeX」是一个**可用**状态（显示原始 TeX），
 * 而不是一个会 500 的状态。
 *
 * ## 安全
 *
 * - `trust: false`（**契约硬要求，绝不可开**）：KaTeX 会禁掉 `\href` /
 *   `\url` / `\includegraphics` / `\html*` 这类会引入外部资源或 HTML 的命令。
 *   开了它，用户输入的公式就能注入任意链接/图片，是实打实的 XSS/SSRF 面。
 * - `maxSize` / `maxExpand` 封顶：前者挡 `\rule{9999em}` 把页面撑爆，
 *   后者挡 `\def` 递归展开成指数级 token 把 CPU 打满（KaTeX 的 DoS 面）。
 * - KaTeX 在 `trust:false` 下的输出是**自包含且安全**的，所以这里直接内联它的
 *   返回值，不再二次转义（二次转义会把公式里的 `<` 变成 `&lt;` 显示错）。
 *   降级路径则必须走 `ctx.escapeHtml`。
 */
import type { MarkdownIt as MarkdownItInstance, RendererRule, StateInline } from 'markdown-it'

import type { RenderFeature, RenderFeatureContext } from '../feature.js'

/**
 * KaTeX 的最小结构类型。
 *
 * ⚠️ 用**方法语法**（`renderToString(...)`）而不是属性箭头函数：方法参数在 TS 里是
 * **双变**的，这样真实的 `katex`（它的 `options` 是具体的 `KatexOptions`）才能
 * 直接传进来，而不会被 `strictFunctionTypes` 拒掉。写成属性箭头函数就会逼消费方
 * 做一次 `as` 断言。
 */
export interface KatexLike {
  renderToString(tex: string, options?: Record<string, unknown>): string
}

/**
 * 挂 KaTeX 渲染器的键。
 *
 * 用 `Symbol.for`（全局注册表）而不是字符串键：消费方和本模块**可能来自不同的包
 * 副本**（比如打包器去重失败），字符串键在不同副本间是同一个字符串没问题，
 * 但 Symbol 更彻底地避免和 `md` 上任何未来属性撞名。用 `Symbol.for` 而非
 * `Symbol()` 是为了跨副本也能解析到同一个键。
 */
export const KATEX_RENDERER = Symbol.for('nexusdown.math.katex')

/** 消费方传给 `renderMarkdown({ plugins })` 的插件形状（与 `render/index.ts` 结构一致）。 */
export type MathKatexPlugin = (md: MarkdownItInstance) => void

/**
 * 把 KaTeX 注入渲染管线的插件。
 *
 * ```ts
 * renderMarkdown(src, { plugins: [katexRenderer(katex)] })
 * ```
 *
 * 只挂函数、不改任何规则 —— 规则由 `mathFeature` 在 `install` 时注册，
 * 渲染时才回头来这里取。见文件头「为什么能装一次、用很久」。
 */
export function katexRenderer(katex: KatexLike): MathKatexPlugin {
  return (md) => {
    ;(md as unknown as Record<symbol, unknown>)[KATEX_RENDERER] = katex
  }
}

/**
 * KaTeX 的渲染选项。**每一项都是安全相关的，不要随手改。**
 *
 * - `throwOnError: false` —— 语法错时**不抛**，让 KaTeX 自己画一个红色错误标记。
 *   抛了会把一条脏公式升级成整页 500。
 * - `trust: false` —— 见文件头「安全」。**这是底线，永远不要开。**
 * - `strict: 'ignore'` —— 默认 `'warn'` 会在 SSR 控制台刷一堆
 *   「Unicode text character used in math mode」之类的警告，淹没真正的错误。
 *   我们不靠 KaTeX 的 warning 做任何事，关掉。
 * - `maxSize: 50` —— `\rule` / `\kern` / `\hspace` 的尺寸上限（单位 em）。
 *   默认 `Infinity`，一条 `\rule{100000em}{1em}` 就能把页面撑到几百万像素宽。
 * - `maxExpand: 1000` —— `\def` / `\edef` 宏展开次数上限，挡「宏递归展开」这类
 *   CPU DoS。KaTeX 默认就是 1000，这里**显式写出来**，免得日后有人以为没设。
 *
 * ★ **导出**是给编辑器侧的块级公式 widget 用的（`cm/features/math.ts`）——
 * 编辑器里也要调 `renderToString`，而这些选项**每一项都是安全底线**。
 * 抄一份到那边就会漂（一边补了 `maxSize`、另一边没有，而且两边都"看起来对"），
 * 所以两边共用**同一个常量对象**。本模块没有运行时 import（全是 `import type`），
 * 因此编辑器侧引入它不会把 markdown-it 拖进 CM 的产物。
 */
export const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: 'ignore',
  maxSize: 50,
  maxExpand: 1000,
} as const

export const mathFeature: RenderFeature = {
  name: 'math',
  install(ctx) {
    installInlineMath(ctx)
    installBlockMath(ctx)
  },
}

/**
 * 行内 `$…$`：注册一个内联规则 + 对应的渲染规则。
 *
 * 为什么用**内联规则**而不是 `rules.text` 里做替换：`rules.text` 拿到的是**已分词**
 * 的文本片段，`$` 可能已经被上游规则（如 `emphasis`）切走；而且 text 规则里做替换
 * 无法正确「跨 token」处理闭合 `$`。内联规则在**扫描阶段**就把 `$…$` 认出来，
 * 和 `mark.ts`（`==高亮==`）是同一套做法。
 *
 * 插在 `escape` **之前**：`\$` 会被 `escape` 规则吃掉（我的规则看到的是 `\`，
 * 直接返回 false），所以转义美元不会误开公式。而 `` ` `` 由后面的 `backticks`
 * 规则整段吃掉，所以 `` `$x$` `` 里的 `$` 也进不来 —— **跳过行内代码是白送的**。
 */
function installInlineMath(ctx: RenderFeatureContext): void {
  const { md } = ctx

  md.inline.ruler.before('escape', 'nd_math_inline', (state: StateInline, silent: boolean) => {
    const start = state.pos
    const src = state.src

    if (src.charCodeAt(start) !== 0x24 /* $ */) return false
    // `$$…$$` 不是行内公式（契约：块级用围栏）。
    if (src.charCodeAt(start + 1) === 0x24) return false
    /*
     * ⚠️ 开 `$` 前面**也不能**紧跟 `$`。
     *
     * markdown-it 会逐字符推进：`$$x$$` 的第一个 `$` 被上面那条挡下后，游标前进一格，
     * 第二个 `$` 就会被当成「开 `$`」，把 `x` 认成公式 —— 于是 `$$x$$` 变成
     * 「字面 `$` + 公式 + 字面 `$`」，和编辑器侧（`scanLine` 遇到 `$$` 直接跳两格）
     * 的结果**不一致**。这里改成看前一个字符来对齐两边。
     */
    if (start > 0 && src.charCodeAt(start - 1) === 0x24) return false

    // 找闭合 `$`；`\$` 是转义，跳过。
    let pos = start + 1
    let end = -1
    while (pos < state.posMax) {
      const code = src.charCodeAt(pos)
      if (code === 0x5c /* \ */) {
        pos += 2
        continue
      }
      if (code === 0x24) {
        end = pos
        break
      }
      pos++
    }
    if (end < 0) return false

    const tex = src.slice(start + 1, end)
    // 与编辑器侧同一套判定（`cm/features/math.ts` 的 `scanLine`），否则会出现
    // 「编辑器当公式、渲染器当文本」的两侧不一致：
    // 内容非空、首尾非空白（挡货币 `$5 and $6`）、闭 `$` 后不紧跟数字（挡 `$x$5`）。
    if (tex.length === 0 || /^\s/.test(tex) || /\s$/.test(tex)) return false
    const after = src.charCodeAt(end + 1)
    if (after >= 0x30 && after <= 0x39) return false

    if (!silent) {
      const token = state.push('nd_math_inline', '', 0)
      token.content = tex
      token.markup = '$'
    }
    state.pos = end + 1
    return true
  })

  ctx.rules.nd_math_inline = (tokens, idx) =>
    renderMath(md, tokens[idx]!.content, false, ctx.escapeHtml)
}

/**
 * 块级 ` ```math ` 围栏。
 *
 * ⚠️ **不能直接覆盖 `rules.fence`** —— 那是 `renderer.ts` 给**普通代码块**装的
 * 标题栏规则，覆盖掉的话所有代码块都会变成公式。这里把原规则**包一层**：
 * 只有 `info` 的第一段是 `math` 才走 KaTeX，其余原样交给 `baseFence`。
 */
function installBlockMath(ctx: RenderFeatureContext): void {
  const { md } = ctx
  const baseFence: RendererRule | undefined = ctx.rules.fence

  ctx.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!
    // `info` 是开围栏后的自由文本（```math  → "math"）。只取第一段当语言名，
    // 和 `renderer.ts` 的判定保持一致（```math title=x 也算 math）。
    const info = token.info ? md.utils.unescapeAll(token.info).trim() : ''
    const language = info ? info.split(/\s+/)[0]! : ''

    if (language !== 'math') {
      return baseFence
        ? baseFence(tokens, idx, options, env, self)
        : self.renderToken(tokens, idx, options)
    }

    const tex = withoutTrailingNewline(token.content)
    return `<div class="nd-math nd-math-block">${renderMath(md, tex, true, ctx.escapeHtml)}</div>`
  }
}

/**
 * 渲染一段 TeX。**这是唯一的出口**，所有降级都收在这里。
 *
 * - 注入了 KaTeX → `renderToString`；它抛错（`throwOnError:false` 挡不住的那类）
 *   就 `catch` 住降级 —— 契约要求「抛错时降级成源码文本，不要抛」。
 * - 没注入 KaTeX → 直接降级。
 *
 * ⚠️ 降级路径必须 `escapeHtml`（源码是用户输入）；KaTeX 路径**不要**二次转义
 * （KaTeX 的输出是安全的自包含 HTML，再转义会把 `<` 显示成 `&lt;`）。
 */
function renderMath(
  md: MarkdownItInstance,
  tex: string,
  display: boolean,
  escapeHtml: (value: string) => string,
): string {
  const katex = (md as unknown as Record<symbol, unknown>)[KATEX_RENDERER] as KatexLike | undefined

  if (katex) {
    try {
      return katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode: display })
    } catch {
      // 落到下面的降级。故意吞掉异常：契约明确「不要抛」。
    }
  }

  return display
    ? `<pre class="nd-math-source">${escapeHtml(tex)}</pre>`
    : `<code class="nd-math-source">${escapeHtml(`$${tex}$`)}</code>`
}

/** 去掉 markdown-it 围栏内容结尾那个换行（与 `renderer.ts` 的处理一致）。 */
function withoutTrailingNewline(content: string): string {
  return content.charCodeAt(content.length - 1) === 0x0a ? content.slice(0, -1) : content
}
