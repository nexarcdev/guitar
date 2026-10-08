// A voicing is what the fretboard shows and what a strum is judged against: frets per string plus
// the sounding pitches they make in the current setup.

import { absFret, fretMidi, STD_MIDI, type Frets, type Setup } from './music';

export interface Voicing {
  frets: Frets;
  /** The fret the diagram's first column represents (frets > 0 are relative to it). */
  baseFret: number;
  /** Sounding MIDI pitches, ascending. */
  midis: number[];
}

export const STRINGS = STD_MIDI.length;

/** Sounding pitches of a fingering in this setup, ascending. */
export function voicingMidis(frets: Frets, baseFret: number, setup: Setup): number[] {
  const out: number[] = [];
  frets.forEach((f, i) => {
    if (f >= 0) out.push(fretMidi(i, absFret(f, baseFret), setup));
  });
  return out.sort((a, b) => a - b);
}

export const toVoicing = (frets: Frets, baseFret: number, setup: Setup): Voicing => ({
  frets: [...frets] as unknown as Frets,
  baseFret,
  midis: voicingMidis(frets, baseFret, setup),
});

export const sameFrets = (a: Frets, b: Frets) => a.every((v, i) => v === b[i]);

/** The open-position chords every guitarist learns first, as fingered in standard tuning. */
export const COMMON: ReadonlyArray<{ label: string; frets: Frets }> = [
  { label: 'C', frets: [-1, 3, 2, 0, 1, 0] },
  { label: 'G', frets: [3, 2, 0, 0, 0, 3] },
  { label: 'D', frets: [-1, -1, 0, 2, 3, 2] },
  { label: 'A', frets: [-1, 0, 2, 2, 2, 0] },
  { label: 'E', frets: [0, 2, 2, 1, 0, 0] },
  { label: 'Am', frets: [-1, 0, 2, 2, 1, 0] },
  { label: 'Em', frets: [0, 2, 2, 0, 0, 0] },
  { label: 'Dm', frets: [-1, -1, 0, 2, 3, 1] },
  { label: 'F', frets: [1, 3, 3, 2, 1, 1] },
  { label: 'G7', frets: [3, 2, 0, 0, 0, 1] },
  { label: 'A7', frets: [-1, 0, 2, 0, 2, 0] },
  { label: 'B7', frets: [-1, 2, 1, 2, 0, 2] },
  { label: 'D7', frets: [-1, -1, 0, 2, 1, 2] },
  { label: 'E7', frets: [0, 2, 0, 1, 0, 0] },
  { label: 'Cmaj7', frets: [-1, 3, 2, 0, 0, 0] },
  { label: 'Fmaj7', frets: [-1, -1, 3, 2, 1, 0] },
  { label: 'Asus2', frets: [-1, 0, 2, 2, 0, 0] },
  { label: 'Dsus4', frets: [-1, -1, 0, 2, 3, 3] },
];
