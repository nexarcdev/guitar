// Did the strum sound like the target chord? Exact MIDI pitches are compared, not strings: the
// same note on another string is still the right note. The string mapping exists only to tell the
// player what to fix.

import { fretMidi, identifyMidi, type ChordName, type Offsets, type Setup } from './music';
import { STRINGS, type Voicing } from './common';

export type StringMark = 'ok' | 'missing' | 'wrongOpen' | 'none';
export type VerdictStatus = 'exact' | 'sameName' | 'different';

export interface Verdict {
  status: VerdictStatus;
  target: Voicing;
  /** Fundamentals the strum was judged on. */
  heard: number[];
  /** Target pitches that sounded. */
  present: number[];
  /** Target pitches that did not. */
  missing: number[];
  /** Heard pitches outside the target that are not partials of a target note that sounded. */
  stray: number[];
  /** Per string, 0 = low E. */
  strings: StringMark[];
  /** Strays not explained as a string's open pitch: shown as pills. */
  strayNotes: number[];
  heardName: ChordName;
  /** One line each, low string first: 'Mute the low E string', 'Fret the B string'. */
  fixes: string[];
}

/** Semitone offsets of the 2nd to 16th partials. */
const PARTIALS = [12, 19, 24, 28, 31, 34, 36, 38, 40, 42, 43, 44, 46, 47, 48];

export function stringName(i: number, setup: Setup): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = names[((fretMidi(i, 0, setup) % 12) + 12) % 12];
  if (i === 0) return 'low ' + note;
  if (i === STRINGS - 1) return 'high ' + note.toLowerCase();
  return note;
}

const nameOf = (midis: number[], o: Offsets) => identifyMidi(midis, o).name;

/**
 * `heard`: the strum's fundamentals. `peaks`: every exact pitch that cleared the floor in the
 * window, partials included (a target note that coincides with a partial of a lower target note
 * cannot be told apart from it, and it sounds right either way).
 */
export function judge(target: Voicing, heard: number[], peaks: ReadonlySet<number>, setup: Setup): Verdict {
  const heardSet = new Set(heard);
  const targetSet = new Set(target.midis);
  const present = target.midis.filter((m) => heardSet.has(m) || peaks.has(m));
  const presentSet = new Set(present);
  const missing = target.midis.filter((m) => !presentSet.has(m));
  const partialOfPresent = (m: number) => present.some((p) => PARTIALS.includes(m - p));
  const stray = heard.filter((m) => !targetSet.has(m) && !partialOfPresent(m)).sort((a, b) => a - b);

  const strings: StringMark[] = target.frets.map((f, i) => {
    if (f < 0) return 'none';
    return presentSet.has(fretMidi(i, f > 0 ? f + target.baseFret - 1 : 0, setup)) ? 'ok' : 'missing';
  });
  const fixes: string[] = [];
  const strayNotes: number[] = [];
  for (const m of stray) {
    const i = target.frets.findIndex((_, k) => strings[k] !== 'ok' && strings[k] !== 'wrongOpen' && fretMidi(k, 0, setup) === m);
    if (i >= 0) {
      strings[i] = 'wrongOpen';
      fixes.push((target.frets[i] === -1 ? 'Mute the ' : 'Fret the ') + stringName(i, setup) + ' string');
    } else strayNotes.push(m);
  }
  // Fixes read low string first.
  const order = (f: string) => target.frets.findIndex((_, i) => f.endsWith(stringName(i, setup) + ' string'));
  fixes.sort((a, b) => order(a) - order(b));

  const heardName = identifyMidi(heard, setup.offsets);
  const status: VerdictStatus =
    !missing.length && !stray.length ? 'exact' : heard.length && heardName.root != null && heardName.name === nameOf(target.midis, setup.offsets) ? 'sameName' : 'different';
  return { status, target, heard, present, missing, stray, strings, strayNotes, heardName, fixes };
}
