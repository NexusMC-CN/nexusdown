# CodeMirror 6 Live Preview —— 实现参考

这份文档是**从 silkdown（magarcia/silkdown）提取的实现参考**，用于把 nexusdown 的编辑引擎
从 Tiptap（节点树）换成 CodeMirror 6（文本 + 装饰）。

⚠️ **silkdown 只作参考，不作依赖** —— 它 v0.1.0、0 star、npm 未发布。
它的价值在于**主干写得极干净**：`plugin.ts`(172) + `shared.ts`(41) + `selection.ts`(33) = **246 行**。
其余 900 行是按元素展开的样板。

⚠️ **下面标了「silkdown 的坑」的地方，是它做错了、我们不要照抄的。**

---

## 0. 架构总览

```
文本（真相）  ──►  lezer 解析器（@codemirror/lang-markdown）
                      │
                      ▼
              语法树（每次重建时遍历）
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
   decorations                 atomicDecorations
   （所有装饰）                  （只有隐藏态）
        │                           │
        ▼                           ▼
   ViewPlugin.decorations    EditorView.atomicRanges
```

**核心二分**：`decorations` 含所有装饰，`atomicDecorations` **只含隐藏态的 replace**。
两者必须分开 —— 把 `decorations` 直接当 atomicRanges，揭示态的标记也会被当成原子块，
光标就没法一个字符一个字符走进 `**` 里。

---

## 1. 行级揭示谓词（`selection.ts`，33 行）

**这是全项目信噪比最高的 20 行。**

```ts
/**
 * Obsidian 式的行级揭示判定：任一选区与 [from, to] 有共同行 → 揭示。
 *
 * 为什么用行区间而不是 lineAt(head)：
 *   - 多行选区必须揭示被跨越的行里的节点
 *   - 多行节点（围栏代码块）在任意一行上都该揭示
 *
 * 为什么遍历 selection.ranges 而不是 selection.main：
 *   - CM6 支持多光标，每个光标独立触发揭示
 */
export function selectionTouchesLineRange(
  doc: Text,
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  // CM6 的节点 `to` 是**排他**的。如果 `to` 正好落在下一行行首，
  // 不减 1 就会把 end-line 算多一行 —— 表现为"光标在下一行时，上一行的标记也被揭示"。
  const safeTo = to > from ? Math.max(from, to - 1) : to;
  const nodeStartLine = doc.lineAt(from).number;
  const nodeEndLine = doc.lineAt(safeTo).number;

  for (const range of selection.ranges) {
    const selStartLine = doc.lineAt(range.from).number;
    const selEndLine = doc.lineAt(range.to).number;
    if (selStartLine <= nodeEndLine && nodeStartLine <= selEndLine) return true;
  }
  return false;
}
```

**`safeTo` 那个 off-by-one 必须抄。** 这是最容易漏、又最容易被当成"玄学 bug"的细节。

---

## 2. 三件套（`shared.ts`，41 行）

```ts
/**
 * 共享的空 `Decoration.replace`。**必须是模块级单例** ——
 * RangeSet 里的等值比较依赖对象标识，每次 new 一个空 replace
 * 会让 CM 的 diff 无法复用 DOM。
 */
export const HIDE = Decoration.replace({});

/** 揭示态的标记（`**`、`*`、`` ` ``、`# `、`> `）：变淡，并中和继承来的粗体/斜体 */
export const MUTED_MARK = Decoration.mark({ class: 'nd-mark' });

export function pushAtomicRange(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  decoration: Decoration,
  from: number,
  to: number,
): void {
  ranges.push(decoration.range(from, to));
  atomicRanges.push(decoration.range(from, to));
}

export function pushRevealableMark(
  ranges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  revealed: boolean,
  from: number,
  to: number,
): void {
  if (revealed) {
    ranges.push(MUTED_MARK.range(from, to));
  } else {
    pushAtomicRange(ranges, atomicRanges, HIDE, from, to);
  }
}
```

**关键手法**：样式 mark **覆盖整个节点（含标记）**，然后用 `.nd-mark` 在揭示态把标记的
继承样式中和掉：

```css
.nd-mark {
  opacity: var(--nd-mark-opacity);
  font-weight: normal;
  font-style: normal;
}
```

这样 `**bold**` 在揭示态下，`**` 虽落在 `.nd-strong` 区间内，却被 `.nd-mark` 的
`font-weight: normal` 压回去。**不用为"标记"和"内容"切两段 mark**，省掉一大堆边界计算。

---

## 3. ViewPlugin 骨架（`plugin.ts`）

```ts
export function nexusdownLivePreview(opts = {}): Extension {
  return ViewPlugin.fromClass(
    class implements PluginValue {
      decorations: DecorationSet;
      atomicDecorations: DecorationSet;
      private wasComposing = false;   // ★ 见下方「silkdown 的坑 ①」

      constructor(view: EditorView) {
        const built = this.build(view);
        this.decorations = built.decorations;
        this.atomicDecorations = built.atomicDecorations;
      }

      update(u: ViewUpdate) {
        // IME 门控：组合期间绝不重建装饰 —— IME 依赖稳定的 DOM，否则会丢字。
        const composing = u.view.composing;
        if (composing) {
          this.wasComposing = true;
          return;
        }
        const justEndedComposing = this.wasComposing;
        this.wasComposing = false;

        if (
          justEndedComposing ||           // ★ silkdown 没有这一条
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        ) {
          const built = this.build(u.view);
          this.decorations = built.decorations;
          this.atomicDecorations = built.atomicDecorations;
        }
      }

      build(view: EditorView) {
        const ranges: Range<Decoration>[] = [];
        const atomicRanges: Range<Decoration>[] = [];
        const tree = syntaxTree(view.state);
        const sel = view.state.selection;
        const doc = view.state.doc;

        for (const { from, to } of view.visibleRanges) {   // 只走可见区
          tree.iterate({
            from,
            to,
            enter: (n) => {
              if (HEADING_NODES.has(n.name)) { decorateHeading(...); return false; }
              if (INLINE_NODES.has(n.name)) { decorateInline(...); /* 不 return，为了嵌套 */ }
              if (n.name === 'Blockquote') decorateBlockquote(...);
              if (n.name === 'ListItem') decorateListItem(...);
              if (n.name === 'Link') { decorateLink(...); return false; }
              // ...
              if (n.name === 'FencedCode') { decorateFencedCode(...); /* 不 return，让高亮 tag 落进去 */ }
            },
          });
        }

        return {
          decorations: Decoration.set(ranges, true),          // true = 自动排序
          atomicDecorations: Decoration.set(atomicRanges, true),
        };
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomicDecorations ?? Decoration.none),
    },
  );
}
```

### 三个要点

1. **`Decoration.set(ranges, true)`** 而不是 `RangeSetBuilder`。
   `true` = 自动排序，绕开"必须单调递增"的约束。性能略差（要排序），但**不会崩**。
   先用它保正确性，profile 出问题再换 builder。

2. **`enter` 返回 `false` = 不再下降**。
   - `return false`：heading、Link、Image、HorizontalRule（自己管完了）
   - **不 return**：`INLINE_NODES`（为了嵌套 `***`）、Blockquote、ListItem、**FencedCode**
   - `FencedCode` 不 return 的原因：**要让 lezer overlay 的高亮 tag 落进去**

3. **`provide` 必须给 `atomicDecorations` 这个独立集合**，不是 `decorations`。

---

## 4. 各元素的处理

### 4.1 标题 —— 用 `Decoration.line`，不是 `mark`

```ts
const LINE_CLASSES = {
  1: Decoration.line({ class: 'nd-h1' }),
  // ... 2-6
};

export function decorateHeading(ranges, atomicRanges, node, doc, sel) {
  const level = Number.parseInt(node.name.slice(-1), 10);
  const line = doc.lineAt(node.from);
  ranges.push(LINE_CLASSES[level].range(line.from));

  const headerMark = node.firstChild;
  if (headerMark?.name !== 'HeaderMark') return;
  const markTo = Math.min(headerMark.to + 1, node.to);   // 连后面的空格一起藏
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  pushRevealableMark(ranges, atomicRanges, revealed, headerMark.from, markTo);

  // ★ silkdown 的坑 ②：它这里 `return false`，导致标题里的 `**粗体**` 不会被处理。
  //   我们应该**继续下降**（不 return），但要注意别重复处理 HeaderMark。
}
```

**放大方式必须是 `Decoration.line`** —— `Decoration.mark` 只包文字，改不了行高/外边距。

⚠️ **silkdown 的坑 ②**：它对 `ATXHeading*` 提前 `return false`，所以
`# 这是 **粗体** 标题` 里的 `**` **原样露出**。我们要**继续下降**。

### 4.2 行内标记（含嵌套 `***`）

```ts
const STYLES = {
  StrongEmphasis: Decoration.mark({ class: 'nd-strong' }),
  Emphasis: Decoration.mark({ class: 'nd-em' }),
  InlineCode: Decoration.mark({ class: 'nd-code' }),
  Strikethrough: Decoration.mark({ class: 'nd-strike' }),
};
const MARKER_NODES = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark']);

export function decorateInline(ranges, atomicRanges, node, doc, sel) {
  const styling = STYLES[node.name];
  ranges.push(styling.range(node.from, node.to));

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  // ★ silkdown 的坑 ③：它在这里额外做了
  //     if (!revealed) atomicRanges.push(styling.range(node.from, node.to));
  //   把**整个 `**bold**`（含内容）**注册成原子区间 → 非活动行上光标跨不过词中间。
  //   而 pushRevealableMark 已经给每个 marker 注册了 atomic，这三行是**冗余且过度**的。
  //   我们**不要**照抄。

  for (const child of children(node)) {
    if (!MARKER_NODES.has(child.name)) continue;
    pushRevealableMark(ranges, atomicRanges, revealed, child.from, child.to);
  }
}
```

**嵌套 `***粗斜体***`**（@lezer/markdown 1.7.2 实测，⚠️ **不是"两层区间完全相同"**）：

```
***粗斜体***   (9 字符)
Emphasis         [0,9)   ← 外层，把首尾那两个单 * 也算进自己的区间
  EmphasisMark   [0,1)  "*"
  StrongEmphasis [1,8)   ← 内层
    EmphasisMark [1,3)  "**"
    EmphasisMark [6,8)  "**"
  EmphasisMark   [8,9)  "*"
```

**`Emphasis [0,9)` 包住 `StrongEmphasis [1,8)`，区间不同。** 代码侧不需要任何特判：
`plugin.ts` 对 inline **不 return false**，两层各调一次 `decorateInline`，各推一个 mark
覆盖自己的区间，两个 class 落在重叠的 DOM 上自然叠加。

4 个定界符 `[0,1) [1,3) [6,8) [8,9)` 全被藏掉，中间 `[3,6)` 正好是正文。

### 4.3 引用块

```ts
const LINE_CLASS = Decoration.line({ class: 'nd-blockquote' });

export function decorateBlockquote(ranges, atomicRanges, node, doc, sel) {
  // 整块**每一行**都推一个 line 装饰，否则 border-left 只覆盖一行
  let pos = node.from;
  while (pos <= node.to) {
    const line = doc.lineAt(pos);
    ranges.push(LINE_CLASS.range(line.from));
    if (line.to >= node.to) break;
    pos = line.to + 1;
  }

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  for (const quoteMark of collectQuoteMarks(node, [])) {
    // `> ` 的尾随空格一起藏；但要处理没有空格的情况（`>tight`）
    const next = doc.sliceString(quoteMark.to, quoteMark.to + 1);
    const markTo = next === ' ' ? quoteMark.to + 1 : quoteMark.to;
    pushRevealableMark(ranges, atomicRanges, revealed, quoteMark.from, markTo);
  }
}

/**
 * 收集**本层**引用块自己的 `QuoteMark`。
 *
 * ⚠️ **不能只看直接子节点**（silkdown 的写法，是个真 bug）：
 * lezer 把续行的 `>` 塞进了 `Paragraph` 里 ——
 *
 *     > a\n> b
 *     Blockquote [0,7)
 *       QuoteMark [0,1)      ← 第一行的 >
 *       Paragraph [2,7) "a\n> b"
 *         QuoteMark [4,5)    ← 第二行的 >，**不是 Blockquote 的直接子节点**
 *
 * 只扫直接子节点的话，**多行引用只有第一行的 `>` 被藏掉**。
 *
 * 遇到嵌套 `Blockquote` 要**剪枝**：`> > 文字` 里内层的 `>` 由内层自己那次
 * 调用处理，否则同一区间会被推两次。
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
```

左边线用 `Decoration.line` + CSS `border-left`。

⚠️ **silkdown 的坑**：嵌套引用（`> > 文字`）会给同一行推两次同一个 class，
CSS 只算一次 → **嵌套没有视觉层级**。想修要按嵌套深度生成 `nd-bq-1` / `nd-bq-2`。

### 4.4 列表

**silkdown 只做了两件事**：给 `ListItem` 首行加 class（而那个 class 在它的 theme 里**根本没定义**）、
把 `TaskMarker` 替换成复选框。**`-` 没有被藏掉，也没换成 `•`。**

这对我们是好消息：**证明了"列表符号替换成 `•`"是可以完全不做的一步**，`-` 保持可见也不会崩。
但要做 Typora 级体验，这块得自己补。

### 4.5 代码块

**既不是 WidgetType 也不是 mark —— 高亮完全交给 lezer overlay，装饰只负责"藏围栏 + 加背景"。**

```ts
export function decorateFencedCode(ranges, atomicRanges, node, doc, sel) {
  // 1. 按行加背景（first/last 只圆外角）
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);
  for (let n = startLine.number; n <= endLine.number; n++) {
    ranges.push(pickLineDeco(n, startLine.number, endLine.number).range(doc.line(n).from));
  }

  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);
  if (revealed) return;

  // 2. 藏围栏 —— **按行藏，永远不跨行**
  const openMark = firstChildNamed(node, 'CodeMark');
  if (openMark) {
    const openLine = doc.lineAt(openMark.from);
    pushAtomicRange(ranges, atomicRanges, HIDE, openLine.from, openLine.to);
  }
  // 同样处理 closeMark
}
```

⚠️ **`Decoration.replace` 不能跨行** —— 所以藏围栏时**按整行切**，不 replace 整个 node。

⚠️ **`FencedCode` 在 `plugin.ts` 里不能 `return false`** —— 否则 lezer overlay 的
高亮 tag 落不进去，代码块没有语法高亮。

⚠️ **不要用 `block: true` 的 replace widget** —— 方向键**永远进不去**。

### 4.6 链接（`link.ts`，262 行，最复杂）

```ts
export function decorateLink(ranges, atomicRanges, node, doc, sel, references, urlPolicy) {
  const parts = parseLink(node, doc, references);   // 解析出 [ ] ( ) 的坐标
  if (!parts) return;

  const safe = urlPolicy(parts.url);
  const revealed = selectionTouchesLineRange(doc, sel, node.from, node.to);

  if (revealed) {
    muteLinkSyntax(ranges, parts);   // 揭示态：**变灰，不是隐藏**
    if (safe && parts.textFrom < parts.textTo) {
      ranges.push(linkMark(safe).range(parts.textFrom, parts.textTo));
    }
    return;
  }

  // 非揭示态：把 `[` 和 `](url)` 两段分别 HIDE
  if (parts.textFrom > node.from) {
    pushAtomicRange(ranges, atomicRanges, HIDE, node.from, parts.textFrom);
  }
  if (safe && parts.textFrom < parts.textTo) {
    ranges.push(linkMark(safe).range(parts.textFrom, parts.textTo));
  }
  if (parts.textTo < node.to) {
    pushAtomicRange(ranges, atomicRanges, HIDE, parts.textTo, node.to);
  }
}
```

**链接点击：不用 widget，用 mark + `data-href` + 全局 click handler。**

```ts
function linkMark(href: string) {
  return Decoration.mark({ class: 'nd-link', attributes: { 'data-href': href } });
}

export const linkClickHandler = EditorView.domEventHandlers({
  click(event) {
    if (!(event.metaKey || event.ctrlKey)) return false;   // ★ 只有 Cmd/Ctrl 才跳转
    const link = event.target instanceof Element ? event.target.closest('[data-href]') : null;
    const href = link?.getAttribute('data-href');
    if (!href) return false;
    window.open(href, '_blank', 'noopener,noreferrer');
    event.preventDefault();
    return true;
  },
});
```

**这个设计很值得抄**：链接文字保持**真实可编辑文本**（不是 widget），
点击只在 `Cmd/Ctrl` 下才打开 URL，否则交还给 CM 做光标定位。
"点一下想改字"和"点一下想跳转"不会打架。

### 4.7 URL 白名单（`url.ts`，35 行）

**白名单 + 默认拒绝**：`http(s)://`、`data:image/*`、**无 scheme 的相对路径**。
协议相对 URL（`//evil.com`）显式拒绝，其余带 scheme 的一律拒绝。

⚠️ **`mailto:` 会被拒**（silkdown 明确测了这点）。要做邮件链接得自己传 policy。

签名是 `(url) => string | null`，**可以返回改写后的字符串**，比返回 boolean 更好用。

### 4.8 图片（WidgetType）

```ts
export class ImageWidget extends WidgetType {
  constructor(private src: string, private alt: string) { super(); }

  // ★ 必须实现 eq()，否则每次 rebuild 都重建 DOM → 图片闪、重新发请求
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  override toDOM(): HTMLElement {
    const img = document.createElement('img');
    img.className = 'nd-image-widget';
    img.src = this.src;
    img.alt = this.alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  override ignoreEvent(): boolean { return false; }   // 让 CM 接管 → 点击落到光标定位
}
```

### 4.9 任务列表复选框（可交互 widget）

**四个动作缺一不可**：

```ts
export class TaskCheckboxWidget extends WidgetType {
  constructor(private checked: boolean, private from: number, private to: number) { super(); }

  override eq(o: TaskCheckboxWidget): boolean {
    return o.checked === this.checked && o.from === this.from && o.to === this.to;
  }

  override toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;

    // ① 阻止 input 抢焦点、阻止 CM 把光标挪走
    //    （否则点复选框会让整行变 active、widget 被揭示态覆盖）
    input.addEventListener('mousedown', (e) => e.preventDefault());

    // ② 用构造时存下的坐标精确 dispatch，不需要反查选区
    input.addEventListener('change', () => {
      view.dispatch({ changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' } });
    });
    return input;
  }

  // ③ 白名单放行 mousedown/click，其余交给 CM。**反着写就点不动。**
  override ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown' && event.type !== 'click';
  }
}
```

⚠️ **复选框要"永远渲染"**（不检查 `revealed`）—— 它本身就是编辑入口，
和"标记揭示"的规则是**故意背离**的。

---

## 5. 已知的坑（silkdown 的代码事实 + 我们的改进）

| # | silkdown 的做法 | 问题 | 我们要怎么做 |
|---|---|---|---|
| ① | `if (view.composing) return` | **没有边沿检测** —— 组合结束后装饰可能滞后，靠后续事件兜底。作者自己承认这个分支**无法自动化测试** | 加 `wasComposing` 状态，在 true→false 的边沿**强制重建一次** |
| ② | heading 提前 `return false` | **标题里的嵌套 inline 全废**（`# 这是 **粗体**` 露出星号） | 处理完标记后**继续下降** |
| ③ | `inline.ts` 把整个节点注册成 atomic | 非活动行上**光标跨不过词中间**（Obsidian 是可以的） | 删掉那三行，只让 `pushRevealableMark` 注册 marker |
| ④ | `buildLinkReferences` 每次全量遍历树 | 大文档性能热点（它自己的文档还警告过别这么干） | 做成 `StateField`，只在 `docChanged` 时重算 |
| ⑤ | 嵌套引用块视觉无层级 | `> > 文字` 和 `> 文字` 左边线一样 | 按嵌套深度生成 `nd-bq-1` / `nd-bq-2` |
| ⑥ | 无条件吃掉 `HeaderMark` 后一个字符 | `#  三空格  标题` 隐藏后残留两个空格 | 向后扫到第一个非空格字符 |
| ⑦ | `silkdown()` 自带 `history()` | 库不该替消费方决定要不要 history；和 `basicSetup` 重复 | **不要把 `history()` 放进默认扩展** |
| ⑧ | 文档与代码多处不一致 | `architecture.md` 的文件树是错的、行号过期 | 以代码为准 |

### 其他必须知道的约束

- **`Decoration.replace` 不能跨行、不能部分重叠** —— 所以 URL、`(url)`、围栏都要**按行切**或算准区间
- **`block: true` 的 replace 区间，方向键永远进不去** —— 所以**完全不做 block widget**
- **`@codemirror/*` 和 `@lezer/*` 必须放 peerDependencies 并 external** ——
  两份 `@codemirror/state` 会让 facet **静默失配**、装饰不渲染
- **IME 门控无法用 Playwright 覆盖** —— 合成 `CompositionEvent` 不会翻转 `view.composing`。
  **只能人工 CJK 冒烟**：光标放进 `****` 中间（offset 2）→ 用拼音打 `你好` → 确认变成 `**你好**` 且没丢字
- **只走 `view.visibleRanges`**，不要全量遍历

---

## 6. 装配（`index.ts`）

```ts
export function nexusdown(opts = {}): Extension {
  const { codeLanguages = languages, ...pluginOpts } = opts;
  return [
    // ⚠️ `base: markdownLanguage`（GFM）。**不要用 `extensions: [...]`** ——
    //    那会整体替换 base，丢掉 GFM（`~~删除线~~` 不再被解析）。
    markdown({ base: markdownLanguage, codeLanguages, addKeymap: false }),
    nexusdownLivePreview(pluginOpts),
    // ★ 不要放 history() —— 交给消费方决定（见坑 ⑦）
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(true),
    linkClickHandler,
    markdownKeymap,
    baseTheme,
  ];
}
```

---

## 7. 快捷键（`shortcuts.ts`）

- **`Mod-B` / `Mod-I` / `` Mod-` ``**：切换行内标记。无选中时扩展到光标词；
  空白处插入成对标记并把光标居中；包裹/解包是**独立撤销步骤**
- **列表内回车**：用 `insertNewlineContinueMarkup` 继续标记
- **撤销粒度**：dispatch 时带 `userEvent: 'format.nexusdown'` —— CM6 的 history
  按 `userEvent` 前缀分组，`format.*` 和 `input.*` 分开成独立 undo step
- **多光标安全**：用 `state.changeByRange(...)` 而不是 `view.dispatch({ changes })` 一把梭
