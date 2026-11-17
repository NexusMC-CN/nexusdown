import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.local', 'lightbox-browser')
mkdirSync(output, { recursive: true })
const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(path => path && existsSync(path))
assert.ok(executablePath, 'Set CHROME_PATH to a Chromium executable')
const errors = []
const checks = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
const server = await createServer({
  root,
  configFile: false,
  server: { host: '127.0.0.1', port: 0 },
  appType: 'custom',
})
const html = [
  '«!doctype html>«html lang="zh-CN">«meta charset="utf-8">«title>Lightbox browser validation«/title>',
  '«body style="overflow:scroll;margin:24px">«article id="content">«/article>«aside id="other">«/aside>',
  '«div id="original" style="height:1400px">Original link destination«/div>',
  '«script type="module">',
  'import { renderMarkdown } from "/src/render/index.ts";',
  'import { mountImageLightbox } from "/src/lightbox/index.ts";',
  'const content = document.querySelector("#content");',
  'const markdown = "![First](/__qa/a.png)\\n![Second](/__qa/b.png)\\n\\n[![Linked](/__qa/linked.png)](#original)";',
  'window.events = [];',
  'window.configure = (mode) => {',
  '  window.dispose?.();',
  '  content.innerHTML = renderMarkdown(markdown, { idPrefix: "browser" });',
  '  window.dispose = mountImageLightbox(content, mode === "host" ? { onOpen: (images,index) => window.events.push({images,index}) } : undefined);',
  '};',
  'window.replaceContent = () => { content.innerHTML = renderMarkdown("![Replacement](/__qa/replacement.png)", {idPrefix:"replacement"}); };',
  'window.openSecond = () => {',
  '  const other = document.querySelector("#other");',
  '  other.innerHTML = renderMarkdown("![Other](/__qa/other.png)", {idPrefix:"other"});',
  '  window.otherDispose = mountImageLightbox(other);',
  '  other.querySelector("img").click();',
  '};',
  'window.configure("host");',
  'window.ready = true;',
  '«/script>«/body>«/html>',
].join('\n').replaceAll('«', String.fromCharCode(60))
server.middlewares.use((request, response, next) => {
  if (request.url === '/__qa/') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(html)
  } else if (request.url?.startsWith('/__qa/') && request.url.endsWith('.png')) {
    response.setHeader('content-type', 'image/png')
    response.end(png)
  } else if (request.url === '/favicon.ico') {
    response.statusCode = 204
    response.end()
  } else next()
})
await server.listen()
const address = server.httpServer.address()
assert.ok(address && typeof address !== 'string')
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  userDataDir: resolve(output, 'profile'),
  args: ['--no-sandbox', '--disable-gpu'],
})
try {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 1280, height: 800 })
  await page.goto('http://127.0.0.1:' + address.port + '/__qa/', { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.ready === true)
  const selector = '#content img[data-nd-image]'
  const marked = await page.$$(selector)
  assert.equal(marked.length, 3)
  await marked[1].click()
  assert.deepEqual(await page.evaluate(() => window.events.map(event => ({
    index: event.index,
    titles: event.images.map(image => image.title),
  }))), [{ index: 1, titles: ['First', 'Second'] }])
  assert.equal(await page.$('[role=dialog]'), null)
  checks.push('host callback receives the exact content group and clicked index')

  await page.evaluate(() => {
    const root = document.querySelector('#content')
    root.addEventListener('click', event => {
      window.linkIntercepted = event.defaultPrevented
      event.preventDefault()
    }, { once: true })
    root.querySelector('a img').click()
  })
  assert.equal(await page.evaluate(() => window.linkIntercepted), false)
  checks.push('linked image navigation remains available')

  await page.evaluate(() => window.configure('default'))
  await page.focus(selector)
  await page.keyboard.press('Enter')
  await page.waitForSelector('[role=dialog]')
  assert.equal(await page.evaluate(() => document.querySelector('[role=dialog]').contains(document.activeElement)), true)
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.$eval('[role=dialog] img', image => image.getAttribute('src')), '/__qa/b.png')
  await page.click('[role=dialog] button[aria-label="上一张"]')
  assert.equal(await page.$eval('[role=dialog] img', image => image.getAttribute('src')), '/__qa/a.png')
  for (let index = 0; index !== 4; index++) await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.querySelector('[role=dialog]').contains(document.activeElement)), true)
  await page.screenshot({ path: resolve(output, 'desktop.png') })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role=dialog]', { hidden: true })
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#content img')), true)
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'scroll')
  checks.push('keyboard/buttons, focus constraint and return, scroll restoration')

  await page.click(selector)
  await page.evaluate(() => {
    const target = document.querySelector('[role=dialog]')
    for (const [type, x, y] of [['touchstart', 220, 50], ['touchend', 40, 55]]) {
      const event = new Event(type, { bubbles: true })
      Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', {
        value: [{ clientX: x, clientY: y }],
      })
      target.dispatchEvent(event)
    }
  })
  assert.equal(await page.$eval('[role=dialog] img', image => image.getAttribute('src')), '/__qa/b.png')
  checks.push('horizontal touch paging')

  await page.evaluate(() => window.replaceContent())
  await page.waitForSelector('[role=dialog]', { hidden: true })
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'scroll')
  await page.click(selector)
  assert.equal(await page.$eval('[role=dialog] img', image => image.getAttribute('src')), '/__qa/replacement.png')
  checks.push('document replacement closes stale viewing and activates new content')

  await page.evaluate(() => window.openSecond())
  assert.equal(await page.$$eval('[role=dialog]', elements => elements.length), 2)
  await page.keyboard.press('Escape')
  assert.equal(await page.$$eval('[role=dialog]', elements => elements.length), 1)
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
  await page.evaluate(() => { window.otherDispose(); window.dispose(); })
  assert.equal(await page.$$eval('[role=dialog]', elements => elements.length), 0)
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'scroll')
  checks.push('top viewer key ownership and multi-instance cleanup')

  await page.setViewport({ width: 390, height: 844 })
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.evaluate(() => window.configure('default'))
  await page.click(selector)
  assert.equal(await page.$eval('[role=dialog]', element => element.getAnimations().length), 0)
  const bounds = await page.$eval('[role=dialog]', element => {
    const box = element.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  })
  assert.deepEqual(bounds, { x: 0, y: 0, width: 390, height: 844 })
  await page.screenshot({ path: resolve(output, 'mobile-reduced-motion.png') })
  await page.click('[role=dialog] button[aria-label="关闭"]')
  await page.evaluate(() => { window.dispose(); window.dispose(); })
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'scroll')
  checks.push('mobile viewport, reduced motion, repeat cleanup')

  assert.deepEqual(errors, [])
  const result = { checks, errors, scope: 'Real Chromium + actual renderer and lightbox modules; no application backend.' }
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  await server.close()
}
