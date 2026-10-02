/**
 * 代码块标题栏的**纯逻辑** —— 结构、类名、图标、降级徽章。
 *
 * ## 为什么单独一个文件
 *
 * 同一个「代码块标题栏」有**三个**渲染者：
 *
 * 1. `widgets/code-header.ts` —— 编辑器里 CM6 的 widget（活 DOM，带折叠按钮）
 * 2. `render/renderer.ts` —— 显示侧 markdown-it 的 fence 规则（HTML 字符串，无按钮）
 * 3. 消费方自己的演示/预览 UI
 *
 * 三者**必须长得一样**，否则「编辑器里看到的」和「发布出来的」就不是一个东西 ——
 * 那正是 `nexusdown/render` 当初要消灭的问题，只不过发生在视觉层而不是语法层。
 *
 * 所以这里只放**不依赖 DOM、不依赖 CM6** 的东西：解析围栏信息、取图标、
 * 拼标题栏 HTML。谁要渲染，谁自己把它塞进自己的容器里。
 *
 * ## 标记里只有两处是用户输入
 *
 * `lang` 和 `title` 都来自围栏的 info string，**必须转义**（`escapeHtml`）。
 * 图标 SVG 来自我们自己的构建产物，可以放心当 HTML 用。
 */
import { codeIconFor } from './code-icons.js'
import { MC_CODE_ICONS } from './code-icons-mc.js'

/** 折叠按钮的两个箭头（内联 SVG，跟着 `currentColor` 走）。 */
const CHEVRON_DOWN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5 8 10.5 12 6.5"/></svg>'
const CHEVRON_RIGHT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4 10.5 8 6.5 12"/></svg>'

/**
 * 语言 → 徽章配色（**降级用**）。
 *
 * 首选是真图标（`code-icons.ts` 里内联的 vscode-icons SVG）。
 * 只有当语言没有对应图标时才降级到这个「彩色圆角方块 + 缩写」——
 * 比如用户写了一个冷门语言，总比什么都不显示强。
 *
 * 颜色取各语言官方品牌色的近似值；`fg` 是缩写文字的对比色。
 */
interface Badge {
  label: string
  color: string
  fg: string
}

const BADGES: Record<string, Badge> = {
  js: { label: 'JS', color: '#f7df1e', fg: '#1a1a1a' },
  javascript: { label: 'JS', color: '#f7df1e', fg: '#1a1a1a' },
  mjs: { label: 'JS', color: '#f7df1e', fg: '#1a1a1a' },
  cjs: { label: 'JS', color: '#f7df1e', fg: '#1a1a1a' },
  jsx: { label: 'JSX', color: '#61dafb', fg: '#1a1a1a' },
  ts: { label: 'TS', color: '#3178c6', fg: '#fff' },
  typescript: { label: 'TS', color: '#3178c6', fg: '#fff' },
  tsx: { label: 'TSX', color: '#3178c6', fg: '#fff' },
  vue: { label: 'V', color: '#42b883', fg: '#fff' },
  py: { label: 'PY', color: '#3776ab', fg: '#fff' },
  python: { label: 'PY', color: '#3776ab', fg: '#fff' },
  rs: { label: 'RS', color: '#dea584', fg: '#1a1a1a' },
  rust: { label: 'RS', color: '#dea584', fg: '#1a1a1a' },
  go: { label: 'GO', color: '#00add8', fg: '#fff' },
  java: { label: 'JV', color: '#b07219', fg: '#fff' },
  kt: { label: 'KT', color: '#a97bff', fg: '#fff' },
  c: { label: 'C', color: '#555555', fg: '#fff' },
  cpp: { label: 'C++', color: '#f34b7d', fg: '#fff' },
  cs: { label: 'C#', color: '#178600', fg: '#fff' },
  php: { label: 'PHP', color: '#4f5d95', fg: '#fff' },
  rb: { label: 'RB', color: '#701516', fg: '#fff' },
  ruby: { label: 'RB', color: '#701516', fg: '#fff' },
  swift: { label: 'SW', color: '#fa7343', fg: '#fff' },
  sh: { label: 'SH', color: '#4eaa25', fg: '#fff' },
  bash: { label: 'SH', color: '#4eaa25', fg: '#fff' },
  zsh: { label: 'SH', color: '#4eaa25', fg: '#fff' },
  ps1: { label: 'PS', color: '#012456', fg: '#fff' },
  powershell: { label: 'PS', color: '#012456', fg: '#fff' },
  html: { label: '<>', color: '#e34c26', fg: '#fff' },
  xml: { label: '<>', color: '#e34c26', fg: '#fff' },
  css: { label: 'CSS', color: '#563d7c', fg: '#fff' },
  scss: { label: 'SC', color: '#c6538c', fg: '#fff' },
  less: { label: 'LE', color: '#1d365d', fg: '#fff' },
  json: { label: '{}', color: '#8b8b8b', fg: '#fff' },
  jsonc: { label: '{}', color: '#8b8b8b', fg: '#fff' },
  yml: { label: 'YML', color: '#cb171e', fg: '#fff' },
  yaml: { label: 'YML', color: '#cb171e', fg: '#fff' },
  toml: { label: 'TML', color: '#9c4221', fg: '#fff' },
  ini: { label: 'INI', color: '#6b7280', fg: '#fff' },
  sql: { label: 'SQL', color: '#e38c00', fg: '#fff' },
  md: { label: 'MD', color: '#083fa1', fg: '#fff' },
  markdown: { label: 'MD', color: '#083fa1', fg: '#fff' },
  dockerfile: { label: 'DK', color: '#2496ed', fg: '#fff' },
  docker: { label: 'DK', color: '#2496ed', fg: '#fff' },
  gradle: { label: 'GR', color: '#02303a', fg: '#fff' },
  lua: { label: 'LUA', color: '#000080', fg: '#fff' },
  dart: { label: 'DT', color: '#00b4ab', fg: '#fff' },
  diff: { label: '±', color: '#6b7280', fg: '#fff' },
}

/** 认不出来的语言 —— 给一个中性的默认徽章，不要什么都不显示。 */
const DEFAULT_BADGE: Badge = { label: '{}', color: '#8b8b8b', fg: '#fff' }

/**
 * 取图标 SVG：**通用图标优先，MC 图标兜底**。
 *
 * 两个表都来自构建期拉取/手绘的内联 SVG（`width/height="1em"`，跟着 font-size 走）。
 * 查不到返回 `null`，调用方降级到彩色方块徽章。
 */
export function codeIconSvg(lang: string): string | null {
  return codeIconFor(lang) ?? MC_CODE_ICONS[lang] ?? null
}

/** 围栏信息 → `{ lang, title }`。 */
export function parseFenceInfo(info: string): { lang: string; title: string } {
  const trimmed = info.trim()
  if (!trimmed) return { lang: '', title: '' }
  const [first = '', ...rest] = trimmed.split(/\s+/)
  return { lang: first.toLowerCase(), title: rest.join(' ') }
}

/** 语言 → 降级徽章。取不到就给默认。 */
export function badgeFor(lang: string): Badge {
  return BADGES[lang] ?? DEFAULT_BADGE
}

/** 只有 `lang` / `title` 是用户输入，其余是我们自己的常量。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface CodeHeaderRenderOptions {
  /**
   * 渲染折叠按钮。
   *
   * **只有编辑器要** —— 显示侧的 HTML 是死的，没人接事件，
   * 多一个点不动的按钮只会让人困惑。
   */
  interactive?: boolean
  /** 当前折叠状态 —— 决定按钮画哪个箭头。 */
  folded?: boolean
}

/**
 * 围栏信息 → **标题栏的 HTML 字符串**。
 *
 * 结构（三个渲染者共用，类名即契约）：
 *
 *     <div class="nd-code-header" contenteditable="false">
 *       <span class="nd-code-dots"><i></i><i></i><i></i></span>
 *       <span class="nd-code-file">
 *         <span class="nd-code-icon">…SVG…</span>          ← 有图标时
 *         <span class="nd-code-icon nd-code-icon-fallback" ← 没图标时降级
 *               style="--nd-code-icon-bg:…;--nd-code-icon-fg:…">TS</span>
 *         <span class="nd-code-title">ci.yml</span>
 *       </span>
 *       <span class="nd-code-lang">yaml</span>
 *       <button class="nd-code-toggle">…</button>          ← 仅 interactive
 *     </div>
 *
 * 没写语言也没写文件名时，中间的 `nd-code-file` 整段省略，标题栏只剩圆点
 * （不会出现空徽章）。
 */
export function renderCodeHeaderHtml(info: string, opts: CodeHeaderRenderOptions = {}): string {
  const { lang, title } = parseFenceInfo(info)
  const parts: string[] = [
    '<span class="nd-code-dots" aria-hidden="true"><i></i><i></i><i></i></span>',
  ]

  if (lang || title) {
    const file: string[] = []
    const svg = codeIconSvg(lang)
    if (svg) {
      // SVG 来自我们自己的构建产物，不是用户输入 —— 可以当 HTML 用。
      file.push(`<span class="nd-code-icon">${svg}</span>`)
    } else if (lang) {
      /*
       * 降级：语言没有对应图标时，用「彩色圆角方块 + 缩写」。
       * 比什么都不显示强 —— 至少能看出这是个代码文件、是什么语言。
       */
      const badge = badgeFor(lang)
      file.push(
        '<span class="nd-code-icon nd-code-icon-fallback"' +
          ` style="--nd-code-icon-bg:${escapeHtml(badge.color)};--nd-code-icon-fg:${escapeHtml(badge.fg)}">` +
          `${escapeHtml(badge.label)}</span>`,
      )
    }
    if (title) file.push(`<span class="nd-code-title">${escapeHtml(title)}</span>`)
    parts.push(`<span class="nd-code-file">${file.join('')}</span>`)
  }

  if (lang) parts.push(`<span class="nd-code-lang">${escapeHtml(lang)}</span>`)

  if (opts.interactive) {
    const folded = Boolean(opts.folded)
    parts.push(
      '<button type="button" class="nd-code-toggle"' +
        ` aria-expanded="${String(!folded)}"` +
        ` aria-label="${folded ? '展开代码块' : '折叠代码块'}"` +
        ` title="${folded ? '展开' : '折叠'}">` +
        (folded ? CHEVRON_RIGHT : CHEVRON_DOWN) +
        '</button>',
    )
  }

  return `<div class="nd-code-header" contenteditable="false">${parts.join('')}</div>`
}
