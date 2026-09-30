import { Decoration } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import {
  HIDE,
  MARK_CLASS,
  MUTED_MARK,
  pushAtomicRange,
  pushRevealableMark,
} from '../../src/cm/decorate/shared';
import type { DecorationRanges } from '../../src/cm/types';

function buckets(): [DecorationRanges, DecorationRanges] {
  return [[], []];
}

describe('decorate/shared', () => {
  it('HIDE / MUTED_MARK 是模块级单例（RangeSet 的等值比较依赖对象标识）', async () => {
    const first = await import('../../src/cm/decorate/shared');
    const second = await import('../../src/cm/decorate/shared');

    expect(first.HIDE).toBe(second.HIDE);
    expect(first.MUTED_MARK).toBe(second.MUTED_MARK);
    expect(HIDE).toBe(first.HIDE);
    expect(MUTED_MARK).toBe(first.MUTED_MARK);
  });

  it('MUTED_MARK 的 class 是 .nd-mark', () => {
    expect(MARK_CLASS).toBe('nd-mark');
    expect(MUTED_MARK.spec.class).toBe('nd-mark');
  });

  it('HIDE 是不带 widget 的 replace（纯隐藏）', () => {
    expect(HIDE.spec).toEqual({});
    expect(HIDE.spec.widget).toBeUndefined();
    // replace 与 mark 的 side 不同：同一位置上 replace 排在 mark 前面
    expect(HIDE.startSide).toBeLessThan(MUTED_MARK.startSide);
  });

  it('★ 揭示态：只推 MUTED_MARK，**绝不**推 atomicRanges', () => {
    const [ranges, atomicRanges] = buckets();

    pushRevealableMark(ranges, atomicRanges, true, 5, 7);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].value).toBe(MUTED_MARK);
    expect(ranges[0].from).toBe(5);
    expect(ranges[0].to).toBe(7);

    // 揭示态的 `**` 必须留在文本流里，光标才能一个字符一个字符走进去。
    expect(atomicRanges).toHaveLength(0);
  });

  it('★ 非揭示态：推 HIDE，并且 ranges / atomicRanges 各一份', () => {
    const [ranges, atomicRanges] = buckets();

    pushRevealableMark(ranges, atomicRanges, false, 5, 7);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].value).toBe(HIDE);
    expect(ranges[0].from).toBe(5);
    expect(ranges[0].to).toBe(7);

    expect(atomicRanges).toHaveLength(1);
    expect(atomicRanges[0].value).toBe(HIDE);
    expect(atomicRanges[0].from).toBe(5);
    expect(atomicRanges[0].to).toBe(7);
  });

  it('pushAtomicRange 两个桶都推，且是同一个 decoration', () => {
    const [ranges, atomicRanges] = buckets();
    const decoration = Decoration.replace({});

    pushAtomicRange(ranges, atomicRanges, decoration, 1, 4);

    expect(ranges).toHaveLength(1);
    expect(atomicRanges).toHaveLength(1);
    expect(ranges[0].value).toBe(decoration);
    expect(atomicRanges[0].value).toBe(decoration);
    expect([ranges[0].from, ranges[0].to]).toEqual([1, 4]);
    expect([atomicRanges[0].from, atomicRanges[0].to]).toEqual([1, 4]);
  });

  it('两种状态可以混在同一个桶里，并且能直接喂给 Decoration.set', () => {
    const [ranges, atomicRanges] = buckets();

    pushRevealableMark(ranges, atomicRanges, true, 0, 2); // 揭示：`**`
    pushRevealableMark(ranges, atomicRanges, false, 6, 8); // 隐藏：`**`

    const set = Decoration.set(ranges, true);
    const atomicSet = Decoration.set(atomicRanges, true);

    expect(set.size).toBe(2);
    expect(atomicSet.size).toBe(1);
    // 隐藏的那一段才是原子区间
    expect(atomicSet.iter().value).toBe(HIDE);
  });
});
