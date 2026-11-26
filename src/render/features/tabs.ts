/**
 * `tabs` —— 相邻围栏 + `{tab="…"}` 合成一组页签（零 JS，radio + label）。
 *
 * 语法（契约 `docs/dialect-extensions.md` §0）：
 *
 * ```md
 * ```bash
 * apt install nginx
 * ```
 * {tab="Ubuntu"}
 *
 * ```bash
 * brew install nginx
 * ```
 * {tab="macOS"}
 * ```
 *
 * 判定：**连续的 fence token**，每个都带 `meta[ATTRS_META].tab`。
 * 只有 1 个不组（照常渲染成代码块）；中间夹了别的块就断开。
 *
 * ## 为什么用 `html_block` token
 *
 * 页签组是**跨多个 fence** 的结构，markdown-it 的 token 流里没有对应节点。
 * 直接把这组 fence 替换成一个 `html_block` 是最小侵入的做法：
 * 渲染器后续不会再碰它，消费方拿到的就是最终 HTML。
 *
 * ## 零 JS
 *
 * `input[type=radio]` + `label` + 相邻兄弟选择器。每个 radio 后面紧跟自己的
 * panel；`.nd-tabs` 用 flex 把 bar（label 行）排到最前面（`order: -1`）。
 * 当前页签的 label 高亮用 `:has(...)`（最多 6 个，够用）。
 */
import type { Token } from 'markdown-it'

import { ATTRS_META } from '../../shared/attrs.js'
import { scopedRenderId } from '../../shared/render-ids.js'
import type { RenderFeature } from '../feature.js'

/** IDs reserved by the generated controls, also consumed by heading allocation. */
export const TABS_IDS_META = 'ndTabsIds'

interface TabsMeta {
  readonly tab?: string
}

function tabOf(token: Token): string | undefined {
  return (token.meta?.[ATTRS_META] as TabsMeta | undefined)?.tab
}

export const tabsFeature: RenderFeature = {
  name: 'tabs',

  install(ctx) {
    ctx.md.core.ruler.push('nd_tabs', (state) => {
      const tokens = state.tokens
      const fenceRule = ctx.rules.fence
      // 序号只属于本次文档解析；同页片段通过稳定的 idPrefix 隔离。
      let sequence = 0

      for (let i = 0; i < tokens.length; i += 1) {
        if (tokens[i]!.type !== 'fence' || tabOf(tokens[i]!) === undefined) continue

        // 收集连续带 tab 的 fence
        let end = i
        while (end < tokens.length && tokens[end]!.type === 'fence' && tabOf(tokens[end]!) !== undefined) {
          end += 1
        }

        const group = tokens.slice(i, end)
        if (group.length < 2) {
          i = end - 1
          continue
        }

        const name = scopedRenderId(state.env, `tabs-${++sequence}`)
        const panels: string[] = []
        const labels: string[] = []
        const ids: string[] = []

        group.forEach((token, index) => {
          const id = `${name}-${index + 1}`
          ids.push(id)
          const tab = tabOf(token) ?? ''
          const html = fenceRule
            ? fenceRule(group, index, undefined as never, state.env, ctx.md.renderer as never)
            : ''
          panels.push(
            `<input type="radio" name="${name}" id="${id}"${index === 0 ? ' checked' : ''}>` +
              `<div class="nd-tabs__panel" data-tab="${ctx.escapeHtml(tab)}">${html}</div>`,
          )
          labels.push(`<label for="${id}">${ctx.escapeHtml(tab)}</label>`)
        })

        const html =
          `<div class="nd-tabs">${panels.join('')}` +
          `<div class="nd-tabs__bar">${labels.join('')}</div></div>`

        const block = new state.Token('html_block', '', 0)
        block.content = html
        block.meta = { [TABS_IDS_META]: ids }
        tokens.splice(i, group.length, block)
      }
    })
  },
}
