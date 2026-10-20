import { indexFeatures, type EditorFeature, type NormalizedFeatureIndex } from '../feature';
import { attrsFeature } from './attrs';
import { diagramFeature } from './diagram';
import { emojiFeature } from './emoji';
import { embedFeature } from './embed';
import { highlightFeature } from './highlight';
import { createMathFeature, mathFeature, type MathRenderer } from './math';
import { createMentionFeature, mentionFeature, type MentionResolutions } from './mention';
import { tableFeature } from './table';
import { tabsFeature } from './tabs';

/**
 * 所有**编辑器侧**功能模块。
 *
 * ⚠️ 加一个新功能 = 加一行 `import` + 数组里加一项。**不要改 `plugin.ts`。**
 *
 * 数组顺序 = 注册顺序 = **同一节点上多个功能的执行顺序**（`priority` 相同时）。
 * 一个节点可以被多个功能认领（见 `feature.ts` 的 `EditorFeature.nodes`），
 * 所以顺序不再只是"方便查" —— 按字母排仍然是好习惯，但真正决定先后的是 `priority`。
 *
 * ⚠️ 这里用的是 math 的**默认实例**（没有注入渲染函数）。真实装配走
 * `createEditorFeatureMap()`，它会把消费方注入的渲染函数带进去。
 */
export const EDITOR_FEATURES: readonly EditorFeature[] = [
  diagramFeature,
  emojiFeature,
  mathFeature,
  tableFeature,
  embedFeature,
  mentionFeature,
  highlightFeature,
  attrsFeature,
  tabsFeature,
];

/**
 * `节点名 → 认领它的功能列表`。`plugin.ts` 用它分发。
 *
 * 建索引时只拦一种冲突：**同一个功能重复认领同一节点**（装配错了，表现是同区间
 * 推两条 replace → CM6 崩）。不同功能共享节点是**允许**的 —— `math` 与 `mention`
 * 都认 `Paragraph`，各看各的文本判据（见 `feature.ts` 的 `EditorFeature.nodes`）。
 */
export const EDITOR_FEATURE_BY_NODE: NormalizedFeatureIndex = indexFeatures(EDITOR_FEATURES);

/**
 * 按选项装配功能表 —— 把消费方注入的**装配期配置**交给对应功能。
 *
 * 目前有两件事：
 * - **数学渲染函数**交给 math 功能（块级 ` ```math ` 围栏要它才能出公式）；
 * - **提及解析结果**交给 mention 功能（卡片要它才能显示标题 / 图标 / 角标 / 缩略图）。
 *
 * 为什么要单独一个函数、而不是让功能自己去读某个全局变量：这两样都是
 * **每个编辑器一份的装配期配置**（同渲染侧 `katexRenderer` / `RenderData` 的定位）。
 * 做成模块级可变状态的话，同一进程里两个消费方装不同的数据会互相串，
 * 而且测试没法并行。
 *
 * 什么都没传时**原样返回默认表**（`EDITOR_FEATURE_BY_NODE`）—— 行为与加这些
 * 通道之前完全一致（块级公式退回普通代码块、提及卡片只显示 slug）。
 */
export function createEditorFeatureMap(
  opts: { mathRenderer?: MathRenderer; mentions?: MentionResolutions } = {},
): NormalizedFeatureIndex {
  if (!opts.mathRenderer && !opts.mentions) return EDITOR_FEATURE_BY_NODE;
  return indexFeatures([
    diagramFeature,
    emojiFeature,
    opts.mathRenderer ? createMathFeature(opts.mathRenderer) : mathFeature,
    tableFeature,
    embedFeature,
    opts.mentions ? createMentionFeature(opts.mentions) : mentionFeature,
    highlightFeature,
    attrsFeature,
    tabsFeature,
  ]);
}
