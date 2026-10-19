// Lesson 4, playing along: G, Em, C, D, one bar each, looped. The click comes from the audio
// channel's synth; strums come from the chord detector. Each bar is scored on the first strum
// that names the expected chord: was it the right chord, and did it land near the bar line.

import { engine } from '../../audio/engine';
import { useStore, type Strum } from '../../state/store';
import { pcOf } from '../../theory/music';
import * as db from '../../state/db';
import { useLearn, type BarResult, type SkillScores } from './state';

export interface LessonChord {
  name: string;
  sub: string;
  /** Low E first; -1 muted. */
  frets: [number, number, number, number, number, number];
  fingers: Array<number | string>;
  /** Root pitch class and whether the third is minor: how a heard chord is matched. */
  root: number;
  minor: boolean;
}

export const LESSON = {
  title: 'Lesson 4 · Playing along',
  part: 'Open chords · part 2 of 3',
  key: 'G',
  meter: '4/4',
  chords: [
    { name: 'G', sub: 'major', frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], root: 7, minor: false },
    { name: 'Em', sub: 'minor', frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], root: 4, minor: true },
    { name: 'C', sub: 'major', frets: [-1, 3, 2, 0, 1, 0], fingers: ['', 3, 2, 0, 1, 0], root: 0, minor: false },
    { name: 'D', sub: 'major', frets: [-1, -1, 0, 2, 3, 2], fingers: ['', '', 0, 1, 3, 2], root: 2, minor: false },
  ] as LessonChord[],
  /** Times through the progression before the run ends on its own. */
  passes: 8,
  /** Lessons after this one (not built yet, listed so you know what's coming). */
  next: [
    { title: 'Part 3 · Faster changes, 84 BPM', meta: '6 min' },
    { title: 'Strumming · down-down-up-up-down-up', meta: '8 min' },
    { title: 'Lesson 5 · Your first barre: F', meta: 'After part 3' },
  ],
};

/** What to try when one change keeps landing late (fingerings as on the charts). */
export const CHANGE_TIPS: Record<string, string> = {
  'G>Em': 'Em is two fingers at the 2nd fret on the A and D strings. Lift everything from G and drop both together.',
  'Em>C': 'While Em rings, aim finger 3 at the A string, 3rd fret. It leads the C shape.',
  'C>D': 'Lead with finger 1: from the B string, 1st fret, to the G string, 2nd fret.',
  'D>G': 'Place finger 3 on the high e first, then fingers 2 and 1 fall onto the low strings.',
};

export const BPM_MIN = 40;
export const BPM_MAX = 160;
const BARS = LESSON.chords.length;
/** A change counts as on time within a quarter beat of the bar line. */
const ON_TIME_BEATS = 0.25;

const spb = () => 60 / useLearn.getState().bpm;

/** Does a heard strum name this chord? Root plus third: G6 still counts as G, Gm doesn't. */
export function matches(h: Strum, c: LessonChord) {
  const r = h.name.root;
  if (r == null || pcOf(r) !== c.root) return false;
  const pcs = new Set(h.name.notes.map(pcOf));
  const minor = pcs.has((r + 3) % 12) && !pcs.has((r + 4) % 12);
  return minor === c.minor;
}

// ---------------------------------------------------------------- transport

let stopClicks: (() => void) | null = null;
let unsub: (() => void) | null = null;

/** Starts the run: one bar of clicks first when count-in is on, then the progression. */
export function start() {
  stop(false);
  engine.resume();
  const { bpm, countIn } = useLearn.getState();
  const beat = 60 / bpm;
  const lead = countIn ? 4 : 0;
  const beats = lead + LESSON.passes * BARS * 4;
  const clicks = Array.from({ length: beats }, (_, i) => ({ t: i * beat, hz: i % 4 === 0 ? 1568 : 1047 }));
  const p = engine.playNotes(clicks, 0, 0.05);
  stopClicks = p.stop;
  useLearn.setState({ playing: true, zero: p.zero + lead * beat, totalBars: LESSON.passes * BARS, bar: countIn ? -1 : 0, beat: 0, results: [] });
  // Strums arrive on the listening clock; place them on the lesson's clock by how long ago they were.
  let lastT = useStore.getState().heard?.t ?? -1;
  unsub = useStore.subscribe((s) => {
    const h = s.heard;
    if (!h || h.quiet || h.t === lastT) return;
    lastT = h.t;
    const at = engine.now() - Math.max(0, engine.clock() - h.t);
    score(h, at);
  });
}

/** Stops the click; `keep` leaves the run's results (and saves its scores). */
export function stop(keep = true) {
  stopClicks?.();
  stopClicks = null;
  unsub?.();
  unsub = null;
  const s = useLearn.getState();
  if (!s.playing) return;
  useLearn.setState({ playing: false, bar: -1, beat: 0 });
  if (keep) {
    const sk = skillsOf(s.results, s.bpm);
    if (sk) {
      useLearn.setState({ skills: sk });
      db.setKV('learn', { skills: sk }).catch(() => {});
    }
  }
}

/** Tempo changes restart the run from the top so the click and the scoring stay in step. */
export function setBpm(bpm: number) {
  const v = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
  const playing = useLearn.getState().playing;
  useLearn.setState({ bpm: v });
  if (playing) start();
}

/** Called every animation frame while playing: where the playhead is, in bars. */
export function position(now = engine.now()) {
  const s = useLearn.getState();
  return (now - s.zero) / (spb() * 4);
}

/** Advances bar and beat (state changes once a beat, never per frame) and ends the run. */
export function tick(now = engine.now()) {
  const s = useLearn.getState();
  if (!s.playing) return;
  const pos = position(now);
  if (pos >= s.totalBars) {
    stop(true);
    return;
  }
  const bar = Math.floor(pos);
  const beat = Math.min(3, Math.floor((pos - bar) * 4));
  if (bar !== s.bar || beat !== s.beat) useLearn.setState({ bar, beat });
}

// ---------------------------------------------------------------- scoring

function score(h: Strum, at: number) {
  const s = useLearn.getState();
  if (!s.playing) return;
  const beat = spb();
  const pos = (at - s.zero) / beat; // in beats
  // A strum just before a bar line belongs to the bar it is reaching for.
  const bar = Math.floor((pos + ON_TIME_BEATS) / 4);
  if (bar < 0 || bar >= s.totalBars) return;
  const chord = LESSON.chords[bar % BARS];
  const offsetBeats = pos - bar * 4;
  const results = [...s.results];
  const prev = results.find((r) => r.bar === bar);
  // Timing: every strum, against the nearest beat.
  const nearest = Math.round(pos);
  const timingMs = Math.abs(pos - nearest) * beat * 1000;
  if (!prev) results.push({ bar, ok: matches(h, chord), offsetMs: matches(h, chord) ? offsetBeats * beat * 1000 : null, timing: [timingMs] });
  else {
    prev.timing = [...prev.timing, timingMs];
    if (!prev.ok && matches(h, chord)) {
      prev.ok = true;
      prev.offsetMs = offsetBeats * beat * 1000;
    }
  }
  useLearn.setState({ results });
}

export interface RunStats {
  /** Bars finished so far. */
  bars: number;
  correct: number;
  /** Changes into a new chord that have been due (every bar after the first). */
  changes: number;
  onTime: number;
  meanTimingMs: number | null;
  /** The change that most often lands late, when one does. */
  lateChange: string | null;
}

export function statsOf(results: readonly BarResult[], upTo: number, bpm: number): RunStats {
  const win = ON_TIME_BEATS * (60 / bpm) * 1000;
  const done = results.filter((r) => r.bar < upTo);
  const bars = Math.max(0, upTo);
  const correct = done.filter((r) => r.ok).length;
  const due = done.filter((r) => r.bar > 0);
  const changes = Math.max(0, bars - 1);
  const on = due.filter((r) => r.ok && r.offsetMs != null && Math.abs(r.offsetMs) <= win);
  const timing = done.flatMap((r) => r.timing);
  // Late: right chord, after the window, or never right in its bar.
  const late = new Map<string, number>();
  for (let b = 1; b < bars; b++) {
    const r = done.find((x) => x.bar === b);
    const isLate = !r || !r.ok || (r.offsetMs != null && r.offsetMs > win);
    if (!isLate) continue;
    const key = `${LESSON.chords[(b - 1) % BARS].name}>${LESSON.chords[b % BARS].name}`;
    late.set(key, (late.get(key) ?? 0) + 1);
  }
  const worst = [...late.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    bars,
    correct,
    changes,
    onTime: on.length,
    meanTimingMs: timing.length ? timing.reduce((a, b) => a + b, 0) / timing.length : null,
    lateChange: worst && worst[1] >= 2 && done.some((r) => r.timing.length) ? worst[0] : null,
  };
}

/** Skill scores from a run, or null when nothing was played. */
export function skillsOf(results: readonly BarResult[], bpm: number): SkillScores | null {
  if (!results.length) return null;
  const upTo = Math.max(...results.map((r) => r.bar)) + 1;
  const st = statsOf(results, upTo, bpm);
  return {
    openChords: Math.round((100 * st.correct) / Math.max(1, st.bars)),
    changes: Math.round((100 * st.onTime) / Math.max(1, st.changes)),
    timing: st.meanTimingMs == null ? 0 : Math.round(Math.max(0, Math.min(100, 100 - st.meanTimingMs / 2))),
  };
}

/** Reads the last saved scores once. */
export async function loadSkills() {
  const v = await db.getKV<{ skills?: SkillScores }>('learn').catch(() => undefined);
  if (v?.skills && !useLearn.getState().skills) useLearn.setState({ skills: v.skills });
}
