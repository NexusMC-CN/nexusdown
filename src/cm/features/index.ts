import { indexFeatures, type EditorFeature } from '../feature';
import { emojiFeature } from './emoji';
import { embedFeature } from './embed';
import { mathFeature } from './math';

/**
 * 所有**编辑器侧**功能模块。
 *
 * ⚠️ 加一个新功能 = 加一行 `import` + 数组里加一项。**不要改 `plugin.ts`。**
 *
 * 数组顺序 = 注册顺序。`indexFeatures` 会拒绝「同一个节点名被两个功能认领」，
 * 所以顺序本身不影响正确性 —— 但按字母排方便查。
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
