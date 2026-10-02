import type { RenderFeature } from '../feature'
import { carouselFeature } from './carousel'
import { emojiFeature } from './emoji'
import { embedFeature } from './embed'
import { linkCardFeature } from './link-card'
import { mathFeature } from './math'

/**
 * 所有**渲染侧**功能模块。
 *
 * ⚠️ 加一个新功能 = 加一行 `import` + 数组里加一项。**不要改 `renderer.ts`。**
 */
export const RENDER_FEATURES: readonly RenderFeature[] = [
  carouselFeature,
  emojiFeature,
  mathFeature,
  embedFeature,
  linkCardFeature,
]
