// Every way to play a set of pitch classes that an ordinary hand can reach: at most four fingers,
// a barre counting as one, no more than three frets between the lowest and highest fretted note,
// no muted string between two sounding ones. Stretches are not generated at all: most players
// cannot make them, and a chord they cannot play teaches nothing.

import { fretMidi, pcOf, STD_MIDI, type Frets, type Setup } from './music';
import { toVoicing, type Voicing } from './common';

export interface Hand {
  fingers: number;
  /** Highest minus lowest fretted fret. */
  span: number;
}
export const DEFAULT_HAND: Hand = { fingers: 4, span: 3 };

export interface Barre {
  fret: number;
  /** String indices covered, 0 = low E. */
  from: number;
  to: number;
}

export interface Grip {
  fingers: number;
  /** A full barre: the index across four or more strings at the lowest fret. */
  barre: Barre | null;
  /** Muted strings with a sounding string on both sides (hard to damp cleanly). */
  innerMutes: number;
  span: number;
  /** Lowest fretted fret, 0 when nothing is fretted. */
  lo: number;
  /** Notes at one fret on strings too far apart for separate fingers and not barre-able. */
  awkward: boolean;
}

export interface Fingering extends Voicing {
  grip: Grip;
  /** How hard it is to hold: lower is easier. */
  cost: number;
}

/** Frets as the hand sees them: -1 muted, 0 open, else the absolute fret. */
export function absFrets(frets: Frets, baseFret: number): number[] {
  return frets.map((f) => (f > 0 ? f + baseFret - 1 : f));
}

/** Fits absolute frets into the five visible columns, preferring the open position. */
export function toBoard(abs: readonly number[]): { frets: Frets; baseFret: number } {
  const fretted = abs.filter((f) => f > 0);
  if (!fretted.length) return { frets: [...abs] as unknown as Frets, baseFret: 1 };
  const lo = Math.min(...fretted);
  const hi = Math.max(...fretted);
  const baseFret = hi <= 5 ? 1 : Math.min(lo, 12);
  return { frets: abs.map((f) => (f > 0 ? f - baseFret + 1 : f)) as unknown as Frets, baseFret };
}

/**
 * How a hand holds these frets. Strings at one fret form a group when every string between them
 * is fretted at that fret or higher (a finger can lie across them). At the lowest fret a group of
 * up to three adjacent strings, or one four or more strings wide, is a barre and costs one finger;
 * any other group costs a finger per string at the fret. A full barre cannot have an open string
 * above it, and separate fingers cannot hold one fret on strings more than three apart.
 */
export function grip(abs: readonly number[]): Grip {
  const sounding = abs.map((f) => f >= 0);
  let innerMutes = 0;
  abs.forEach((f, i) => {
    if (f === -1 && sounding.slice(0, i).some(Boolean) && sounding.slice(i + 1).some(Boolean)) innerMutes++;
  });
  const fretted = abs.filter((f) => f > 0);
  if (!fretted.length) return { fingers: 0, barre: null, innerMutes, span: 0, lo: 0, awkward: false };
  const lo = Math.min(...fretted);
  const hi = Math.max(...fretted);
  let fingers = 0;
  let barre: Barre | null = null;
  let awkward = false;
  for (const f of [...new Set(fretted)].sort((a, b) => a - b)) {
    const at = abs.map((v, i) => (v === f ? i : -1)).filter((i) => i >= 0);
    const groups: number[][] = [];
    for (const i of at) {
      const g = groups[groups.length - 1];
      if (g && abs.slice(g[g.length - 1] + 1, i).every((v) => v >= f)) g.push(i);
      else groups.push([i]);
    }
    for (const g of groups) {
      const [a, b] = [g[0], g[g.length - 1]];
      const adjacent = g.length === b - a + 1;
      const openAbove = abs.slice(b + 1).some((v) => v === 0);
      // A small adjacent group can leave the string above it open (the one-finger A); a full
      // barre cannot.
      if (f === lo && g.length >= 2 && ((adjacent && g.length <= 3) || (b - a + 1 >= 4 && !openAbove))) {
        fingers += 1;
        if (b - a + 1 >= 4) barre = { fret: f, from: a, to: b };
      } else fingers += g.length;
    }
    if (groups.length > 1 && at[at.length - 1] - at[0] > 3) awkward = true;
  }
  return { fingers, barre, innerMutes, span: hi - lo, lo, awkward };
}

export function playable(abs: readonly number[], hand: Hand = DEFAULT_HAND, allowInnerMute = false): boolean {
  const g = grip(abs);
  return g.fingers <= hand.fingers && g.span <= hand.span && !g.awkward && (allowInnerMute || g.innerMutes === 0);
}

export function gripCost(g: Grip, sounding: number, bassIsRoot: boolean): number {
  return 0.6 * g.fingers + 0.4 * g.span + 0.05 * g.lo - 0.25 * sounding + 2 * g.innerMutes + (g.barre ? 0.8 : 0) + (bassIsRoot ? 0 : 1.5);
}

export interface EnumOpts {
  /** Pitch class that must sound lowest; null = any. Default: the root. */
  bass?: number | null;
  /** Pitch classes that must all sound. Default: every one of `pcs`. */
  require?: number[];
  /** Default 3. */
  minStrings?: number;
  /** Highest fret considered. Default 12. */
  maxFret?: number;
  hand?: Hand;
  allowInnerMute?: boolean;
}

export const voicingKey = (v: Voicing) => absFrets(v.frets, v.baseFret).join(',');

/** All playable fingerings of `pcs` in this setup, easiest first. */
export function enumerateVoicings(pcs: readonly number[], root: number, setup: Setup, opts: EnumOpts = {}): Fingering[] {
  const bass = opts.bass === undefined ? root : opts.bass;
  const require = opts.require ?? [...pcs];
  const minStrings = opts.minStrings ?? 3;
  const maxFret = opts.maxFret ?? 12;
  const hand = opts.hand ?? DEFAULT_HAND;
  const want = new Set(pcs);
  const open = STD_MIDI.map((_, i) => fretMidi(i, 0, setup));
  const seen = new Set<string>();
  const out: Fingering[] = [];
  const abs = new Array<number>(STD_MIDI.length).fill(-1);

  const leaf = () => {
    const key = abs.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const midis: number[] = [];
    abs.forEach((f, i) => {
      if (f >= 0) midis.push(open[i] + f);
    });
    if (midis.length < minStrings) return;
    const have = new Set(midis.map(pcOf));
    if (!require.every((p) => have.has(p))) return;
    const lowest = pcOf(Math.min(...midis));
    if (bass !== null && lowest !== bass) return;
    if (!playable(abs, hand, opts.allowInnerMute)) return;
    const g = grip(abs);
    const board = toBoard(abs);
    const v = toVoicing(board.frets, board.baseFret, setup);
    out.push({ ...v, grip: g, cost: gripCost(g, midis.length, lowest === root) });
  };

  for (let p = 1; p + hand.span <= maxFret; p++) {
    const walk = (i: number, soundingBefore: boolean, mutedGap: boolean) => {
      if (i === abs.length) return leaf();
      // Muted: fine at the edges; in the middle only when allowed.
      abs[i] = -1;
      walk(i + 1, soundingBefore, soundingBefore);
      const start = (sb: boolean) => {
        if (mutedGap && sb && !opts.allowInnerMute) return false;
        return true;
      };
      if (start(soundingBefore)) {
        if (want.has(pcOf(open[i]))) {
          abs[i] = 0;
          walk(i + 1, true, false);
        }
        for (let f = p; f <= p + hand.span; f++) {
          if (want.has(pcOf(open[i] + f))) {
            abs[i] = f;
            walk(i + 1, true, false);
          }
        }
      }
      abs[i] = -1;
    };
    walk(0, false, false);
  }
  return out.sort((a, b) => a.cost - b.cost);
}

/**
 * How far the hand moves from one chord to the next: fretted notes are matched greedily to the
 * nearest fretted note of the previous chord; a finger that stays put earns a bonus, a new one
 * costs, a barre coming or going costs, and so does shifting position.
 */
export function transitionCost(from: Voicing | null, to: Fingering): number {
  if (!from) return to.cost;
  const a = absFrets(from.frets, from.baseFret).map((f, s) => ({ f, s })).filter((x) => x.f > 0);
  const b = absFrets(to.frets, to.baseFret).map((f, s) => ({ f, s })).filter((x) => x.f > 0);
  const used = new Set<number>();
  let c = 0;
  for (const n of b) {
    let best = -1;
    let bestD = Infinity;
    a.forEach((m, k) => {
      if (used.has(k)) return;
      const d = Math.abs(m.f - n.f) + 0.5 * Math.abs(m.s - n.s);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    if (best < 0) c += 1.5;
    else {
      used.add(best);
      c += bestD === 0 ? -1 : bestD;
    }
  }
  const ga = grip(absFrets(from.frets, from.baseFret));
  if (!!ga.barre !== !!to.grip.barre) c += 1;
  if (ga.lo && to.grip.lo) c += 0.5 * Math.abs(ga.lo - to.grip.lo);
  return c;
}
