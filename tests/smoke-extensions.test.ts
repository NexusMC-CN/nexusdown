/**
 * 冒烟测试：**注册表接对了没有**。
 *
 * 各功能的单测都是「用 `features` 选项把功能注入一个临时编辑器」——
 * 那种测法**绕过了注册表**，所以「功能写了但没注册」这类错误它抓不到。
 * 这一条专门守那个：直接用公开的 `nexusdown()` / `renderMarkdown()`，
 * 不加任何选项，断言功能真的生效了。
 *
 * ⚠️ 加新功能时**在这里补一条**。这是唯一能发现"忘了往 `EDITOR_FEATURES` /
 * `RENDER_FEATURES` 里加一行"的地方。
 */
import { renderMarkdown } from '../src/render/index.js'

describe('渲染侧：注册表接对了没有', () => {
  it('emoji —— `:smile:` 被替换成字形', () => {
    const html = renderMarkdown('a :smile: b')
    expect(html).not.toContain(':smile:')
    expect(html).toContain('😄')
  })

  it('embed —— `embed` 围栏产出 iframe 容器', () => {
    const html = renderMarkdown('```embed bilibili video BV1xx411c7mD\n```')
    expect(html).toContain('nd-embed')
    expect(html).toContain('player.bilibili.com')
    expect(html).toContain('BV1xx411c7mD')
  })

  it('embed —— 非法 ID 不产出 iframe（安全底线）', () => {
    const html = renderMarkdown('```embed bilibili video ../../etc/passwd\n```')
    expect(html).not.toContain('<iframe')
  })

  it('embed —— 非 embed 的围栏仍然是普通代码块', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```')
    expect(html).toContain('class="language-js"')
    expect(html).not.toContain('nd-embed')
  })

  it('carousel —— 独占一段的连续图片产出轮播结构', () => {
    const html = renderMarkdown('![一](a.png)\n![二](b.png)')
    expect(html).toContain('nd-carousel')
    expect(html).toContain('a.png')
    expect(html).toContain('b.png')
  })

  it('carousel —— 单张图**不是**轮播', () => {
    const html = renderMarkdown('![一](a.png)')
    expect(html).not.toContain('nd-carousel')
    expect(html).toContain('<img')
  })

  it('table —— GFM 表格照旧（回归）', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table>')
  })

  it('link-card —— 没有元数据时**降级成普通链接**（不经过卡片代码）', () => {
    const html = renderMarkdown('https://example.com/post')
    expect(html).not.toContain('nd-card')
    expect(html).toContain('<a ')
  })

  it('math —— 没有注入 KaTeX 时**降级成源码**，不抛错', () => {
    expect(() => renderMarkdown('$x^2$')).not.toThrow()
    // 没装 KaTeX 就该原样显示，绝不能变成空白或崩掉
    expect(renderMarkdown('$x^2$')).toContain('x^2')
  })
})
