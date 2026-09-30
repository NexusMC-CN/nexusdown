import { EditorView } from '@codemirror/view';

import { MARK_CLASS } from './decorate/shared';

/**
 * **结构性**主题（不是视觉主题）。
 *
 * 这里只放「机制不成立就会坏」的规则；颜色、间距、圆角、字体大小这些视觉部分
 * 全在 `theme.css` 里，消费方可以整个覆盖掉而不影响功能。
 */
export const baseTheme = EditorView.baseTheme({
  '&': {
    // 揭示态标记的默认淡化程度。消费方覆盖这个变量即可调深浅，
    // 不需要知道 `.nd-mark` 是怎么来的。
    '--nd-mark-opacity': '0.35',
  },

  // ★ 机制性规则：`.nd-mark` 必须把从 `.nd-strong` / `.nd-em` / `.nd-strike`
  //   继承来的样式**中和掉**，否则 `**bold**` 在揭示态下两个 `**` 会被渲染成粗体。
  //   这条规则是「一个样式 mark 覆盖整个节点（含标记）+ 标记再单独变淡」
  //   这个手法成立的前提 —— 少了它，就得为「标记」和「内容」切两段 mark。
  [`.${MARK_CLASS}`]: {
    fontWeight: 'normal',
    fontStyle: 'normal',
    textDecorationLine: 'none',
    opacity: 'var(--nd-mark-opacity)',
  },
});
