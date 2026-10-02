/**
 * `emoji` —— 渲染侧（契约：`docs/dialect-extensions.md` 第 3 节）。
 *
 * ## 为什么不用 `markdown-it-emoji`
 *
 * 任务书给了两条路：`rules.text` 里替换，或挂 `markdown-it-emoji`。查证后选了前者：
 *
 * 1. `markdown-it-emoji` **不在依赖里**（实测 `node_modules` 无此包；
 *    `npm view markdown-it-emoji dist.unpackedSize` → `344311`，约 336 KB）。
 * 2. 更关键的是它**自带一张 shortcode 表**。挂上去，渲染侧用的就是**它的表**，
 *    而编辑器侧用的是我们的 `shared/emoji-data.ts` —— 两张表必然漂移，
 *    正是契约点名的「这个功能唯一的真风险」。手写 `rules.text` 才能强制两边
 *    查**同一张** `EMOJI_SHORTCODES`。
 *
 * ## 为什么在 `rules.text` 里替换就**天然跳过了代码**
 *
 * `rules.text` 只处理**文本 token**。markdown-it 不会把代码里的内容变成文本 token：
 * 行内代码是 `code_inline`（走 `rules.code_inline`），围栏/缩进代码是 `fence` /
 * `code_block`（走各自的规则）。所以 `` `:smile:` `` 和 ` ```:smile:``` ` 里的
 * 短代码**根本到不了这里** —— 和编辑器侧「跳过代码块与行内代码」的要求对齐，
 * 且是**结构性**保证，不是靠正则绕。
 */
import { EMOJI_SHORTCODES, EMOJI_SHORTCODE_RE } from '../../shared/emoji-data.js'
import type { RenderFeature } from '../feature.js'

export const emojiFeature: RenderFeature = {
  name: 'emoji',
  install(ctx) {
    /*
     * ⚠️ 覆盖的是 markdown-it 的**默认** `text` 规则，而默认规则干的就是
     * `escapeHtml(token.content)`（`typographer` 在本库是关的，见 `render/index.ts`），
     * 所以这里必须自己调一次 `ctx.escapeHtml` —— 否则 `<` `&` 会原样漏进 HTML，
     * 直接破掉「只输出我们声明的标签」这条安全线。
     *
     * 顺序是「先替换、后转义」：字形是 Unicode，`escapeHtml` 不动它；
     * 而被替换掉的 `:name:` 本身也不含需要转义的字符。真正的风险字符来自**其余文本**，
     * 转义一次就够。
     */
    ctx.rules.text = (tokens, idx) => {
      const content = tokens[idx]!.content

      // 快路径：绝大多数文本 token 没有冒号，省掉一次全串扫描。
      if (content.indexOf(':') === -1) return ctx.escapeHtml(content)

      const replaced = content.replace(
        EMOJI_SHORTCODE_RE,
        (whole, name: string) => EMOJI_SHORTCODES.get(name) ?? whole,
      )
      return ctx.escapeHtml(replaced)
    }
  },
}
