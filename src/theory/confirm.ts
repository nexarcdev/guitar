// Chord Confirm: which strings of the target shape are sounding, and whether a string that
// should be muted is ringing. Works on octave-exact pitch salience, so an open low E is not
// mistaken for the E on the D string, plus exact pitches the ML pass heard recently.

import { absFret, fretMidi, STD_MIDI, type Setup, type Frets } from './music';

/** A string counts as sounding when its fundamental is within this many dB of the loudest peak. */
export const HEARD_DB = -30;
/**
 * A muted string only counts as ringing when its fundamental is nearly as loud as the loudest
 * peak. Measured on a real guitar: a string that was actually struck sits within ~5 dB of the
 * top, while sympathetic ringing and decay from earlier notes sit 12 dB or more below.
 */
export const WRONG_DB = -8;
const ML_WINDOW = 2;

export interface ConfirmInput {
  frets: Frets;
  baseFret: number;
  setup: Setup;
  /** Held per-MIDI salience (dB relative to the strongest peak), or null when nothing is playing. */
  pitch: ArrayLike<number> | null;
  mlRecent: ReadonlyArray<{ midi: number; t: number }>;
  clock: number;
}

export interface ConfirmFrame {
  /** Strings (0 = low E) in the shape that are sounding. */
  heard: number[];
  /** Muted strings whose open note is ringing. */
  wrong: number[];
  /** Strings the shape asks for. */
  played: number[];
}

export function confirmFrame({ frets, baseFret, setup, pitch, mlRecent, clock }: ConfirmInput): ConfirmFrame {
  const played: number[] = [];
  const expected: number[] = [];
  frets.forEach((f, i) => {
    if (f >= 0) {
      played.push(i);
      expected.push(fretMidi(i, absFret(f, baseFret), setup));
    }
  });
  const ml = new Set(mlRecent.filter((m) => clock - m.t < ML_WINDOW).map((m) => m.midi));
  const level = (m: number) => (pitch && m >= 0 && m < pitch.length ? pitch[m] : -Infinity);

  const heard = played.filter((_, k) => level(expected[k]) >= HEARD_DB || ml.has(expected[k]));

  // An open string that should be muted is "explained" if its pitch is one of the shape's notes
  // or an overtone of one (octave, octave + fifth, two octaves); otherwise it's ringing in error.
  const explained = (m: number) => expected.some((e) => m === e || m === e + 12 || m === e + 19 || m === e + 24);
  const wrong: number[] = [];
  frets.forEach((f, i) => {
    if (f !== -1) return;
    const open = STD_MIDI[i] + setup.offsets[i] + setup.capo;
    if (explained(open)) return;
    if (level(open) >= WRONG_DB || ml.has(open)) wrong.push(i);
  });
  return { heard, wrong, played };
}

