// @vitest-environment node
import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'

import type { RenderFeatureContext, RenderData } from '../../src/render/feature.js'
import {
  buildSpec,
  embedFeature,
  embedTitle,
  isShortLink,
  parseEmbedFence,
  parseEmbedUrl,
  resolveEmbedFromText,
} from '../../src/render/features/embed.js'

/**
 * `embed` 渲染侧的测试。
 *
 * 环境是 **node**（同 `renderMarkdown.test.ts`）：渲染侧必须在无 DOM 下工作。
 *
 * ## 为什么自己建 markdown-it、不跑 `applyNexusdownRenderer`
 *
 * 只测本功能，避免把代码块标题栏等无关规则卷进来。副作用正好有用：
 * `ctx.rules.fence` 此时是 markdown-it 的**默认**围栏规则 —— 于是
 * 「非 embed 围栏被原样交还给 baseFence」这条断言，验的就是「默认行为没被动过」。
 */
function build() {
  const md = new MarkdownIt({ html: false, linkify: true })
  const ctx: RenderFeatureContext = {
    md,
    rules: md.renderer.rules,
    escapeHtml: md.utils.escapeHtml,
  }
  embedFeature.install(ctx)
  return md
}

/** 便捷：`md.render(src, { data })`。 */
function render(src: string, data?: RenderData): string {
  return build().render(src, { data })
}

const BILI_ID = 'BV1xx411c7mD' // BV + 10 位 = 12
const DY_ID = '7458617091420114236' // 19 位

describe('embed 渲染侧 —— 围栏', () => {
  it('★ ```embed bilibili video → .nd-embed + details + iframe，src 由模板构造', () => {
    const html = render('```embed bilibili video ' + BILI_ID + '\n```')

    expect(html).toContain('<div class="nd-embed nd-embed--bilibili" data-nd-embed="bilibili:video">')
    expect(html).toContain('<details class="nd-embed__gate">')
    expect(html).toContain('<summary class="nd-embed__placeholder">')
    // `&` 必须转义成 `&amp;`，否则属性会被截断。
    expect(html).toContain('src="//player.bilibili.com/player.html?bvid=' + BILI_ID + '&amp;autoplay=0"')
  })

  it('★ iframe 四个属性逐条照契约', () => {
    const html = render('```embed douyin video ' + DY_ID + '\n```')

    expect(html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"',
    )
    expect(html).toContain('allow="fullscreen; autoplay"')
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('src="https://open.douyin.com/player/video?vid=' + DY_ID + '&amp;autoplay=0"')
  })

  it('★ 默认点击才加载：iframe 在**闭合的** <details> 里，占位条先出现', () => {
    const html = render('```embed netease song 110761\n```')

    // 没有 `open` 属性 → details 默认闭合。
    expect(html).not.toContain('<details class="nd-embed__gate" open>')
    // 占位条在 iframe 之前（先渲染占位，用户点了才展开）。
    expect(html.indexOf('nd-embed__placeholder')).toBeLessThan(html.indexOf('<iframe'))
    // 占位条上是「点击加载」。
    expect(html).toContain('点击加载')
  })

  it('网易云两种 kind 用不同的 type/height 模板', () => {
    expect(render('```embed netease song 110761\n```')).toContain(
      'src="//music.163.com/outchain/player?type=2&amp;id=110761&amp;auto=0&amp;height=66"',
    )
    expect(render('```embed netease playlist 473007041\n```')).toContain(
      'src="//music.163.com/outchain/player?type=0&amp;id=473007041&amp;auto=0&amp;height=430"',
    )
  })

  it('★ 非 embed 的围栏**原样**交还给 baseFence（普通代码块行为不变）', () => {
    const html = render('```js\nconst x = 1\n```')

    expect(html).not.toContain('nd-embed')
    expect(html).toContain('<pre><code class="language-js">const x = 1\n</code></pre>')
  })

  it('★ info 只是以 embed 开头（`embedded`）不算 embed，交回 baseFence', () => {
    const html = render('```embedded\nx\n```')
    expect(html).not.toContain('nd-embed')
    expect(html).toContain('class="language-embedded"')
  })

  it('★ 非法 embed（provider/kind 不合法）→ 降级成普通代码块，不产出 iframe', () => {
    const html = render('```embed vimeo video 123\n```')
    expect(html).not.toContain('<iframe')
    expect(html).toContain('class="language-embed"')
  })

  it('★ 围栏里多写了东西（超过 4 段）→ 拒绝，降级成普通代码块', () => {
    const html = render('```embed bilibili video ' + BILI_ID + ' extra\n```')
    expect(html).not.toContain('<iframe')
    expect(html).toContain('class="language-embed"')
  })
})

describe('embed 渲染侧 —— ID 校验（安全底线）', () => {
  it('★ 路径穿越 / 含空格 / 超长 ID 一律拒绝，绝不进 URL', () => {
    // 路径穿越：`../..` 里的 `/` 过不了 `BV[0-9A-Za-z]{10}`。
    expect(parseEmbedFence('embed bilibili video ../../etc')).toBeNull()
    // 含空格：解析成 5 段 → 拒绝。
    expect(parseEmbedFence('embed bilibili video BV1xx411c7m D')).toBeNull()
    // 直接喂带空格的 ID 给唯一构造入口，也必须拒绝。
    expect(buildSpec('bilibili', 'video', 'BV1 xx411c7m')).toBeNull()
    // 超长：网易云契约是 `\d+`，我们收紧到 20 位。
    expect(parseEmbedFence('embed netease song ' + '1'.repeat(21))).toBeNull()
  })

  it('★ 把 URL/协议塞进 ID 位置也不会进 src（src 永远来自模板）', () => {
    expect(parseEmbedFence('embed bilibili video javascript:alert(1)')).toBeNull()
    expect(parseEmbedFence('embed bilibili video //evil.com/x')).toBeNull()
    expect(parseEmbedFence('embed netease song https://evil.com')).toBeNull()
  })

  it('非法 embed 围栏产出的 HTML 里不含任何 iframe / 用户串', () => {
    const html = render('```embed bilibili video //evil.com/x\n```')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('evil.com')
  })
})

describe('embed 渲染侧 —— 三家 ID 正则边界', () => {
  it('bilibili：`BV` + 恰好 10 位 `[0-9A-Za-z]`', () => {
    expect(buildSpec('bilibili', 'video', 'BV1xx411c7mD')).not.toBeNull() // 12
    expect(buildSpec('bilibili', 'video', 'BV0000000000')).not.toBeNull() // 全数字也合法
    expect(buildSpec('bilibili', 'video', 'BV1xx411c7m')).toBeNull() // 11（少一位）
    expect(buildSpec('bilibili', 'video', 'BV1xx411c7mDD')).toBeNull() // 13（多一位）
    expect(buildSpec('bilibili', 'video', 'bv1xx411c7mD')).toBeNull() // 小写前缀
    expect(buildSpec('bilibili', 'video', 'AV1xx411c7mD')).toBeNull() // AV 不是 BV
    expect(buildSpec('bilibili', 'video', 'BV1xx411c7m_')).toBeNull() // `_` 不在字符集
  })

  it('douyin：15~20 位数字', () => {
    expect(buildSpec('douyin', 'video', '1'.repeat(15))).not.toBeNull()
    expect(buildSpec('douyin', 'video', DY_ID)).not.toBeNull() // 19
    expect(buildSpec('douyin', 'video', '1'.repeat(20))).not.toBeNull()
    expect(buildSpec('douyin', 'video', '1'.repeat(14))).toBeNull()
    expect(buildSpec('douyin', 'video', '1'.repeat(21))).toBeNull()
    expect(buildSpec('douyin', 'video', '745861709142011423a')).toBeNull()
  })

  it('netease：1~20 位数字（契约是 `\\d+`，按"超长拒绝"收紧）', () => {
    expect(buildSpec('netease', 'song', '110761')).not.toBeNull()
    expect(buildSpec('netease', 'playlist', '473007041')).not.toBeNull()
    expect(buildSpec('netease', 'song', '1'.repeat(20))).not.toBeNull()
    expect(buildSpec('netease', 'song', '1'.repeat(21))).toBeNull()
    expect(buildSpec('netease', 'song', '')).toBeNull()
    expect(buildSpec('netease', 'song', '110761x')).toBeNull()
  })

  it('provider/kind 组合必须存在于表里', () => {
    expect(buildSpec('bilibili', 'song', '110761')).toBeNull() // bilibili 没有 song
    expect(buildSpec('netease', 'video', '110761')).toBeNull() // netease 没有 video
    expect(buildSpec('douyin', 'playlist', '473007041')).toBeNull()
  })
})

describe('embed 渲染侧 —— 链接自动识别', () => {
  const cases: Array<[string, string]> = [
    ['https://www.bilibili.com/video/' + BILI_ID, 'bilibili:video'],
    ['www.bilibili.com/video/' + BILI_ID, 'bilibili:video'],
    ['https://www.bilibili.com/video/' + BILI_ID + '?p=1', 'bilibili:video'],
    ['https://www.douyin.com/video/' + DY_ID, 'douyin:video'],
    ['https://music.163.com/song?id=110761', 'netease:song'],
    ['https://music.163.com/playlist?id=473007041', 'netease:playlist'],
    ['https://music.163.com/song?id=110761&x=1', 'netease:song'],
  ]

  for (const [url, key] of cases) {
    it(`独占一段的 ${url} → ${key}`, () => {
      const html = render(url)
      expect(html).toContain(`data-nd-embed="${key}"`)
      expect(html).toContain('<iframe')
    })
  }

  it('★ 段落里还有别的字 → 不转 embed', () => {
    const html = render('看这个 https://www.bilibili.com/video/' + BILI_ID + ' 很好')
    expect(html).not.toContain('nd-embed')
    expect(html).toContain('看这个')
  })

  it('★ 不是已知平台 → 不转（哪怕路径长得像）', () => {
    expect(render('https://evil.com/video/' + BILI_ID)).not.toContain('nd-embed')
    expect(render('https://notbilibili.com/video/' + BILI_ID)).not.toContain('nd-embed')
  })

  it('★ 非 http(s) scheme 不转（哪怕 host 是 bilibili.com）', () => {
    expect(render('ftp://www.bilibili.com/video/' + BILI_ID)).not.toContain('nd-embed')
    expect(parseEmbedUrl('javascript:www.bilibili.com/video/' + BILI_ID)).toBeNull()
  })

  it('路径多一截 → 不转（正则锚定整段 pathname）', () => {
    expect(render('https://www.bilibili.com/video/' + BILI_ID + '/extra')).not.toContain('nd-embed')
  })
})

describe('embed 渲染侧 —— 短链降级', () => {
  it('★ 短链无数据 → 降级成普通链接，不报错、不产出 embed', () => {
    const html = render('https://b23.tv/abcdefg')
    expect(html).not.toContain('nd-embed')
    expect(html).toContain('<a href="https://b23.tv/abcdefg">')
  })

  it('★ 短链有数据 → 从跳转后的长链里提 ID，转成 embed', () => {
    const data: RenderData = {
      links: new Map([
        ['https://b23.tv/abcdefg', { url: 'https://www.bilibili.com/video/' + BILI_ID }],
      ]),
    }
    const html = render('https://b23.tv/abcdefg', data)
    expect(html).toContain('data-nd-embed="bilibili:video"')
    expect(html).toContain('bvid=' + BILI_ID)
  })

  it('★ 有数据但跳转目标不是已知平台 → 也降级', () => {
    const data: RenderData = {
      links: new Map([['https://b23.tv/abcdefg', { url: 'https://evil.com/x' }]]),
    }
    const html = render('https://b23.tv/abcdefg', data)
    expect(html).not.toContain('nd-embed')
    expect(html).toContain('<a href="https://b23.tv/abcdefg">')
  })

  it('★ 数据是**每次渲染**传进来的（不是烤进 install 的）', () => {
    const md = build()
    const data: RenderData = {
      links: new Map([['https://b23.tv/abcdefg', { url: 'https://www.bilibili.com/video/' + BILI_ID }]]),
    }
    // 第一次带数据 → embed；第二次不带 → 降级。同一个 md 实例。
    expect(md.render('https://b23.tv/abcdefg', { data })).toContain('nd-embed')
    expect(md.render('https://b23.tv/abcdefg', {})).not.toContain('nd-embed')
  })

  it('`v.douyin.com` / `163cn.tv` 也认作短链', () => {
    expect(isShortLink('https://v.douyin.com/abcdefg')).toBe(true)
    expect(isShortLink('https://163cn.tv/abcdefg')).toBe(true)
    expect(isShortLink('https://bilibili.com/video/' + BILI_ID)).toBe(false)
  })
})

describe('embed 渲染侧 —— 辅助函数与转义', () => {
  it('`embedTitle` 是占位卡上的标题（两侧共用）', () => {
    const spec = parseEmbedFence('embed netease playlist 473007041')!
    expect(embedTitle(spec)).toBe('网易云音乐 · 歌单 473007041')
  })

  it('`resolveEmbedFromText` 对空串 / 空白返回 null', () => {
    expect(resolveEmbedFromText('', {})).toBeNull()
    expect(resolveEmbedFromText('   ', {})).toBeNull()
  })

  it('没有 env / env 形状不对时不抛，直接降级', () => {
    expect(resolveEmbedFromText('https://b23.tv/x', undefined)).toBeNull()
    expect(resolveEmbedFromText('https://b23.tv/x', { data: null })).toBeNull()
    expect(resolveEmbedFromText('https://b23.tv/x', { data: { links: new Map() } })).toBeNull()
  })
})
