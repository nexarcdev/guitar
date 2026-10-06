import { describe, expect, it } from 'vitest';
import { mergeWindow } from '../src/theory/merge';
import { STD_SETUP } from '../src/theory/music';
import type { TabNote } from '../src/theory/stream';

describe('hybrid merge', () => {
  it('replaces provisional notes inside the window and keeps everything else', () => {
    const buf: TabNote[] = [
      { s: 0, f: 3, t: 0.5, p: true },   // before window: untouched
      { s: 1, f: 3, t: 1.2, p: true },   // inside: replaced
      { s: 2, f: 2, t: 1.5 },            // inside but already confirmed: kept
      { s: 3, f: 0, t: 2.1, p: true },   // after: untouched
    ];
    const r = mergeWindow(buf, 1, 2, [
      { midi: 48, t: 1.2, amp: 0.8 }, { midi: 52, t: 1.21, amp: 0.7 }, { midi: 55, t: 1.22, amp: 0.6 },
      { midi: 48, t: 1.25, amp: 0.3 }, // duplicate onset
    ], STD_SETUP, 3);
    expect(r.buf.filter((n) => n.t >= 1 && n.t < 2 && !n.p).map((n) => [n.s, n.f])).toEqual([[1, 3], [2, 2], [3, 0], [2, 2]]);
    expect(r.buf.some((n) => n.t === 0.5 && n.p)).toBe(true);
    expect(r.buf.some((n) => n.t === 2.1 && n.p)).toBe(true);
    expect(r.chords).toEqual([{ t: 1.2, midis: [48, 52, 55] }]);
  });
});

import { cluster } from '../src/theory/merge';
describe('strum clustering', () => {
  it('keeps a slow 6-string strum together but splits separate hits', () => {
    const strum = [0, 0.018, 0.036, 0.054, 0.072, 0.09].map((t, i) => ({ midi: 40 + i * 5, t, amp: 1 }));
    expect(cluster(strum)).toHaveLength(1);
    expect(cluster([...strum, { midi: 60, t: 0.3, amp: 1 }])).toHaveLength(2);
  });
});
