// Chooses where on the neck a set of simultaneous pitches was most likely played.
// A pitch can sit on several strings; we pick the assignment that keeps the hand compact
// and close to where it just was, which is how players actually move.

import { STD_MIDI, type Setup } from './music';

export const MAX_FRET = 15;

export interface Placement {
  s: number;
  f: number;
}

export interface FingerResult {
  placed: Array<Placement & { midi: number }>;
  /** Hand position (mean fretted fret) after this cluster, or the previous one if all open. */
  hand: number;
}

function cost(frets: number[], hand: number): number {
  const fretted = frets.filter((f) => f > 0);
  if (!fretted.length) return 0;
  const lo = Math.min(...fretted);
  const hi = Math.max(...fretted);
  const span = hi - lo;
  const center = fretted.reduce((a, b) => a + b, 0) / fretted.length;
  let c = span * 0.5 + Math.abs(center - hand) * 0.3 + fretted.reduce((a, f) => a + f * 0.05, 0);
  if (span > 4) c += (span - 4) * 10;
  return c;
}

/**
 * Places up to six pitches on distinct strings. Pitches that cannot be placed (out of range,
 * or more pitches than free strings) are dropped, quietest first if amplitudes are given.
 */
export function finger(midis: number[], setup: Setup, hand = 3, amps?: number[]): FingerResult {
  let order = midis.map((m, i) => ({ m, a: amps ? amps[i] : 1 }));
  order.sort((x, y) => y.a - x.a);
  order = order.slice(0, 6);
  const open = STD_MIDI.map((m, i) => m + setup.offsets[i] + setup.capo);
  const options = order.map(({ m }) => {
    const o: Placement[] = [];
    for (let s = 0; s < 6; s++) {
      const f = m - open[s];
      if (f >= 0 && f <= MAX_FRET) o.push({ s, f });
    }
    return o;
  });

  let best: { c: number; pick: Array<Placement | null> } | null = null;
  const pick: Array<Placement | null> = new Array(order.length).fill(null);
  const used = new Array(6).fill(false);
  // Exhaustive search is tiny: at most 6 notes × 6 strings. Dropping a note costs more than any
  // reasonable stretch so we only drop when nothing fits.
  const walk = (k: number, dropped: number) => {
    if (k === order.length) {
      const frets = pick.filter((p): p is Placement => !!p).map((p) => p.f);
      const c = cost(frets, hand) + dropped * 25;
      if (!best || c < best.c) best = { c, pick: [...pick] };
      return;
    }
    for (const o of options[k]) {
      if (used[o.s]) continue;
      used[o.s] = true;
      pick[k] = o;
      walk(k + 1, dropped);
      used[o.s] = false;
    }
    pick[k] = null;
    walk(k + 1, dropped + 1);
  };
  walk(0, 0);

  const chosen = (best as { c: number; pick: Array<Placement | null> } | null)?.pick ?? [];
  const placed = chosen
    .map((p, i) => (p ? { ...p, midi: order[i].m } : null))
    .filter((p): p is Placement & { midi: number } => !!p)
    .sort((a, b) => a.s - b.s);
  const fretted = placed.filter((p) => p.f > 0).map((p) => p.f);
  return { placed, hand: fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : hand };
}
