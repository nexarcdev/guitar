// Pitch, tuning and chord-naming primitives. Everything here is pure and unit tested.

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** Semitone offsets from standard tuning, low E first. */
export type Offsets = readonly [number, number, number, number, number, number];
export interface Setup {
  offsets: Offsets;
  capo: number;
}

export const TUNINGS: ReadonlyArray<readonly [string, Offsets]> = [
  ['Standard', [0, 0, 0, 0, 0, 0]],
  ['Drop D', [-2, 0, 0, 0, 0, 0]],
  ['Half step down', [-1, -1, -1, -1, -1, -1]],
  ['Whole step down', [-2, -2, -2, -2, -2, -2]],
  ['Drop C', [-4, -2, -2, -2, -2, -2]],
  ['Double drop D', [-2, 0, 0, 0, 0, -2]],
  ['DADGAD', [-2, 0, 0, 0, -2, -2]],
  ['Open G', [-2, -2, 0, 0, 0, -2]],
  ['Open D', [-2, 0, 0, -1, -2, -2]],
  ['Open E', [0, 2, 2, 1, 0, 0]],
  ['Open C', [-4, -2, -2, 0, 1, 0]],
];

export const STD_SETUP: Setup = { offsets: [0, 0, 0, 0, 0, 0], capo: 0 };
/** Open-string MIDI numbers in standard tuning, low E (index 0) to high e (index 5). */
export const STD_MIDI = [40, 45, 50, 55, 59, 64] as const;
export const OFFSET_MIN = -7;
export const OFFSET_MAX = 4;
export const MAX_CAPO = 12;

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const hzMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const pcOf = (m: number) => ((Math.round(m) % 12) + 12) % 12;
export const sameArr = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
export const tuningName = (o: Offsets) => TUNINGS.find(([, x]) => sameArr(x, o))?.[0] ?? 'Custom';
/** Flat-heavy tunings (e.g. half step down) read better with flat names. */
export const useFlats = (o: Offsets) => o.filter((v) => v < 0 && Math.abs(v) % 2 === 1).length >= 4;
export const ord = (n: number) =>
  n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0] as string);
export const setupStr = (s: Setup) => tuningName(s.offsets) + (s.capo ? ' · Capo ' + s.capo : '');
export const sameSetup = (a: Setup, b: Setup) => sameArr(a.offsets, b.offsets) && a.capo === b.capo;

export interface OpenString {
  midi: number;
  pc: number;
  hz: number;
  note: string;
  oct: number;
}

export function openStrings(o: Offsets): OpenString[] {
  const names = useFlats(o) ? FLAT : NOTES;
  return STD_MIDI.map((m, i) => {
    const midi = m + o[i];
    const pc = pcOf(midi);
    return { midi, pc, hz: midiHz(midi), note: names[pc], oct: Math.floor(midi / 12) - 1 };
  });
}

export const noteName = (pc: number, o: Offsets) => (useFlats(o) ? FLAT : NOTES)[pcOf(pc)];
/** String label as guitarists write it: the high string is always lowercase. */
export const stringLabel = (note: string, i: number) => (i === 5 ? note.toLowerCase() : note);

/** Sounding pitch of a fret, where fret numbers count from the capo (chord-chart convention). */
export const fretMidi = (string: number, fret: number, setup: Setup) =>
  STD_MIDI[string] + setup.offsets[string] + setup.capo + fret;

// ---- chord naming

const TEMPL: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['5', [0, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]],
  ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]],
  ['m7', [0, 3, 7, 10]], ['dim7', [0, 3, 6, 9]], ['m7b5', [0, 3, 6, 10]], ['6', [0, 4, 7, 9]],
  ['m6', [0, 3, 7, 9]], ['add9', [0, 2, 4, 7]], ['madd9', [0, 2, 3, 7]], ['7sus4', [0, 5, 7, 10]],
  ['9', [0, 2, 4, 7, 10]], ['maj9', [0, 2, 4, 7, 11]], ['m9', [0, 2, 3, 7, 10]], ['mMaj7', [0, 3, 7, 11]],
  ['7#9', [0, 3, 4, 7, 10]], ['7b9', [0, 1, 4, 7, 10]], ['6/9', [0, 2, 4, 7, 9]], ['7(no5)', [0, 4, 10]],
  ['m7(no5)', [0, 3, 10]], ['maj7(no5)', [0, 4, 11]],
];
const FULL: Record<string, string> = { '': 'major', m: 'minor', '5': 'power chord', dim: 'diminished', aug: 'augmented' };

export interface ChordName {
  name: string;
  sub: string;
  /** Pitch classes in the voicing. */
  notes: number[];
  /** Root pitch class, or null when the set is a single note or unrecognized. */
  root: number | null;
}

/** Names a pitch-class set. `bass` decides slash chords and breaks ties between roots. */
export function nameSet(set: number[], bass: number, o: Offsets): ChordName {
  const N = (p: number) => noteName(p, o);
  if (set.length < 2) return { name: set.length ? N(set[0]) : '·', sub: 'Single note', notes: set, root: null };
  let best: { score: number; root: number; suf: string } | null = null;
  for (const root of set) {
    const iv = [...new Set(set.map((p) => (p - root + 12) % 12))].sort((a, b) => a - b);
    for (const [suf, t] of TEMPL) {
      if (t.length === iv.length && t.every((v, i) => v === iv[i])) {
        const score = (root === bass ? 2 : 0) - t.length * 0.1;
        if (!best || score > best.score) best = { score, root, suf };
      }
    }
  }
  if (!best) return { name: '?', sub: 'Unrecognized voicing: ' + set.map(N).join(' '), notes: set, root: null };
  const slash = best.root !== bass ? '/' + N(bass) : '';
  const full = FULL[best.suf];
  return {
    name: N(best.root) + best.suf + slash,
    sub: (full ? N(best.root) + ' ' + full : N(best.root) + ' ' + best.suf) + (slash ? ' over ' + N(bass) : ''),
    notes: set,
    root: best.root,
  };
}

/** Frets per string, -1 = muted, 0 = open. `base` is the fret the diagram's first column represents. */
export type Shape = readonly [number, number, number, number, number, number];

export const absFret = (f: number, base: number) => (f <= 0 ? f : f + base - 1);

export function identifyShape(frets: Shape, base: number, setup: Setup): ChordName {
  const pcs: number[] = [];
  frets.forEach((f, i) => {
    if (f >= 0) pcs.push(pcOf(fretMidi(i, absFret(f, base), setup)));
  });
  if (!pcs.length) return { name: '·', sub: 'Tap frets to build a chord', notes: [], root: null };
  return nameSet([...new Set(pcs)], pcs[0], setup.offsets);
}

export const PRESETS: Record<string, Shape> = {
  C: [-1, 3, 2, 0, 1, 0], G: [3, 2, 0, 0, 0, 3], D: [-1, -1, 0, 2, 3, 2], A: [-1, 0, 2, 2, 2, 0],
  E: [0, 2, 2, 1, 0, 0], Am: [-1, 0, 2, 2, 1, 0], Em: [0, 2, 2, 0, 0, 0], Dm: [-1, -1, 0, 2, 3, 1],
  F: [1, 3, 3, 2, 1, 1], E7: [0, 2, 0, 1, 0, 0], Cmaj7: [-1, 3, 2, 0, 0, 0],
};

/** Finds a common shape that sounds like `name` in this setup, so a heard chord can be shown on the fretboard. */
export function shapeFor(name: string, setup: Setup): Shape | null {
  const k = Object.keys(PRESETS).find((k) => identifyShape(PRESETS[k], 1, setup).name === name);
  return k ? PRESETS[k] : null;
}

/** Identifies the chord in a set of sounding MIDI notes; the lowest note is the bass. */
export function identifyMidi(midis: number[], o: Offsets): ChordName {
  if (!midis.length) return { name: '·', sub: '', notes: [], root: null };
  const sorted = [...midis].sort((a, b) => a - b);
  const pcs = [...new Set(sorted.map(pcOf))];
  return nameSet(pcs, pcOf(sorted[0]), o);
}

// ---- chord from a chroma profile

/** Templates worth guessing from audio alone; rarer colours are left to the ML pass. */
const AUDIO_TEMPL = TEMPL.filter(([suf]) => ['', 'm', '5', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'add9', '6', 'm6'].includes(suf));

/**
 * Best chord for a 12-bin chroma (cosine match against binary templates). Each chord tone must be
 * clearly present and extensions cost a little, so plain triads win unless the colour is really there.
 */
export function chordFromChroma(c: number[], bass: number | null, o: Offsets): ChordName | null {
  const norm = Math.sqrt(c.reduce((a, v) => a + v * v, 0));
  if (!norm) return null;
  let best: { score: number; root: number; t: readonly number[] } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const [, t] of AUDIO_TEMPL) {
      let dot = 0, weakest = 1;
      for (const iv of t) {
        const v = c[(root + iv) % 12];
        dot += v;
        if (v < weakest) weakest = v;
      }
      if (weakest < 0.2) continue;
      let score = dot / Math.sqrt(t.length) / norm - Math.max(0, t.length - 3) * 0.06 - (t.length === 2 ? 0.08 : 0);
      if (bass === root) score += 0.03;
      if (!best || score > best.score) best = { score, root, t };
    }
  }
  if (!best || best.score < 0.6) return null;
  const set = best.t.map((iv) => (best!.root + iv) % 12);
  return nameSet(set, bass != null && set.includes(bass) ? bass : best.root, o);
}
