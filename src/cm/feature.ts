import type { EditorSelection, Text } from '@codemirror/state';

import type { DecorateContext, DecorationRanges, MarkdownNode, SourceRange } from './types';

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
   *
   * ## ★ 一个节点可以被**多个**功能认领（本次改动）
   *
   * 以前这里是一条硬约束：`indexFeatures` 发现两个功能认领同一节点名就**启动即抛**。
   * 那条规则本意是好的（悄悄覆盖的表现是「某个元素突然不渲染」，极难查），但它把
   * 一个**正常需求**也堵死了：两个语法落在**同一个 lezer 节点**上。
   *
   * 实测的两个例子：
   *
   * - `$$…$$` 块级数学（`features/math.ts`）—— lezer 把它整个解析成**一个 `Paragraph`**；
   * - `@slug` 提及（`features/mention.ts`）—— 也认 `Paragraph`。
   *
   * 两者**互不相干**（一个看行首是不是 `$$`，一个找 `@`），天然可以共存。
   * 所以注册表改成 `节点名 → 功能列表`，各功能按**自己的文本判据 no-op**。
   *
   * ⚠️ 但「同一个功能**重复**认领同一节点」仍然会抛 —— 那一定是装配错了
   * （同一个功能注册两遍），表现是**同一条 replace 推两次**、CM6 直接崩。
   */
  nodes: readonly string[];

  /**
   * 同一节点上多个功能的**执行顺序**。数值**大的先跑**，默认 `0`；
   * 同优先级按**注册顺序**（`EDITOR_FEATURES` 数组里的先后），也就是稳定的。
   *
   * ## 为什么需要它
   *
   * 多个功能认领同一节点之后，「谁先推装饰」变成可观察的行为：后推的 `replace`
   * 会盖住先推的区间，而 `Decoration.set(ranges, true)` 的自动排序**不解决**
   * 「同区间谁赢」—— 那是插入顺序决定的。不把它定死，就是「加一个功能、
   * 另一个功能的行为悄悄变了」。
   *
   * ## 为什么是「大的先跑」而不是「小的先跑」
   *
   * `priority` 读作「优先级」：**更重要的先跑**。写成「小的先跑」的话，
   * 想插到最前面得给一个负数，读代码的人会先怀疑自己看错了符号。
   */
  priority?: number;

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
    /*
     * 用户**点开**了哪个块级装饰（`editingBlock` 的值 ✓）—— 只有块级功能用得到 ✓。
     *
     * 为什么单独一个参数而不是塞进 `DecorateContext`：`context` 是**视图层**构造的
     * （带 `folded` 等 ✓），而这个是**状态层**的 ✓；混在一起会让"谁负责填它"变得含糊 ✓。
     */
    blockEditing?: number | null,
    /**
     * 正在「看源码」的区间（见 `types.ts` 的 `SourceRange`）。
     *
     * 块级功能如果**包含**这段区间，应该跳过自己 —— 典型是 `tabs`（它认领
     * `Document`，中心跳过的判据管不到它）。
     */
    editingRange?: SourceRange | null,
  ) => void;
}

/**
 * 注册表的**输入**形态：`节点名 → 一个功能` 或 `节点名 → 功能列表`。
 *
 * 为什么允许「单个功能」这种形态：`nexusdownLivePreview({ features })` 是**公开**
 * 选项，消费方和本仓库的单测都是手写 `new Map([['Document', mathFeature]])` 这种表。
 * 改注册表只应该让**多认领**成为可能，不该顺手把所有现有调用方改成数组 ——
 * 那是一次没有收益的破坏性变更。`plugin.ts` 在入口处统一归一化（`toFeatureList`）。
 */
export type FeatureIndex = ReadonlyMap<string, EditorFeature | readonly EditorFeature[]>;

/** 归一化之后的形态：**一定是数组**。`plugin.ts` 内部只认这个。 */
export type NormalizedFeatureIndex = ReadonlyMap<string, readonly EditorFeature[]>;

/** 把 `FeatureIndex` 的两种取值形态统一成数组。 */
export function toFeatureList(value: EditorFeature | readonly EditorFeature[]): readonly EditorFeature[] {
  return Array.isArray(value) ? value : [value as EditorFeature];
}

/** 把（可能是宽松形态的）功能表归一化成「节点名 → 功能列表」。 */
export function normalizeFeatures(features: FeatureIndex): NormalizedFeatureIndex {
  const out = new Map<string, readonly EditorFeature[]>();
  for (const [node, value] of features) out.set(node, toFeatureList(value));
  return out;
}

/**
 * 按节点名建索引：`节点名 → 认领它的功能列表`。
 *
 * ## 列表顺序 = 执行顺序（稳定）
 *
 * 先按 `priority` 降序（大的先跑），**同优先级按注册顺序** ——
 * `Array.prototype.sort` 自 ES2019 起是**稳定排序**，所以这里不需要自己记下标。
 *
 * ## 两种冲突，两种处理
 *
 * | 情况 | 处理 | 理由 |
 * | --- | --- | --- |
 * | 两个**不同**功能认领同一节点 | **允许**，进同一个列表 | `math` 与 `mention` 都要 `Paragraph`，各看各的文本前缀 |
 * | 同一个功能**重复**认领同一节点 | **抛错** | 装配错了，表现是同区间推两条 replace → CM6 崩 |
 *
 * ⚠️ 第一种以前也是抛错的。见 `EditorFeature.nodes` 的注释：那条规则把
 * 「两个语法落在同一个 lezer 节点上」这个**正常需求**也堵死了。
 */
export function indexFeatures(features: readonly EditorFeature[]): NormalizedFeatureIndex {
  const map = new Map<string, EditorFeature[]>();
  for (const feature of features) {
    for (const node of feature.nodes) {
      const list = map.get(node);
      if (!list) {
        map.set(node, [feature]);
        continue;
      }
      /*
       * 同一个功能重复认领同一节点 = 装配错误（不是「两个功能共享节点」）。
       *
       * ⚠️ 按 **`name`** 判而不是按对象标识：`name` 是约定好的唯一名字，
       * 而装配错误最常见的样子恰恰是**造了两个不同对象**——
       * 比如 `createEditorFeatureMap()` 里把 `createMathFeature()` 写了两遍。
       * 只比对象标识的话那种错误查不出来，症状是「同一条 replace 推两次」。
       */
      if (list.some((claimed) => claimed.name === feature.name)) {
        throw new Error(`[nexusdown] 功能 ${feature.name} 重复认领了节点 ${node}`);
      }
      list.push(feature);
    }
  }

  for (const list of map.values()) {
    // 稳定排序：同 priority 保持注册顺序。
    list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }
  return map;
}
