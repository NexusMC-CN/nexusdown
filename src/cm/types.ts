import type { EditorSelection, Range, Text } from '@codemirror/state';
import type { Decoration, DecorationSet } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/**
 * 装饰器看到的语法树节点：**稳定的** `SyntaxNode`。
 *
 * ⚠️ `tree.iterate` 的 `enter` 回调给的是 `SyntaxNodeRef`（TreeCursor 的只读视图），
 * 它**没有** `firstChild` / `nextSibling` —— 所以 `plugin.ts` 在分发前会取一次
 * `ref.node` 把它变成稳定的 `SyntaxNode`。这一步是必须的，不是可选优化。
 */
export type MarkdownNode = SyntaxNode;

/** 待排序的装饰区间集合（`Decoration.set(ranges, true)` 的入参）。 */
export type DecorationRanges = Range<Decoration>[];

/**
 * 一次 build 的产物。
 *
 * **核心二分**：`decorations` 含所有装饰，`atomicDecorations` **只含隐藏态的 replace**。
 * 两者必须分开 —— 把 `decorations` 直接当 atomicRanges，揭示态的标记也会被当成原子块，
 * 光标就没法一个字符一个字符走进 `**` 里。
 */
export interface DecorationBuild {
  decorations: DecorationSet;
  atomicDecorations: DecorationSet;
}

/**
 * 装饰上下文。
 *
 * 目前只有一件事：**这个代码块折叠了吗**。
 *
 * ## 为什么做成参数，而不是让装饰器自己去读 `StateField`
 *
 * 装饰器的签名里**故意没有 `state`**（只有 `doc` / `selection`）——
 * 这样绝大多数装饰器都是**纯函数**，能脱离编辑器单测（`tests/cm/` 里全是这么测的）。
 * 折叠是唯一需要**文档级状态**的场景，所以只给它开一个口子，而不是把 `state`
 * 塞进所有人的签名里。
 */
export interface DecorateContext {
  /** 这个 `FencedCode` 当前是否被折叠（内容行藏起来、只留标题栏）。 */
  folded: boolean;
}

/**
 * 单个元素的装饰器：只往两个数组里 push，不返回任何东西。
 *
 * `context` 是**可选**的 —— 只有 `fencedCode` 会用到它，其余装饰器忽略即可。
 */
export type DecorateFn = (
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
  context?: DecorateContext,
) => void;

/**
 * URL 白名单策略：返回 `null` 表示拒绝，返回字符串表示放行（**可以返回改写后的 URL**，
 * 比返回 boolean 更好用）。
 */
export type UrlPolicy = (url: string) => string | null;

/** 引用式链接（`[text][ref]`）的索引：`ref → url`。 */
export type LinkReferences = ReadonlyMap<string, string>;

/** 链接装饰器多两个参数：引用索引与 URL 策略。 */
export type LinkDecorateFn = (
  ranges: DecorationRanges,
  atomicRanges: DecorationRanges,
  node: MarkdownNode,
  doc: Text,
  selection: EditorSelection,
  references: LinkReferences | undefined,
  urlPolicy: UrlPolicy | undefined,
) => void;

/**
 * 装饰器表：`plugin.ts` 只负责「遍历 + 分发 + 装桶」，具体每个元素怎么装饰由这张表决定。
 *
 * 表由装配层（`index.ts`）注入。这样 plugin.ts 不依赖任何具体元素实现，
 * 可以用假装饰器单测骨架本身。
 */
export interface LivePreviewDecorators {
  heading: DecorateFn;
  inline: DecorateFn;
  blockquote: DecorateFn;
  listItem: DecorateFn;
  fencedCode: DecorateFn;
  block: DecorateFn;
  link: LinkDecorateFn;
}
