import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(process.env.NEXUSDOWN_POPUP_OUTPUT || resolve(root, '.local/popup-theme-browser'))
mkdirSync(output, { recursive: true })
const executablePath = [process.env.ANNEXUS_BROWSER_PATH, process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path && existsSync(path))
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium executable')
const doc = 'intro\n\n| A | B |\n| --- | --- |\n| a | b |\n\ntail'
const html = `<!doctype html><html><meta charset="utf-8"><title>Popup theme regression</title>
<style>
body{margin:20px;font-family:serif}.scope{padding:20px;margin:10px;border:1px solid #ddd;--host-surface:rgb(240, 244, 248);--nd-surface:var(--host-surface);--nd-brand:rgb(20, 80, 140);--nd-popup-only:initial;--nd-text:rgb(12, 20, 30);font-family:monospace;font-size:18px;line-height:29px;color-scheme:light}
.scope .cm-editor{font-family:inherit;font-size:inherit;line-height:inherit;--nd-motion-dur-2:170ms}
.scope[data-theme="dark"]{--host-surface:rgb(28, 34, 42);--nd-brand:rgb(160, 200, 240);color-scheme:dark}
.scope[data-palette="changed"]{--nd-brand:rgb(210, 50, 90)}
.scope[data-scope="new-hash"]{--nd-brand:rgb(80, 150, 60)}
.scope.special{--nd-brand:rgb(120, 60, 180)}
@media(prefers-color-scheme:dark){.scope[data-theme="system"]{--host-surface:rgb(16, 24, 32);color-scheme:dark}}
@media(prefers-reduced-motion:reduce){.scope .cm-editor{--nd-motion-dur-2:0ms}}
[data-nexusdown-skin="fixture"].nd-variant-menu{border-radius:13px;background:var(--nd-surface)}
</style><body><section id="a" class="scope" data-nexusdown-skin="fixture"><div class="host"></div></section><section id="b" class="scope" data-nexusdown-skin="other"><div class="host"></div></section>
<script type="module">
import {mountEditor} from '/src/cm/mount.ts';
import {forceParsing} from '@codemirror/language';
import '/src/cm/theme.css';
window.editors={};window.kept={};
// Track registrations on the real MediaQueryList objects, rather than replacing
// media evaluation or event delivery. Closing every popup must release them.
const match=window.matchMedia.bind(window);window.themeListeners=new Map();
window.matchMedia=query=>{const media=match(query),add=media.addEventListener.bind(media),remove=media.removeEventListener.bind(media);media.addEventListener=(type,listener,options)=>{if(type==='change'&&['(prefers-color-scheme: dark)','(prefers-reduced-motion: reduce)'].includes(query))window.themeListeners.set(media,listener);add(type,listener,options)};media.removeEventListener=(type,listener,options)=>{window.themeListeners.delete(media);remove(type,listener,options)};return media};
for(const id of ['a','b']){const parent=document.querySelector('#'+id+' .host');const view=mountEditor({parent,doc:${JSON.stringify(doc)}});forceParsing(view,view.state.doc.length,1000);window.editors[id]=view}
document.querySelector('#b').style.setProperty('--nd-brand','rgb(180, 120, 10)');
window.ready=true;
</script></body></html>`
const server = await createServer({ root, configFile: false, appType: 'custom', server: { host: '127.0.0.1', port: 0 } })
server.middlewares.use(async (request, response, next) => {
  if (request.url === '/__popup-theme') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(await server.transformIndexHtml(request.url, html))
  } else if (request.url === '/favicon.ico') { response.statusCode = 204; response.end() }
  else next()
})
let browser
const checks = [], failures = [], errors = []
try {
  await server.listen()
  browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: resolve(output, 'profile'), args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 1000, height: 850 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/__popup-theme', { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.ready)
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const check = async (name, run) => {
    try { await run(); checks.push(name) } catch (error) { failures.push({ name, error: error.message }) }
  }
  const open = async id => {
    await page.hover('#' + id + ' .nd-table')
    await page.waitForFunction(id => !document.querySelector('#' + id + ' .nd-variant-hover').hidden, {}, id)
    await page.click('#' + id + ' .nd-variant-hover')
    await page.waitForSelector('.nd-variant-menu')
  }
  const brand = () => page.$eval('.nd-variant-menu', element => getComputedStyle(element).getPropertyValue('--nd-brand').trim())
  const listenerBaseline = await page.evaluate(() => window.themeListeners.size)

  await open('a')
  await check('initial body menu receives resolved inherited variables, typography and skin before measurement', async () => {
    const value = await page.$eval('.nd-variant-menu', element => { const style=getComputedStyle(element); return {surface:style.backgroundColor,brand:style.getPropertyValue('--nd-brand').trim(),font:style.fontFamily,size:style.fontSize,line:style.lineHeight,skin:element.dataset.nexusdownSkin,radius:style.borderRadius,width:element.style.width,top:element.style.top} })
    assert.equal(value.surface, 'rgb(240, 244, 248)')
    assert.equal(value.brand, 'rgb(20, 80, 140)')
    assert.equal(value.font, 'monospace')
    assert.equal(value.size, '18px')
    assert.equal(value.line, '29px')
    assert.equal(value.skin, 'fixture')
    assert.equal(value.radius, '13px')
    assert.equal(value.width, '')
    assert.ok(value.top)
  })
  await check('open menu follows ancestor data-theme, arbitrary scope hash, class and inline palette', async () => {
    await page.$eval('#a', el => {el.dataset.theme='dark'})
    await settle()
    assert.equal(await page.$eval('.nd-variant-menu', el=>getComputedStyle(el).backgroundColor), 'rgb(28, 34, 42)')
    await page.$eval('#a', el => {el.dataset.scope='new-hash'})
    await settle()
    assert.equal(await brand(), 'rgb(80, 150, 60)')
    await page.$eval('#a', el => {delete el.dataset.scope;el.classList.add('special')})
    await settle()
    assert.equal(await brand(), 'rgb(120, 60, 180)')
    await page.$eval('#a', el => {el.style.setProperty('--nd-brand','rgb(9, 88, 77)');el.style.direction='rtl'})
    await settle()
    assert.equal(await brand(), 'rgb(9, 88, 77)')
    assert.equal(await page.$eval('.nd-variant-menu', el=>getComputedStyle(el).direction), 'rtl')
  })
  await check('system color scheme updates an already open menu without attribute changes', async () => {
    await page.$eval('#a', el => {el.dataset.theme='system'})
    await settle()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.nd-variant-menu')).backgroundColor==='rgb(16, 24, 32)', { timeout: 3000 })
    assert.equal(await page.$eval('.nd-variant-menu', el=>getComputedStyle(el).colorScheme), 'dark')
  })
  await check('reduced motion updates an already open menu in both directions without attribute changes', async () => {
    assert.equal(await page.$eval('.nd-variant-menu', el=>el.style.getPropertyValue('--nd-motion-dur-2')), '170ms')
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.waitForFunction(() => document.querySelector('.nd-variant-menu').style.getPropertyValue('--nd-motion-dur-2')==='0ms', { timeout: 3000 })
    assert.equal(await page.evaluate(() => window.themeListeners.size), listenerBaseline + 2)
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }])
    await page.waitForFunction(() => document.querySelector('.nd-variant-menu').style.getPropertyValue('--nd-motion-dur-2')==='170ms', { timeout: 3000 })
  })
  await check('removing source variables and the nearest skin does not leave stale inline values', async () => {
    await page.$eval('#a', el => {el.style.setProperty('--nd-transient','temporary')})
    await settle()
    assert.equal(await page.$eval('.nd-variant-menu', el=>el.style.getPropertyValue('--nd-transient')), 'temporary')
    await page.$eval('#a', el => {el.style.removeProperty('--nd-transient');el.removeAttribute('data-nexusdown-skin')})
    await settle()
    assert.equal(await page.$eval('.nd-variant-menu', el=>el.style.getPropertyValue('--nd-transient')), '')
    assert.equal(await page.$eval('.nd-variant-menu', el=>el.hasAttribute('data-nexusdown-skin')), false)
  })
  await page.evaluate(() => {window.kept.closed=document.querySelector('.nd-variant-menu');document.querySelector('.nd-variant-menu [role="menuitem"]').click();window.kept.toast=document.querySelector('.nd-variant-toast')})
  await open('b')
  await check('toast and menu keep explicit independent owners while another editor opens', async () => {
    await page.$eval('#a', el => {el.style.setProperty('--nd-brand','rgb(99, 77, 55)')})
    await settle()
    assert.equal(await page.evaluate(()=>window.kept.toast.style.getPropertyValue('--nd-brand').trim()), 'rgb(99, 77, 55)')
    assert.equal(await brand(), 'rgb(180, 120, 10)')
    assert.equal(await page.evaluate(()=>window.kept.closed.style.getPropertyValue('--nd-brand').trim()), 'rgb(9, 88, 77)')
  })
  await check('editor destruction removes its live menu and toast', async () => {
    await page.evaluate(() => {window.editors.a.destroy();window.editors.b.destroy()})
    assert.equal(await page.$('.nd-variant-menu'), null)
    assert.equal(await page.$('.nd-variant-toast'), null)
    assert.equal(await page.evaluate(() => window.themeListeners.size), listenerBaseline)
  })
  assert.deepEqual(errors, [])
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, failures, pageErrors: errors }, null, 2))
  for (const check of checks) console.log('  ok ' + check)
  for (const failure of failures) console.error('  FAIL ' + failure.name + ': ' + failure.error)
  assert.deepEqual(failures, [], 'Popup theme browser regressions')
  console.log(`Popup theme browser regression passed (${checks.length} checks)`)
} finally {
  await browser?.close()
  await server.close()
}
