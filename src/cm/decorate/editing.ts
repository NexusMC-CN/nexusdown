/**
 * 「用户**明确**进入编辑的是哪个块级区间」—— `math` 的 ` ```math ` 围栏和 `table`
 * 的管道表**共用**这一套机制。
 *
 * ## 为什么需要它：「紧邻即揭示」在空行上是错的
 *
 * 块级 `Decoration.replace({ block: true })` 的区间**光标进不去** —— 连程序
 * `dispatch({ selection: cursor(from) })` 都会被夹到 `from - 1`。所以「点一下就能编辑」
 * 曾经靠「光标紧邻 `from - 1` / `to + 1` 就揭示」实现（门口是唯一能触达的位置）。
 *
 * 那个判据是**位置**判据，而位置分不清「路过」和「要编辑」：
 *
 * ```
 * 1: (空行)
 * 2: ```math
 * 3: E = mc²
 * 4: ```
 * 5: (空行)
 * ```
 *
 * 空行**整行只有一个光标位置**，它恰好等于 `from - 1`（第 1 行）/ `to + 1`（第 5 行）。
 * 于是光标停在那儿的**任何时刻**都是「紧邻」→ **永远揭示**，公式死活渲染不出来。
 * 一写字，那一行变长、`from` 后移、光标不再是 `from - 1` → 又渲染了 —— 和用户描述完全吻合。
 *
 * ## 改成「意图」判据
 *
 * 新增一个 `StateField` 记住「用户**点过**哪个块」（存那个块的区间）。揭示条件变成：
 *
 * 1. 选区碰到块任意一行（`selectionNearBlock` 的前半，兜底，多光标安全）；
 * 2. **或者** 这个块的 `from` 就是标记里的 `from`（用户点进来的）。
 *
 * 裸的「紧邻」被删掉了 —— 它无法区分意图。但**「紧邻」没有消失**：
 * 它变成了**标记的存活条件**（见 `update` 第 3 步）。因为块级区间进不去，
 * 用户点进来之后就是停在 `from - 1` 门口打字的 —— 标记必须认这个位置，
 * 否则一点进来就被清掉，等于没点。
 *
 * ## 和折叠（`fold.ts`）的关系
 *
 * 同一类东西：都是「文档级、跟块走、随文档变化映射位置」的 `StateField`。
 * 区别是 `foldedBlocks` 存一个集合（可以同时折叠多个），这里只存**一个**
 * （用户一次只能编辑一个块）。
 */
import { StateEffect, StateField, type EditorSelection, type Text } from '@codemirror/state'

import { selectionTouchesLineRange } from '../util/selection.js'

/** 用户明确点进去编辑的那个块级区间。两端都是**文档位置**，随文档变化一起映射。 */
export interface EditingBlock {
  from: number
  /** 排他。 */
  to: number
}

/**
 * 进入编辑 —— 点块级 widget 时 dispatch，`value` 是**这个块当时的区间**。
 *
 * 为什么把 `to` 也带上：清除标记时要判断「选区还在不在这个块上」，
 * 只有 `from` 判断不了「块有多长」。区间由**产出 widget 的功能**填
 * （它才知道自己的块到哪儿）。
 */
export const enterEditingBlock = StateEffect.define<EditingBlock>()

/**
 * 用户**明确进入编辑**的块；没人点过就是 `null`。
 *
 * ⚠️ 它**不产出任何装饰** —— 只存一个区间。块级装饰只能由 `plugin.ts` 的
 * `blockDecorations` 那个 StateField 提供（见 `feature.ts` 的 `EditorFeature.block`），
 * 两者不能合并：这个字段要能被多个功能读，而装饰字段按功能分流。
 */
export const editingBlock = StateField.define<EditingBlock | null>({
  create: () => null,

  update(value, tr) {
    // 1) 点 widget → 明确进入编辑。直接采用 effect 里的区间（这一拍还没有清除判断）。
    for (const effect of tr.effects) {
      if (effect.is(enterEditingBlock)) return effect.value
    }
    if (value === null) return null

    let next = value

    /*
     * 2) 文档变了 → 区间跟着内容平移。
     *
     * `from` 用 `assoc = 1`：用户在**门口**（`from - 1`）打字时，插入点在 `from`
     * **之前**，块要整体后移，标记才继续指着同一个块（同 `fold.ts` 的理由）。
     * `to` 用 `assoc = -1`：插在块尾之后的内容不该被算进块里。
     */
    if (tr.docChanged) {
      const from = tr.changes.mapPos(next.from, 1)
      const to = tr.changes.mapPos(next.to, -1)
      // 块被删没了（或被并进了别的块）→ 标记失效，别再指着一段不存在的区间。
      if (from >= to) return null
      next = { from, to }
    }

    /*
     * 3) 选区离开这个块 → 清除。
     *
     * ⚠️ 「还在」的定义里**必须包含紧邻的两扇门口**（`from - 1` / `to + 1`），
     * 见 `selectionNearBlock`。块级区间光标进不去，用户点进来之后就是停在门口
     * 打字的 —— 少了这一条，点进来的**那一次**就会被判成「离开」而立刻清掉。
     *
     * ⚠️ 只在**选区真的变了**时判断（`tr.selection` 为 `null` = 没变）：
     * 纯文档变化、选区没动的情况下不该顺带清除。
     */
    if (tr.selection && !selectionNearBlock(tr.state.doc, tr.state.selection, next.from, next.to)) {
      return null
    }

    return next
  },
})

/**
 * 选区是否还在这个块「身上」或它的两扇门口。
 *
 * ★ **揭示判据和标记清除判据共用这一条** —— 两处对「还在」的定义必须逐字一致，
 * 否则会出现「刚揭示就被清、清了又揭示」的抖动。
 *
 * - **碰到块任意一行**：`selectionTouchesLineRange` 是既有的多光标安全判据；
 * - **停在 `from - 1` / `to + 1`**：⚠️ 这一条**不能省**。块级区间光标进不去，
 *   门口是唯一能触达的位置；`selectionTouchesLineRange` 不会把 `from - 1` 算进来
 *   （那是**上一行**，和块行不相交）。
 *
 * 用 `range.head` 而不是 `range.from` / `range.to`：紧邻描述的是**光标**（移动端），
 * 而选区只要碰到块行就已经被前半条覆盖。
 */
export function selectionNearBlock(
  doc: Text,
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  if (selectionTouchesLineRange(doc, selection, from, to)) return true
  for (const range of selection.ranges) {
    if (range.head === from - 1 || range.head === to + 1) return true
  }
  return false
}
