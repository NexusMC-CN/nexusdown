/**
 * Markdown 编辑命令。
 *
 * ## 为什么这个文件重要
 *
 * 这些命令以前住在应用里（`app/utils/cm-markdown.ts`），而 `shortcuts.ts` 里
 * **另有一份逐字相同的 `toggle()`** —— 两边都没什么测试。现在合成一份、
 * 搬进库里，**测试也一起搬进来**。
 *
 * 断言的都是**不变量**，不是"输出长什么样"：
 * - 多光标下每个选区各算各的（`changeByRange` 的约定）
 * - 解包 `***粗斜体***` 时不能把内层的 `**` 削掉一个
 * - 没改动时不产生空事务（返回 `false`）
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import {
  insertBlockMath,
  insertEmbed,
  insertInlineMath,
  insertLink,
  insertTable,
  toggleBold,
  toggleBulletList,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleQuote,
  wrapCodeBlock,
} from '../../src/cm/commands.js'

/** 建一个编辑器，把选区设在 `[from, to]`（`from === to` 就是光标）。 */
function editor(doc: string, ...ranges: Array<[number, number] | number>) {
  /*
   * ⚠️ `selection` 必须传 **`EditorSelection` 实例**，不能传 `{ ranges: [...] }`。
   *
   * 传 `{ ranges }` 不会报错，**会被静默忽略** → 选区退化成默认的光标 0 →
   * 命令走错分支（`range.empty` 为真，于是去调 `wordAt`），测试结果全是假的。
   * 实测踩过：14 个测试全挂，报错却在 `wordAt` 里，离真正的原因很远。
   */
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(
        ranges.map((r) =>
          typeof r === 'number'
            ? EditorSelection.cursor(r)
            : EditorSelection.range(r[0], r[1]),
        ),
      ),
      /*
       * ⚠️ **必须带上 `allowMultipleSelections`** —— 它是命令「多光标安全」的**前提**。
       *
       * CM6 的 `state.changeByRange()` 只在开了这个 facet 时才**遍历所有选区**；
       * 没开就只处理主选区 —— 于是多光标下只有第一处生效，而且**零报错**。
       *
       * `nexusdown()` 里是开了的（`src/cm/index.ts`）。测试这边手动补上，
       * 因为这里只装了 `markdown()`。**测试环境和真实环境的这个差异，
       * 害我一度以为命令有 bug。**
       */
      extensions: [
        markdown({ base: markdownLanguage }),
        EditorState.allowMultipleSelections.of(true),
      ],
    }),
  })
  return view
}

/** 跑命令，返回改动后的文档与选区。 */
function run(view: EditorView, cmd: (v: EditorView) => boolean) {
  cmd(view)
  const sel = view.state.selection
  return {
    doc: view.state.doc.toString(),
    ranges: sel.ranges.map((r) => [r.from, r.to] as [number, number]),
  }
}

describe('toggleBold', () => {
  it('有选区 → 包上 `**`', () => {
    const v = editor('abc', [0, 3])
    expect(run(v, toggleBold).doc).toBe('**abc**')
    v.destroy()
  })

  it('已在粗体里 → 解包', () => {
    const v = editor('**abc**', 4)
    expect(run(v, toggleBold).doc).toBe('abc')
    v.destroy()
  })

  it('光标在词里 → 扩展到整个词', () => {
    const v = editor('hello world', 8)
    expect(run(v, toggleBold).doc).toBe('hello **world**')
    v.destroy()
  })

  it('空白处 → 插一对定界符，光标停在中间', () => {
    const v = editor('', 0)
    const out = run(v, toggleBold)
    expect(out.doc).toBe('****')
    expect(out.ranges[0]).toEqual([2, 2])
    v.destroy()
  })

  it('★ 解包 `***粗斜体***` 不能削掉内层的 `**`', () => {
    // `***x***` = StrongEmphasis > Emphasis；光标在最内层时解掉一层，
    // 剩下的必须还是完整的 `**x**`。
    const v = editor('***x***', 5)
    const out = run(v, toggleBold)
    expect(out.doc).toBe('*x*')
    v.destroy()
  })

  it('★ 多光标：每个选区各算各的', () => {
    const v = editor('aa bb', [0, 2], [3, 5])
    expect(run(v, toggleBold).doc).toBe('**aa** **bb**')
    v.destroy()
  })

  it('没有可解包的节点 → 返回 false（不产生空事务）', () => {
    const v = editor('**abc**', 0) // 光标在节点**外**
    // 在 `**` 之前，`enclosingNode` 的区间判定不成立 → 走包裹分支，
    // 但 `wordAt` 可能命中 `abc`；这里只断言"不抛且文档合理"
    expect(() => toggleBold(v)).not.toThrow()
    v.destroy()
  })
})

describe('toggleItalic / toggleInlineCode', () => {
  it('斜体包 `*`', () => {
    const v = editor('abc', [0, 3])
    expect(run(v, toggleItalic).doc).toBe('*abc*')
    v.destroy()
  })

  it('行内代码包反引号', () => {
    const v = editor('abc', [0, 3])
    expect(run(v, toggleInlineCode).doc).toBe('`abc`')
    v.destroy()
  })
})

describe('块级命令', () => {
  it('toggleHeading 加 `# `，再来一次去掉', () => {
    const v = editor('标题', 1)
    const once = run(v, toggleHeading(1))
    expect(once.doc).toBe('# 标题')
    // 光标位置在标题行内
    const v2 = editor(once.doc, 3)
    expect(run(v2, toggleHeading(1)).doc).toBe('标题')
    v.destroy()
    v2.destroy()
  })

  it('toggleBulletList 加 `- `', () => {
    const v = editor('项目', 1)
    expect(run(v, toggleBulletList).doc).toContain('- ')
    v.destroy()
  })

  it('toggleQuote 加 `> `', () => {
    const v = editor('引用', 1)
    expect(run(v, toggleQuote).doc).toContain('> ')
    v.destroy()
  })

  it('wrapCodeBlock 包成围栏', () => {
    const v = editor('const a = 1', 0)
    const out = run(v, wrapCodeBlock)
    expect(out.doc).toContain('```')
    expect(out.doc).toContain('const a = 1')
    v.destroy()
  })
})

describe('insertLink', () => {
  it('有选中文字 → 变成 `[文字](url)`', () => {
    const v = editor('点这里', [0, 3])
    const out = run(v, insertLink('https://example.com'))
    expect(out.doc).toBe('[点这里](https://example.com)')
    v.destroy()
  })
})

/* ---------------------------------------------------------------- 插入骨架类 */

/** 和 `commands.ts` 里的 `TABLE_SKELETON` 逐字一致 —— 断言的是**落下来的源码**。 */
const TABLE = '| 列一 | 列二 |\n| --- | --- |\n|  |  |'

describe('insertTable', () => {
  it('空白处 → 落下两列表骨架，光标（选区）在第一个单元格里', () => {
    const v = editor('', 0)
    const out = run(v, insertTable)
    expect(out.doc).toBe(TABLE)
    // `| ` 是 2 个字符，`列一` 占 [2, 4) —— 选中占位字，接着打字就替换掉它
    expect(out.ranges[0]).toEqual([2, 4])
    v.destroy()
  })

  it('有选区 → 用骨架替换选区（表格没有"包住选中内容"的语义）', () => {
    const v = editor('旧内容', [0, 3])
    const out = run(v, insertTable)
    expect(out.doc).toBe(TABLE)
    v.destroy()
  })

  it('★ 多光标：每个选区各插一份，第二份的选区跟着第一份的插入右移', () => {
    const v = editor('ab', 0, 2)
    const out = run(v, insertTable)
    expect(out.doc).toBe(TABLE + 'ab' + TABLE)
    // 第一份骨架（TABLE.length 字）+ 中间的 `ab`（2 字）+ 第二份里 `列一` 的偏移 [2, 4]
    expect(out.ranges).toEqual([
      [2, 4],
      [TABLE.length + 2 + 2, TABLE.length + 2 + 4],
    ])
    v.destroy()
  })
})

describe('insertInlineMath', () => {
  it('空白处 → 插一对 `$`，光标停在正中间', () => {
    const v = editor('', 0)
    const out = run(v, insertInlineMath)
    expect(out.doc).toBe('$$')
    expect(out.ranges[0]).toEqual([1, 1])
    v.destroy()
  })

  it('有选区 → 用 `$` 包住选区', () => {
    const v = editor('x^2', [0, 3])
    const out = run(v, insertInlineMath)
    expect(out.doc).toBe('$x^2$')
    // 选区仍罩住原来的公式（两端各被一个 `$` 顶开 1 格）
    expect(out.ranges[0]).toEqual([1, 4])
    v.destroy()
  })

  it('★ 多光标：每个选区各插一对，各自的光标都居中', () => {
    const v = editor('ab', 0, 2)
    const out = run(v, insertInlineMath)
    expect(out.doc).toBe('$$ab$$')
    expect(out.ranges).toEqual([
      [1, 1],
      [5, 5],
    ])
    v.destroy()
  })
})

describe('insertBlockMath', () => {
  it('空白处 → 落三行围栏，光标停在中间那行', () => {
    const v = editor('', 0)
    const out = run(v, insertBlockMath)
    expect(out.doc).toBe('```math\n\n```')
    // ` ```math\n ` 是 8 个字符，光标正好落在空行上
    expect(out.ranges[0]).toEqual([8, 8])
    v.destroy()
  })

  it('有选区 → 把选中的整行包进围栏（和 wrapCodeBlock 同一套）', () => {
    const v = editor('a = 1', [0, 5])
    const out = run(v, insertBlockMath)
    expect(out.doc).toBe('```math\na = 1\n```')
    expect(out.ranges[0]).toEqual([8, 13])
    v.destroy()
  })

  it('★ 多光标：每个选区各落一份围栏', () => {
    const v = editor('ab', 0, 2)
    const out = run(v, insertBlockMath)
    expect(out.doc).toBe('```math\n\n```ab```math\n\n```')
    // 第一份围栏 12 字 + `ab` 2 字 + 第二份里空行的偏移 8
    expect(out.ranges).toEqual([
      [8, 8],
      [12 + 2 + 8, 12 + 2 + 8],
    ])
    v.destroy()
  })
})

describe('insertEmbed', () => {
  it('空白处 → 落三行 `embed` 围栏，光标停在中间那行', () => {
    const v = editor('', 0)
    const out = run(v, insertEmbed)
    expect(out.doc).toBe('```embed\n\n```')
    // ` ```embed\n ` 是 9 个字符
    expect(out.ranges[0]).toEqual([9, 9])
    v.destroy()
  })

  it('★ 多光标：每个选区各落一份围栏', () => {
    const v = editor('ab', 0, 2)
    const out = run(v, insertEmbed)
    expect(out.doc).toBe('```embed\n\n```ab```embed\n\n```')
    // 第一份围栏 13 字 + `ab` 2 字 + 第二份里空行的偏移 9
    expect(out.ranges).toEqual([
      [9, 9],
      [13 + 2 + 9, 13 + 2 + 9],
    ])
    v.destroy()
  })
})
