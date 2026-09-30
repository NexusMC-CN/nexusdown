import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';

/**
 * 拿到稳定的 `SyntaxNode`。
 *
 * `tree.iterate` 的 `enter` 给的是 `SyntaxNodeRef`（TreeCursor 的只读视图），
 * 它没有 `firstChild` / `nextSibling`。`SyntaxNodeRef.node` 会给出稳定的 `SyntaxNode`；
 * 对 `SyntaxNode` 自身它返回 `this`，所以两种入参都能吃。
 */
function stable(node: SyntaxNodeRef): SyntaxNode {
  return node.node;
}

/** 直接子节点（按文档顺序）。 */
export function children(node: SyntaxNodeRef): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let child = stable(node).firstChild; child; child = child.nextSibling) {
    out.push(child);
  }
  return out;
}

/** 第一个名字匹配的直接子节点。 */
export function firstChildNamed(node: SyntaxNodeRef, name: string): SyntaxNode | null {
  for (let child = stable(node).firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child;
  }
  return null;
}

/** 最后一个名字匹配的直接子节点（围栏代码块的闭合 `CodeMark`）。 */
export function lastChildNamed(node: SyntaxNodeRef, name: string): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  for (let child = stable(node).firstChild; child; child = child.nextSibling) {
    if (child.name === name) found = child;
  }
  return found;
}
