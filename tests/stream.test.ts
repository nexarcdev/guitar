import { describe, expect, it } from 'vitest';
import { estBeat, layoutLive, spanFor, spanEnd, type TabNote } from '../src/theory/stream';

const seq = (ts: number[]): TabNote[] => ts.map((t) => ({ s: 0, f: 0, t }));

describe('stream layout', () => {
  it('estimates beat from inter-onset intervals', () => {
    expect(estBeat(seq([0, 0.5, 1, 1.5, 2, 2.5]))).toBeCloseTo(0.5);
    expect(estBeat(seq([0, 0.25, 0.5, 0.75, 1, 1.25]))).toBeCloseTo(0.5);
  });
  it('collapses long rests into dividers and never saves across them', () => {
    const notes = seq([0, 0.5, 1, 10, 10.5, 11]);
    const l = layoutLive(notes, 1.8);
    expect(l.divs).toHaveLength(1);
    expect(l.segStart).toBe(3);
    expect(l.pos[3]).toBeCloseTo(1 + 1.8);
    const sp = spanFor(l, 'phrase', spanEnd(l, true, 11.2, 1.8), 2)!;
    expect(sp.idx).toEqual([3, 4, 5]);
    const two = spanFor(l, 8, spanEnd(l, true, 11.2, 1.8), 2)!;
    expect(two.idx).toEqual([3, 4, 5]);
  });
});
