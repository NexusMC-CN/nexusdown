import type { EditorSelection, Text } from '@codemirror/state';

import type { DecorateContext, DecorationRanges, MarkdownNode } from './types';

/**
 * 一个**编辑器侧功能模块**。
 *
 * ## 为什么要有这个接口
 *
 * `plugin.ts` 原来把「哪些节点归哪个装饰器」写死成三张表
 * （`INLINE_NODES` / `BLOCK_NODES` / 一串具名槽位）。加一个元素就要改 `plugin.ts`
 * 和 `types.ts` 的 `LivePreviewDecorators` —— 每个新功能都去动骨架，骨架越来越胖，
 * 而且多个功能同时改同一张表必然冲突。
 *
 * 改成「**功能自己认领节点名**」之后：
 *
 * - 新功能 = 一个新文件 + 注册表里一行；
 * - `plugin.ts` 只认 `node.name`，不认任何具体元素；
 * - 功能之间互不知道对方存在（也就不可能互相破坏）。
 *
 * ## 两条必须遵守的约束
 *
 * ⚠️ **一、不要 `Decoration.replace({ block: true })`。**
 * `block: true` 的替换区间**方向键永远进不去** —— 那一行会彻底无法编辑。
 * 需要「整块替换」时看 `decorate/block.ts` 和 `decorate/fence.ts` 怎么绕的
 * （藏掉行内字符 + 给行加 class，块级视觉由 CSS 画）。
 *
 * ⚠️ **二、隐藏态的 `replace` 必须同时登记进 `atomicRanges`。**
 * 否则光标会停在隐藏区间的**中间**，表现为"按一下方向键没动"。见
 * `decorate/shared.ts` 的 `pushAtomicRange` / `pushRevealableMark`。
 */
export interface EditorFeature {
  /**
   * 唯一名字。用于报错定位，也用于 `enabled` 过滤。
   * 约定用 kebab-case：`table` / `math` / `emoji` / `embed`。
   */
  name: string;

  /**
   * 我认领的 lezer 节点名（`node.name` 的原值，大小写敏感）。
   *
   * 认领之后：`plugin.ts` 遍历到这些节点时**不再往下走**，直接把控制权交给
   * `decorate`。所以认领一个父节点就等于认领它的整棵子树。
   *
   * 想看某个语法会产出什么节点名，可以在 `tests/cm/tree.test.ts` 里加一条，
   * 它会打印整棵语法树。
   */
  nodes: readonly string[];

  /**
   * 这个功能产出的是**块级替换**（`Decoration.replace({ block: true })`）。
   *
   * ## ⚠️ 为什么需要这个标记：CM6 禁止 ViewPlugin 提供块级装饰
   *
   * 实测（`@codemirror/view` 6.43.13）—— 从 ViewPlugin 的 `decorations` 里推一个
   * `block: true` 的 replace，挂载时直接抛：
   *
   *     RangeError: Block decorations may not be specified via plugins
   *
   * 根因：CM6 用 `dynamicDecorationMap[i] = typeof d == "function"` 标记
   * 「这个装饰集是**动态**的」（ViewPlugin 的 `decorations:` 会被包成
   * `decorations.of(view => …)`，是个函数），动态装饰集**一律**禁止块级效果 ——
   * 因为块级装饰会改垂直布局，而布局必须在 state 更新时就定下来。
   *
   * 跨行 `replace` 同样被禁（`Decorations that replace line breaks may not be
   * specified via plugins`），所以「藏掉整块」这条路在 ViewPlugin 里**走不通** ✗。
   *
   * ## 于是骨架怎么处理它
   *
   * `plugin.ts` 把带这个标记的功能**分流**到 `EditorView.decorations.from(field)`
   * 背后的 StateField（facet 值不是函数 → 允许块级 ✓），ViewPlugin 那边跳过它们。
   * 功能作者什么都不用做，照常往 `ranges` 里 push 块级 replace 即可。
   *
   * ⚠️ 带这个标记的功能，`decorate` 里**别推行内 mark / 行级 line 装饰** ——
   * 那些会被一起丢进 StateField（也能用，但会失去 ViewPlugin 的可见区裁剪，
   * 大文档上白付全文遍历的钱）。
   */
  block?: boolean;

  /**
   * 认领节点的装饰逻辑。签名与 `DecorateFn` 完全一致 ——
   * **只往两个数组里 push，不返回任何东西**。
   *
   * `context` 只有需要文档级状态的场景才用（目前只有折叠）。
   */
  decorate: (
    ranges: DecorationRanges,
    atomicRanges: DecorationRanges,
    node: MarkdownNode,
    doc: Text,
    selection: EditorSelection,
    context?: DecorateContext,
  ) => void;
}

/** 按节点名建索引：`节点名 → 认领它的功能`。后注册的覆盖先注册的。 */
export function indexFeatures(
  features: readonly EditorFeature[],
): ReadonlyMap<string, EditorFeature> {
  const map = new Map<string, EditorFeature>();
  for (const feature of features) {
    for (const node of feature.nodes) {
      if (map.has(node)) {
        throw new Error(
          `[nexusdown] 节点 ${node} 被多个功能认领：` +
            `${map.get(node)!.name} 与 ${feature.name}`,
        );
      }
      map.set(node, feature);
    }
  }
  return map;
}
