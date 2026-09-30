/**
 * 一次性脚本：从 iconify API 拉取文件图标的 SVG，生成 `src/cm/widgets/code-icons.ts`。
 *
 * 为什么要**内联**而不是运行时用 `iconify-icon`：
 * - `iconify-icon` 是 Web Component，要从 CDN 拉图标数据。离线/内网会**静默变成空标签**
 *   （不报错、就是不显示）—— 今天已经踩过一次同类的静默失效（两份 `@codemirror/language`）。
 * - 这些图标是**静态资源**，构建期拉一次、内联进产物，运行时零请求、零闪烁。
 *
 * 图标集：`vscode-icons`（VSCode 官方图标主题的第三方移植，辨识度最高）。
 * 用法：`node scripts/build-code-icons.mjs`
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** 语言别名 → iconify 图标名（`vscode-icons` 集）。 */
const ICONS = {
  js: 'file-type-js',
  javascript: 'file-type-js',
  mjs: 'file-type-js',
  cjs: 'file-type-js',
  jsx: 'file-type-reactjs',
  ts: 'file-type-typescript',
  typescript: 'file-type-typescript',
  tsx: 'file-type-reactts',
  vue: 'file-type-vue',
  svelte: 'file-type-svelte',
  py: 'file-type-python',
  python: 'file-type-python',
  rs: 'file-type-rust',
  rust: 'file-type-rust',
  go: 'file-type-go',
  java: 'file-type-java',
  kt: 'file-type-kotlin',
  kts: 'file-type-kotlin',
  c: 'file-type-c',
  h: 'file-type-cheader',
  cpp: 'file-type-cpp',
  cc: 'file-type-cpp',
  hpp: 'file-type-cppheader',
  cs: 'file-type-csharp',
  php: 'file-type-php',
  rb: 'file-type-ruby',
  ruby: 'file-type-ruby',
  swift: 'file-type-swift',
  dart: 'file-type-dartlang',
  lua: 'file-type-lua',
  sh: 'file-type-shell',
  bash: 'file-type-shell',
  zsh: 'file-type-shell',
  ps1: 'file-type-powershell',
  powershell: 'file-type-powershell',
  html: 'file-type-html',
  htm: 'file-type-html',
  xml: 'file-type-xml',
  svg: 'file-type-svg',
  css: 'file-type-css',
  scss: 'file-type-scss',
  sass: 'file-type-sass',
  less: 'file-type-less',
  json: 'file-type-json',
  jsonc: 'file-type-json',
  json5: 'file-type-json5',
  yml: 'file-type-yaml',
  yaml: 'file-type-yaml',
  toml: 'file-type-toml',
  ini: 'file-type-ini',
  conf: 'file-type-config',
  cfg: 'file-type-config',
  sql: 'file-type-sql',
  md: 'file-type-markdown',
  markdown: 'file-type-markdown',
  mdx: 'file-type-mdx',
  tex: 'file-type-tex',
  dockerfile: 'file-type-docker',
  docker: 'file-type-docker',
  gradle: 'file-type-gradle',
  makefile: 'file-type-makefile',
  cmake: 'file-type-cmake',
  nginx: 'file-type-nginx',
  diff: 'file-type-diff',
  patch: 'file-type-diff',
  graphql: 'file-type-graphql',
  gql: 'file-type-graphql',
  proto: 'file-type-protobuf',
  r: 'file-type-r',
  pl: 'file-type-perl',
  scala: 'file-type-scala',
  groovy: 'file-type-groovy',
  vim: 'file-type-vim',
  bat: 'file-type-bat',
  cmd: 'file-type-bat',
  ex: 'file-type-elixir',
  exs: 'file-type-elixir',
  erl: 'file-type-erlang',
  hs: 'file-type-haskell',
  clj: 'file-type-clojure',
  nim: 'file-type-nim',
  zig: 'file-type-zig',
  tf: 'file-type-terraform',
  hcl: 'file-type-terraform',
}

const SET = 'vscode-icons'
const OUT = 'src/cm/widgets/code-icons.ts'

/** iconify 的 SVG 里 `width/height="1em"`，正好跟着 font-size 走，不用改。 */
function normalize(svg) {
  return svg
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 拉一个图标，遇到 429（限流）就退避重试。
 *
 * ⚠️ iconify 的公开 API **有限流**：一口气连发 70 个请求会有一批 429
 * （实测第一轮 62 成功 / 10 失败，第二轮 58 / 14）。
 */
async function fetchIcon(icon, attempt = 0) {
  const res = await fetch(`https://api.iconify.design/${SET}/${icon}.svg`)
  if (res.status === 429 && attempt < 6) {
    await sleep(800 * (attempt + 1))
    return fetchIcon(icon, attempt + 1)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const svg = await res.text()
  if (!svg.startsWith('<svg')) throw new Error(`不是 SVG: ${svg.slice(0, 60)}`)
  return svg
}

/**
 * ★ **增量模式**：先读现有文件里已经拉到的图标，只补缺的那些。
 *
 * 为什么必须增量：脚本每跑一次都会**整体重写** `code-icons.ts`，
 * 而 iconify 的限流是**随机命中**的 —— 第二轮重跑时，第一轮成功拉到的
 * `js` / `ts` / `vue` / `java` / `python` 恰好被限流，于是**常用的图标全丢了**。
 * 增量能保证"已经拿到的不再冒险重拉"。
 */
function readExisting() {
  const map = {}
  try {
    const src = readFileSync(OUT, 'utf8')
    const re = /^ {2}("(?:[^"\\]|\\.)*"): (".*"),$/gm
    let m
    while ((m = re.exec(src))) {
      map[JSON.parse(m[1])] = JSON.parse(m[2])
    }
  } catch {
    // 文件还不存在，从零开始
  }
  return map
}

const existing = readExisting()
const entries = Object.entries(existing)
const failed = []
let fetched = 0

console.log(`已有 ${entries.length} 个，开始补缺……`)

for (const [lang, icon] of Object.entries(ICONS)) {
  if (existing[lang]) continue
  try {
    entries.push([lang, normalize(await fetchIcon(icon))])
    fetched++
    process.stdout.write('.')
  } catch (e) {
    failed.push(`${lang} (${icon}): ${e.message}`)
    process.stdout.write('x')
  }
  // 限速：每个请求之间停 150ms，避开 iconify 的限流
  await sleep(150)
}

// 保持 key 有序，diff 才稳定
entries.sort((a, b) => a[0].localeCompare(b[0]))

console.log('')
if (failed.length) {
  console.log(`⚠️ 拉取失败 ${failed.length} 个：`)
  for (const f of failed) console.log('  ' + f)
}

const body = entries
  .map(([lang, svg]) => `  ${JSON.stringify(lang)}: ${JSON.stringify(svg)},`)
  .join('\n')

const file = `/**
 * 文件图标 —— 内联 SVG（\`vscode-icons\` 图标集）。
 *
 * ⚠️ **这是自动生成的，不要手改。** 重新生成：\`node scripts/build-code-icons.mjs\`
 *
 * ## 为什么内联，而不是运行时用 \`iconify-icon\`
 *
 * \`iconify-icon\` 确实在依赖里，但它是个 Web Component，**要从 CDN 拉图标数据**。
 * 离线 / 内网 / CDN 被墙的环境下它会**静默变成一个空标签** —— 不报错、就是不显示。
 * 这个项目今天已经踩过一次同类的静默失效（两份 \`@codemirror/language\` 让装饰层
 * 全失效、零报错），所以这里选**构建期拉一次、内联进产物**：运行时零请求、零闪烁。
 *
 * 每个 SVG 约 300~600 字节，全部内联后约 40KB（gzip 后小得多）。
 *
 * \`width/height="1em"\` 是 iconify 的默认值，正好跟着 \`font-size\` 走，不用改。
 */

/** 语言别名 → SVG 源码。key 是小写。 */
export const CODE_ICONS: Record<string, string> = {
${body}
}

/** 取图标；没有对应图标时返回 \`null\`（调用方自行降级）。 */
export function codeIconFor(lang: string): string | null {
  return CODE_ICONS[lang] ?? null
}
`

writeFileSync(OUT, file, 'utf8')
console.log(`\n✓ 写入 ${OUT}（${entries.length} 个图标，${(file.length / 1024).toFixed(1)} KB）`)
