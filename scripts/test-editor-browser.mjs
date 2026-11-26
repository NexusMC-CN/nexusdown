import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.local/editor-browser')
mkdirSync(output, { recursive: true })
const executablePath = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path && existsSync(path))
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium executable')
const source = '# Long document\n\n' + 'A paragraph with **formatting** and a link to https://example.com/very/long/path.\n\n'.repeat(65)
const html = `<!doctype html><html><meta charset="utf-8"><title>Editor browser regression</title>
<style>body{margin:0;font-family:system-ui}nav{position:fixed;top:0;left:0;right:0;height:64px;background:#183149;color:white;z-index:100;display:grid;place-items:center}main{max-width:960px;margin:180px auto 500px;padding:0 12px}.case{border:1px solid #ccd3dc;margin-bottom:120px}.dialog{height:420px;overflow:auto;border:2px solid #789;margin-top:100px}.gap{height:150px}*{box-sizing:border-box}</style>
<body><nav>64px host navigation</nav><main><div id="app"></div></main>
<script type="module">
import {createApp,h,ref,nextTick} from 'vue';
import {ViewPlugin,Decoration} from '@codemirror/view';
import {NexusdownEditor,defaultToolbarGroups} from '/dist/editor/index.js';
import '/dist/editor/nexusdown.css';
const text=ref(${JSON.stringify(source)}), mode=ref('container'), height=ref('420px'), a=ref(null), b=ref(null), c=ref(null);
const nestedMode=ref('page'), nestedHeight=ref('420px');
const plugin=ViewPlugin.define(()=>({decorations:Decoration.set([Decoration.mark({class:'host-mark'}).range(0,1)])}),{decorations:value=>value.decorations});
const extensions=ref([plugin]);
window.errors=[]; window.saves=0;
const toolbar={groups:[
 {id:'common',label:'Common',items:['bold','italic','link']},
 {id:'host',label:'Host actions',display:'dropdown',items:[{id:'insert-host',label:'Insert host text',run({runCommand}){runCommand(view=>{view.dispatch(view.state.replaceSelection('HOST-CONTENT'));return true})}}]},
 {id:'extended',label:'Extensions',display:'dropdown',items:['table','mention','blockVariants']}
]};
const aToolbar=ref(toolbar);
createApp({setup(){return()=>h('form',{onSubmit:e=>{e.preventDefault();window.saves++}},[
 h('section',{id:'editor-a',class:'case'},[h(NexusdownEditor,{ref:a,modelValue:text.value,'onUpdate:modelValue':v=>text.value=v,extensions:extensions.value,toolbar:aToolbar.value,scrollMode:mode.value,toolbarOffset:64,style:{'--nd-editor-height':height.value},onActionError:e=>window.errors.push(String(e.error))})]),
 h('section',{id:'editor-b',class:'case'},[h(NexusdownEditor,{ref:b,modelValue:${JSON.stringify(source)},toolbar,scrollMode:'page',toolbarOffset:64})]),
 h('div',{id:'dialog',class:'dialog'},[h(NexusdownEditor,{ref:c,modelValue:${JSON.stringify(source)},toolbar,scrollMode:nestedMode.value,toolbarOffset:0,style:{'--nd-editor-height':nestedHeight.value}})]),
 h('button',{type:'submit',id:'publish'},'Publish')
])}}).mount('#app');
window.ready=()=>!!a.value?.view&&!!b.value?.view&&!!c.value?.view;
window.view=()=>a.value.view; window.source=()=>text.value;
window.nestedView=()=>c.value.view;
window.configureNested=async()=>{nestedMode.value='container';nestedHeight.value='1200px';await nextTick();c.value.view.requestMeasure()};
window.pluginWorks=()=>!!a.value.view.plugin(plugin)&&!!document.querySelector('#editor-a .host-mark');
window.configure=async(next,size='420px')=>{mode.value=next;height.value=size;await nextTick();a.value.view.requestMeasure()};
window.expandToolbar=async(display='inline')=>{aToolbar.value={groups:[{id:'all',label:'All actions',display,items:defaultToolbarGroups.flatMap(group=>group.items)}]};await nextTick();a.value.view.requestMeasure()};
</script></body></html>`
const server = await createServer({ root, configFile: false, appType: 'custom', server: { host: '127.0.0.1', port: 0 } })
server.middlewares.use(async (request, response, next) => {
  if (request.url === '/__editor-regression') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(await server.transformIndexHtml(request.url, html))
  } else if (request.url === '/favicon.ico') { response.statusCode = 204; response.end() }
  else next()
})
let browser
const checks = []
const errors = []
try {
  await server.listen()
  browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: resolve(output, 'profile'), args: ['--no-sandbox', '--disable-gpu'] })
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 1280, height: 850 })
  const address = server.httpServer.address()
  await page.goto('http://127.0.0.1:' + address.port + '/__editor-regression', { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.ready?.())
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const geometry = id => page.$eval('#' + id, root => {
    const header = root.querySelector('.nd-editor__chrome').getBoundingClientRect()
    const editor = root.querySelector('.nd-editor').getBoundingClientRect()
    const host = root.querySelector('.nd-editor__content').getBoundingClientRect()
    return {top:header.top,bottom:header.bottom,editorBottom:editor.bottom,hostHeight:host.height,editorHeight:editor.height}
  })
  assert.ok(Math.abs((await geometry('editor-a')).hostHeight - 420) < 2)
  assert.ok(await page.evaluate(() => window.pluginWorks()))
  checks.push('a host decoration extension keeps its identity through a Vue ref')
  await page.$eval('#editor-a .cm-scroller', element => { element.scrollTop = 300 })
  assert.ok(await page.$eval('#editor-a .cm-scroller', element => element.scrollTop > 200))
  checks.push('default container retains 420px and internal scrolling')

  await page.click('#editor-a button[aria-label="Host actions"]')
  await page.click('#editor-a [role="menuitem"][aria-label="Insert host text"], #editor-a button[aria-label="Insert host text"]')
  assert.ok((await page.evaluate(() => window.source())).includes('HOST-CONTENT'))
  assert.equal(await page.evaluate(() => window.saves), 0)
  checks.push('host-defined category inserts through a custom action without submitting')

  await page.evaluate(() => window.configure('container', '1200px'))
  await settle()
  assert.ok((await geometry('editor-a')).hostHeight >= 1199)
  await page.$eval('#editor-a', element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 300))
  await settle()
  assert.ok(Math.abs((await geometry('editor-a')).top - 64) < 3)
  checks.push('oversized container toolbar sticks below host navigation')

  await page.evaluate(() => {const view=window.view();view.dispatch({selection:{anchor:view.state.doc.length},scrollIntoView:true});view.focus()})
  await settle()
  await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control')
  await settle()
  let cursor = await page.evaluate(() => {const v=window.view(),p=v.coordsAtPos(v.state.selection.main.head),h=document.querySelector('#editor-a .nd-editor__chrome').getBoundingClientRect();return {top:p?.top,bottom:p?.bottom,header:h.bottom}})
  assert.ok(cursor.top >= cursor.header - 3, JSON.stringify(cursor))
  checks.push('cursor navigation in a tall container avoids the sticky toolbar')

  await page.evaluate(() => window.configure('page'))
  await settle()
  assert.ok((await geometry('editor-a')).hostHeight > 1200)
  await page.$eval('#editor-a', element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 450))
  await settle()
  assert.ok(Math.abs((await geometry('editor-a')).top - 64) < 3)
  await page.click('#editor-a button[data-mode="preview"]')
  await settle()
  assert.ok(await page.$('#editor-a .nd-editor__preview'))
  assert.ok(Math.abs((await geometry('editor-a')).top - 64) < 3)
  await page.click('#editor-a button[data-mode="edit"]')
  await settle()
  checks.push('page scrolling sticks the shared edit/preview header')

  await page.evaluate(() => {const v=window.view();v.dispatch({selection:{anchor:0},scrollIntoView:true})})
  await settle()
  cursor = await page.evaluate(() => {const v=window.view(),p=v.coordsAtPos(0),h=document.querySelector('#editor-a .nd-editor__chrome').getBoundingClientRect();return {top:p?.top,header:h.bottom}})
  assert.ok(cursor.top >= cursor.header - 3, JSON.stringify(cursor))
  checks.push('page caret scrolling avoids the toolbar and navigation offset')

  await page.$eval('#editor-b', element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 250))
  await settle()
  const first = await geometry('editor-a'), second = await geometry('editor-b')
  assert.ok(first.bottom <= first.editorBottom + 2)
  assert.ok(first.top < 64)
  assert.ok(Math.abs(second.top - 64) < 3)
  checks.push('each editor stops its header at its own bottom boundary')

  await page.evaluate(() => window.view().dispatch({ selection: { anchor: 0 }, scrollIntoView: true }))
  await settle()
  cursor = await page.evaluate(() => {const v=window.view(),p=v.coordsAtPos(0),h=document.querySelector('#editor-a .nd-editor__chrome').getBoundingClientRect();return {top:p?.top,header:h.bottom}})
  assert.ok(cursor.top >= cursor.header - 3, JSON.stringify(cursor))
  checks.push('returning to an offscreen editor keeps its caret below the header')

  await page.$eval('#dialog', element => {element.scrollIntoView();element.scrollTop=240})
  await settle()
  const dialogTop = await page.$eval('#dialog', element => element.getBoundingClientRect().top)
  const dialogHeader = await page.$eval('#dialog .nd-editor__chrome', element => element.getBoundingClientRect().top)
  assert.ok(Math.abs(dialogHeader - dialogTop - 2) < 3)
  checks.push('page mode inside a scroll container sticks to that container')
  await page.evaluate(() => window.configureNested())
  await settle()
  await page.evaluate(() => {const view=window.nestedView();view.dispatch({selection:{anchor:view.state.doc.length},scrollIntoView:true});view.focus()})
  await settle()
  await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control')
  await settle()
  cursor = await page.evaluate(() => {const v=window.nestedView(),p=v.coordsAtPos(v.state.selection.main.head),h=document.querySelector('#dialog .nd-editor__chrome').getBoundingClientRect();return {top:p?.top,header:h.bottom}})
  assert.ok(cursor.top >= cursor.header - 3, JSON.stringify(cursor))
  checks.push('cursor navigation avoids the header inside a nested tall container')

  await page.setViewport({ width: 375, height: 800 })
  await page.$eval('#editor-a', element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 300))
  await settle()
  assert.ok(Math.abs((await geometry('editor-a')).top - 64) < 3)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
  await page.evaluate(() => window.expandToolbar())
  await settle()
  const inline = await page.$eval('#editor-a .cm-toolbar', toolbar => {
    const buttons = [...toolbar.querySelectorAll('.inline-items button')]
    return { count: buttons.length, rows: new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size }
  })
  assert.equal(inline.count, 20)
  assert.ok(inline.rows > 1, JSON.stringify(inline))
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
  await page.screenshot({ path: resolve(output, 'narrow-page.png'), fullPage: false })
  checks.push('375px layout wraps all 20 inline actions without horizontal page overflow')
  await page.evaluate(() => window.expandToolbar('dropdown'))
  await settle()
  await page.click('#editor-a button[aria-label="All actions"]')
  const dropdown = await page.$eval('#editor-a [role="menu"][aria-label="All actions"]', menu => {
    const rect = menu.getBoundingClientRect()
    return { count: menu.querySelectorAll('[role="menuitem"]').length, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight }
  })
  assert.equal(dropdown.count, 20)
  assert.ok(dropdown.left >= 0 && dropdown.right <= dropdown.width && dropdown.top >= 0 && dropdown.bottom <= dropdown.height, JSON.stringify(dropdown))
  await page.keyboard.press('Escape')
  assert.equal(await page.$('#editor-a [role="menu"][aria-label="All actions"]'), null)
  checks.push('all 20 actions fit in a narrow category dropdown and Escape closes it')
  assert.deepEqual(errors, [])
  assert.deepEqual(await page.evaluate(() => window.errors), [])
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, pageErrors: errors }, null, 2))
  console.log(`Editor browser regression passed (${checks.length} checks)`)
  for (const check of checks) console.log('  ok ' + check)
} finally {
  await browser?.close()
  await server.close()
}
