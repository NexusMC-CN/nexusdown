import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/render/index.js'
import { parseEmbedUrl } from '../../src/render/features/embed.js'

const bili = 'https://www.bilibili.com/video/BV1xx411c7mD/'
describe('media link contract', () => {
  it('keeps Bilibili trailing slash, page and start time', () => {
    const spec = parseEmbedUrl(bili + '?p=3&t=42')
    expect(spec?.src).toContain('&p=3')
    expect(spec?.src).toContain('t=42')
  })
  it('recognizes AV videos and NetEase hash routes', () => {
    expect(parseEmbedUrl('https://www.bilibili.com/video/av170001/')?.src).toContain('aid=170001')
    expect(parseEmbedUrl('https://music.163.com/#/song?id=110761')?.kind).toBe('song')
    expect(parseEmbedUrl('https://music.163.com/#/playlist?id=123')?.kind).toBe('playlist')
  })
  it('rejects credentials, unsafe URLs and text disguised as URL', () => {
    for (const input of ['https://a:b@www.bilibili.com/video/BV1xx411c7mD', bili + '\nhello', 'javascript:' + bili, 'https://www.bilibili.com:444/video/BV1xx411c7mD']) {
      expect(parseEmbedUrl(input)).toBeNull()
    }
  })
  it('renders a functional original link and zero live iframe', () => {
    const html = renderMarkdown(bili)
    expect(html).toContain('data-nd-embed-load')
    expect(html).toContain('href="' + bili + '"')
    expect(html).not.toContain('<iframe')
  })
  it('lets explicit ordinary or card mode override auto embedding', () => {
    const data = { links: new Map([[bili, { card: { title: 'Actual title' } }]]) }
    const plain = renderMarkdown(bili + '\n\n{.no-card}', { data })
    expect(plain).not.toContain('nd-embed')
    expect(plain).not.toContain('class="nd-card"')
    const card = renderMarkdown(bili + '\n\n{.card}', { data })
    expect(card).not.toContain('nd-embed')
    expect(card).toContain('Actual title')
  })
  it('retains shortlink original URL and canonical provider separately', () => {
    const raw = 'https://b23.tv/abc'
    const html = renderMarkdown(raw, { data: { links: new Map([[raw, { url: bili }]]) } })
    expect(html).toContain('href="' + raw + '"')
    expect(html).toContain('data-nd-embed-canonical="' + bili + '"')
    expect(html).not.toContain('<iframe')
  })
  it('never embeds a URL inside inline code or a mixed paragraph', () => {
    expect(renderMarkdown('`' + bili + '`')).not.toContain('nd-embed')
    expect(renderMarkdown('Look ' + bili)).not.toContain('nd-embed')
  })
  it('recognizes explicit modes immediately after soft or hard line breaks', () => {
    const data = { links: new Map([[bili, { card: {title: 'Metadata'} }]]) }
    for (const separator of ['\n', '  \n']) {
      const plain = renderMarkdown(bili + separator + '{.no-card}', {data})
      expect(plain).not.toContain('nd-embed')
      expect(plain).not.toContain('class="nd-card"')
      expect(plain).not.toContain('{.no-card}')
      const card = renderMarkdown(bili + separator + '{.card}', {data})
      expect(card).toContain('Metadata')
      expect(card).not.toContain('{.card}')
    }
  })
  it('keeps an actionable shortlink when embed resolution is unavailable', () => {
    const html = renderMarkdown('```embed https://b23.tv/abc\n```')
    expect(html).toContain('href="https://b23.tv/abc"')
    expect(html).not.toContain('<iframe')
  })
})
