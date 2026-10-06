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

const HARMONICS = [12, 19, 24];
const isOvertone = (hi: number, lo: number) => HARMONICS.includes(hi - lo);
/** basic-pitch reports overtones of a plucked string at well under its fundamental's confidence. */
const GHOST_RATIO = 0.75;
/** A lone note this unsure, that the fast tracker didn't hear, is string noise. */
const LONE_MIN_AMP = 0.55;
const NEAR = 0.15;

/**
 * Removes basic-pitch's typical false positives on real guitar: the octave/twelfth "ghost" of a
 * plucked string, and low-confidence blips from fret or muting noise.
 */
export function cleanCluster(g: RawNote[], fastNear: boolean): RawNote[] {
  const lowest = g.reduce((a, n) => (n.midi < a.midi ? n : a), g[0]);
  // Everything is the lowest note or its overtones: it's one string, keep the fundamental.
  if (g.every((n) => n.midi === lowest.midi || isOvertone(n.midi, lowest.midi))) g = [lowest];
  else g = g.filter((n) => !g.some((f) => isOvertone(n.midi, f.midi) && n.amp < f.amp * GHOST_RATIO));
  if (g.length === 1 && g[0].amp < LONE_MIN_AMP && !fastNear) return [];
  return g;
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
  for (const g0 of cluster(dedupe(raw))) {
    const fastNear = buf.some((n) => n.p && Math.abs(n.t - g0[0].t) < NEAR);
    const g = cleanCluster(g0, fastNear);
    if (!g.length) continue;
    const r = finger(g.map((n) => n.midi), setup, hand, g.map((n) => n.amp));
    hand = r.hand;
    const t = +g[0].t.toFixed(3);
    for (const p of r.placed) add.push({ s: p.s, f: p.f, t, m: p.midi });
    if (r.placed.length) chords.push({ t, midis: r.placed.map((p) => p.midi) });
  }
  const out = [...kept, ...add].sort((a, b) => a.t - b.t || a.s - b.s);
  return { buf: out, hand, chords };
}
