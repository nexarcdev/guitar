import { describe, expect, it } from 'vitest';
import { NO_PITCH, type Analysis, type Fundamental } from '../src/core/protocol';
import { StrumTracker } from '../src/state/strum';
import * as L from '../src/theory/levels';

const FLOOR = -75;
const CHUNK_S = 1024 / 48000;
const CHROMA_EVERY = 0.06;

interface Opts {
  attacks?: number;
  sinceAttack?: number;
  gate?: boolean;
  /** Chroma frame with these fundamentals (midi -> dB); null = gate closed frame; undefined = no frame. */
  notes?: Record<number, number> | null;
  topDb?: number;
}

function msg(clock: number, o: Opts, lastAttack: number): Analysis {
  const fundamentals: Fundamental[] = Object.entries(o.notes ?? {}).map(([m, db]) => ({ midi: +m, db }));
  const pitch = new Array(128).fill(NO_PITCH);
  const topDb = o.topDb ?? (fundamentals.length ? Math.max(...fundamentals.map((f) => f.db)) : -100);
  for (const f of fundamentals) pitch[f.midi] = f.db - topDb;
  return {
    type: 'analysis',
    clock,
    frames: [],
    notes: [],
    chroma: o.notes === undefined ? undefined : o.notes === null ? null : { chroma: new Array(12).fill(0), pitch, topDb, fundamentals },
    peak: 0,
    levels: {
      floorDb: FLOOR, measuredDb: FLOOR, floorMode: 'auto', measuring: null, openDb: 12, sinceAttack: o.sinceAttack ?? clock - lastAttack,
      peakDb: -20, gate: o.gate ?? true, attacks: o.attacks ?? 0, attackDb: -20,
    },
  };
}

/** Drives a tracker with chunks every 21 ms; chroma frames every 60 ms while `notes(t)` returns one. */
function drive(attacksAt: number[], notes: (t: number) => Record<number, number> | null | undefined, until = 3, gateOff?: (t: number) => boolean) {
  const tr = new StrumTracker(6);
  const out: Array<{ at: number; d: ReturnType<StrumTracker['push']> }> = [];
  let nextChroma = CHROMA_EVERY;
  let attacks = 0;
  let lastAttack = -1e9;
  for (let t = CHUNK_S; t < until; t += CHUNK_S) {
    while (attacks < attacksAt.length && attacksAt[attacks] <= t) {
      lastAttack = attacksAt[attacks];
      attacks++;
    }
    let o: Opts = { attacks, gate: gateOff ? !gateOff(t) : true };
    if (t >= nextChroma) {
      nextChroma += CHROMA_EVERY;
      o = { ...o, notes: notes(t) };
    }
    const d = tr.push(msg(t, o, lastAttack));
    if (d) out.push({ at: t, d });
  }
  return out;
}

const C = { 48: -30, 52: -32, 55: -31 };

describe('per-strum verdicts', () => {
  it('decides once per attack, after the window, with the voted notes', () => {
    const r = drive([1.0], (t) => (t > 1.0 ? C : null));
    expect(r).toHaveLength(1);
    expect(r[0].at).toBeGreaterThan(1.0 + L.WINDOW_END);
    expect(r[0].at).toBeLessThan(1.0 + L.WINDOW_END + 0.1);
    expect(r[0].d!.heard.map((f) => f.midi).sort()).toEqual([48, 52, 55]);
    expect(r[0].d!.quiet).toBe(false);
    expect(r[0].d!.t).toBeCloseTo(1.0, 1);
  });

  it('a sweep of attacks within one strum is one decision', () => {
    const r = drive([1.0, 1.04, 1.09], (t) => (t > 1.0 ? C : null));
    expect(r).toHaveLength(1);
    expect(r[0].d!.t).toBeCloseTo(1.09, 1);
  });

  it('a new strum before the window closes decides the first one early', () => {
    const G = { 43: -30, 47: -33, 50: -36 };
    const r = drive([1.0, 1.45], (t) => (t > 1.45 ? G : t > 1.0 ? C : null));
    expect(r).toHaveLength(2);
    expect(r[0].at).toBeLessThan(1.5);
    expect(r[0].d!.heard.map((f) => f.midi).sort()).toEqual([48, 52, 55]);
    expect(r[1].d!.heard.map((f) => f.midi).sort()).toEqual([43, 47, 50]);
  });

  it('a strum barely above the floor is quiet', () => {
    const r = drive([1.0], (t) => (t > 1.0 ? { 48: FLOOR + 14 } : null));
    expect(r).toHaveLength(1);
    expect(r[0].d!.quiet).toBe(true);
    expect(r[0].d!.heard).toEqual([]);
  });

  it('the gate closing with frames in hand decides at once', () => {
    const r = drive([1.0], (t) => (t > 1.0 && t < 1.35 ? C : null), 3, (t) => t >= 1.35);
    expect(r).toHaveLength(1);
    expect(r[0].at).toBeLessThan(1.45);
    expect(r[0].d!.heard.map((f) => f.midi).sort()).toEqual([48, 52, 55]);
  });

  it('a note that only shows in the transient is dropped', () => {
    const r = drive([1.0], (t) => (t > 1.0 ? (t < 1.22 ? { ...C, 73: -28 } : C) : null));
    expect(r[0].d!.heard.map((f) => f.midi).sort()).toEqual([48, 52, 55]);
  });

  it('a string still ringing from before is not part of the new strum unless re-struck', () => {
    // E4 rings at -40 from 0.5 s; the attack at 1.0 adds B3 but E4 stays where it was.
    const r = drive([1.0], (t) => (t > 1.0 ? { 59: -34, 64: -40.5 } : t > 0.5 ? { 64: -40 } : null));
    expect(r[0].d!.heard.map((f) => f.midi)).toEqual([59]);
    // Re-struck: E4 comes back up by more than RESTRIKE_DB.
    const r2 = drive([1.0], (t) => (t > 1.0 ? { 59: -34, 64: -36 } : t > 0.5 ? { 64: -40 } : null));
    expect(r2[0].d!.heard.map((f) => f.midi).sort()).toEqual([59, 64]);
  });

  it('peaks carry every pitch that cleared the floor, partials included', () => {
    const r = drive([1.0], (t) => (t > 1.0 ? C : null));
    expect([...r[0].d!.peaks].sort((a, b) => a - b)).toEqual([48, 52, 55]);
  });

  it('reset forgets the open window', () => {
    const tr = new StrumTracker(6);
    tr.push(msg(0.5, { attacks: 0 }, -1e9));
    tr.push(msg(1.0, { attacks: 1, sinceAttack: 0 }, 1.0));
    tr.reset();
    expect(tr.push(msg(1.3, { attacks: 1, notes: C }, 1.0))).toBeNull();
    expect(tr.push(msg(1.7, { attacks: 1, notes: C }, 1.0))).toBeNull();
  });
});
