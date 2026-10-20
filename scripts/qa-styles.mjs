/**
 * 样式对拍：同一份 full 样例，分别取「编辑器行」与「渲染侧元素」的计算样式，
 * 输出 JSON 方便逐项比对字号 / 行高 / 外边距 / 颜色 / 背景。
 *
 * 用法：node scripts/qa-styles.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = path.resolve('.local/qa-shots/styles.json')

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1680, height: 1000 })
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle0', timeout: 60_000 })
await page.waitForSelector('.cm-editor', { timeout: 30_000 })
await page.select('.fixture select', 'full')
await new Promise((r) => setTimeout(r, 400))

// 光标到文末，让块级组件全部处于渲染态
await page.click('.cm-content')
await page.keyboard.down('Control')
await page.keyboard.press('End')
await page.keyboard.up('Control')
await new Promise((r) => setTimeout(r, 300))

const result = await page.evaluate(() => {
  const pick = (el) => {
    if (!el) return null
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      fontWeight: s.fontWeight,
      color: s.color,
      background: s.backgroundColor,
      marginTop: s.marginTop,
      marginBottom: s.marginBottom,
      paddingLeft: s.paddingLeft,
      paddingTop: s.paddingTop,
      borderRadius: s.borderRadius,
      borderLeft: s.borderLeftWidth + ' ' + s.borderLeftStyle + ' ' + s.borderLeftColor,
      width: Math.round(r.width),
      height: Math.round(r.height),
    }
  }

  const editor = {}
  const editorSelectors = {
    h1: '.cm-line.nd-h1',
    h2: '.cm-line.nd-h2',
    h3: '.cm-line.nd-h3',
    p: '.cm-line:not(.nd-h1):not(.nd-h2):not(.nd-h3):not(.nd-blockquote)',
    blockquote: '.cm-line.nd-blockquote',
    listItem: '.cm-line.nd-list-item',
    table: '.cm-editor .nd-table table',
    tableTh: '.cm-editor .nd-table th',
    codeFence: '.cm-editor .nd-code-fence',
    codeHeader: '.cm-editor .nd-code-header',
    calloutLine: '.cm-line.nd-callout--tip',
    taskInput: '.cm-editor input[type=checkbox]',
  }
  for (const [k, sel] of Object.entries(editorSelectors)) editor[k] = pick(document.querySelector(sel))

  const preview = {}
  const previewSelectors = {
    h1: '.nd-preview h1',
    h2: '.nd-preview h2',
    h3: '.nd-preview h3',
    p: '.nd-preview p',
    blockquote: '.nd-preview blockquote',
    listItem: '.nd-preview li',
    table: '.nd-preview table',
    tableTh: '.nd-preview th',
    codeFence: '.nd-preview .nd-code-fence',
    codeHeader: '.nd-preview .nd-code-header',
    callout: '.nd-preview .nd-callout',
    calloutTitle: '.nd-preview .nd-callout__title',
    taskInput: '.nd-preview input[type=checkbox]',
    mark: '.nd-preview mark',
    math: '.nd-preview .nd-math',
  }
  for (const [k, sel] of Object.entries(previewSelectors)) preview[k] = pick(document.querySelector(sel))

  return { editor, preview }
})

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(result, null, 2))

// 终端里先给一张简表
const keys = [...new Set([...Object.keys(result.editor), ...Object.keys(result.preview)])]
for (const k of keys) {
  const e = result.editor[k]
  const p = result.preview[k]
  const fmt = (x) => (x ? `${x.fontSize}/${x.lineHeight} m:${x.marginTop},${x.marginBottom} pad:${x.paddingLeft} bg:${x.background}` : '—')
  console.log(`${k.padEnd(12)} editor ${fmt(e)}`)
  console.log(`${''.padEnd(12)} preview ${fmt(p)}`)
}

await browser.close()
