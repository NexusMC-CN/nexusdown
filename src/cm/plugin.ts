import { syntaxTree } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

import { foldedBlocks } from './fold.js';
import type {
  DecorationBuild,
  DecorationRanges,
  LinkReferences,
  LivePreviewDecorators,
  UrlPolicy,
} from './types';

/**
 * 标题节点（ATX `# 标题` + Setext `标题\n===`）。
 *
 * ★ 坑 ②：这些节点在 `enter` 里**绝不能 `return false`** —— 一旦提前返回，
 *   标题里的 `**粗体**` / `` `code` `` 就不会被 inline 装饰器处理，星号原样露出。
 *   正确做法是处理完标记后**继续下降**。
 */
export const HEADING_NODES: ReadonlySet<string> = new Set([
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
]);

/**
 * 需要「样式 mark + 标记揭示」的行内节点。
 *
 * ⚠️ 这个集合**只含样式节点**，不含任何 `*Mark` 节点 —— 标记由各装饰器
 * 用 `children()` 自己扫。这正好也是「heading 继续下降但 HeaderMark 不被重复处理」
 * 的保证：`decorateHeading` 只认 `HeaderMark`，`decorateInline` 只认这里列出的样式节点，
 * 两个集合**不相交**，同一次下降不会有两方去动同一个区间。
 */
export const INLINE_NODES: ReadonlySet<string> = new Set([
  'StrongEmphasis',
  'Emphasis',
  'InlineCode',
  'Strikethrough',
]);

/** 自包含的块级节点：装饰完就没必要再往下走。 */
export const BLOCK_NODES: ReadonlySet<string> = new Set(['Image', 'HorizontalRule']);

const NOOP_DECORATOR: LivePreviewDecorators['heading'] = () => {};
const NOOP_LINK_DECORATOR: LivePreviewDecorators['link'] = () => {};

export interface LivePreviewOptions {
  /**
   * 各元素的装饰器表。由装配层（`index.ts`）注入；不传的项退化成空操作，
   * 所以骨架本身可以脱离具体元素实现单独测试。
   */
  decorators?: Partial<LivePreviewDecorators>;
  /** 链接 URL 白名单策略；不传则由 link 装饰器用内置默认策略。 */
  urlPolicy?: UrlPolicy;
  /** 引用式链接（`[text][ref]`）索引；不传则由 link 装饰器从 doc 现算。 */
  references?: LinkReferences;
}

/** 插件实例的形状（测试里用它断言装饰数量）。 */
export interface LivePreviewPluginValue extends PluginValue {
  readonly decorations: DecorationSet;
  readonly atomicDecorations: DecorationSet;
  build(view: EditorView): DecorationBuild;
  /** `PluginValue.update` 在基类里是可选的，这里收紧成必选。 */
  update(update: ViewUpdate): void;
}

/**
 * Live Preview 主干。
 *
 * 职责只有三件事：**只走可见区遍历语法树 → 按节点名分发 → 分别装进
 * `decorations` / `atomicDecorations` 两个桶**。每个元素长什么样不归它管。
 */
export function nexusdownLivePreview(opts: LivePreviewOptions = {}): Extension {
  const decorators: LivePreviewDecorators = {
    heading: opts.decorators?.heading ?? NOOP_DECORATOR,
    inline: opts.decorators?.inline ?? NOOP_DECORATOR,
    blockquote: opts.decorators?.blockquote ?? NOOP_DECORATOR,
    listItem: opts.decorators?.listItem ?? NOOP_DECORATOR,
    fencedCode: opts.decorators?.fencedCode ?? NOOP_DECORATOR,
    block: opts.decorators?.block ?? NOOP_DECORATOR,
    link: opts.decorators?.link ?? NOOP_LINK_DECORATOR,
  };
  const { urlPolicy, references } = opts;

  class NexusdownLivePreview implements LivePreviewPluginValue {
    decorations: DecorationSet;
    atomicDecorations: DecorationSet;

    /** ★ 坑 ①：没有它就无法在 IME 组合结束的**边沿**强制重建一次装饰。 */
    private wasComposing = false;

    constructor(view: EditorView) {
      const built = this.build(view);
      this.decorations = built.decorations;
      this.atomicDecorations = built.atomicDecorations;
    }

    update(u: ViewUpdate): void {
      // IME 门控：组合期间**绝不重建**装饰 —— IME 依赖稳定的 DOM，重建会丢字。
      if (u.view.composing) {
        this.wasComposing = true;
        return;
      }
      // ★ silkdown 只写了上面那个 if，于是「组合结束」这件事没有任何人负责：
      //   组合期间挂起的重建要等下一次 docChanged / viewportChanged 才补上。
      //   这里显式记录 true→false 的边沿，边沿上强制重建一次。
      const justEndedComposing = this.wasComposing;
      this.wasComposing = false;

      // ★ 折叠状态变了也要重建。
      //
      // `toggleFold` 是**纯视图状态**（不碰文档），所以 dispatch 它时
      // `docChanged` / `selectionSet` / `viewportChanged` **全是 false** ——
      // 没有这一条的话点了折叠按钮会毫无反应（effect 生效了、`foldedBlocks`
      // 也更新了，就是装饰不重算，界面纹丝不动，而且**零报错**）。
      //
      // 用引用比较就够了：`fold.ts` 的 `update` 只在真的处理了 effect 时才
      // 新建 Set，没变时返回的是同一个对象。
      const foldChanged =
        u.startState.field(foldedBlocks, false) !== u.state.field(foldedBlocks, false);

      if (
        foldChanged ||
        justEndedComposing ||
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        /**
         * ⚠️ **重建前锁住滚动位置。**
         *
         * 装饰是**视觉层**，但它会改变行宽：`**` 在揭示态占约 12px，翻成隐藏态
         * 变成 0。开着 `EditorView.lineWrapping` 时，行宽变化会改变**换行位置**、
         * 进而改变**总行数** —— 浏览器于是重算滚动位置。
         *
         * 最明显的触发点就是 **IME 组合结束**：用户打完 `**粗体**` 提交组合，
         * 装饰从揭示态翻成隐藏态，视口直接跳到文档末尾（用户实测反馈：
         * "输入一次 `**xxxx**` 的时候用中文输入法，给我跳到底下去了"）。
         *
         * 恢复分两拍：同步一次（覆盖本帧就生效的情况），`requestMeasure`
         * 里再一次（装饰的实际 DOM 写入发生在 CM6 的 measure/update 周期里，
         * 那时才会真正引起回流）。只同步恢复是不够的。
         */
        const scroller = u.view.scrollDOM;
        const keepTop = scroller.scrollTop;
        const keepLeft = scroller.scrollLeft;

        const built = this.build(u.view);
        this.decorations = built.decorations;
        this.atomicDecorations = built.atomicDecorations;

        if (scroller.scrollTop !== keepTop) scroller.scrollTop = keepTop;
        if (scroller.scrollLeft !== keepLeft) scroller.scrollLeft = keepLeft;
        u.view.requestMeasure({
          read: () => null,
          write: () => {
            if (scroller.scrollTop !== keepTop) scroller.scrollTop = keepTop;
            if (scroller.scrollLeft !== keepLeft) scroller.scrollLeft = keepLeft;
          },
        });
      }
    }

    build(view: EditorView): DecorationBuild {
      const ranges: DecorationRanges = [];
      const atomicRanges: DecorationRanges = [];
      const tree = syntaxTree(view.state);
      const doc = view.state.doc;
      const selection = view.state.selection;

      // 折叠或多段可见区时，一个跨段节点会在两段里各被 enter 一次。
      // mark 装饰重复推无所谓（class 幂等），但 replace 装饰重复推会造出重叠区间、
      // 渲染错乱，所以按 (name, from, to) 去重。
      const visited = view.visibleRanges.length > 1 ? new Set<string>() : null;

      // ★ 只走可见区，绝不 `tree.iterate({})` 全量遍历。
      for (const { from, to } of view.visibleRanges) {
        tree.iterate({
          from,
          to,
          enter: (ref) => {
            if (visited) {
              const key = `${ref.name}:${ref.from}:${ref.to}`;
              // 注意是 `return` 不是 `return false`：子节点可能落在另一段可见区里。
              if (visited.has(key)) return;
              visited.add(key);
            }

            // `enter` 给的是 TreeCursor 的只读视图（`SyntaxNodeRef`），它没有
            // `firstChild` / `nextSibling`。装饰器需要稳定的 `SyntaxNode`，
            // 所以在**分发前**才取一次 `.node`（只对命中的节点付费）。
            const node = ref.node;
            const name = node.name;

            if (HEADING_NODES.has(name)) {
              decorators.heading(ranges, atomicRanges, node, doc, selection);
              // ★ 坑 ②：不 return false —— 继续下降，标题里的 `**粗体**` 才会被处理。
              return;
            }

            if (INLINE_NODES.has(name)) {
              decorators.inline(ranges, atomicRanges, node, doc, selection);
              // 不 return false：`***粗斜体***` 是 Emphasis > StrongEmphasis 两层
              // 完全相同的区间，两层都要各推一个 mark 才能叠加。
              return;
            }

            if (name === 'Blockquote') {
              decorators.blockquote(ranges, atomicRanges, node, doc, selection);
              return;
            }

            if (name === 'ListItem') {
              decorators.listItem(ranges, atomicRanges, node, doc, selection);
              return;
            }

            if (name === 'FencedCode') {
              /*
               * 折叠状态是**文档级**的（存在 `foldedBlocks` 这个 StateField 里），
               * 而装饰器的签名里故意没有 `state`（见 `types.ts` 的 `DecorateContext`）。
               * 所以在这里读一次、通过 `context` 传下去 —— 只有代码块需要它。
               *
               * `required: false`：消费方可能没装 `nexusdown()`（只用了裸 plugin 做单测），
               * 那时这个 field 不存在，读它不该抛。
               */
              const folded = view.state.field(foldedBlocks, false);
              decorators.fencedCode(ranges, atomicRanges, node, doc, selection, {
                folded: folded?.has(node.from) ?? false,
              });
              // 不 return false：要让 lezer overlay 的语法高亮 tag 落进代码块里。
              return;
            }

            if (name === 'Link') {
              decorators.link(ranges, atomicRanges, node, doc, selection, references, urlPolicy);
              return false;
            }

            // ⚠️ `Autolink`（`<https://x>`）和裸 `URL`（GFM 自动链接，`https://x.com`
            //    直接写在正文里）**必须单独分发** —— 它们不是 `Link` 节点，
            //    漏掉的话装饰器里那两个分支永远跑不到，自动链接就不会渲染。
            //    两者的 `urlPolicy` 过滤在 `decorateLink` 里统一做。
            if (name === 'Autolink' || name === 'URL') {
              decorators.link(ranges, atomicRanges, node, doc, selection, references, urlPolicy);
              return false;
            }

            if (BLOCK_NODES.has(name)) {
              decorators.block(ranges, atomicRanges, node, doc, selection);
              return false;
            }
          },
        });
      }

      return {
        // ★ `true` = 自动排序。绕开 RangeSetBuilder「必须单调递增」的约束：
        //   性能略差，但不会崩。先保正确性，profile 出问题再换 builder。
        decorations: Decoration.set(ranges, true),
        atomicDecorations: Decoration.set(atomicRanges, true),
      };
    }
  }

  return ViewPlugin.fromClass(NexusdownLivePreview, {
    decorations: (v) => v.decorations,
    // ★ 必须给 `atomicDecorations` 这个**独立集合**，不是 `decorations`。
    //   把 decorations 直接当 atomicRanges，揭示态的标记也会被当成原子块，
    //   光标就没法一个字符一个字符走进 `**` 里。
    provide: (p) =>
      EditorView.atomicRanges.of((view) => view.plugin(p)?.atomicDecorations ?? Decoration.none),
  });
}
