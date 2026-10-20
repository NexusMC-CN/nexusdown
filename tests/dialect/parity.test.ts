/**
 * **parity 测试** —— 同一份 Markdown，两侧各投影一次，按契约表对拍。
 *
 * ## 它到底断言什么
 *
 * 1. **各自的投影都成立**：渲染侧真的产出了声明的标签 / 类名，编辑器侧真的产出了
 *    声明的类名。防的是「fixture 写错」和「功能忘了注册」（那类错误单测抓不到，
 *    见 `tests/smoke-extensions.test.ts` 文件头）。
 * 2. **契约类名的状态**：
 *    - `contracted` → 两侧**都**有这些类名；
 *    - `pending` → 缺口**还在**（棘轮，见 `fixtures.ts` 文件头）。
 * 3. **原子节点共用投影器**：表格的 widget 内层 HTML、块级公式的渲染结果，
 *    逐字等于渲染侧对同一份源码的输出 —— 这是「一份 spec、两个投影器」里
 *    原子那一半的真正证据（共用的是**同一段 HTML**，不是同一个 DOM 结构）。
 *
 * ## 怎么读失败信息
 *
 * - 「渲染侧缺少 .nd-h1」→ 契约已经写了、渲染侧还没实现（`status` 还是 pending 时
 *   不该出现这条，说明 fixture 的 `render.classes` 写错了）；
 * - 「两侧已经对齐，把 status 改成 contracted」→ **好事**：phase 2 改完了，
 *   把这一行翻成 `contracted` 并把两侧的 `classes` 补齐即可；
 * - 「表格 widget 没画出来」→ 光标停在了揭示态（fixture 的 `TAIL` 没了？）。
 */
import { EditorState } from '@codemirror/state'
import { EditorView, type Decoration, type WidgetType } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { nexusdown } from '../../src/cm/index.js'
import { katexRenderer, renderMarkdown } from '../../src/render/index.js'
import { CONTRACT_BLOCKS, FAKE_KATEX, PARITY_CASES, type ParityCase } from './fixtures.js'

/** 一侧投影出来的「标签 + 类名」集合。 */
interface Projection {
  tags: Set<string>
  classes: Set<string>
}

const views: EditorView[] = []

afterEach(() => {
  // 编辑器视图是**手动挂载**的（parity 要读 DecorationSet，不能只建 state）——
  // 不 destroy 会留下 DOM 和 measure 循环，污染后面的用例。
  for (const view of views.splice(0)) view.destroy()
  document.body.innerHTML = ''
})

/**
 * 挂一个**真编辑器**。
 *
 * ⚠️ 为什么不能只建 `EditorState`：块级功能（表格 / 块级公式）的装饰由
 * `StateField` 经 `EditorView.decorations.from(field)` 提供，而**行内**功能在
 * `ViewPlugin` 里 —— 后者必须挂上视图才存在（见 `plugin.ts` 的两条通道）。
 */
function mount(c: ParityCase): EditorView {
  const state = EditorState.create({
    doc: c.markdown,
    /*
     * 光标落在「尾段」末尾 —— 所有块都处于**非揭示态**。
     * ⚠️ 默认选区是 0，不显式给的话**第一个块**是揭示态（见 fixtures.ts 的 TAIL）。
     */
    selection: { anchor: c.markdown.length },
    extensions: [
      nexusdown({
        // 同一份数据喂两侧（库不查库）—— 和渲染侧的 `RenderData` 是同一个形状。
        mentions: c.data?.mentions,
        mathRenderer: c.data?.math,
      }),
    ],
  })

  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({ state, parent })
  views.push(view)
  return view
}

/** 把一棵 DOM（或它的后代）里的标签名 / 类名收进 `into`。 */
function collect(root: ParentNode, into: Projection): Projection {
  const walk = (el: Element): void => {
    into.tags.add(el.tagName.toLowerCase())
    for (const cls of Array.from(el.classList)) into.classes.add(cls)
    for (const child of Array.from(el.children)) walk(child)
  }
  if (root instanceof Element) walk(root)
  else root.querySelectorAll('*').forEach(walk)
  return into
}

const emptyProjection = (): Projection => ({ tags: new Set(), classes: new Set() })

/** 渲染侧投影：`renderMarkdown()` → jsdom 解析 → 标签 / 类名。 */
function renderProjection(c: ParityCase): Projection {
  const plugins = c.data?.math ? [katexRenderer(c.data.math)] : undefined
  const html = renderMarkdown(c.markdown, {
    data: c.data?.mentions ? { mentions: c.data.mentions } : undefined,
    plugins,
  })

  const holder = document.createElement('div')
  holder.innerHTML = html
  return collect(holder, emptyProjection())
}

/**
 * 编辑器侧投影：遍历 `EditorView.decorations` 里的**每一个** `DecorationSet`。
 *
 * ⚠️ 必须遍历 facet，不能只读 `view.plugin(...).decorations`：块级功能走的是
 * StateField（`plugin.ts` 的 `blockDecorations`），从插件实例上读不到。
 * facet 的取值两种形态都有 —— `DecorationSet`（StateField）和
 * `(view) => DecorationSet`（ViewPlugin），这里统一求值。
 */
function editorProjection(view: EditorView): Projection {
  const out = emptyProjection()
  const docLength = view.state.doc.length

  for (const provider of view.state.facet(EditorView.decorations)) {
    const set = typeof provider === 'function' ? provider(view) : provider

    set.between(0, docLength, (_from, _to, value) => {
      const spec = (value as Decoration).spec as {
        class?: string
        tagName?: string
        widget?: WidgetType
      }

      // `Decoration.mark` / `Decoration.line` 可以带 tagName（本仓库没用到，留个兜底）
      if (spec.tagName) out.tags.add(spec.tagName.toLowerCase())
      // 类名可能是空格分隔的多个（`nd-code-block nd-code-block-first`）
      if (spec.class) {
        for (const cls of spec.class.split(/\s+/)) if (cls) out.classes.add(cls)
      }

      if (spec.widget) {
        /*
         * ★ widget 的类名在 `toDOM()` 里 —— 不调它就看不到 `.nd-table` /
         * `.nd-code-header` / `.nd-mention-card` 这些（它们不在 decoration 的
         * spec 上，而是 widget 自己搭的 DOM）。
         *
         * ⚠️ 包 `try`：widget 的 `toDOM` 在 jsdom 里可能因为拿不到真实布局而抛
         * （本仓库目前没有这种 widget，但别让一个 widget 把整条 parity 拖红）。
         * 抛了就按「这个 widget 没有可断言的 DOM」处理，并在下面由「渲染侧 /
         * 编辑器侧缺少类名」的断言把问题暴露出来 —— 不会静默通过。
         */
        try {
          const dom = spec.widget.toDOM(view)
          if (dom) collect(dom, out)
        } catch {
          /* 见上：交给类名断言去暴露 */
        }
      }
    })
  }

  return out
}

/** 把期望值也过一遍 jsdom 的解析 / 序列化，避免和浏览器归一化（`<tbody>` 之类）打架。 */
function normalized(markdownSource: string, plugins?: ReturnType<typeof katexRenderer>[]): string {
  const holder = document.createElement('div')
  holder.innerHTML = renderMarkdown(markdownSource, { plugins })
  return holder.innerHTML
}

function caseOf(id: string): ParityCase {
  const found = PARITY_CASES.find((c) => c.id === id)
  if (!found) throw new Error(`没有这条 fixture：${id}`)
  return found
}

describe('parity —— 契约表的覆盖率', () => {
  it('契约表里的每一个块都有 fixture', () => {
    const covered = new Set(PARITY_CASES.map((c) => c.block))
    const missing = CONTRACT_BLOCKS.filter((block) => !covered.has(block))
    expect(missing, `这些块没有 fixture：${missing.join('、')}`).toEqual([])
  })

  it('每条 fixture 的 block 都是契约表里的名字', () => {
    for (const c of PARITY_CASES) {
      expect(CONTRACT_BLOCKS as readonly string[]).toContain(c.block)
    }
  })

  it('pending 的用例必须带契约类名（否则棘轮永远不响）', () => {
    for (const c of PARITY_CASES.filter((c) => c.status === 'pending')) {
      expect(c.contract.length, `${c.id} 标了 pending 却没有契约类名`).toBeGreaterThan(0)
    }
  })

  it('contracted 的原子用例必须靠「同一段 HTML」对拍，而不是空跑', () => {
    /*
     * 原子节点的 `contract` 允许是空数组（类名不同、HTML 相同）——
     * 但那样它就必须被下面「原子节点」那两条之一覆盖，否则就是一条什么都不测的
     * 空 fixture。这里把「哪些原子用例没有类名契约」列出来，和那边对账。
     */
    const classless = PARITY_CASES.filter(
      (c) => c.axis === 'atomic' && c.status === 'contracted' && c.contract.length === 0,
    ).map((c) => c.id)

    // 目前只有这两条：表格（widget 内层 HTML === renderMarkdown）与图片（共享 `img` 标签）。
    expect(classless.sort()).toEqual(['image', 'table'])
  })
})

describe('parity —— 逐条对拍', () => {
  for (const c of PARITY_CASES) {
    it(`${c.block} · ${c.id}（${c.status}）`, () => {
      const render = renderProjection(c)
      const editor = editorProjection(mount(c))

      // ① 两侧各自的投影都真的产出了东西（fixture 不是空跑）
      for (const tag of c.render.tags) {
        expect(render.tags, `渲染侧缺少 <${tag}>`).toContain(tag)
      }
      for (const cls of c.render.classes) {
        expect(render.classes, `渲染侧缺少 .${cls}`).toContain(cls)
      }
      for (const tag of c.editor.tags) {
        expect(editor.tags, `编辑器侧缺少 <${tag}>`).toContain(tag)
      }
      for (const cls of c.editor.classes) {
        expect(editor.classes, `编辑器侧缺少 .${cls}`).toContain(cls)
      }

      // ② 契约类名：contracted = 两侧都有；pending = 缺口还在
      const onRender = c.contract.filter((cls) => render.classes.has(cls))
      const onEditor = c.contract.filter((cls) => editor.classes.has(cls))

      if (c.status === 'contracted') {
        expect(onRender, `契约类名在渲染侧没齐：${c.note}`).toEqual([...c.contract])
        expect(onEditor, `契约类名在编辑器侧没齐：${c.note}`).toEqual([...c.contract])
        return
      }

      const aligned = onRender.length === c.contract.length && onEditor.length === c.contract.length
      expect(
        aligned,
        `${c.id} 的两侧已经对齐 —— 把 status 改成 contracted 并补齐两侧 classes（${c.note}）`,
      ).toBe(false)
    })
  }
})

describe('原子节点：共用 HTML 投影器（不是共用 DOM）', () => {
  it('表格：编辑器 widget 的内层 HTML 逐字等于 renderMarkdown()', () => {
    /*
     * ★ 这是「原子节点共用投影器」最硬的证据：`TableWidget.toDOM()` 里
     * `wrap.innerHTML = renderMarkdown(this.source)` —— 编辑器**不自己拼表格**。
     * 所以「编辑器里看到的表格」和「发布出去的表格」是同一段字符串。
     */
    const c = caseOf('table')
    const view = mount(c)
    const wrap = view.dom.querySelector('.nd-table')

    expect(wrap, '表格 widget 没画出来（光标是不是落在揭示态了？）').not.toBeNull()
    expect(wrap!.innerHTML).toBe(normalized('| a | b |\n| - | - |\n| c | d |'))
  })

  it('块级公式：两侧吃的是同一个渲染函数', () => {
    /*
     * 块级公式的外壳是两侧各自搭的（一个 `<div class="nd-math nd-math-block">`），
     * 但**内容**必须来自同一个注入的渲染函数 —— 否则「编辑器里是 KaTeX、
     * 发出来是另一个公式」这种漂移无从发现。
     */
    const view = mount(caseOf('math-block'))
    const wrap = view.dom.querySelector('.nd-math.nd-math-block')

    expect(wrap, '块级公式 widget 没画出来（没注入 mathRenderer？）').not.toBeNull()

    const holder = document.createElement('div')
    holder.innerHTML = renderMarkdown('```math\nx^2\n```', { plugins: [katexRenderer(FAKE_KATEX)] })
    const rendered = holder.firstElementChild

    expect(rendered, '渲染侧没有产出 .nd-math 外壳').not.toBeNull()
    expect(wrap!.innerHTML).toBe(rendered!.innerHTML)
  })
})
