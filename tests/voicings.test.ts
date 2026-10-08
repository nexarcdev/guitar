import { describe, expect, it } from 'vitest';
import { STD_SETUP, type Frets } from '../src/theory/music';
import { toVoicing, voicingMidis } from '../src/theory/common';
import { absFrets, enumerateVoicings, grip, playable, toBoard, transitionCost, voicingKey } from '../src/theory/voicings';

const C: Frets = [-1, 3, 2, 0, 1, 0];
const G: Frets = [3, 2, 0, 0, 0, 3];
const F: Frets = [1, 3, 3, 2, 1, 1];
const keys = (list: { frets: Frets; baseFret: number }[]) => list.map((v) => absFrets(v.frets, v.baseFret).join(','));

describe('hand model', () => {
  it('counts fingers, with a barre as one', () => {
    expect(grip(absFrets(C, 1))).toMatchObject({ fingers: 3, barre: null, innerMutes: 0, span: 2, lo: 1 });
    expect(grip(absFrets(F, 1))).toMatchObject({ fingers: 4, barre: { fret: 1, from: 0, to: 5 }, span: 2 });
    expect(grip([-1, 3, 5, 5, 5, 3])).toMatchObject({ fingers: 4, barre: { fret: 3, from: 1, to: 5 } });
    expect(grip([-1, 0, 2, 2, 2, 0]).fingers).toBe(1);
    // D: two notes at the 2nd fret around a 3rd-fret note take two fingers, not a barre.
    expect(grip([-1, -1, 0, 2, 3, 2])).toMatchObject({ fingers: 3, barre: null });
    // D7: fret 2 on two strings around a fret-1 note: three fingers.
    expect(grip([-1, -1, 0, 2, 1, 2])).toMatchObject({ fingers: 3, awkward: false });
    // Small F: the index lies across B and e.
    expect(grip([-1, -1, 3, 2, 1, 1]).fingers).toBe(3);
  });
  it('refuses an open or muted string inside a barre, stretches and inner mutes', () => {
    expect(grip([1, 3, 0, 2, 1, 1]).barre).toBeNull();
    expect(playable([1, 3, 0, 2, 1, 1])).toBe(false);
    // Fret 1 on the low E and on B and e with the A string open: no finger does that.
    expect(playable([1, 0, 3, 0, 1, 1])).toBe(false);
    // A barre cannot leave the string above it open.
    expect(playable([1, 3, 3, 2, 1, 0])).toBe(false);
    expect(playable([-1, 3, 2, 0, 1, 0])).toBe(true);
    expect(playable([1, 3, 3, 5, 1, 1])).toBe(false);
    expect(playable([3, -1, 0, 0, 0, 3])).toBe(false);
    expect(grip([3, -1, 0, 0, 0, 3]).innerMutes).toBe(1);
  });
  it('fits a fingering into five columns, preferring the open position', () => {
    expect(toBoard([-1, 3, 2, 0, 1, 0])).toEqual({ frets: [-1, 3, 2, 0, 1, 0], baseFret: 1 });
    expect(toBoard([8, 10, 10, 9, 8, 8])).toEqual({ frets: [1, 3, 3, 2, 1, 1], baseFret: 8 });
    expect(toBoard([-1, 3, 5, 5, 5, 3])).toEqual({ frets: [-1, 3, 5, 5, 5, 3], baseFret: 1 });
  });
});

describe('voicings', () => {
  it('sounds the right pitches', () => {
    expect(voicingMidis(C, 1, STD_SETUP)).toEqual([48, 52, 55, 60, 64]);
    expect(voicingMidis([1, 3, 3, 2, 1, 1], 8, STD_SETUP)).toEqual([48, 55, 60, 64, 67, 72]);
  });
  it('enumerates the C major fingerings a hand can hold, easiest first', () => {
    const all = enumerateVoicings([0, 4, 7], 0, STD_SETUP);
    const k = keys(all);
    expect(k).toContain('-1,3,2,0,1,0');
    expect(k).toContain('-1,3,5,5,5,3');
    expect(k).toContain('8,10,10,9,8,8');
    expect(k).toContain('-1,3,2,0,1,-1');
    for (const v of all) {
      expect(v.grip.fingers).toBeLessThanOrEqual(4);
      expect(v.grip.span).toBeLessThanOrEqual(3);
      expect(v.grip.innerMutes).toBe(0);
      expect(v.midis[0] % 12).toBe(0);
    }
    expect(new Set(k).size).toBe(k.length);
    expect(all[0].cost).toBeLessThanOrEqual(all[all.length - 1].cost);
  });
  it('spans of four frets are never generated', () => {
    const all = enumerateVoicings([0, 4, 7], 0, STD_SETUP, { bass: null, minStrings: 2 });
    expect(all.every((v) => v.grip.span <= 3)).toBe(true);
  });
  it('allows inversions when asked', () => {
    const inv = enumerateVoicings([0, 4, 7], 0, STD_SETUP, { bass: null });
    expect(keys(inv)).toContain('0,3,2,0,1,0');
    expect(keys(inv)).toContain('3,3,2,0,1,0');
  });
  it('prefers a transition that keeps fingers in place', () => {
    const g = toVoicing(G, 1, STD_SETUP);
    const open = enumerateVoicings([0, 4, 7], 0, STD_SETUP).find((v) => voicingKey(v) === '-1,3,2,0,1,0')!;
    const high = enumerateVoicings([0, 4, 7], 0, STD_SETUP).find((v) => voicingKey(v) === '8,10,10,9,8,8')!;
    expect(transitionCost(g, open)).toBeLessThan(transitionCost(g, high));
    expect(transitionCost(null, open)).toBe(open.cost);
  });
});
