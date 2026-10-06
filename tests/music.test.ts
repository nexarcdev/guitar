import { describe, expect, it } from 'vitest';
import { identifyMidi, identifyShape, openStrings, PRESETS, shapeFor, STD_SETUP, tuningName, setupStr, stringLabel, type Setup } from '../src/theory/music';
import { finger } from '../src/theory/fingering';

describe('music', () => {
  it('names open strings in standard and drop D', () => {
    expect(openStrings(STD_SETUP.offsets).map((s) => s.note).join(' ')).toBe('E A D G B E');
    expect(openStrings([-2, 0, 0, 0, 0, 0]).map((s) => s.note)[0]).toBe('D');
    expect(openStrings([-1, -1, -1, -1, -1, -1]).map((s) => s.note).join(' ')).toBe('Eb Ab Db Gb Bb Eb');
  });
  it('labels the high string lowercase', () => {
    expect(stringLabel('E', 5)).toBe('e');
    expect(stringLabel('E', 0)).toBe('E');
  });
  it('identifies preset shapes', () => {
    expect(identifyShape(PRESETS.C, 1, STD_SETUP).name).toBe('C');
    expect(identifyShape(PRESETS.Am, 1, STD_SETUP).name).toBe('Am');
    expect(identifyShape(PRESETS.Cmaj7, 1, STD_SETUP).name).toBe('Cmaj7');
    expect(identifyShape(PRESETS.E7, 1, STD_SETUP).name).toBe('E7');
  });
  it('transposes with capo and tuning', () => {
    const capo2: Setup = { offsets: STD_SETUP.offsets, capo: 2 };
    expect(identifyShape(PRESETS.G, 1, capo2).name).toBe('A');
    expect(shapeFor('A', capo2)).toEqual(PRESETS.G);
    expect(setupStr({ offsets: [-2, 0, 0, 0, 0, 0], capo: 2 })).toBe('Drop D · Capo 2');
    expect(tuningName([1, 0, 0, 0, 0, 0])).toBe('Custom');
  });
  it('names slash chords from the bass note', () => {
    // C/E: E2 C3 E3 G3
    expect(identifyMidi([40, 48, 52, 55], STD_SETUP.offsets).name).toBe('C/E');
    expect(identifyMidi([48, 52, 55], STD_SETUP.offsets).name).toBe('C');
  });
});

describe('fingering', () => {
  it('places an open C triad the way players do', () => {
    const r = finger([48, 52, 55], STD_SETUP, 3);
    expect(r.placed.map((p) => [p.s, p.f])).toEqual([[1, 3], [2, 2], [3, 0]]);
  });
  it('keeps single notes near the hand', () => {
    // A3 (57): 5th fret low E... no, 57-40=17 out of range; options are A string 12, D 7, G 2
    expect(finger([57], STD_SETUP, 7).placed[0]).toMatchObject({ s: 2, f: 7 });
    expect(finger([57], STD_SETUP, 2).placed[0]).toMatchObject({ s: 3, f: 2 });
  });
  it('counts frets from the capo and drops unplayable notes', () => {
    const capo: Setup = { offsets: STD_SETUP.offsets, capo: 3 };
    expect(finger([43], capo).placed[0]).toMatchObject({ s: 0, f: 0 });
    expect(finger([30], STD_SETUP).placed).toEqual([]);
  });
});

import { chordFromChroma } from '../src/theory/music';
describe('chordFromChroma', () => {
  const v = (pcs: Record<number, number>) => Array.from({ length: 12 }, (_, i) => pcs[i] ?? 0.05);
  it('prefers the plain triad when extensions are weak', () => {
    expect(chordFromChroma(v({ 7: 1, 11: 0.7, 2: 0.8 }), null, STD_SETUP.offsets)?.name).toBe('G');
    expect(chordFromChroma(v({ 4: 1, 7: 0.6, 11: 0.8 }), null, STD_SETUP.offsets)?.name).toBe('Em');
    expect(chordFromChroma(v({ 2: 1, 6: 0.5, 9: 0.9, 0: 0.12 }), null, STD_SETUP.offsets)?.name).toBe('D');
  });
  it('names a real seventh and returns null for noise', () => {
    expect(chordFromChroma(v({ 2: 1, 6: 0.6, 9: 0.8, 0: 0.7 }), null, STD_SETUP.offsets)?.name).toBe('D7');
    expect(chordFromChroma(Array(12).fill(0.5), null, STD_SETUP.offsets)).toBeNull();
  });
});

import { confirmFrame } from '../src/theory/confirm';
import { NO_PITCH } from '../src/dsp/chroma';
describe('chord confirm (levels measured on a real guitar)', () => {
  const C: [number, number, number, number, number, number] = [-1, 3, 2, 0, 1, 0];
  const pitch = (lv: Record<number, number>) => {
    const p = new Float32Array(128).fill(NO_PITCH);
    for (const [m, d] of Object.entries(lv)) p[+m] = d;
    return p;
  };
  const run = (lv: Record<number, number> | null) =>
    confirmFrame({ frets: C, baseFret: 1, setup: STD_SETUP, pitch: lv ? pitch(lv) : null, mlRecent: [], clock: 0 });
  it('hears every string of the shape', () => {
    const f = run({ 48: -2, 52: -6, 55: 0, 60: -9, 64: -15 });
    expect(f.heard.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(f.wrong).toEqual([]);
  });
  it('flags the muted low E when it was actually struck', () => {
    expect(run({ 40: -3, 48: -2, 52: -6, 55: 0, 60: -9, 64: -15 }).wrong).toEqual([0]);
  });
  it('ignores sympathetic ringing of the muted string', () => {
    expect(run({ 40: -14, 48: -2, 52: -6, 55: 0, 60: -9, 64: -15 }).wrong).toEqual([]);
  });
  it('hears nothing in silence', () => {
    expect(run(null).heard).toEqual([]);
  });
});
