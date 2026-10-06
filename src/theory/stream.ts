// Layout and bar math for the rolling riff. Positions are "stream seconds": real time, except that
// a rest longer than the gap threshold collapses to a fixed-width divider.

export interface TabNote {
  /** String index, 0 = low E. */
  s: number;
  /** Fret, counted from the capo. */
  f: number;
  /** Onset in listening-clock seconds. */
  t: number;
  /** Detected MIDI pitch. */
  m?: number;
  /** True while the note is a fast single-note guess waiting for the ML pass. */
  p?: boolean;
}

export type TimeSig = '4/4' | '3/4' | '6/8';
export const BEATS_PER_BAR: Record<TimeSig, number> = { '4/4': 4, '3/4': 3, '6/8': 6 };

/** Median inter-onset interval folded into 60–150 BPM. Chord notes (< 120 ms apart) are ignored. */
export function estBeat(notes: readonly TabNote[]): number {
  const d: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    const x = notes[i].t - notes[i - 1].t;
    if (x > 0.12 && x < 1.5) d.push(x);
  }
  if (d.length < 4) return 0.6;
  d.sort((a, b) => a - b);
  let b = d[Math.floor(d.length / 2)];
  while (b < 0.4) b *= 2;
  while (b > 1) b /= 2;
  return b;
}

export interface Layout {
  pos: number[];
  /** Divider positions (stream seconds). */
  divs: number[];
  /** Index of the first note of the current phrase. */
  segStart: number;
  lastPos: number;
  lastT: number;
}

export function layoutLive(notes: readonly TabNote[], gapSec: number): Layout {
  const pos: number[] = [];
  const divs: number[] = [];
  let p = 0;
  let segStart = 0;
  notes.forEach((n, i) => {
    if (i) {
      const d = n.t - notes[i - 1].t;
      if (d > gapSec) {
        divs.push(p + gapSec / 2);
        p += gapSec;
        segStart = i;
      } else p += d;
    }
    pos.push(p);
  });
  return { pos, divs, segStart, lastPos: notes.length ? p : 0, lastT: notes.length ? notes[notes.length - 1].t : 0 };
}

/** Where the "now" edge of the live stream sits, given the listening clock. */
export function nowPos(l: Layout, hasNotes: boolean, now: number, gapSec: number) {
  if (!hasNotes) return 0;
  return l.lastPos + Math.min(now - l.lastT, gapSec);
}

/** End of a saveable span: once resting, a span ends just after the last note rather than at "now". */
export function spanEnd(l: Layout, hasNotes: boolean, now: number, gapSec: number) {
  if (!hasNotes) return 0;
  const d = now - l.lastT;
  return d > gapSec ? l.lastPos + 0.35 : l.lastPos + Math.min(d, gapSec);
}

export type SaveKind = number | 'phrase';

export interface Span {
  start: number;
  end: number;
  idx: number[];
  bars: number;
}

/** The notes a save button would keep: the last N bars of the current phrase, never crossing a divider. */
export function spanFor(l: Layout, kind: SaveKind, end: number, barSec: number): Span | null {
  if (!l.pos.length) return null;
  const phraseStart = l.pos[l.segStart] - 0.25;
  const start = kind === 'phrase' ? phraseStart : Math.max(phraseStart, end - kind * barSec);
  const idx: number[] = [];
  l.pos.forEach((p, i) => {
    if (i >= l.segStart && p >= start) idx.push(i);
  });
  const bars = Math.max(0.5, Math.round(((end - start) / barSec) * 2) / 2);
  return { start, end, idx, bars };
}

export const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many);
export const fmtTime = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
export const riffDur = (n: readonly TabNote[]) => (n.length ? n[n.length - 1].t + 0.6 : 0);
