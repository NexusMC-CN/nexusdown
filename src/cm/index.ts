import { history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  syntaxHighlighting,
  type Language,
  type LanguageDescription,
  type LanguageSupport,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view';

import { decorateBlock } from './decorate/block';
import { decorateBlockquote } from './decorate/blockquote';
import { decorateFencedCode } from './decorate/fence';
import { decorateHeading } from './decorate/heading';
import { decorateInline } from './decorate/inline';
import { decorateLink, linkClickHandler } from './decorate/link';
import { decorateListItem } from './decorate/list';
import { foldedBlocks } from './fold';
import { nexusdownLivePreview } from './plugin';
import { markdownKeymap } from './shortcuts';
import { baseTheme } from './theme';
import type { LinkReferences, UrlPolicy } from './types';

/**
 * 代码块的语法着色。
 *
 * ⚠️ **绝对不能用 `defaultHighlightStyle`。**
 *
 * 它是给**代码编辑器**设计的，里面有这么一条
 * （`@codemirror/language/dist/index.js:1808`）：
 *
 *     { tag: tags.heading, textDecoration: "underline", fontWeight: "bold" }
 *
 * 而 **Markdown 的标题节点也带 `tags.heading`** —— 于是每个标题下面都会
 * 凭空多出一条下划线，而且它的类名是 CM6 用 style-mod 生成的 `ͼN`，
 * 在 DevTools 里查不到来源，非常难定位（用户原话："那个下划线就是有的，
 * 都是什么 ͼ7 ͼ3 的 css 提供的，很奇怪"）。
 *
 * 标题的视觉由 `theme.css` 的 `.nd-h1` ~ `.nd-h6` 全权负责，
 * 高亮器不该再插一脚。所以这里**自己定义一份**，只覆盖代码相关的 tag，
 * 把 `heading` / `link` / `emphasis` / `strong` 全部留给 CSS。
 *
 * 颜色用 CSS 变量 + 回退值，消费方换肤时自动跟着走。
 */
const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--nd-code-keyword, #7c3aed)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--nd-code-string, #0a7d3e)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--nd-code-number, #b45309)' },
  { tag: tags.comment, color: 'var(--nd-code-comment, #6b7280)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--nd-code-function, #1d4ed8)' },
  { tag: tags.typeName, color: 'var(--nd-code-type, #0e7490)' },
  { tag: tags.propertyName, color: 'var(--nd-code-property, #b45309)' },
  { tag: tags.tagName, color: 'var(--nd-code-tag, #dc2626)' },
  { tag: tags.attributeName, color: 'var(--nd-code-attr, #b45309)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--nd-code-punct, #4b5563)' },
  { tag: tags.heading, color: 'inherit' },
  { tag: tags.link, color: 'inherit' },
  { tag: tags.strong, color: 'inherit' },
  { tag: tags.emphasis, color: 'inherit' },
  { tag: tags.strikethrough, color: 'inherit' },
]);

export interface NexusdownOptions {
  /**
   * 代码块的语言支持。
   *
   * 传 `@codemirror/language-data` 的 `languages` 就能开箱拿到语法高亮：
   * ```ts
   * import { languages } from '@codemirror/language-data';
   * nexusdown({ codeLanguages: languages });
   * ```
   * 不传也能用 —— 围栏代码块照样被 lezer 解析、围栏照样会被隐藏，只是没有着色。
   * （本库**不**把 `@codemirror/language-data` 写进依赖：它很重，而且静态 import
   *   会强制每个消费方都装上它。高亮按需开启。）
   */
  codeLanguages?: readonly LanguageDescription[] | ((info: string) => Language | LanguageDescription | null);
  /** 代码块的兜底语言。 */
  defaultCodeLanguage?: Language | LanguageSupport;
  /** 链接 URL 白名单策略；不传则用 `url.ts` 的内置默认策略。 */
  urlPolicy?: UrlPolicy;
  /** 引用式链接（`[text][ref]`）索引；不传则由 link 装饰器从 doc 现算。 */
  references?: LinkReferences;
}

/**
 * 组装出一个完整的 Nexusdown Live Preview 扩展。
 *
 * 这个函数是**装配层**：`plugin.ts` 只提供「遍历 + 分发」的骨架，
 * 具体每个 Markdown 元素怎么装饰由这里注入。
 *
 * ## 开箱即用的编辑器基础
 *
 * 这里无条件带上撤销栈（`history`）、光标绘制（`drawSelection`）、当前行高亮
 * （`highlightActiveLine`）和基础语法着色（`syntaxHighlighting`）—— 缺了任何一个
 * 消费方拿到的都是「不能用」的编辑器：
 *
 * - 没有 `history()` → `Mod-z` 没反应，写错一个字只能手动改回来；
 * - 没有 `drawSelection()` → **光标根本不可见**（CM6 不调它就只画原生 `caret-color`，
 *   而 live preview 的装饰会盖掉它）；
 * - 没有 `syntaxHighlighting(defaultHighlightStyle, { fallback: true })` → 代码块纯黑。
 *
 * `basicSetup` 也带这些，但本库不依赖它（那会把整套 keymap / 搜索面板 / 折叠
 * 都塞进来）。如果消费方自己用了 `basicSetup`，重复添加 `history()` 是安全的：
 * CM6 的 `historyField` 是 StateField，同一份 field 只生效一次。
 */
export function nexusdown(opts: NexusdownOptions = {}): Extension {
  const { codeLanguages, defaultCodeLanguage, urlPolicy, references } = opts;

  return [
    // ⚠️ 必须用 `base: markdownLanguage`（GFM）。
    //    不要用 `extensions: [...]` —— 那会整体**替换** base，丢掉 GFM，
    //    `~~删除线~~` 就不再被解析了。
    //    `addKeymap: false`：快捷键统一由 `shortcuts.ts` 提供，避免两份 keymap 打架。
    markdown({ base: markdownLanguage, codeLanguages, defaultCodeLanguage, addKeymap: false }),

    nexusdownLivePreview({
      decorators: {
        heading: decorateHeading,
        inline: decorateInline,
        blockquote: decorateBlockquote,
        listItem: decorateListItem,
        fencedCode: decorateFencedCode,
        link: decorateLink,
        block: decorateBlock,
      },
      urlPolicy,
      references,
    }),

    // ---------------------------------------------------------------------
    // 必需基础设施（顺序有意义）
    // ---------------------------------------------------------------------

    // 撤销栈。⚠️ `keymap.of(historyKeymap)` **必须排在 `markdownKeymap` 之前**：
    // 同优先级的 keymap 按 extensions 数组顺序求值，historyKeymap 绑了
    // `Mod-z` / `Mod-y` / `Mod-Shift-z` / `Mod-u` / `Alt-u`，放在后面会被
    // 后出现的绑定抢走。（`shortcuts.ts` 目前只绑 `Mod-b` / `Mod-i` /
    // `Mod-\`` / `Enter`，没有正面冲突，但顺序仍然要保持，防止以后加绑定踩雷。）
    history(),
    keymap.of(historyKeymap),

    // ⚠️ 必须。CM6 默认不画光标 —— 不调 `drawSelection()` 的话 `.cm-cursor`
    //    元素根本不存在，用户看不到插入点。它会用 `Prec.highest` 注入
    //    `.cm-content { caret-color: transparent !important }` 并自绘 `.cm-cursor`，
    //    所以**改光标颜色只能改 `.cm-cursor { border-left-color }`**
    //    （`theme.css` 里已经写死这条约定，颜色变量是 `--nd-caret`）。
    drawSelection(),

    // 当前行高亮：文本模型里没有「节点选中」可依赖，行高亮是唯一的方向感来源。
    // 背景色由 `theme.css` 的 `.cm-activeLine` 接管（变量 `--nd-active-line`）。
    highlightActiveLine(),

    // 代码块的语法着色。⚠️ 用的是**自己的** `codeHighlightStyle`，不是
    // `defaultHighlightStyle` —— 后者给 `tags.heading` 加了 `text-decoration: underline`，
    // 会让每个 Markdown 标题下面凭空多一条下划线（详见上面 `codeHighlightStyle` 的注释）。
    syntaxHighlighting(codeHighlightStyle, { fallback: true }),

    // ---------------------------------------------------------------------
    // 编辑器行为
    // ---------------------------------------------------------------------

    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(true),

    // 代码块的折叠状态（用户点标题栏上的箭头）。
    // 放在这里而不是 plugin 里，是因为它是**文档级**状态，消费方也可能想读它
    // （比如「全部折叠」按钮）。见 `fold.ts`。
    foldedBlocks,

    linkClickHandler,
    markdownKeymap,
    baseTheme,
  ];
}

export { nexusdownLivePreview, type LivePreviewOptions } from './plugin';
export { baseTheme } from './theme';
export { foldedBlocks, toggleFold } from './fold';
/*
 * 代码块标题栏的**纯逻辑**。
 *
 * 导出是因为「同一个标题栏有三个渲染者」：编辑器 widget、`nexusdown/render`
 * 的 fence 规则、以及消费方自己的演示/预览 UI。三者必须长得一样，
 * 所以结构、类名、图标必须来自**同一个函数**，而不是各自手抄。
 */
export {
  codeIconSvg,
  parseFenceInfo,
  renderCodeHeaderHtml,
  type CodeHeaderRenderOptions,
} from './widgets/code-header-parts';
export type {
  DecorationBuild,
  DecorationRanges,
  DecorateFn,
  LinkDecorateFn,
  LinkReferences,
  LivePreviewDecorators,
  MarkdownNode,
  UrlPolicy,
} from './types';
