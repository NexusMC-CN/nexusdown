/**
 * Live Preview 骨架 —— 遍历语法树、按节点名分发、把装饰装进两个桶。
 *
 * ## 两条装饰通道（为什么不是一条）
 *
 * 绝大多数功能产出的是**行内 mark / 行级 line** 装饰，走 `ViewPlugin`（下面那个
 * `NexusdownLivePreview`）：它能只遍历**可见区**，大文档上省下大量工作。
 *
 * 但带 `block: true` 的功能产出**块级替换**，CM6 **禁止 ViewPlugin 提供块级装饰**
 * （挂载即抛 `RangeError: Block decorations may not be specified via plugins`）——
 * 块级装饰会改垂直布局，而布局必须在 state 更新时就定下来。这类功能只能由
 * `StateField` 经 `EditorView.decorations.from(field)` 提供（见 `blockDecorations`）。
 *
 * 分流点是 `splitFeatures`：没有块级功能时，本函数**原样返回那个 ViewPlugin**
 * （不是包一层数组），行为与加这条通道之前一字不差。
 */
import { syntaxTree } from '@codemirror/language';
import { EditorState, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

import type { EditorFeature } from './feature.js';
import { foldedBlocks } from './fold.js';
import type {
  DecorationBuild,
  DecorationRanges,
  LinkReferences,
  LivePreviewDecorators,
  MarkdownNode,
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
const NO_FEATURES: ReadonlyMap<string, EditorFeature> = new Map();
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
  /**
   * 功能模块：`节点名 → 认领它的功能`。
   *
   * 由装配层（`index.ts`）注入 `EDITOR_FEATURE_BY_NODE`；不传就是空表。
   * 骨架**不认识任何具体元素**，所以可以脱离实现单测（同 `decorators`）。
   */
  features?: ReadonlyMap<string, EditorFeature>;
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
  const features = opts.features ?? NO_FEATURES;
  /*
   * ★ **按「装饰能不能从 ViewPlugin 出来」把功能分成两拨。**
   *
   * 带 `block: true` 的功能产出块级替换，而 CM6 **禁止 ViewPlugin 提供块级装饰**
   * （运行时抛 `Block decorations may not be specified via plugins`，见
   * `feature.ts` 的 `EditorFeature.block`）。所以它们改由下面那个 StateField 提供。
   *
   * ⚠️ 没有块级功能时（绝大多数单测、以及只装行内功能的消费方）**原样返回
   * 那个 ViewPlugin** —— 返回类型、插件实例的获取方式都和加这个通道之前一字不差，
   * 不制造无谓的行为变化。
   */
  const { view: viewFeatures, block: blockFeatures } = splitFeatures(features);

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

            /*
             * ★ **功能模块优先。**
             *
             * 新元素走 `features`（`src/cm/features/`），不再往下面那几张表里塞 ——
             * 那几张表是骨架的一部分，每加一个元素就要动一次骨架，多人同时改必然冲突。
             *
             * 放最前面是**故意**的：功能可以认领内置节点。真冲突时
             * `indexFeatures`（`feature.ts`）会在**启动时抛错**，不会悄悄覆盖 ——
             * 悄悄覆盖的表现是"某个元素突然不渲染了"，极难查。
             *
             * ⚠️ 命中后**不 return false**：认领父节点 ≠ 放弃子树，
             * 比如表格里还可能有行内标记。
             */
            const feature = viewFeatures.get(name);
            if (feature) {
              /*
               * ⚠️ **`context` 必须传下去。**
               *
               * 折叠状态只经 `context` 传入（见 `types.ts` 的 `DecorateContext`）。
               * 少了它，**认领了 `FencedCode` 的功能会把整条代码块路径带坏** ——
               * `folded` 恒为 `false`，点标题栏的折叠箭头**毫无反应且零报错**。
               * （实测踩过：embed 认领 `FencedCode` 后所有代码块都不能折叠了。）
               *
               * 只有围栏需要文档级状态，所以只对它读 field —— 别让每个被认领的
               * 节点都去 `field()` 一次。
               */
              const context =
                name === 'FencedCode'
                  ? { folded: view.state.field(foldedBlocks, false)?.has(node.from) ?? false }
                  : undefined;
              feature.decorate(ranges, atomicRanges, node, doc, selection, context);
              return;
            }

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

  const plugin = ViewPlugin.fromClass(NexusdownLivePreview, {
    decorations: (v) => v.decorations,
    // ★ 必须给 `atomicDecorations` 这个**独立集合**，不是 `decorations`。
    //   把 decorations 直接当 atomicRanges，揭示态的标记也会被当成原子块，
    //   光标就没法一个字符一个字符走进 `**` 里。
    provide: (p) =>
      EditorView.atomicRanges.of((view) => view.plugin(p)?.atomicDecorations ?? Decoration.none),
  });

  /*
   * 没有块级功能 → **返回 ViewPlugin 本身**（不是包一层数组）：
   * `view.plugin(nexusdownLivePreview(...))` 这种用法在测试里到处都是，
   * 包成数组会让它们全部找不到插件实例。
   */
  if (blockFeatures.size === 0) return plugin;
  return [blockDecorations(blockFeatures), plugin];
}

/**
 * 把功能表按 `block` 标记分成两拨。没有块级功能时**原样返回同一个 Map** ——
 * 不制造一个内容相同的新对象（避免给「这个功能表变了吗」这类引用比较添乱）。
 */
function splitFeatures(features: ReadonlyMap<string, EditorFeature>): {
  view: ReadonlyMap<string, EditorFeature>;
  block: ReadonlyMap<string, EditorFeature>;
} {
  const block = new Map<string, EditorFeature>();
  for (const [name, feature] of features) {
    if (feature.block) block.set(name, feature);
  }
  if (block.size === 0) return { view: features, block };
  const view = new Map<string, EditorFeature>();
  for (const [name, feature] of features) {
    if (!feature.block) view.set(name, feature);
  }
  return { view, block };
}

/** 块级通道一次构建的两份产物：要渲染的装饰 + 其中隐藏态对应的原子区间。 */
interface BlockDecorations {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

/**
 * **块级装饰通道** —— 一个 StateField，提供 `EditorView.decorations`。
 *
 * ## 为什么必须是 StateField（而不是 ViewPlugin）
 *
 * CM6 的 `dynamicDecorationMap[i] = typeof d == "function"`：ViewPlugin 的
 * `decorations:` 会被包成函数 → 标记为动态 → **禁止块级效果**（挂载即抛
 * `Block decorations may not be specified via plugins`）。StateField 经
 * `EditorView.decorations.from(field)` 提供时，facet 值是**字段的当前值**
 * （一个 `DecorationSet`，不是函数）→ 动态标记为假 → 块级装饰放行 ✓。
 *
 * ## 只跑块级功能，且按「语法树」缓存节点列表
 *
 * 这个字段**不碰**行内功能（那些还在 ViewPlugin 里，享受可见区裁剪）。它只在
 * 全树里挑出块级功能认领的节点，逐个交给 `feature.decorate`。
 *
 * ⚠️ 缓存按**语法树对象**（不是 `doc`）：lezer 是**增量**解析的，同一个 doc 在
 * 解析补全前后可能是**两棵树** —— 按 doc 缓存会把「树还没解析出表格」这个中间态
 * 永久钉住。按树缓存则树一换就重算。
 *
 * ## ⚠️ 这个通道**也必须**提供 `atomicRanges`（不只是 `decorations`）
 *
 * 起初这里只 provide 了 `decorations`，`atomicRanges` 收下就扔了 —— 当时的假设是
 * 「块级功能只推块级 replace，而块级区间光标本来就进不去，不需要原子区间」。
 *
 * **那个假设不成立** ✓：一个功能可以**同时**是块级的、又推行内 replace。`math` 就是
 * 例子 —— 它认领 `Document`（为了全文扫围栏），所以整份功能（含**行内** `$…$` 的
 * 隐藏态 replace）都被分流进这个字段。行内 replace **必须**登记原子区间，否则光标会
 * 停在隐藏区间的中间（表现为「按一下方向键没动」，见 `decorate/shared.ts`）。
 *
 * 所以字段的值改成 `{ decorations, atomic }` 两份一起提供。`table` 不推原子区间，
 * 于是它的那份恒为空 —— 行为一字不变。
 */
function blockDecorations(
  blockFeatures: ReadonlyMap<string, EditorFeature>,
): Extension {
  const cache = new WeakMap<object, MarkdownNode[]>();

  function nodesFor(state: EditorState): MarkdownNode[] {
    const tree = syntaxTree(state);
    const hit = cache.get(tree);
    if (hit) return hit;

    const nodes: MarkdownNode[] = [];
    tree.iterate({
      enter: (ref) => {
        if (!blockFeatures.has(ref.name)) return;
        nodes.push(ref.node);
        // 块级功能独占整棵子树 —— 表格里不可能再嵌一个块级功能。
        return false;
      },
    });
    cache.set(tree, nodes);
    return nodes;
  }

  function build(state: EditorState): BlockDecorations {
    const nodes = nodesFor(state);
    if (nodes.length === 0) return { decorations: Decoration.none, atomic: Decoration.none };

    const ranges: DecorationRanges = [];
    const atomicRanges: DecorationRanges = [];
    const doc = state.doc;
    const selection = state.selection;
    for (const node of nodes) {
      blockFeatures.get(node.name)?.decorate(ranges, atomicRanges, node, doc, selection);
    }
    return {
      // `true` = 自动排序，同 ViewPlugin 那边（块级区间跨度大，顺序不保证单调）。
      decorations: Decoration.set(ranges, true),
      atomic: Decoration.set(atomicRanges, true),
    };
  }

  const field = StateField.define<BlockDecorations>({
    create: (state) => build(state),
    update(deco, tr) {
      /*
       * 只在「文档变了 / 语法树换了 / 选区动了」时重算。
       *
       * ⚠️ **选区必须算进来** —— 揭示态（光标紧邻表格 / 围栏）就是靠选区驱动的
       * （见 `features/table.ts` 的「紧邻即揭示」）。漏了它，光标走到门口
       * 表格也不会换回源码，**而且零报错**。
       */
      if (
        !tr.docChanged &&
        syntaxTree(tr.startState) === syntaxTree(tr.state) &&
        tr.startState.selection.eq(tr.state.selection)
      ) {
        return deco;
      }
      return build(tr.state);
    },
    provide: (f) => [
      EditorView.decorations.from(f, (value) => value.decorations),
      /*
       * 原子区间经 facet 的**函数形态**提供（`atomicRanges` 的 facet 值就是
       * `(view) => RangeSet`）。每次布局时读一遍字段当前值，所以两份产物永远同源同步。
       */
      EditorView.atomicRanges.of(
        (view) => view.state.field(f, false)?.atomic ?? Decoration.none,
      ),
    ],
  });

  return field;
}
