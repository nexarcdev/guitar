// One verdict per strum. The tracker counts pick attacks; each new attack opens a window a little
// after it (past the transient, before the strings fade), the chroma frames inside the window are
// voted, and the result is decided once when the window closes. Attacks within a strum's sweep
// re-arm the same window. Nothing is decided while nobody is playing.

import type { Analysis, Fundamental } from '../core/protocol';
import { NO_PITCH } from '../core/protocol';
import { STRINGS } from '../theory/common';
import * as L from '../theory/levels';

export interface StrumFrame {
  /** App clock at the end of the frame's chunk. */
  t: number;
  topDb: number;
  floorDb: number;
  fundamentals: Fundamental[];
  pitch: number[];
  chroma: number[];
}

export interface Decided {
  /** App clock of the strum's last attack. */
  t: number;
  /** Notes that belong to the strum, loudest first, at most the string count. */
  heard: Fundamental[];
  /** Every exact pitch that cleared the floor in the window, partials included. */
  peaks: Set<number>;
  topDb: number;
  floorDb: number;
  /** Mean 12-bin chroma over the window. */
  chroma: number[];
  /** Too quiet to judge: a click, a brush, nothing played. */
  quiet: boolean;
}

interface Pending {
  t0: number;
  from: number;
  until: number;
  frames: StrumFrame[];
}

export class StrumTracker {
  private lastAttacks = -1;
  private pending: Pending | null = null;
  /** Recent frames, for each note's level just before an attack. */
  private recent: StrumFrame[] = [];

  constructor(private strings = STRINGS) {}

  /** Forget the open window (the target changed under it). */
  reset() {
    this.pending = null;
  }

  /** Feeds one analysis message; returns a decided strum when a window closes. */
  push(a: Analysis): Decided | null {
    let decided: Decided | null = null;
    const lv = a.levels;
    const attacked = this.lastAttacks >= 0 && lv.attacks > this.lastAttacks;
    this.lastAttacks = lv.attacks;
    if (attacked) {
      const tA = a.clock - Math.min(lv.sinceAttack, 0.5);
      if (this.pending && tA - this.pending.t0 < L.STRUM_MERGE) {
        // Still sweeping the same strum: the last string's attack anchors the window.
        this.pending = { t0: tA, from: tA + L.WINDOW_START, until: tA + L.WINDOW_END, frames: [] };
      } else {
        if (this.pending?.frames.length) decided = this.decide();
        this.pending = { t0: tA, from: tA + L.WINDOW_START, until: tA + L.WINDOW_END, frames: [] };
      }
    }
    if (a.chroma !== undefined) {
      if (a.chroma) {
        const f: StrumFrame = { t: a.clock, topDb: a.chroma.topDb, floorDb: lv.floorDb, fundamentals: a.chroma.fundamentals, pitch: a.chroma.pitch, chroma: a.chroma.chroma };
        this.recent.push(f);
        while (this.recent.length && this.recent[0].t < a.clock - 1.5) this.recent.shift();
        if (this.pending && a.clock >= this.pending.from && a.clock <= this.pending.until) this.pending.frames.push(f);
      } else if (this.pending?.frames.length && a.clock >= this.pending.from) {
        // The gate closed with frames in hand: the strings have stopped, judge what there was.
        decided = decided ?? this.decide();
      }
    }
    if (this.pending && a.clock > this.pending.until) {
      if (this.pending.frames.length) decided = decided ?? this.decide();
      this.pending = null;
    }
    return decided;
  }

  private decide(): Decided {
    const p = this.pending!;
    this.pending = null;
    const pre = [...this.recent].reverse().find((f) => f.t <= p.t0 - L.PRE_END) ?? null;
    return aggregate(p.frames, p.t0, pre, this.strings);
  }
}

/**
 * Votes the window's frames into one set of notes. A note counts when it shows in enough frames,
 * clears the floor, sits within range of the loudest note, and (if it was already sounding in
 * the frame before the attack) came back up when the strings were struck.
 */
export function aggregate(frames: StrumFrame[], t0: number, pre: StrumFrame | null, strings = STRINGS): Decided {
  const topDb = Math.max(...frames.map((f) => f.topDb));
  const floorDb = frames[frames.length - 1].floorDb;
  const quiet = topDb < floorDb + L.STRUM_MIN_ABOVE_FLOOR;
  const minFrames = Math.ceil(frames.length * L.NOTE_MIN_FRAMES);
  const votes = new Map<number, { n: number; db: number }>();
  const peakVotes = new Map<number, number>();
  for (const f of frames) {
    for (const x of f.fundamentals) {
      const v = votes.get(x.midi) ?? { n: 0, db: -Infinity };
      v.n++;
      v.db = Math.max(v.db, x.db);
      votes.set(x.midi, v);
    }
    for (let m = 0; m < f.pitch.length; m++) {
      if (f.pitch[m] <= NO_PITCH) continue;
      const abs = f.pitch[m] + f.topDb;
      if (abs >= floorDb + L.NOTE_MIN_ABOVE_FLOOR && abs >= topDb - L.NOTE_MAX_BELOW_TOP) peakVotes.set(m, (peakVotes.get(m) ?? 0) + 1);
    }
  }
  const before = new Map(pre?.fundamentals.map((x) => [x.midi, x.db]) ?? []);
  const heard: Fundamental[] = [...votes]
    .filter(([m, v]) => {
      const was = before.get(m);
      return v.n >= minFrames && v.db >= floorDb + L.NOTE_MIN_ABOVE_FLOOR && v.db >= topDb - L.NOTE_MAX_BELOW_TOP && (was === undefined || v.db >= was + L.RESTRIKE_DB);
    })
    .map(([midi, v]) => ({ midi, db: v.db }))
    .sort((a, b) => b.db - a.db)
    .slice(0, strings);
  const peaks = new Set<number>([...peakVotes].filter(([, n]) => n >= minFrames).map(([m]) => m));
  for (const h of heard) peaks.add(h.midi);
  const chroma = new Array(12).fill(0);
  for (const f of frames) f.chroma.forEach((v, i) => (chroma[i] += v / frames.length));
  return { t: t0, heard: quiet ? [] : heard, peaks, topDb, floorDb, chroma, quiet };
}
