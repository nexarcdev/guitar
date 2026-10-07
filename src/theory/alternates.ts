// Other ways to play the chord in front of the player, each with a one-line reason that teaches
// something: the same chord elsewhere on the neck, another voicing, an easier grip, and the
// substitutions a guitarist reaches for (relative minor, power chord, sus and seventh colours).

import { identifyMidi, noteName, ord, pcOf, TEMPL, type ChordName, type Offsets, type Setup } from './music';
import type { Voicing } from './common';
import { absFrets, enumerateVoicings, grip, transitionCost, voicingKey, type Fingering } from './voicings';

export type AltKind = 'position' | 'voicing' | 'simpler' | 'substitute';

export interface Alternate {
  kind: AltKind;
  name: ChordName;
  voicing: Fingering;
  reason: string;
}

const INTERVAL: Record<number, string> = {
  1: 'flat ninth', 2: 'ninth', 3: 'minor third', 4: 'third', 5: 'fourth', 6: 'flat fifth', 7: 'fifth', 8: 'sharp fifth',
  9: 'sixth', 10: 'seventh', 11: 'major seventh',
};

const templ = (suf: string) => TEMPL.find(([s]) => s === suf)?.[1] ?? null;

/** The template suffix of a named chord ('' major, 'm' minor, '7', ...), or null. */
export function suffixOf(name: ChordName): string | null {
  if (name.root == null) return null;
  const iv = [...new Set(name.notes.map((p) => (p - name.root! + 12) % 12))].sort((a, b) => a - b);
  const hit = TEMPL.find(([, t]) => t.length === iv.length && t.every((v, i) => v === iv[i]));
  return hit ? hit[0] : null;
}

const pcsOf = (root: number, suf: string) => (templ(suf) ?? []).map((iv) => (root + iv) % 12);

const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');

/** Easiest playable voicing of a chord: open position, or a movable grip without open strings. */
function easiest(root: number, suf: string, setup: Setup): Fingering | null {
  const pcs = pcsOf(root, suf);
  if (!pcs.length) return null;
  const all = unsubsumed(enumerateVoicings(pcs, root, setup, { bass: root })).filter((v) => v.grip.lo <= 2 || !v.frets.includes(0));
  return all[0] ?? null;
}

function rank(list: Fingering[], from: Voicing | null): Fingering[] {
  return [...list].sort((a, b) => transitionCost(from, a) - transitionCost(from, b) || a.cost - b.cost);
}

export function alternates(cur: { name: ChordName; voicing: Voicing }, prev: Voicing | null, setup: Setup, perKind = 3): Alternate[] {
  const root = cur.name.root;
  const suf = suffixOf(cur.name);
  if (root == null || suf == null) return [];
  const o = setup.offsets;
  const N = (pc: number) => noteName(pc, o);
  const from = prev ?? cur.voicing;
  const curKey = voicingKey(cur.voicing);
  const curMidis = cur.voicing.midis.join(',');
  const curGrip = grip(absFrets(cur.voicing.frets, cur.voicing.baseFret));
  const curPcs = new Set(cur.voicing.midis.map(pcOf));
  const pcs = pcsOf(root, suf);
  const fresh = (v: Fingering) => voicingKey(v) !== curKey && v.midis.join(',') !== curMidis;
  const out: Alternate[] = [];
  const seen = new Set<string>();
  /** Up to `perKind` of a category, each voicing shown once across categories. Ranked by how far
   * the hand moves from the previous chord, or kept in the list's own (teaching) order. */
  const take = (kind: AltKind, list: Array<{ v: Fingering; name: ChordName; reason: string }>, ranked = true) => {
    let n = 0;
    for (const x of ranked ? rank(list.map((x) => x.v), from) : list.map((x) => x.v)) {
      if (n >= perKind) break;
      const key = voicingKey(x);
      if (seen.has(key)) continue;
      seen.add(key);
      const item = list.find((y) => y.v === x)!;
      out.push({ kind, name: item.name, voicing: x, reason: item.reason });
      n++;
    }
  };

  // Same pitch classes, any bass: positions and voicings come from one search. A voicing that
  // only drops strings from the current one, or from a fuller candidate, is not an alternative.
  const same = unsubsumed(enumerateVoicings(pcs, root, setup, { bass: null }).filter(fresh)).filter((v) => !subset(v, cur.voicing));
  const far = (v: Fingering) => Math.abs(v.grip.lo - curGrip.lo) >= 2 || (!!v.grip.lo !== !!curGrip.lo);
  const openPosition = (v: Fingering) => v.grip.lo <= 2;

  take(
    'position',
    same
      // A movable grip: up the neck it has no open strings.
      .filter((v) => pcOf(v.midis[0]) === root && far(v) && (openPosition(v) || !v.frets.includes(0)))
      .map((v) => ({
        v,
        name: cur.name,
        reason: v.grip.barre
          ? `Same ${cur.name.name}, barre at the ${ord(v.grip.barre.fret)} fret`
          : openPosition(v)
            ? `Same ${cur.name.name}, open position`
            : `Same ${cur.name.name}, ${ord(v.grip.lo)} fret`,
      })),
  );

  take(
    'voicing',
    same
      // Inversions anywhere; the same bass only when the voicing is fuller or lighter than now.
      .filter((v) => pcOf(v.midis[0]) !== root || (!far(v) && v.midis.length !== cur.voicing.midis.length))
      .map((v) => {
        const name = identifyMidi(v.midis, o);
        const bassPc = pcOf(v.midis[0]);
        const reason =
          bassPc !== root
            ? `${name.name}, the ${INTERVAL[(bassPc - root + 12) % 12] ?? 'bass'} in the bass`
            : `${name.name}, ${plural(v.midis.length, 'string')}, ${v.midis.length > cur.voicing.midis.length ? 'fuller' : 'lighter'}`;
        return { v, name, reason };
      }),
  );

  // Easier: fewer fingers, or the same chord without the barre; also the related colours that
  // open up a string (Cmaj7 for C, Fmaj7 for F, Am7 for Am).
  const easier = (v: Fingering) => v.grip.fingers < curGrip.fingers || (!!curGrip.barre && !v.grip.barre);
  const simpler: Array<{ v: Fingering; name: ChordName; reason: string }> = unsubsumed(
    enumerateVoicings(pcs, root, setup, { bass: root }).filter((v) => fresh(v) && easier(v)),
  ).map((v) => ({
      v,
      name: cur.name,
      reason: `${plural(v.midis.length, 'string')}, ${plural(v.grip.fingers, 'finger')}` + (curGrip.barre && !v.grip.barre ? ', no barre' : ''),
    }));
  const related = suf === '' ? ['maj7', 'add9', 'sus2'] : suf === 'm' ? ['m7'] : [];
  for (const rs of related) {
    const v = easiest(root, rs, setup);
    if (!v || !easier(v)) continue;
    const name = identifyMidi(v.midis, o);
    simpler.push({ v, name, reason: `${name.name}, ${change(curPcs, pcsOf(root, rs), N)}` + (curGrip.barre && !v.grip.barre ? ', open strings instead of the barre' : fewer(curGrip.fingers, v.grip.fingers)) });
  }
  take('simpler', simpler);

  take('substitute', substitutes(root, suf, setup, N, curPcs), false);
  return out;
}

const fewer = (was: number, now: number) => (now < was ? `, ${plural(was - now, 'finger')} fewer` : '');

/** Every sounding string of `a` is played the same way in `b`, `b` sounds more strings, and the
 * bass note is the same (a fuller voicing with a new bass is a different chord to the ear). */
function subset(a: Voicing, b: Voicing): boolean {
  const fa = absFrets(a.frets, a.baseFret);
  const fb = absFrets(b.frets, b.baseFret);
  return a.midis[0] === b.midis[0] && fa.every((f, i) => f < 0 || f === fb[i]) && fb.filter((f) => f >= 0).length > fa.filter((f) => f >= 0).length;
}

/** Drops fingerings that only mute strings of another fingering in the list. */
function unsubsumed<T extends Voicing>(list: T[]): T[] {
  return list.filter((v) => !list.some((w) => w !== v && subset(v, w)));
}

/** 'adds B', 'D instead of E', 'drops the seventh'. */
function change(before: Set<number>, after: number[], N: (pc: number) => string): string {
  const added = after.filter((p) => !before.has(p));
  const removed = [...before].filter((p) => !after.includes(p));
  if (added.length && removed.length) return `${added.map(N).join(' and ')} instead of ${removed.map(N).join(' and ')}`;
  if (added.length) return `adds ${added.map(N).join(' and ')}`;
  if (removed.length) return `drops ${removed.map(N).join(' and ')}`;
  return 'same notes';
}

/** In teaching order: the relative, the power chord, then the colours. */
function substitutes(root: number, suf: string, setup: Setup, N: (pc: number) => string, curPcs: Set<number>) {
  const list: Array<{ root: number; suf: string; reason: (name: string, pcs: number[]) => string }> = [];
  const shared = (pcs: number[]) => pcs.filter((p) => curPcs.has(p)).map(N).join(' and ');
  if (suf === '') {
    list.push({ root: (root + 9) % 12, suf: 'm', reason: (n, p) => `${n}, relative minor: shares ${shared(p)}` });
    list.push({ root, suf: '5', reason: (n) => `${n}, root and fifth only` });
    list.push({ root, suf: 'sus4', reason: (n) => `${n}: ${N(root + 5)} instead of ${N(root + 4)}, resolves back to ${N(root)}` });
    list.push({ root, suf: 'sus2', reason: (n) => `${n}: ${N(root + 2)} instead of ${N(root + 4)}, open sound` });
    list.push({ root, suf: '7', reason: (n) => `${n}: adds ${N(root + 10)}, pulls toward ${N(root + 5)}` });
    list.push({ root, suf: 'maj7', reason: (n) => `${n}: adds ${N(root + 11)}, softer` });
  } else if (suf === 'm') {
    list.push({ root: (root + 3) % 12, suf: '', reason: (n, p) => `${n}, relative major: shares ${shared(p)}` });
    list.push({ root, suf: '5', reason: (n) => `${n}, root and fifth only` });
    list.push({ root, suf: 'm7', reason: (n) => `${n}: adds ${N(root + 10)}, lighter` });
    list.push({ root, suf: 'sus2', reason: (n) => `${n}: ${N(root + 2)} instead of ${N(root + 3)}, neither major nor minor` });
  } else {
    const plain = suf.startsWith('m') && !suf.startsWith('maj') ? 'm' : '';
    list.push({ root, suf: plain, reason: (n, p) => `${n}, the plain triad: ${change(curPcs, p, N)}` });
    list.push({ root, suf: '5', reason: (n) => `${n}, root and fifth only` });
  }
  const out: Array<{ v: Fingering; name: ChordName; reason: string }> = [];
  for (const s of list) {
    const v = easiest(s.root, s.suf, setup);
    if (!v) continue;
    const name = identifyMidi(v.midis, setup.offsets);
    out.push({ v, name, reason: s.reason(name.name, pcsOf(s.root, s.suf)) });
  }
  return out;
}

export const noteNames = (pcs: number[], o: Offsets) => pcs.map((p) => noteName(p, o));
