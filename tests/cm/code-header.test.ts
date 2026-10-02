/**
 * 代码窗口标题栏的单元测试。
 *
 * 重点是 `parseFenceInfo` —— 围栏信息是**自由文本**（CommonMark 没有规定格式），
 * 约定俗成写成 `语言 文件名`。这个函数决定了标题栏上显示什么。
 */
import { CodeFenceHeaderWidget } from '../../src/cm/widgets/code-header.js'
import { parseFenceInfo, renderCodeHeaderHtml } from '../../src/cm/widgets/code-header-parts.js'

describe('parseFenceInfo', () => {
  it('只有语言', () => {
    expect(parseFenceInfo('js')).toEqual({ lang: 'js', title: '' })
    expect(parseFenceInfo('  yaml  ')).toEqual({ lang: 'yaml', title: '' })
  })

  it('语言 + 文件名', () => {
    expect(parseFenceInfo('ts app.vue')).toEqual({ lang: 'ts', title: 'app.vue' })
    expect(parseFenceInfo('js  index.js')).toEqual({ lang: 'js', title: 'index.js' })
  })

  it('文件名里有路径时原样保留', () => {
    expect(parseFenceInfo('ts src/utils/a.ts')).toEqual({ lang: 'ts', title: 'src/utils/a.ts' })
  })

  it('文件名里有空格时后面的都算文件名', () => {
    expect(parseFenceInfo('js my file.js')).toEqual({ lang: 'js', title: 'my file.js' })
  })

  it('语言大小写归一成小写（配色表按小写查）', () => {
    expect(parseFenceInfo('TypeScript a.ts').lang).toBe('typescript')
    expect(parseFenceInfo('YAML ci.yml').lang).toBe('yaml')
  })

  it('空信息', () => {
    expect(parseFenceInfo('')).toEqual({ lang: '', title: '' })
    expect(parseFenceInfo('   ')).toEqual({ lang: '', title: '' })
  })
})

describe('CodeFenceHeaderWidget', () => {
  const render = (info: string): HTMLElement => new CodeFenceHeaderWidget(info).toDOM()

  it('eq 只比较 info —— 不实现的话每次重建都会重建 DOM，标题栏会闪', () => {
    const a = new CodeFenceHeaderWidget('ts a.ts')
    expect(a.eq(new CodeFenceHeaderWidget('ts a.ts'))).toBe(true)
    expect(a.eq(new CodeFenceHeaderWidget('ts b.ts'))).toBe(false)
  })

  it('渲染出圆点 + 图标 + 文件名 + 语言名', () => {
    const el = render('ts app.vue')

    // 三个窗口按钮
    expect(el.querySelectorAll('.nd-code-dots i')).toHaveLength(3)
    // 文件图标：有对应语言时用**内联 SVG**（不是文字徽章）
    const icon = el.querySelector('.nd-code-icon') as HTMLElement
    expect(icon.querySelector('svg')).not.toBeNull()
    expect(icon.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 32 32')
    // 文件名
    expect(el.querySelector('.nd-code-title')?.textContent).toBe('app.vue')
    // 语言名
    expect(el.querySelector('.nd-code-lang')?.textContent).toBe('ts')
    // 标题栏本身不该被编辑
    expect(el.getAttribute('contenteditable')).toBe('false')
  })

  it('只写语言、没写文件名时，不渲染文件名', () => {
    const el = render('yaml')
    expect(el.querySelector('.nd-code-icon svg')).not.toBeNull()
    expect(el.querySelector('.nd-code-title')).toBeNull()
  })

  it('冷门语言降级成彩色方块徽章（不是什么都不显示）', () => {
    // `brainfuck` 没有图标 → 走 `BADGES` 降级路径
    const el = render('brainfuck x.bf')
    const icon = el.querySelector('.nd-code-icon') as HTMLElement
    expect(icon.querySelector('svg')).toBeNull()
    expect(icon.classList.contains('nd-code-icon-fallback')).toBe(true)
    expect(icon.textContent).toBe('{}')
  })

  it('完全空的围栏只剩圆点，不会出现空徽章', () => {
    const el = render('')
    expect(el.querySelectorAll('.nd-code-dots i')).toHaveLength(3)
    expect(el.querySelector('.nd-code-file')).toBeNull()
    expect(el.querySelector('.nd-code-lang')).toBeNull()
  })

  it('认不出的语言仍然显示文件名', () => {
    const el = render('brainfuck x.bf')
    expect(el.querySelector('.nd-code-title')?.textContent).toBe('x.bf')
  })

  it('eq 把 folded / from 也算进去（否则折叠按钮会 dispatch 到错的位置）', () => {
    const base = new CodeFenceHeaderWidget('ts a.ts', false, 10)
    expect(base.eq(new CodeFenceHeaderWidget('ts a.ts', false, 10))).toBe(true)
    expect(base.eq(new CodeFenceHeaderWidget('ts a.ts', true, 10))).toBe(false)
    expect(base.eq(new CodeFenceHeaderWidget('ts a.ts', false, 20))).toBe(false)
  })

  // ---------------------------------------------------------------- 纯函数（显示侧也用）

  describe('renderCodeHeaderHtml', () => {
    it('结构：圆点 + 文件 + 语言', () => {
      const html = renderCodeHeaderHtml('yaml ci.yml')
      expect(html).toContain('<span class="nd-code-dots" aria-hidden="true"><i></i><i></i><i></i></span>')
      expect(html).toContain('<span class="nd-code-title">ci.yml</span>')
      expect(html).toContain('<span class="nd-code-lang">yaml</span>')
      expect(html).toContain('class="nd-code-header"')
    })

    it('★ 语言和文件名是用户输入，必须转义', () => {
      const html = renderCodeHeaderHtml('ts <img src=x onerror=alert(1)>')
      expect(html).not.toContain('<img')
      expect(html).toContain('&lt;img')
      const lang = renderCodeHeaderHtml('"><script>alert(1)</script>')
      expect(lang).not.toContain('<script')
    })

    it('只有编辑器要折叠按钮', () => {
      expect(renderCodeHeaderHtml('ts a.ts')).not.toContain('nd-code-toggle')
      expect(renderCodeHeaderHtml('ts a.ts', { interactive: true })).toContain('nd-code-toggle')
    })

    it('折叠态按钮画右箭头', () => {
      const html = renderCodeHeaderHtml('ts a.ts', { interactive: true, folded: true })
      expect(html).toContain('aria-expanded="false"')
      expect(html).toContain('aria-label="展开代码块"')
    })

    it('和 widget 产出同一份结构（单一来源，不靠人工同步）', () => {
      const el = render('ts a.ts')
      const html = renderCodeHeaderHtml('ts a.ts')
      expect(html).toContain('<span class="nd-code-title">a.ts</span>')
      expect(el.querySelector('.nd-code-title')?.textContent).toBe('a.ts')
      expect(el.querySelector('.nd-code-lang')?.textContent).toBe('ts')
      expect(el.querySelectorAll('.nd-code-dots i')).toHaveLength(3)
    })
  })

})
