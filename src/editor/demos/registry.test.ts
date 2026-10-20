/**
 * 注册表的**验收测试** —— 三件事，缺一件这次重做就没有意义：
 *
 * 1. **每条方言语法至少一条演示**，包括图表语法。
 *    语法清单从 `playground/src/fixtures.ts` 的 `DIALECT_SYNTAXES` 读 ——
 *    **只 import 数据，不 import 任何 Vue 组件**（那是画廊的事）。
 * 2. **演示的元数据是统一的时间语言**：时长 ~1800ms、拍点就是那五个。
 *    这条守的是"删掉散落的 `2.8s`"——时长只有 `DemoSpec.duration` 一个来源。
 * 3. **`demos.css` 里没有任何 keyframes 动 layout 属性**（P0 的四条重做）。
 *    这条是**静态扫描**：它比 Motion Lab 的运行时审计更早失败、失败得更清楚
 *    （`frame 47 文字右移 1px` 那种结论要人去看，而"keyframes 里出现
 *    `font-size`"是一眼就能指出来的一行）。
 *
 * ⚠️ 为什么不用运行时审计来锁这条：运行时审计只在**人打开 Lab 时**跑，
 * 而 CI 里没有人打开 Lab。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIALECT_SYNTAXES } from '../../../playground/src/fixtures'
import {
  ACTION_SYNTAX,
  classifyProp,
  DEMO_BEATS,
  DEMO_DURATION,
  DEMO_IDS,
  DEMOS,
  getDemo,
  type DemoSpec,
} from './demos'

/**
 * 这条 CSS 就是"演示的 DOM/CSS 只有一份"里的那一份。
 *
 * ⚠️ 用 `process.cwd()` 拼路径而不是 `new URL('./demos.css', import.meta.url)`：
 * 测试跑在 **jsdom** 环境里，`import.meta.url` 的 scheme 是 `http:` 而不是 `file:`，
 * `fileURLToPath` 会直接抛 "The URL must be of scheme file"。
 * （`npm test` 的工作目录就是仓库根，和 `vitest.config.ts` 同级。）
 */
const CSS = readFileSync(resolve(process.cwd(), 'src/editor/demos/demos.css'), 'utf8')

/**
 * 把 CSS 里所有 `@keyframes` 的**声明属性名**拆出来。
 *
 * 手写一个括号配对的扫描器而不是正则 `@keyframes[^}]*}`：keyframes 里**嵌套**
 * 花括号（每一拍），正则会在第一个 `}` 就收尾，扫到的属性只剩第一拍 ——
 * 那种"扫了但没扫全"的测试比没有更糟（它让人以为守住了）。
 */
function keyframeDeclarations(css: string): Array<{ name: string; props: string[] }> {
  const found: Array<{ name: string; props: string[] }> = []
  const header = /@keyframes\s+([\w-]+)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = header.exec(css))) {
    const start = header.lastIndex
    let depth = 1
    let i = start
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    const body = css.slice(start, i - 1)
    /* 只认"属性名:"，值的括号/逗号都不含冒号，所以这一条不会误伤 cubic-bezier。 */
    const props = [...body.matchAll(/([a-zA-Z-]+)\s*:/g)].map((m) => m[1]!)
    found.push({ name: match[1]!, props: [...new Set(props)] })
  }
  return found
}

/** 每条演示的根元素类名（`h()` 造出来的 vnode，取 `props.class`）。 */
function rootClass(demo: DemoSpec): string {
  const vnode = demo.render() as { props?: { class?: unknown } } | null
  expect(vnode, `${demo.id}: render() 没返回 vnode`).toBeTruthy()
  return String(vnode?.props?.class ?? '')
}

describe('演示注册表', () => {
  it('20 条方言语法每条至少一条演示', () => {
    /*
     * 语法总数是显式的验收约束。方言增加新语法时这条会红 ——
     * **那正是它该做的事**：新语法没有演示，就等于"工具栏不会教它"。
     * 补一条 `DemoSpec` 之后把这里改成新总数。
     */
    expect(DIALECT_SYNTAXES.length).toBe(20)

    const covered = new Set(DEMOS.map((demo) => demo.syntax))
    const missing = DIALECT_SYNTAXES.filter((syntax) => !covered.has(syntax.id)).map((s) => s.id)

    expect(missing, `这些语法没有演示：${missing.join(', ')}`).toEqual([])
  })

  it('每条演示的 syntax 都是已知语法（或工具栏动作）', () => {
    const known = new Set<string>([...DIALECT_SYNTAXES.map((syntax) => syntax.id), ACTION_SYNTAX])
    const unknown = DEMOS.filter((demo) => !known.has(demo.syntax)).map((demo) => `${demo.id} → ${demo.syntax}`)

    expect(unknown, `syntax 写错了？${unknown.join(', ')}`).toEqual([])
  })

  it('`DEMO_IDS` 和 `DEMOS` 一一对应（两张表不许漂）', () => {
    expect(DEMOS.map((demo) => demo.id)).toEqual([...DEMO_IDS])
    expect(new Set(DEMO_IDS).size).toBe(DEMO_IDS.length)
    /* 每个 id 都能按 id 取到 —— 工具栏的 `demo` 字段走的就是这条路。 */
    for (const id of DEMO_IDS) expect(getDemo(id)?.id, id).toBe(id)
    expect(getDemo('不存在的演示')).toBeUndefined()
  })

  it('统一时间语言：时长 ~1800ms、拍点 [0,22,44,66,100]', () => {
    for (const demo of DEMOS) {
      expect(demo.duration, `${demo.id} 的时长`).toBe(DEMO_DURATION)
      expect(demo.beats, `${demo.id} 的拍点`).toEqual([...DEMO_BEATS])
      /* 1.8s 是"教学演示"的量级：再长观众等不起，再短看不清第 3 拍。 */
      expect(demo.duration).toBeGreaterThanOrEqual(2000)
      expect(demo.duration).toBeLessThanOrEqual(3000)
    }
  })

  it('每条演示都画得出来，而且根元素带 `demo-` 类名、互不重复', () => {
    const roots = DEMOS.map((demo) => {
      const cls = rootClass(demo)
      expect(cls, `${demo.id} 的根元素类名`).toMatch(/^demo-/)
      return cls
    })

    /* 根类名重复 = 复制粘贴时忘了改，两段演示会共用同一份样式。 */
    expect(new Set(roots).size).toBe(roots.length)
  })
})

describe('demos.css 的静态审计', () => {
  const keyframes = keyframeDeclarations(CSS)

  it('确实扫到了 keyframes（扫描器自己先别坏）', () => {
    expect(keyframes.length).toBeGreaterThan(30)
    /* 抽查一条：`demo-syntax` 的每一拍都要被扫到，不能只扫到第一拍。 */
    const syntax = keyframes.find((frame) => frame.name === 'demo-syntax')
    expect(syntax?.props).toEqual(['opacity'])
  })

  it('没有 keyframes 动 layout 属性（除非 DemoSpec 显式声明过）', () => {
    const declared = new Set(DEMOS.flatMap((demo) => demo.layoutProps ?? []))
    const violations: string[] = []

    for (const frame of keyframes) {
      for (const prop of frame.props) {
        if (classifyProp(prop) !== 'layout') continue
        if (declared.has(prop)) continue
        violations.push(`@keyframes ${frame.name} → ${prop}`)
      }
    }

    expect(
      violations,
      `这些 keyframes 在动 layout 属性（会让整块重新排版、逐帧看就是抖）：\n${violations.join('\n')}`,
    ).toEqual([])
  })

  it('动画时长只有一个来源：`var(--demo-dur)`，没有散落的秒数', () => {
    /*
     * 允许出现的字面量时长：`0s`（visibility 那类延迟）和 `1800ms`（`--demo-dur` 的
     * 默认值）。别的毫秒数都要走令牌或 `--demo-dur`。
     */
    const literals = [...CSS.matchAll(/animation-duration:\s*([^;]+);/g)]
      .map((m) => m[1]!.trim())
      .filter((value) => !value.startsWith('var(--demo-dur'))

    expect(literals, `animation-duration 只许写 var(--demo-dur)：${literals.join(', ')}`).toEqual([])
    /* 反面证据：`2.8s` 那个老字面量必须已经绝迹。 */
    expect(CSS).not.toContain('2.8s')
  })
})
