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
import { EditorState, StateEffect, StateField, type Extension, type Transaction } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

import type { EditorFeature, FeatureIndex, NormalizedFeatureIndex } from './feature.js';
import { normalizeFeatures } from './feature.js';
import { foldedBlocks } from './fold.js';
import type {
  DecorationBuild,
  SourceRange,
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
const NO_FEATURES: NormalizedFeatureIndex = new Map();
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
   * 功能模块：`节点名 → 认领它的功能`（**一个或多个**）。
   *
   * 由装配层（`index.ts`）注入 `EDITOR_FEATURE_BY_NODE`；不传就是空表。
   * 骨架**不认识任何具体元素**，所以可以脱离实现单测（同 `decorators`）。
   *
   * ⚠️ 取值允许是**单个功能**（历史形态，消费方和单测都这么写）或**数组**：
   * 一个 lezer 节点可以被多个功能认领（见 `feature.ts` 的 `EditorFeature.nodes`），
   * 但没必要为此把所有现有调用方都改成数组。入口处统一归一化（`normalizeFeatures`）。
   */
  features?: FeatureIndex;
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
  /*
   * ⚠️ 先归一化成「节点名 → 功能列表」。`features` 是公开选项，取值允许是单个功能
   * 或数组（见 `LivePreviewOptions.features`），下面两拨分流都只认数组。
   */
  const features = opts.features ? normalizeFeatures(opts.features) : NO_FEATURES;
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
    private destroyed = false;

    constructor(view: EditorView) {
      const built = this.build(view);
      this.decorations = built.decorations;
      this.atomicDecorations = built.atomicDecorations;
    }

    update(u: ViewUpdate): void {
      // IME 门控：组合期间**绝不重建**装饰 —— IME 依赖稳定的 DOM，重建会丢字。
      if (u.view.composing) {
        this.wasComposing = true;
        // 暂缓重建不等于冻结坐标：输入和撤销仍会移动后面的源码。
        // 不映射会让旧 replace 覆盖新文档的换行，直接破坏 CM 的布局。
        if (u.docChanged) {
          this.decorations = this.decorations.map(u.changes);
          this.atomicDecorations = this.atomicDecorations.map(u.changes);
        }
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
      const sourceChanged =
        u.startState.field(editingRange, false) !== u.state.field(editingRange, false);

      if (
        foldChanged ||
        sourceChanged ||
        justEndedComposing ||
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        // 滚动锚定与光标跟随交给 CodeMirror 的布局周期处理。
        // 在 requestMeasure.write 恢复旧位置会覆盖 scrollIntoView，
        // 也会撤销排队之后发生的滚轮滚动；IME 期间仍由上面的门控保护 DOM。
        const built = this.build(u.view);
        this.decorations = built.decorations;
        this.atomicDecorations = built.atomicDecorations;
      }
    }

    finishComposition(view: EditorView): void {
      // CM 在测量开始时先提交尚未处理的 DOM 输入（包括 Android 延迟提交）。
      // 直接排微任务可能早于 compositionend 的最终提交，空事务会丢掉那个字。
      view.requestMeasure({
        key: this,
        read: () => null,
        write: () => queueMicrotask(() => {
          if (!this.destroyed && this.wasComposing && !view.compositionStarted) {
            view.dispatch({});
          }
        }),
      });
    }

    destroy(): void {
      this.destroyed = true;
    }

    build(view: EditorView): DecorationBuild {
      const ranges: DecorationRanges = [];
      const atomicRanges: DecorationRanges = [];
      const tree = syntaxTree(view.state);
      const doc = view.state.doc;
      const selection = view.state.selection;
      const source = view.state.field(editingRange, false);

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
             * ★ 正在「看源码」的区间：**整棵子树跳过** —— 里面不推任何装饰
             * （行内标记、代码块、属性 chip 全不渲染）。`return false` = 不再下降。
             */
            if (source && ref.from >= source.from && ref.to <= source.to) return false;

            /*
             * ★ **功能模块优先。**
             *
             * 新元素走 `features`（`src/cm/features/`），不再往下面那几张表里塞 ——
             * 那几张表是骨架的一部分，每加一个元素就要动一次骨架，多人同时改必然冲突。
             *
             * 放最前面是**故意**的：功能可以认领内置节点。
             *
             * ★ **同一个节点可能有多个功能**（`math` 与 `mention` 都认 `Paragraph`，
             * 见 `feature.ts` 的 `EditorFeature.nodes`）。列表顺序 = 执行顺序
             * （`priority` 大的先跑，同优先级按注册顺序），由 `indexFeatures` 排好。
             * 各功能**自己按文本前缀 no-op**，所以互不干扰。
             *
             * ⚠️ 命中后**不 return false**：认领父节点 ≠ 放弃子树，
             * 比如表格里还可能有行内标记。
             */
            const features = viewFeatures.get(name);
            if (features) {
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
              for (const feature of features) {
                feature.decorate(ranges, atomicRanges, node, doc, selection, context);
              }
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
    eventObservers: {
      compositionend(_event, view) {
        this.finishComposition(view);
      },
    },
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
  /*
   * ⚠️ **`editingBlock` 必须一起挂上** ✗ —— `blockDecorations` 的 build 里要
   * `state.field(editingBlock)` ✓，字段不在 state 里的话**它会抛**
   * （"Field is not present in this state" ✓）——
   * 实测：漏挂时**连 history / drawSelection 这些基础设施测试都会红** ✓，
   * 因为整个 state 建不起来 ✓。
   */
  /*
   * Escape 主动退出源码。鼠标离开区间时的清理由 editingRange 在选区事务中
   * 处理，不能在 mousedown 中提前改变布局，否则 CM 会用变化后的行高定位。
   */
  const sourceModeHandlers: Extension = [
    keymap.of([
      {
        key: 'Escape',
        run: (view) => {
          if (!view.state.field(editingRange, false)) return false;
          view.dispatch({ effects: [setEditingRange.of(null), setEditingBlock.of(null)] });
          return true;
        },
      },
    ]),
  ];

  return [editingBlock, editingRange, blockDecorations(blockFeatures), plugin, sourceModeHandlers];
}

/**
 * 把功能表按 `block` 标记分成两拨。没有块级功能时**原样返回同一个 Map** ——
 * 不制造一个内容相同的新对象（避免给「这个功能表变了吗」这类引用比较添乱）。
 *
 * ★ **一个节点名可以同时出现在两拨里**：`math` 是块级功能、`mention` 不是，两者都认
 * `Paragraph` —— 于是块级通道拿 `Paragraph → [math]`、视图通道拿 `Paragraph → [mention]`，
 * 各跑各的。这正是「一个节点多个装饰器」真正需要的地方：**跨通道**的重复认领
 * （同一通道内的多个功能由列表顺序解决，见 `feature.ts` 的 `indexFeatures`）。
 */
function splitFeatures(features: NormalizedFeatureIndex): {
  view: NormalizedFeatureIndex;
  block: NormalizedFeatureIndex;
} {
  const block = new Map<string, readonly EditorFeature[]>();
  const view = new Map<string, readonly EditorFeature[]>();
  for (const [name, list] of features) {
    const blockList = list.filter((feature) => feature.block);
    const viewList = list.filter((feature) => !feature.block);
    if (blockList.length > 0) block.set(name, blockList);
    if (viewList.length > 0) view.set(name, viewList);
  }
  if (block.size === 0) return { view: features, block };
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
/**
 * 用户**点开**了哪个块级装饰（存那个块的 `from`）。
 *
 * ## 为什么需要它
 *
 * 块级 `Decoration.replace` 的区间**光标进不去** ✗（连程序 dispatch 都被夹到 `from - 1` ✓），
 * 所以"揭示源码"只能靠**停在门口** ✓ —— 而门口是**位置**判据 ✗：
 * **空行只有一个位置** ✓，整行都等于 `from - 1` ✓ → 光标**路过**也命中 ✓
 * → **公式/表格莫名其妙不渲染** ✗（用户实测 ✓）。
 *
 * 位置分不清"路过"和"要编辑" ✗ —— 所以另外记一份**意图** ✓：
 * **点击 widget** 就设上这个标记 ✓，标记在时**才**揭示 ✓。
 *
 * ⚠️ 和 `foldedBlocks`（`fold.ts`）是同一种机制 ✓ —— 都是"用户意图"型的 StateField ✓。
 *
 * ⚠️ **本字段不产出任何装饰** ✓ —— 它只存一个数字 ✓。
 * 块级装饰只能由 `blockDecorations` 那个 StateField 提供 ✓（见它的注释 ✓）。
 */
export const setEditingBlock = StateEffect.define<number | null>();

function selectionLeavesSource(tr: Transaction, from: number, to: number): boolean {
  // 鼠标拖选以当前 head 为准，待 CM 算好坐标后立刻恢复预览。
  if (tr.isUserEvent('select.pointer')) {
    const head = tr.newSelection.main.head;
    return head < from || head > to;
  }
  // 键盘扩选仍覆盖源码时保持揭示；折叠光标在边界处仍属于源码。
  return !!tr.selection && !tr.newSelection.ranges.some((range) =>
    range.empty
      ? range.head >= from && range.head <= to
      : range.from < to && range.to > from
  );
}

export const editingBlock = StateField.define<number | null>({
  create: () => null,

  update(value, tr) {
    for (const e of tr.effects) if (e.is(setEditingBlock)) return e.value;
    if (value === null) return null;

    /*
     * 文档变了 → 区间会移位 ✓，标记也要跟着走 ✓
     * （用户在门口打字，字插在围栏**前面** ✓，`from` 会往后移 ✓）。
     */
    const from = tr.changes.mapPos(value, 1);

    // 表格、图表和 tabs 同时使用 editingRange。它在选区离开时关闭，
    // editingBlock 也必须同步清除；否则前置空行的 from - 1 仍会把源码留在屏幕上。
    // 数学块仅使用 editingBlock，保留其点击后停在 from - 1 的行为。
    const source = tr.startState.field(editingRange, false);
    if (source && selectionLeavesSource(
      tr,
      tr.changes.mapPos(source.from, 1),
      tr.changes.mapPos(source.to, -1),
    )) return null;

    /*
     * 选区**离开门口**就清除 ✓ —— 注意"门口"要算上 `from - 1` 和 `to + 1` ✗：
     * 用户点进来之后光标就停在 `from - 1` ✓，清除条件里不含它的话
     * **一点进来就会被立刻清掉** ✓。
     *
     * `to` 这里用 `tr.newDoc.length` 兜底 ✓ —— 标记只需要保证"光标还在附近" ✓，
     * 不必精确知道围栏多长 ✓（`from` 就是那个块的起点 ✓，往下走几行自然就超了 ✓）。
     */
    const near = tr.state.selection.ranges.some(
      (r) => r.head >= from - 1 && r.head <= from + 1,
    );
    return near ? from : null;
  },
});

/**
 * 「正在看源码」的区间 —— 块级 widget 点开后设置。
 *
 * 和 `editingBlock` 的区别：那个只记一个**位置**（块从哪开始），只能让块自己知道
 * "我被点开了"；这个记**整段区间**，于是**区间内所有装饰**都可以统一跳过 ——
 * 用户看到的是原样 Markdown，而不是"块替换撤了、行内标记和代码块外壳还在"的半渲染。
 *
 * ⚠️ 不靠"选区跨过区间"来实现：那会让用户看到一整片紫色选区（用户实测：
 * "我没选整段啊，我就点它怎么能选整段啊"）。这里只放一个**光标**，区间单独记。
 */
export const setEditingRange = StateEffect.define<SourceRange | null>();

export const editingRange = StateField.define<SourceRange | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setEditingRange)) return e.value;
    if (!value) return null;
    const from = tr.changes.mapPos(value.from, 1);
    const to = tr.changes.mapPos(value.to, -1);
    // CM 已按旧布局算好点击/拖动选区后，再与选区一起收起源码。
    // 保留原生 Shift 扩选、多光标和拖动行为，不自行接管鼠标事件。
    if (selectionLeavesSource(tr, from, to)) return null;
    return to > from ? { from, to } : null;
  },
});

function blockDecorations(
  blockFeatures: NormalizedFeatureIndex,
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
        /*
         * ⚠️⚠️ **根节点绝对不能剪** ✗✗ —— 这是踩过的坑：
         *
         * 原注释写的是「块级功能独占整棵子树 —— 表格里不可能再嵌一个块级功能」✓，
         * 那话对 **`Table`** 成立 ✓，但 **`Document` 是根** ✗ ——
         * 剪掉它等于**整棵树都没了** ✓。
         *
         * 而 `math` 认领的正是 `Document` ✓（它要全文扫围栏 ✓），
         * 于是：**只要 `math` 在（它永远在 ✗）→ 表格、提及……全都收不到节点** ✓✓
         * 实测症状：**表格从来不渲染** ✗ + **提及卡片也不渲染** ✗，
         * 而单独测表格（不挂 math ✓）是好的 ✓ —— **两个功能一起死，原因在根上** ✓。
         *
         * 所以：**只有非根节点才剪** ✓。根的子节点继续走 ✓ ——
         * `Document` 下面的 `Table` / `Paragraph` 才收得到 ✓。
         */
        return ref.name === 'Document';
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
    /*
     * ★ 用户点开了哪个块（见 `editingBlock`）—— 传给功能 ✓，
     * 让它们把"位置判据"和"意图判据"合起来用 ✓。
     */
    const editing = state.field(editingBlock);
    const source = state.field(editingRange, false);
    for (const node of nodes) {
      // 正在看源码的区间 → 块级功能也跳过（否则 tabs/table 的 widget 会重新盖上来）。
      if (source && node.from >= source.from && node.to <= source.to) continue;
      const list = blockFeatures.get(node.name);
      if (!list) continue;
      /*
       * ★ 同一节点可能有多个块级功能（见 `splitFeatures` 的注释）——
       * 顺序由 `indexFeatures` 排好（`priority` 大的先跑，同优先级按注册顺序）。
       */
      for (const feature of list) {
        feature.decorate(
          ranges, atomicRanges, node, doc, selection,
          undefined, // context：块级功能不需要视图层的 folded ✓
          editing,
          source,
        );
      }
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
        tr.startState.selection.eq(tr.state.selection) &&
        tr.startState.field(editingBlock) === tr.state.field(editingBlock) &&
        tr.startState.field(editingRange, false) === tr.state.field(editingRange, false)
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
