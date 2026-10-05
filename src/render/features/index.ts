import type { RenderFeature } from '../feature'
import { carouselFeature } from './carousel'
import { emojiFeature } from './emoji'
import { embedFeature } from './embed'
import { linkCardFeature } from './link-card'
import { mathFeature } from './math'
import { mentionFeature } from './mention'

/**
 * 所有**渲染侧**功能模块。
 *
 * ⚠️ 加一个新功能 = 加一行 `import` + 数组里加一项。**不要改 `renderer.ts`。**
 *
 * ⚠️ 顺序有意义：`mention` 链式覆盖 `rules.text`（先调上一个规则再在结果里找提及），
 * 所以它**必须排在 `emoji` 之后**，否则会把 emoji 的 `rules.text` 挤掉。
 */
export const RENDER_FEATURES: readonly RenderFeature[] = [
  carouselFeature,
  emojiFeature,
  mathFeature,
  embedFeature,
  linkCardFeature,
  mentionFeature,
]
