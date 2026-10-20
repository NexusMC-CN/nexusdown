import type { RenderFeature } from '../feature'
import { attrsFeature } from './attrs'
import { calloutFeature } from './callout'
import { carouselFeature } from './carousel'
import { emojiFeature } from './emoji'
import { embedFeature } from './embed'
import { linkCardFeature } from './link-card'
import { mathFeature } from './math'
import { mentionFeature } from './mention'
import { tabsFeature } from './tabs'

/**
 * 所有**渲染侧**功能模块。
 *
 * ⚠️ 加一个新功能 = 加一行 `import` + 数组里加一项。**不要改 `renderer.ts`。**
 *
 * ⚠️ 顺序有意义：
 *
 * - `mention` 链式覆盖 `rules.text`（先调上一个规则再在结果里找提及），
 *   所以它**必须排在 `emoji` 之后**，否则会把 emoji 的 `rules.text` 挤掉；
 * - `callout` 是 **core 规则**（改写 token 流），排在最前 —— 它把 `> [!NOTE]`
 *   引用块改写成 `<div class="nd-callout">`，后面的功能（`link-card` / `embed`
 *   看 `level === 0` 的段落、`mention` 扫文本）看到的都是**改写后**的流。
 *   它只动引用块内部的 token，不会让别的功能少看到东西。
 */
export const RENDER_FEATURES: readonly RenderFeature[] = [
  attrsFeature,
  tabsFeature,
  calloutFeature,
  carouselFeature,
  emojiFeature,
  mathFeature,
  embedFeature,
  linkCardFeature,
  mentionFeature,
]
