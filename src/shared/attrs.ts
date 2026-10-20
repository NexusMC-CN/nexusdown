/**
 * 属性行 `{…}` 的**唯一解析/生成入口**（两侧共用）。
 *
 * 契约见 `docs/dialect-extensions.md` §0：`{…}` 是「块的后缀」，
 * 只放**变体/参数**，不放类型（类型留在围栏 info 里）。
 *
 * ```md
 * - 第一步
 * - 第二步
 * {.steps}
 *
 * ```ts {title="a.ts" lines=1-20}
 * ```
 *
 * | 参数 | 类型 |
 * | --- | --- |
 * {.fields caption="配置项"}
 * ```
 *
 * ## 语法
 *
 * | 形态 | 含义 | 例 |
 * | --- | --- | --- |
 * | `.name` | 类 / 变体 | `.steps` `.cards` `.fields` |
 * | `#name` | 锚点 id | `{#eq-1}` |
 * | `key="value"` / `key=value` | 键值参数 | `title="a.ts"` `lines=1-20` |
 * | `name` | 布尔参数 | `full-width` |
 *
 * 一行最多一个 `{…}`；值可以用单/双引号包住空格；**不认嵌套**。
 *
 * ## 为什么解析器要放 `shared/`
 *
 * 编辑器侧（chip 标签、插入菜单）和渲染侧（把属性挂到前一个块）必须用
 * **同一份判定**。两边各写一个正则，必然出现「编辑器显示成 chip、渲染侧不认」
 * 或者反过来 —— 那正是 `dialect-extensions.md` §0.4 要求共用扫描器的原因。
 *
 * ⚠️ 本文件**只做语法**，不判断「这个属性对前一个块是否合法」。
 * 块上下文（列表 / 表格 / 围栏）是编辑器功能与渲染规则各自的事。
 */

/** 渲染侧挂在 token.meta 上的键（编辑器侧不读它）。 */
export const ATTRS_META = 'ndAttrs';

export type AttrToken =
  | { kind: 'class'; name: string }
  | { kind: 'id'; name: string }
  | { kind: 'key'; name: string; value?: string };

const NAME = /^[A-Za-z0-9_-]+$/;

/** 把 `{…}` 里的内容按空白切开，引号内的空白不切。 */
function splitTokens(inner: string): string[] | null {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;

  for (const ch of inner) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (/\s/.test(ch)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
    } else {
      buf += ch;
    }
  }

  if (quote) return null;
  if (buf) out.push(buf);
  return out;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * 解析一行属性。
 *
 * @returns token 数组；**不是**合法属性行时返回 `null`（调用方应当原样当普通文本）。
 */
export function parseAttrLine(text: string): AttrToken[] | null {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed[0] !== '{' || trimmed[trimmed.length - 1] !== '}') return null;

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return null;

  const parts = splitTokens(inner);
  if (!parts || parts.length === 0) return null;

  const tokens: AttrToken[] = [];
  for (const part of parts) {
    if (part.startsWith('.')) {
      const name = part.slice(1);
      if (!NAME.test(name)) return null;
      tokens.push({ kind: 'class', name });
      continue;
    }
    if (part.startsWith('#')) {
      const name = part.slice(1);
      if (!NAME.test(name)) return null;
      tokens.push({ kind: 'id', name });
      continue;
    }

    const eq = part.indexOf('=');
    if (eq === -1) {
      if (!NAME.test(part)) return null;
      tokens.push({ kind: 'key', name: part });
      continue;
    }

    const name = part.slice(0, eq);
    const raw = part.slice(eq + 1);
    if (!NAME.test(name)) return null;
    const value = unquote(raw);
    if (!value) return null;
    tokens.push({ kind: 'key', name, value });
  }

  return tokens.length > 0 ? tokens : null;
}

/** 生成一行属性（与 `parseAttrLine` 互逆，供插入菜单/编辑面板使用）。 */
export function formatAttrLine(tokens: readonly AttrToken[]): string {
  const parts = tokens.map((token) => {
    if (token.kind === 'class') return `.${token.name}`;
    if (token.kind === 'id') return `#${token.name}`;
    if (token.value === undefined) return token.name;
    // 只在必要时加引号（含空白或引号）—— 这样 `lines=1-20` 能逐字往返。
    if (!/[\s"']/.test(token.value)) return `${token.name}=${token.value}`;
    return `${token.name}="${token.value.replace(/"/g, '\\"')}"`;
  });
  return `{${parts.join(' ')}}`;
}

/**
 * chip / 菜单里给人看的标签。
 *
 * 只映射**已知**属性；未知属性回退成原文，保证 chip 永远不会是空白。
 * 多个属性用 ` · ` 连接（`title` + `lines` → `代码标题 · 行号`）。
 */
const CLASS_LABELS: Readonly<Record<string, string>> = {
  steps: '步骤',
  cards: '卡片',
  fields: '参数表',
  gallery: '图集',
  card: '卡片',
  'no-card': '取消卡片',
  'no-carousel': '取消轮播',
  'full-width': '全宽',
};

const KEY_LABELS: Readonly<Record<string, string>> = {
  title: '代码标题',
  lines: '行号',
  highlight: '行高亮',
  caption: '标题',
  tab: '页签',
  label: '编号',
};

export function attrLabel(tokens: readonly AttrToken[], raw?: string): string {
  const labels: string[] = [];
  for (const token of tokens) {
    const label =
      token.kind === 'class'
        ? CLASS_LABELS[token.name]
        : token.kind === 'id'
          ? '锚点'
          : KEY_LABELS[token.name];
    if (label && !labels.includes(label)) labels.push(label);
  }
  if (labels.length > 0) return labels.join(' · ');

  // 未知属性：回退成原文（去掉外层花括号），至少让用户看见自己写了什么。
  // 传了 `raw` 就保留用户原本的引号/空格写法；没传才用 format 重新拼。
  const inner = raw?.trim();
  if (inner && inner.startsWith('{') && inner.endsWith('}')) return inner.slice(1, -1).trim();
  return formatAttrLine(tokens).slice(1, -1);
}


/**
 * 解析行号区间（`highlight="2-3,5"`）。
 *
 * 两侧共用：渲染侧决定给哪些 `<span>` 加高亮类，编辑器侧决定给哪些 `.cm-line`
 * 加 `nd-code-hl`。行号从 1 开始；非法片段直接忽略（不抛）。
 */
export function parseLineRanges(value: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!value) return out;

  for (const part of value.split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!match) continue;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    for (let line = start; line <= end && line <= 10_000; line += 1) out.add(line);
  }
  return out;
}
