// Learn keeps its own small store: the lesson's transport and this session's results.
import { create } from 'zustand';

export interface BarResult {
  /** Bar index in the run (0 = the first G). */
  bar: number;
  /** The expected chord was heard in this bar. */
  ok: boolean;
  /** When it was first heard, from the bar line (negative is early). */
  offsetMs: number | null;
  /** Each strum's distance from its nearest beat. */
  timing: number[];
}

export interface SkillScores {
  openChords: number;
  changes: number;
  timing: number;
}

export interface LearnState {
  view: 'charts' | 'tab';
  bpm: number;
  countIn: boolean;
  playing: boolean;
  /** `engine.now()` seconds at the first beat of bar 0. */
  zero: number;
  totalBars: number;
  /** Current bar of the run (-1 during the count-in or when stopped). */
  bar: number;
  beat: number;
  results: BarResult[];
  /** The last finished run's scores (persisted). */
  skills: SkillScores | null;
}

export const useLearn = create<LearnState>(() => ({
  view: 'charts',
  bpm: 72,
  countIn: true,
  playing: false,
  zero: 0,
  totalBars: 0,
  bar: -1,
  beat: 0,
  results: [],
  skills: null,
}));
