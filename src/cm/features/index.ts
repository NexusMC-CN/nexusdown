import { indexFeatures, type EditorFeature } from '../feature';
import { emojiFeature } from './emoji';
import { embedFeature } from './embed';
import { createMathFeature, mathFeature, type MathRenderer } from './math';

/**
 * 所有**编辑器侧**功能模块。
 *
 * ⚠️ 加一个新功能 = 加一行 `import` + 数组里加一项。**不要改 `plugin.ts`。**
 *
 * 数组顺序 = 注册顺序。`indexFeatures` 会拒绝「同一个节点名被两个功能认领」，
 * 所以顺序本身不影响正确性 —— 但按字母排方便查。
 *
 * ⚠️ 这里用的是 math 的**默认实例**（没有注入渲染函数）。真实装配走
 * `createEditorFeatureMap()`，它会把消费方注入的渲染函数带进去。
 */
export const EDITOR_FEATURES: readonly EditorFeature[] = [
  emojiFeature,
  mathFeature,
  embedFeature,
];

/**
 * `节点名 → 认领它的功能`。`plugin.ts` 用它分发。
 *
 * 建索引时就会检查冲突：两个功能认领同一个节点名会**直接抛错**（而不是悄悄后者覆盖前者）——
 * 这种冲突表现出来是"某个元素突然不渲染了"，很难查，所以宁可在启动时炸。
 */
export const EDITOR_FEATURE_BY_NODE = indexFeatures(EDITOR_FEATURES);

/**
 * 按选项装配功能表 —— 目前只有一件事：把消费方注入的**数学渲染函数**交给 math 功能。
 *
 * 为什么要单独一个函数、而不是让 `mathFeature` 自己去读某个全局变量：渲染函数是
 * **每个编辑器一份的装配期配置**（同渲染侧 `katexRenderer` 的定位）。做成模块级
 * 可变状态的话，同一进程里两个消费方装不同的 KaTeX 会互相串，而且测试没法并行。
 *
 * 没传渲染函数时**原样返回默认表**（`EDITOR_FEATURE_BY_NODE`）—— 块级公式退回普通
 * 代码块，行为与加这个通道之前完全一致。
 */
export function createEditorFeatureMap(
  opts: { mathRenderer?: MathRenderer } = {},
): ReadonlyMap<string, EditorFeature> {
  if (!opts.mathRenderer) return EDITOR_FEATURE_BY_NODE;
  return indexFeatures([emojiFeature, createMathFeature(opts.mathRenderer), embedFeature]);
}
