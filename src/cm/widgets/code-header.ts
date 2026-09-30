/**
 * 代码块的「窗口标题栏」widget。
 *
 * 把 Markdown 的围栏行（` ```ts app.vue `）在**非揭示态**渲染成 IDE 代码窗口的标题栏：
 * 左边三个小圆点（模拟窗口按钮），中间是**文件图标 + 文件名**，右边是语言名。
 *
 *     ┌────────────────────────────────┐
 *     │ ● ● ●   [TS] app.vue      ts   │   ← 这行是 widget
 *     ├────────────────────────────────┤
 *     │ const a = 1                     │
 *     └────────────────────────────────┘
 *
 * ## 围栏信息怎么解析
 *
 * CommonMark 里开围栏的 info string 是**自由文本**，约定俗成写成 `语言 文件名`。
 * 这里按空白切成两段：第一段当语言，剩下的当文件名/标题。
 *
 *     ```ts app.vue        → lang=ts    title=app.vue
 *     ```ts src/a.ts       → lang=ts    title=src/a.ts
 *     ```js                → lang=js    title=（空）
 *     ```                  → lang=（空）title=（空）
 *     ```ts title=app.vue  → lang=ts    title=title=app.vue（不特殊处理，原样显示）
 *
 * ⚠️ **只在非揭示态用**。光标进入代码块时 `fence.ts` 会原样显示围栏行
 * （用户要能改语言标记），那时不能挂 widget。
 *
 * ⚠️ 这是 `Decoration.replace` 的**行内**替换（不是 block widget）——
 * CM6 里 `block: true` 的替换区间**方向键永远进不去**，会让围栏行彻底无法编辑。
 */
import { WidgetType, type EditorView } from '@codemirror/view'

import { toggleFold } from '../fold.js'
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
function badgeFor(lang: string): Badge {
  return BADGES[lang] ?? DEFAULT_BADGE
}

export class CodeFenceHeaderWidget extends WidgetType {
  constructor(
    private readonly info: string,
    /** 这个代码块当前折叠了吗（决定按钮画哪个箭头）。 */
    private readonly folded = false,
    /** 开围栏的文档位置 —— 折叠状态用它当 key（见 `fold.ts`）。 */
    private readonly from = -1,
  ) {
    super()
  }

  /**
   * ⚠️ 必须实现。不实现的话每次装饰重建都会 `toDOM()` 重建 DOM，
   * 标题栏会闪、徽章会重新画。
   *
   * 三个字段都要比：`folded` 变了要换箭头，`from` 变了按钮会 dispatch 到错的位置。
   */
  override eq(other: CodeFenceHeaderWidget): boolean {
    return other.info === this.info && other.folded === this.folded && other.from === this.from
  }

  override toDOM(view?: EditorView): HTMLElement {
    const { lang, title } = parseFenceInfo(this.info)

    const header = document.createElement('div')
    header.className = 'nd-code-header'
    // 标题栏不该被当正文选中/编辑 —— 它是窗口装饰。
    header.setAttribute('contenteditable', 'false')

    // ---- 左：三个小圆点（模拟窗口按钮）----
    const dots = document.createElement('span')
    dots.className = 'nd-code-dots'
    dots.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'))
    header.appendChild(dots)

    // ---- 中：文件图标 + 文件名 ----
    // 没写语言也没写文件名时整段省略，标题栏只剩圆点（不会出现空徽章）。
    if (lang || title) {
      const file = document.createElement('span')
      file.className = 'nd-code-file'

      const svg = codeIconSvg(lang)
      if (svg) {
        /*
         * 真图标：构建期内联的 SVG（vscode-icons / 手绘的 MC 图标）。
         * `width/height="1em"` 跟着 font-size 走，不用额外设尺寸。
         *
         * 用 `innerHTML` 是安全的：`svg` 来自我们自己的构建产物
         * （`code-icons.ts` / `code-icons-mc.ts`），不是用户输入。
         */
        const icon = document.createElement('span')
        icon.className = 'nd-code-icon'
        icon.innerHTML = svg
        file.appendChild(icon)
      } else if (lang) {
        /*
         * 降级：语言没有对应图标时，用「彩色圆角方块 + 缩写」。
         * 比什么都不显示强 —— 至少能看出这是个代码文件、是什么语言。
         */
        const badge = badgeFor(lang)
        const icon = document.createElement('span')
        icon.className = 'nd-code-icon nd-code-icon-fallback'
        icon.textContent = badge.label
        icon.style.setProperty('--nd-code-icon-bg', badge.color)
        icon.style.setProperty('--nd-code-icon-fg', badge.fg)
        file.appendChild(icon)
      }

      if (title) {
        const name = document.createElement('span')
        name.className = 'nd-code-title'
        name.textContent = title
        file.appendChild(name)
      }

      header.appendChild(file)
    }

    // ---- 右：语言名 ----
    if (lang) {
      const langEl = document.createElement('span')
      langEl.className = 'nd-code-lang'
      langEl.textContent = lang
      header.appendChild(langEl)
    }

    // ---- 最右：折叠按钮 ----
    if (view && this.from >= 0) {
      header.appendChild(this.buildToggle(view))
    }

    return header
  }

  /**
   * 折叠按钮。
   *
   * ⚠️ 四个动作缺一不可（和 `widgets/task.ts` 的复选框是同一套）：
   *
   * 1. `mousedown` 上 `preventDefault()` —— 阻止按钮抢焦点、阻止 CM 把光标挪走。
   *    少了它，点一下按钮会**先把光标移到这一行**（于是代码块变成揭示态、
   *    围栏原样显示出来），再切换折叠 —— 两个动作打架。
   * 2. `click` 里 `preventDefault()` + `stopPropagation()` —— 别让事件冒到编辑器。
   * 3. dispatch 一个**带 effect 的事务**，不碰文档（`toggleFold` 是纯视图状态）。
   * 4. `ignoreEvent` 放行 `mousedown`/`click`，否则事件根本到不了按钮。
   */
  private buildToggle(view: EditorView): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'nd-code-toggle'
    button.setAttribute('aria-expanded', String(!this.folded))
    button.setAttribute('aria-label', this.folded ? '展开代码块' : '折叠代码块')
    button.title = this.folded ? '展开' : '折叠'
    button.innerHTML = this.folded ? CHEVRON_RIGHT : CHEVRON_DOWN

    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      view.dispatch({ effects: toggleFold.of(this.from) })
    })

    return button
  }

  /**
   * 让 CM6 接管事件 —— 点标题栏就是普通的光标定位，
   * 落进这一行后 `fence.ts` 会把围栏原样显示出来，用户就能改语言了。
   *
   * ⚠️ 但 `mousedown` / `click` 要**放行**，否则折叠按钮收不到事件。
   */
  override ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown' && event.type !== 'click'
  }
}
