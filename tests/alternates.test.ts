import { describe, expect, it } from 'vitest';
import { identifyFrets, STD_SETUP, type Frets } from '../src/theory/music';
import { toVoicing } from '../src/theory/common';
import { alternates, suffixOf, type Alternate } from '../src/theory/alternates';
import { absFrets, playable } from '../src/theory/voicings';

const cur = (frets: Frets, baseFret = 1) => ({ name: identifyFrets(frets, baseFret, STD_SETUP), voicing: toVoicing(frets, baseFret, STD_SETUP) });
const keys = (alts: Alternate[], kind?: string) => alts.filter((a) => !kind || a.kind === kind).map((a) => absFrets(a.voicing.frets, a.voicing.baseFret).join(','));
const reasons = (alts: Alternate[], kind?: string) => alts.filter((a) => !kind || a.kind === kind).map((a) => a.reason);

describe('alternates', () => {
  it('knows the suffix of a named chord', () => {
    expect(suffixOf(identifyFrets([-1, 3, 2, 0, 1, 0], 1, STD_SETUP))).toBe('');
    expect(suffixOf(identifyFrets([-1, 0, 2, 2, 1, 0], 1, STD_SETUP))).toBe('m');
    expect(suffixOf(identifyFrets([0, 2, 0, 1, 0, 0], 1, STD_SETUP))).toBe('7');
  });

  it('for open C after G: positions, voicings, simpler grips and substitutions with reasons', () => {
    const alts = alternates(cur([-1, 3, 2, 0, 1, 0]), toVoicing([3, 2, 0, 0, 0, 3], 1, STD_SETUP), STD_SETUP, 3);
    expect(alts.every((a) => playable(absFrets(a.voicing.frets, a.voicing.baseFret)))).toBe(true);
    expect(keys(alts)).not.toContain('-1,3,2,0,1,0');
    expect(keys(alts, 'position')).toContain('-1,3,5,5,5,3');
    expect(reasons(alts, 'position').some((r) => /Same C, (barre at the 3rd fret|3rd fret)/.test(r))).toBe(true);
    expect(reasons(alts, 'voicing').some((r) => r.startsWith('C/E, the third in the bass') || r.startsWith('C/G, the fifth in the bass'))).toBe(true);
    expect(reasons(alts, 'substitute').some((r) => r.startsWith('Am, relative minor: shares C and E'))).toBe(true);
    expect(reasons(alts, 'substitute').some((r) => r.startsWith('C5, root and fifth only') || /^C(sus4|sus2|7|maj7)/.test(r))).toBe(true);
    for (const kind of ['position', 'voicing', 'simpler', 'substitute']) expect(alts.filter((a) => a.kind === kind).length).toBeLessThanOrEqual(3);
  });

  it('for barre F: an easier grip without the barre and Fmaj7 with open strings', () => {
    const alts = alternates(cur([1, 3, 3, 2, 1, 1]), null, STD_SETUP, 3);
    const simpler = alts.filter((a) => a.kind === 'simpler');
    expect(simpler.length).toBeGreaterThan(0);
    expect(simpler.every((a) => a.voicing.grip.fingers < 4 || !a.voicing.grip.barre)).toBe(true);
    expect(reasons(alts, 'simpler').some((r) => /no barre|open strings instead of the barre/.test(r))).toBe(true);
    expect(reasons(alts, 'substitute').some((r) => r.startsWith('Dm, relative minor: shares F and A'))).toBe(true);
  });

  it('for open E: power chord, relative minor, sus4, seventh', () => {
    const alts = alternates(cur([0, 2, 2, 1, 0, 0]), null, STD_SETUP, 6);
    const subs = reasons(alts, 'substitute');
    expect(subs.some((r) => r.startsWith('E5, root and fifth only'))).toBe(true);
    expect(subs.some((r) => r.startsWith('C#m, relative minor: shares E and G#'))).toBe(true);
    expect(subs.some((r) => r.startsWith('Esus4: A instead of G#, resolves back to E'))).toBe(true);
    expect(subs.some((r) => r.startsWith('E7: adds D, pulls toward A'))).toBe(true);
    expect(reasons(alts, 'position').some((r) => /Same E, (barre at the 7th fret|7th fret)/.test(r))).toBe(true);
  });

  it('for Am: relative major and Am7', () => {
    const alts = alternates(cur([-1, 0, 2, 2, 1, 0]), null, STD_SETUP, 4);
    const subs = reasons(alts, 'substitute');
    expect(subs.some((r) => r.startsWith('C, relative major: shares C and E'))).toBe(true);
    // Am7 is both the easier grip and a colour; it shows once.
    expect(alts.filter((a) => a.reason.startsWith('Am7'))).toHaveLength(1);
    expect(subs.some((r) => r.startsWith('A5, root and fifth only'))).toBe(true);
  });

  it('a single note or an unrecognized set has no alternates', () => {
    expect(alternates(cur([-1, -1, -1, -1, -1, 0]), null, STD_SETUP)).toEqual([]);
  });

  it('runs fast enough to follow strums', () => {
    const t = performance.now();
    for (let i = 0; i < 5; i++) alternates(cur([-1, 3, 2, 0, 1, 0]), null, STD_SETUP);
    expect((performance.now() - t) / 5).toBeLessThan(150);
  });
});
