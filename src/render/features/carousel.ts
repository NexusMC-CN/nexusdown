/**
 * `carousel` —— 媒体轮播，**渲染侧**（契约：`docs/dialect-extensions.md` 第 5 节）。
 *
 * 语法：**独占一段的连续图片**（两张以上、同一段、中间没有空行）。**不新增语法。**
 *
 * ## 产出：**零运行时 JS** 的 scroll-snap 结构
 *
 * 契约要求「输出零 JS 的 scroll-snap 结构 + 锚点，无 JS 也能滑」，并明确
 * 「不要引入运行时 JS」。所以这里只吐结构：
 *
 * - `<ul class="nd-carousel__track">` 是一个 `scroll-snap-type: x mandatory` 的
 *   横向滚动容器 —— 移动端原生手势、触控板横向滑动直接就能翻页（由 CSS 实现，
 *   不是 JS）；
 * - 每个 `<li class="nd-carousel__slide" id="nd-c-<seq>-<n>">` 是
 *   `scroll-snap-align: center` 的吸附点；
 * - `<ol class="nd-carousel__dots">` 里是 `<a href="#nd-c-<seq>-<n>">` 锚点 ——
 *   点一下走浏览器的**原生锚点滚动**（也是零 JS），键盘 Tab 也能逐条跳。
 *
 * ⚠️ 因此**没有**「上/下一张」按钮：那需要 JS 读滚动位置。契约要的就是零 JS，
 * 按钮不做（做了也是假的）。
 *
 * ## 为什么用 core 规则（和 `embed` 一样），而不是渲染规则
 *
 * 要把「一个段落」整体换掉，得同时吞掉 `paragraph_open` / `inline` /
 * `paragraph_close` 三个 token。渲染规则是**逐个 token** 调用的，`paragraph_close`
 * 那一步没有干净的办法回头改前面已经吐出去的字符串。core 规则拿到的是**完整
 * token 流**，可以在渲染之前直接 `splice` 掉这三个 token、换成一个自包含的块级 token。
 *
 * ## 锚点 id 为什么要带序号
 *
 * 契约的骨架写的是 `<li id="nd-c-1">`。但如果一篇文档里有两个轮播，两个
 * `id="nd-c-1"` 就是**重复 id**（非法 HTML），锚点也会指错。所以 id 加一段
 * **每次渲染唯一**的序号（`nd-c-<seq>-<n>`）。序号存在 `env` 上（`env` 是
 * `md.render(src, env)` 每次传进来的那个对象），不是存在模块级变量里 ——
 * 后者在 SSR 并发下会串号。
 */
import type { StateCore, Token } from 'markdown-it'

import type { RenderFeature, RenderFeatureContext } from '../feature.js'

/** 块级 token 类型名。 */
const CAROUSEL_TOKEN = 'nd_carousel'
/** `token.meta` 里放 `CarouselSpec` 的键。 */
const CAROUSEL_META = 'ndCarousel'

/** 一个待渲染的轮播。 */
export interface CarouselSpec {
  /** 图片 token（原样来自 markdown-it，含 `src` / `alt` / `title`）。 */
  images: Token[]
  /** 锚点 id 前缀，形如 `nd-c-2`（2 是本次渲染内第几个轮播）。 */
  prefix: string
}

/**
 * 判断一个 `inline` token 是不是「独占一段的连续图片」。
 *
 * 返回图片 token 数组（≥2），否则 `null`。
 *
 * ## 判定依据
 *
 * markdown-it 会把段内换行变成 `softbreak`、行尾两空格变成 `hardbreak`，
 * 把两个图之间的空格变成 `text` —— 这三种都是**分隔符**，允许出现；
 * **任何其它节点**（真正的文字、链接、强调…）都说明这一段不是「只有图片」。
 *
 * ⚠️ 不能用「`children` 全是 image」这种更宽松的判定：`![a](x)\n文字\n![b](y)`
 * 的 `children` 里确实只有两个 image（「文字」是它们之间的 `text` 子节点，
 * 会出现在 children 里），所以必须逐个检查分隔符。见下面的分支。
 */
export function collectCarouselImages(inline: Token): Token[] | null {
  const children = inline.children ?? []
  if (children.length === 0) return null

  const images: Token[] = []
  for (const child of children) {
    if (child.type === 'image') {
      images.push(child)
      continue
    }
    // 段内换行：允许（同一段、中间没有空行 —— 空行会把段落切断，见下）。
    if (child.type === 'softbreak' || child.type === 'hardbreak') continue
    // 纯空白文本（`![a](x) ![b](y)` 中间那个空格）：允许。
    if (child.type === 'text' && child.content.trim() === '') continue
    // 其它一律不是轮播。
    return null
  }

  // 单张图**不是**轮播 —— 契约要求「两张以上」。单张图走 markdown-it 默认的
  // `<img>`，这里是**降级**，不是缺陷。
  return images.length >= 2 ? images : null
}

export const carouselFeature: RenderFeature = {
  name: 'carousel',
  install(ctx) {
    installCarouselCore(ctx)
    ctx.rules[CAROUSEL_TOKEN] = (tokens, idx, options, env, self) => {
      const spec = specOfToken(tokens[idx])
      return spec ? renderCarousel(spec, ctx, options, env, self) : ''
    }
  },
}

/**
 * core 规则：把「连续图片独占一段」的三个 token 换成一个 `nd_carousel`。
 *
 * ⚠️ 只认 `level === 0` 的段落。列表项里的段落是 `hidden` 的（level ≥ 2），
 * 块引用里的段落 level ≥ 1 —— 把它们的 `paragraph_open/close` 抽掉会让
 * `<li>` / `<blockquote>` 里空一块，而且它们本来也不是「独占一段」。
 */
function installCarouselCore(ctx: RenderFeatureContext): void {
  ctx.md.core.ruler.push('nd_carousel', (state: StateCore) => {
    const tokens = state.tokens

    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]!
      if (open.type !== 'paragraph_open' || open.level !== 0) continue

      const inline = tokens[i + 1]
      const close = tokens[i + 2]
      if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') continue

      const images = collectCarouselImages(inline)
      if (!images) continue

      const token = new state.Token(CAROUSEL_TOKEN, '', 0)
      token.block = true
      token.meta = { [CAROUSEL_META]: { images, prefix: `nd-c-${nextSeq(state.env)}` } }
      // 三个 token 换一个，`i` 落到新 token 上；下一轮 `i++` 跳过它继续扫。
      tokens.splice(i, 3, token)
    }
  })
}

/**
 * 本次渲染内递增的轮播序号。
 *
 * ⚠️ 状态存在 `env`（每次 `md.render` 一份）而不是模块级变量：模块级计数器在
 * SSR 并发渲染下会互相串号。`env` 被冻结（罕见）时退化成进程级计数 —— 那样
 * id 可能重复，但**不会抛**（渲染永远优先保证不炸）。
 */
let fallbackSeq = 0
function nextSeq(env: unknown): number {
  if (env && typeof env === 'object') {
    try {
      const bag = env as Record<string, unknown>
      const next = (typeof bag.__ndCarouselSeq === 'number' ? bag.__ndCarouselSeq : 0) + 1
      bag.__ndCarouselSeq = next
      return next
    } catch {
      // `env` 不可写（冻结 / 只读代理）→ 落到进程级计数。
    }
  }
  return ++fallbackSeq
}

/**
 * 渲染一段轮播。
 *
 * ⚠️ 图片用**现成的 `rules.image`** 渲染，而不是自己拼 `<img>`：
 * `alt` 的取法（CommonMark 规定 alt 是「剥掉行内标记后的标签文本」）和转义
 * 都在那条规则里，自己再写一遍迟早会不一致（`renderer.ts` 的 `rules.image`
 * 就是这么处理 alt 的）。
 */
function renderCarousel(
  spec: CarouselSpec,
  ctx: RenderFeatureContext,
  options: Parameters<NonNullable<RenderFeatureContext['rules'][string]>>[2],
  /*
   * ⚠️ 这里**不能用 `unknown`** —— 它要原样透传给 `rules.image`，而那条规则的
   * `env` 参数是 markdown-it 的 `Env`。用 `unknown` 会在调用处报
   * 「`unknown` 不能赋给 `Env | undefined`」。
   *
   * 直接取规则签名的第 4 个参数类型，这样 markdown-it 升级改了 `env` 的类型时
   * 这边会跟着变，不用手改。
   */
  env: Parameters<NonNullable<RenderFeatureContext['rules'][string]>>[3],
  self: Parameters<NonNullable<RenderFeatureContext['rules'][string]>>[4],
): string {
  const imageRule = ctx.rules.image

  const slides = spec.images
    .map((image, index) => {
      const id = `${spec.prefix}-${index + 1}`
      const img = imageRule
        ? imageRule([image], 0, options, env, self)
        : self.renderToken([image], 0, options)
      return `<li class="nd-carousel__slide" id="${id}">${img}</li>`
    })
    .join('')

  // 圆点 = 锚点。序号是数字，`aria-label` 是固定的中文串，都不含用户输入。
  const dots = spec.images
    .map((_, index) => {
      const id = `${spec.prefix}-${index + 1}`
      return `<li><a class="nd-carousel__dot" href="#${id}" aria-label="第 ${index + 1} 张">${index + 1}</a></li>`
    })
    .join('')

  return (
    '<div class="nd-carousel">' +
    `<ul class="nd-carousel__track">${slides}</ul>` +
    `<ol class="nd-carousel__dots">${dots}</ol>` +
    '</div>'
  )
}

/** 从 token 上取回 spec。 */
function specOfToken(token: Token | undefined): CarouselSpec | undefined {
  const spec = token?.meta?.[CAROUSEL_META]
  return spec && typeof spec === 'object' ? (spec as CarouselSpec) : undefined
}
