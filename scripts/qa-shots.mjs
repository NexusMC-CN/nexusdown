/**
 * 视觉 QA 截图脚本 —— 打开 playground，逐样例截图，并在编辑器里逐行点击后截图。
 *
 * 用法：
 *   node scripts/qa-shots.mjs                 # 全部样例 + 全部行
 *   node scripts/qa-shots.mjs --fixtures=full,table
 *   node scripts/qa-shots.mjs --no-lines      # 只截每个样例的初始状态
 *
 * 产物：.local/qa-shots/<fixture>.png、<fixture>-line<N>.png
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:5199/'
const OUT = path.resolve('.local/qa-shots')
fs.mkdirSync(OUT, { recursive: true })

const args = new Set(process.argv.slice(2))
const only = [...args]
  .find((a) => a.startsWith('--fixtures='))
  ?.slice('--fixtures='.length)
  .split(',')
  .filter(Boolean)
const withLines = !args.has('--no-lines')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1680, height: 1000, deviceScaleFactor: 1 })

const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`)
})

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60_000 })
await page.waitForSelector('.cm-editor', { timeout: 30_000 })
await page.waitForSelector('.nd-preview', { timeout: 30_000 })
await sleep(300)

const allFixtures = await page.$$eval('.fixture select option', (os) => os.map((o) => o.value))
const fixtures = only?.length ? allFixtures.filter((id) => only.includes(id)) : allFixtures

for (const id of fixtures) {
  await page.select('.fixture select', id)
  await sleep(350)

  await page.screenshot({ path: path.join(OUT, `${id}.png`) })

  if (!withLines || id === 'stress') continue

  const count = await page.$$eval('.cm-editor .cm-line', (els) => els.length)
  for (let i = 0; i < count; i += 1) {
    const line = (await page.$$('.cm-editor .cm-line'))[i]
    if (!line) continue
    const box = await line.boundingBox()
    if (!box) continue
    // 点行中央：把光标放进这一行，触发「行级揭示」
    await page.mouse.click(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2)
    await sleep(120)
    const pane = await page.$('.pane-editor')
    if (pane) await pane.screenshot({ path: path.join(OUT, `${id}-line${i + 1}.png`) })
  }
}

if (problems.length) {
  fs.writeFileSync(path.join(OUT, '_problems.txt'), problems.join('\n'))
  console.log(`⚠️ ${problems.length} 条页面错误，见 _problems.txt`)
} else {
  console.log('页面无 console/page 错误')
}

await browser.close()
console.log(`done: ${OUT}`)
