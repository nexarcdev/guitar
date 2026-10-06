// Hybrid transcription: fast single notes land on the stream immediately (provisional), and each
// ML window replaces the provisional notes in its time range with the polyphonic result.

import { finger } from './fingering';
import type { Setup } from './music';
import type { TabNote } from './stream';

export interface RawNote {
  midi: number;
  t: number;
  amp: number;
}

/** A strum is a run of onsets each within STRUM_GAP of the last, spanning at most STRUM_SPAN. */
export const STRUM_GAP = 0.05;
export const STRUM_SPAN = 0.15;
/** basic-pitch sometimes reports the same note twice a few frames apart. */
const DUP_WINDOW = 0.12;

export function dedupe(notes: RawNote[]): RawNote[] {
  const out: RawNote[] = [];
  for (const n of [...notes].sort((a, b) => a.t - b.t)) {
    const d = out.find((o) => o.midi === n.midi && n.t - o.t < DUP_WINDOW);
    if (d) d.amp = Math.max(d.amp, n.amp);
    else out.push({ ...n });
  }
  return out;
}

export function cluster(notes: RawNote[]): RawNote[][] {
  const groups: RawNote[][] = [];
  for (const n of notes) {
    const g = groups[groups.length - 1];
    if (g && n.t - g[g.length - 1].t <= STRUM_GAP && n.t - g[0].t <= STRUM_SPAN) g.push(n);
    else groups.push([n]);
  }
  return groups;
}

export function mergeWindow(
  buf: readonly TabNote[],
  from: number,
  to: number,
  raw: RawNote[],
  setup: Setup,
  hand: number,
): { buf: TabNote[]; hand: number; chords: Array<{ t: number; midis: number[] }> } {
  const kept = buf.filter((n) => !(n.p && n.t >= from && n.t < to));
  const add: TabNote[] = [];
  const chords: Array<{ t: number; midis: number[] }> = [];
  for (const g of cluster(dedupe(raw))) {
    const r = finger(g.map((n) => n.midi), setup, hand, g.map((n) => n.amp));
    hand = r.hand;
    const t = +g[0].t.toFixed(3);
    for (const p of r.placed) add.push({ s: p.s, f: p.f, t, m: p.midi });
    if (r.placed.length) chords.push({ t, midis: r.placed.map((p) => p.midi) });
  }
  const out = [...kept, ...add].sort((a, b) => a.t - b.t || a.s - b.s);
  return { buf: out, hand, chords };
}
