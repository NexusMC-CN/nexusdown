/**
 * 引用块 + **Callouts**（`> [!NOTE]`）—— 编辑器侧。
 *
 * 契约：`docs/dialect-extensions.md` 第 9 节。渲染侧的对应实现在
 * `src/render/features/callout.ts`，两边共用 `src/shared/callouts.ts` 的类型表
 * 和 `src/shared/dialect.css` 的样式。
 *
 * ## 左边线怎么画
 *
 * 靠 `Decoration.line` + CSS `border-left`。因为 line 装饰只作用于
 * 「以该位置开头的那一行」，**整块每一行都要推一个**，否则多行引用的
 * 左边线只覆盖第一行。
 *
 * ## Callout 和普通引用块的区别只有两处
 *
 * 1. 行装饰的类名：普通引用是 `.nd-blockquote`，callout 是
 *    `.nd-callout .nd-callout--note`（**和渲染侧同一套类名**，样式来自 `dialect.css`）；
 * 2. 首行的 `[!NOTE]` 标记：非揭示态换成**徽章**（图标 + 类型名），
 *    揭示态露出源码 —— 和行内标记（`**` / `` ` ``）同一套「光标碰到就揭示」。
 *
 * 判据和渲染侧共用 `parseCallOutMarker`：**未知类型返回 `null`**，于是这里退回
 * 普通引用块（`[!FOO]` 作为正文原样显示）。两侧因此不会出现「编辑器里有徽章、
 * 发出来是普通引用」。
 *
 * ## ⚠️ 两条硬约束
 *
 * - 徽章是**隐藏态**的 `Decoration.replace` → **必须登记 atomicRanges**
 *   （`pushAtomicRange`），否则光标会停在隐藏区间的中间。
 * - 徽章 widget **必须实现 `eq`**，否则每次 rebuild 重建 DOM，徽章会闪。
 *
 * 嵌套引用（`> > 文字`）目前给同一行推两次同一个 class，CSS 只算一次 ——
 * 嵌套没有视觉层级。要修得按嵌套深度生成 `nd-bq-1` / `nd-bq-2`。
 */
import type { EditorSelection, Line, Range, Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, WidgetType } from '@codemirror/view';

import { parseCallOutMarker, type CallOutType } from '../../shared/callouts.js';
import { selectionTouchesLineRange } from '../util/selection.js';
import { children } from '../util/tree.js';
import { MUTED_MARK, pushAtomicRange, pushRevealableMark } from './shared.js';

/** 模块级单例（RangeSet 的等值比较依赖对象标识）。 */
const BLOCKQUOTE_LINE = Decoration.line({ class: 'nd-blockquote' });

/**
 * Callout 的行装饰缓存：`class 字符串 → Decoration`。
 *
 * ⚠️ **不能每次现造**：`Decoration.line` 的等值比较依赖对象标识（同 `fence.ts` 的
 * `LINE_*` 单例），每次 rebuild 新建一个内容相同的 Decoration 会让 CM6 认不出
 * 「这条装饰没变」，整块行盒被拆掉重建 —— 表现是打字时左边线闪。
 * 类名是 `类型 × 首/中/末` 的有限组合，缓存起来就够了。
 */
const CALLOUT_LINE_CACHE = new Map<string, Decoration>();

function calloutLineDecoration(type: string, index: number, count: number): Decoration {
  const classes = ['nd-callout', `nd-callout--${type}`];
  if (index === 0) classes.push('nd-callout-first');
  if (index === count - 1) classes.push('nd-callout-last');
  const key = classes.join(' ');

  let decoration = CALLOUT_LINE_CACHE.get(key);
  if (!decoration) {
    decoration = Decoration.line({ class: key });
    CALLOUT_LINE_CACHE.set(key, decoration);
  }
  return decoration;
}

/**
 * 首行标记徽章（非揭示态）。
 *
 * DOM 结构与渲染侧 `renderTitle()` 对齐：`__title` 里装 `__icon` + `__label`，
 * 类名逐个相同 —— 所以 `dialect.css` 一份样式管两侧。
 * 唯一的差异是根标签：渲染侧是 `<p>`（块级，独占一行），这里是 `<span>`
 * （行内 widget，必须待在一行里，否则会把高度表搞坏）。
 */
export class CallOutBadgeWidget extends WidgetType {
  constructor(private readonly def: CallOutType) {
    super();
  }

  /** 只有类型影响外观，比 `type` 就够（`def` 是常量表里的对象）。 */
  override eq(other: CallOutBadgeWidget): boolean {
    return other.def.type === this.def.type;
  }

  override toDOM(): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'nd-callout__title';
    badge.setAttribute('data-nd-callout', this.def.type);

    const icon = document.createElement('span');
    icon.className = 'nd-callout__icon';
    // 图标是纯装饰，别让屏幕阅读器念一个看不懂的符号（同 `embed` 的占位卡）。
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = this.def.glyph;

    const label = document.createElement('span');
    label.className = 'nd-callout__label';
    label.textContent = this.def.label;

    badge.append(icon, label);
    return badge;
  }

  /** 返回 `false` = 事件交给 CM：点徽章 → 光标落到那一行 → 转揭示态露出 `[!NOTE]`。 */
  override ignoreEvent(_event: Event): boolean {
    return false;
  }
}

export function decorateBlockquote(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  node: SyntaxNode,
  doc: Text,
  sel: EditorSelection,
): void {
  const callout = detectCallOut(doc, node);
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);

  // 整块每一行一个 line 装饰。
  const lines: Line[] = [];
  let pos = node.from;
  while (pos <= node.to) {
    const line = doc.lineAt(pos);
    lines.push(line);
    if (line.to >= node.to) break;
    pos = line.to + 1;
  }
  /*
   * ⚠️ 去掉**尾部空行**：引用块后面补的空行会被 lezer 算进 Blockquote 的 `to`
   * （实测：callout 下面多出一条没有内容的浅色带）。空行不该有 callout 底色。
   */
  while (lines.length > 0 && lines[lines.length - 1]!.text.trim() === '') lines.pop()
  if (lines.length === 0) return

  lines.forEach((line, index) => {
    ranges.push(
      (callout
        ? calloutLineDecoration(callout.def.type, index, lines.length)
        : BLOCKQUOTE_LINE
      ).range(line.from),
    );
  });

  for (const quoteMark of collectQuoteMarks(node, [])) {
    // `> ` 的尾随空格一起藏；`>tight` 没有空格时只藏 `>`。
    const next = doc.sliceString(quoteMark.to, quoteMark.to + 1);
    const markTo = next === ' ' ? quoteMark.to + 1 : quoteMark.to;
    pushRevealableMark(ranges, atomicRanges, revealed, quoteMark.from, markTo);
  }

  if (!callout) return;

  /*
   * 首行标记：揭示态露出源码（淡化），非揭示态换成徽章。
   *
   * ⚠️ 揭示态**不能**推 replace —— 用户就是进来改 `[!NOTE]` 的，
   * 藏掉它等于让他看不见自己写的东西（同 `pushRevealableMark` 的两态处理）。
   */
  if (revealed) {
    ranges.push(MUTED_MARK.range(callout.from, callout.to));
    return;
  }
  pushAtomicRange(
    ranges,
    atomicRanges,
    Decoration.replace({ widget: new CallOutBadgeWidget(callout.def) }),
    callout.from,
    callout.to,
  );
}

/** 一次命中的标记：类型 + 标记在文档里的区间（`[!NOTE]` 的起止）。 */
interface CallOutAt {
  def: CallOutType;
  from: number;
  to: number;
}

/**
 * 这个引用块是不是 callout？是就返回标记的位置和类型。
 *
 * 判据（和渲染侧 `installCalloutCore` 逐条对应）：
 *
 * - 引用块的**第一个内容节点**必须是 `Paragraph` —— 跳过本层的 `QuoteMark`；
 *   若第一个内容节点是另一个 `Blockquote`（`> > [!NOTE]`）或列表，就不是 callout
 *   （对齐渲染侧的 `pOpen.level === open.level + 1`）；
 * - 该段落**首行**必须以 `[!TYPE]` 开头（`parseCallOutMarker`，未知类型返回 `null`）。
 *
 * ⚠️ 只看**首行**：`> 正文\n> [!NOTE]` 不是 callout（契约：标记是第一行）。
 */
function detectCallOut(doc: Text, node: SyntaxNode): CallOutAt | null {
  let child = node.firstChild;
  while (child && child.name === 'QuoteMark') child = child.nextSibling;
  if (!child || child.name !== 'Paragraph') return null;

  /*
   * `Paragraph.from` 不含前导空白（实测 `>   [!NOTE]` 的段落从 `[` 开始），
   * 而 markdown-it 那边段落内容也已经去掉了同样的空白 —— 所以两边切出来的
   * 首行文本是同一串，判定不会漂。
   */
  const line = doc.lineAt(child.from);
  const marker = parseCallOutMarker(doc.sliceString(child.from, line.to));
  if (!marker) return null;

  return { def: marker.def, from: child.from, to: child.from + marker.length };
}

/**
 * 收集**本层**引用块自己的 `QuoteMark`。
 *
 * ⚠️ 不能只看直接子节点：lezer 会把续行的 `>` 塞进 `Paragraph` 里 ——
 * `> a\n> b` 的树是 `Blockquote > [QuoteMark, Paragraph > QuoteMark]`，
 * 第二个 `>` 不是 Blockquote 的直接子节点。只扫直接子节点的话，
 * 多行引用只有第一行的 `>` 被藏掉。
 *
 * 遇到嵌套 `Blockquote` 要**剪枝**：`> > 文字` 里内层的 `>` 由内层自己的
 * 那次调用处理，否则同一个区间会被推两次。
 */
function collectQuoteMarks(node: SyntaxNode, out: SyntaxNode[]): SyntaxNode[] {
  for (const child of children(node)) {
    if (child.name === 'QuoteMark') {
      out.push(child);
    } else if (child.name !== 'Blockquote') {
      collectQuoteMarks(child, out);
    }
  }
  return out;
}
