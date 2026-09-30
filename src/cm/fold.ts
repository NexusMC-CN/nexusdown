/**
 * 代码块的折叠状态。
 *
 * 用户点标题栏上的折叠按钮 → 内容行被藏起来，只剩标题栏。
 *
 * ## 为什么用 `StateField` 而不是挂在 widget 上
 *
 * 折叠状态是**文档级的**，不是视图级的：它要
 * - 在 `fence.ts` 重建装饰时被读到（决定要不要藏内容行）；
 * - 在 widget 重建后依然保持（widget 每次重建都是新对象）；
 * - 参与 CM6 的事务系统（这样 `dispatch` 折叠时能被历史/插件观察到）。
 *
 * 挂在 widget 实例上活不过一次重建。
 *
 * ## 为什么用 `node.from` 当 key
 *
 * `from` 是代码块**开围栏**的文档位置，在一个稳定文档里唯一。
 * 文档一变位置就会漂，所以 `update` 里用 `tr.changes.mapPos` 把它映射过去 ——
 * 不映射的话，用户在折叠块**上面**插一行，折叠状态就会"跑到别的块上"。
 */
import { StateEffect, StateField } from '@codemirror/state'

/** 切换某个代码块（用它的开围栏位置标识）的折叠状态。 */
export const toggleFold = StateEffect.define<number>()

/** 已折叠的代码块集合（存开围栏的文档位置）。 */
export const foldedBlocks = StateField.define<Set<number>>({
  create: () => new Set(),

  update(value, tr) {
    let next = value

    for (const effect of tr.effects) {
      if (!effect.is(toggleFold)) continue
      if (next === value) next = new Set(value)
      const key = effect.value
      if (next.has(key)) next.delete(key)
      else next.add(key)
    }

    // 文档变了：把所有 key 映射到新位置。
    // 不映射的话，在折叠块上面插一行，折叠状态就会落到别的块上。
    if (tr.docChanged && next.size) {
      const mapped = new Set<number>()
      for (const key of next) {
        /*
         * ⚠️ `assoc` 必须用 **`1`（偏向右侧）**，不能用 `-1`。
         *
         * key 是「开围栏的起点」。用户在**块上面**插一行时，插入点正好**等于**
         * key —— 这时 `assoc = -1` 会让 key **原地不动**，于是折叠状态留在了
         * 原来的位置，跑到别的块（或者空白处）上。
         * `assoc = 1` 让 key 跟着内容一起后移，折叠状态才跟着块走。
         *
         * 代价：在**块内部**第一行插入时 key 也会后移（严格说是块内插入了内容），
         * 那种情况极少见，而且用户能看到折叠状态"跳了一下"，比静默跑到别处强。
         */
        mapped.add(tr.changes.mapPos(key, 1))
      }
      next = mapped
    }

    return next
  },
})

/** 这个位置（开围栏的文档位置）折叠了吗。 */
export function isFolded(state: { field: (f: typeof foldedBlocks, required?: boolean) => Set<number> | undefined }, from: number): boolean {
  return state.field(foldedBlocks, false)?.has(from) ?? false
}
