/**
 * 补充截图：把光标放到文档末尾（避免「光标所在行揭示」），
 * 再把编辑器与预览都滚到底部，截「渲染态」的代码块 / 数学 / embed / 图片。
 *
 * 用法：node scripts/qa-bottom.mjs [fixtureId]
 */
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const fixture = process.argv[2] ?? 'full'
const OUT = path.resolve('.local/qa-shots')

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1680, height: 1000 })
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle0', timeout: 60_000 })
await page.waitForSelector('.cm-editor', { timeout: 30_000 })
await page.select('.fixture select', fixture)
await new Promise((r) => setTimeout(r, 350))

// 聚焦编辑器 → 光标到文末（块级组件全部回到渲染态）
await page.click('.cm-content')
await page.keyboard.down('Control')
await page.keyboard.press('End')
await page.keyboard.up('Control')
await new Promise((r) => setTimeout(r, 300))

// 两侧各自滚到底
await page.evaluate(() => {
  const scroller = document.querySelector('.cm-scroller')
  if (scroller) scroller.scrollTop = scroller.scrollHeight
  const preview = document.querySelector('.pane-output .pane-body')
  if (preview) preview.scrollTop = preview.scrollHeight
})
await new Promise((r) => setTimeout(r, 300))

await page.screenshot({ path: path.join(OUT, `${fixture}-bottom.png`) })
const editor = await page.$('.pane-editor')
if (editor) await editor.screenshot({ path: path.join(OUT, `${fixture}-bottom-editor.png`) })
const preview = await page.$('.pane-output')
if (preview) await preview.screenshot({ path: path.join(OUT, `${fixture}-bottom-preview.png`) })

await browser.close()
console.log('done')
