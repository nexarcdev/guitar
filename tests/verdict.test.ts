import { describe, expect, it } from 'vitest';
import { STD_SETUP, type Frets } from '../src/theory/music';
import { toVoicing } from '../src/theory/common';
import { judge, stringName } from '../src/theory/verdict';

const C: Frets = [-1, 3, 2, 0, 1, 0];
const Am: Frets = [-1, 0, 2, 2, 1, 0];
const D: Frets = [-1, -1, 0, 2, 3, 2];
const E: Frets = [0, 2, 2, 1, 0, 0];
const v = (f: Frets, base = 1) => toVoicing(f, base, STD_SETUP);
const peaks = (...m: number[]) => new Set(m);

describe('verdict', () => {
  it('names strings for fixes', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => stringName(i, STD_SETUP))).toEqual(['low E', 'A', 'D', 'G', 'B', 'high e']);
  });

  it('exact: every target pitch sounded and nothing else', () => {
    const r = judge(v(C), [48, 52, 55, 60, 64], peaks(48, 52, 55, 60, 64, 67, 72), STD_SETUP);
    expect(r.status).toBe('exact');
    expect(r.strings).toEqual(['none', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(r.fixes).toEqual([]);
    expect(r.strayNotes).toEqual([]);
  });

  it('octave-coincident strings count when their pitch is in the spectrum', () => {
    // The core attributed C4 and E4 to C3 and E3; the chord asks for them and they sound.
    const r = judge(v(C), [48, 52, 55], peaks(48, 52, 55, 60, 64, 67), STD_SETUP);
    expect(r.status).toBe('exact');
    expect(r.missing).toEqual([]);
  });

  it('a muted string ringing: red nut and a fix', () => {
    const r = judge(v(Am), [40, 45, 52, 57, 60, 64], peaks(40, 45, 52, 57, 60, 64), STD_SETUP);
    expect(r.status).toBe('different');
    expect(r.strings[0]).toBe('wrongOpen');
    expect(r.fixes).toEqual(['Mute the low E string']);
    expect(r.stray).toEqual([40]);
  });

  it('a string played open where a fret was expected', () => {
    // D needs F#4 on the high e (fret 2); the player left it open.
    const r = judge(v(D), [50, 57, 62, 64], peaks(50, 57, 62, 64), STD_SETUP);
    expect(r.status).toBe('different');
    expect(r.strings[5]).toBe('wrongOpen');
    expect(r.fixes).toEqual(['Fret the high e string']);
    expect(r.missing).toEqual([66]);
    // C with the B string left open: B3 is nobody's partial.
    const c = judge(v(C), [48, 52, 55, 59, 64], peaks(48, 52, 55, 59, 64), STD_SETUP);
    expect(c.fixes).toEqual(['Fret the B string']);
    expect(c.strings[4]).toBe('wrongOpen');
  });

  it('partials of a sounding target note are never strays', () => {
    // G chord: B2's third partial is F#4 and lands as a fundamental on a phone mic.
    const g = toVoicing([3, 2, 0, 0, 0, 3], 1, STD_SETUP);
    const r = judge(g, [43, 47, 50, 55, 59, 67, 66], peaks(43, 47, 50, 55, 59, 67, 66), STD_SETUP);
    expect(r.stray).toEqual([]);
    expect(r.status).toBe('exact');
  });

  it('same chord in another voicing is confirmed as a different voicing', () => {
    // Target open C, played as the 3rd-fret C: C3 E3 G3 C4 E4 vs C3 G3 C4 E4 G4.
    const r = judge(v(C), [48, 55, 60, 64, 67], peaks(48, 55, 60, 64, 67), STD_SETUP);
    expect(r.status).toBe('sameName');
    expect(r.heardName.name).toBe('C');
    expect(r.missing).toEqual([52]);
  });

  it('a different chord names what was heard', () => {
    const r = judge(v(C), [45, 52, 57, 60, 64], peaks(45, 52, 57, 60, 64), STD_SETUP);
    expect(r.status).toBe('different');
    expect(r.heardName.name).toBe('Am');
    expect(r.strayNotes).toEqual([57]);
    expect(r.fixes).toEqual(['Fret the A string']);
  });

  it('nothing heard is simply missing', () => {
    const r = judge(v(E), [], peaks(), STD_SETUP);
    expect(r.status).toBe('different');
    expect(r.missing).toHaveLength(6);
    expect(r.strings.every((s) => s === 'missing')).toBe(true);
  });
});
