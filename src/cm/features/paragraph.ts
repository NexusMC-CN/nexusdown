/**
 * `paragraph` —— **独占一段**的两种特殊段落（契约：`docs/dialect-extensions.md` 第 5、6 节）。
 *
 * | 段落内容 | 是什么 | 显示侧产出 |
 * | --- | --- | --- |
 * | 整段只有一条链接 | SEO 卡片 | `.nd-card` |
 * | 整段只有 2 张以上图片 | 媒体轮播 | `.nd-carousel` |
 *
 * ## ⚠️ 为什么 carousel 和 link-card 合成**一个** feature
 *
 * `indexFeatures`（`feature.ts`）**拒绝两个功能认领同一个节点名**（冲突直接抛错，
 * 因为"某个元素突然不渲染了"极难查）。两者都要看 `Paragraph` 的内容才能决定，
 * 所以只能有一个认领者，在内部再分派。
 *
 * ## 编辑器侧**只给提示，不画真组件**
 *
 * - **卡片**：元数据在服务端（库不抓取，见 `render/features/link-card.ts`），
 *   编辑器**根本拿不到**标题/描述/缩略图 —— 所以画不出真卡片。这里只加一个行级
 *   class，用 CSS 提示"这段会被渲染成卡片"。
 * - **轮播**：真轮播要跨行 widget，而项目**明令禁止** `block: true` 的 replace
 *   （方向键会永远进不去，见 `decorate/block.ts`）。每张图仍由 `ImageWidget`
 *   自己渲染，这里只给首行加提示。
 *
 * 也就是说：**编辑器是"所见即所得"的近似，显示侧才是权威**。这条取舍是结构决定的，
 * 不是没做完 —— 想两端完全一致，得先推翻「不做 block widget」那条约束。
 */
import type { Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';

import type { EditorFeature } from '../feature';
import type { DecorationRanges, MarkdownNode } from '../types';

/** 行级 class。用 `Decoration.line` 挂到 `.cm-line` 上，具体样式在 `paragraph.css`。 */
const CARD_LINE = Decoration.line({ class: 'nd-para-card' });
const CAROUSEL_LINE = Decoration.line({ class: 'nd-para-carousel' });

export const paragraphFeature: EditorFeature = {
  name: 'paragraph',
  nodes: ['Paragraph'],
  decorate(ranges, _atomicRanges, node, doc) {
    decorateParagraph(ranges, node, doc);
  },
};

function decorateParagraph(ranges: DecorationRanges, node: MarkdownNode, doc: Text): void {
  const text = doc.sliceString(node.from, node.to).trim();
  if (!text) return;

  // 段落可能跨多行（软换行），class 挂在**首行**上。
  const lineFrom = doc.lineAt(node.from).from;

  if (isLoneLink(text)) {
    ranges.push(CARD_LINE.range(lineFrom));
    return;
  }

  if (isImageOnly(text) && countImages(text) >= 2) {
    ranges.push(CAROUSEL_LINE.range(lineFrom));
  }
}

/**
 * 整段是不是**只有一条链接**？
 *
 * 两种写法都认（和显示侧的 `loneLink` 对齐）：裸 URL、`[文字](url)`。
 *
 * ⚠️ 段落里混了任何别的字就**不算** —— 那种情况换成卡片会把作者写的话吞掉。
 * 所以这里的判据必须是"**整段**匹配"，不能用 `includes`。
 */
function isLoneLink(text: string): boolean {
  return BARE_URL.test(text) || MD_LINK.test(text);
}

const BARE_URL = /^https?:\/\/\S+$/;
/** `[文字](https://…)` —— URL 允许被尖括号包住（`<url>` 是 CommonMark 的写法）。 */
const MD_LINK = /^\[[^\]]*\]\(\s*<?https?:\/\/[^)\s>]+>?\s*\)$/;

const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;

/** 把所有图片标记摘掉之后，剩下的是不是只有空白？ */
function isImageOnly(text: string): boolean {
  return text.replace(IMAGE_RE, '').trim() === '';
}

function countImages(text: string): number {
  // `match` 带 `g` 返回所有命中；没有就是 `null`。
  return text.match(IMAGE_RE)?.length ?? 0;
}
