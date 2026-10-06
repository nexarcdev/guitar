// Turns a stream of audio chunks into pitch frames, chroma frames and fast single-note onsets.
// Runs inside the pitch worker; kept free of worker APIs so it can be tested directly.

import { Yin } from './yin';
import { Chroma } from './chroma';

export interface PitchFrame {
  /** Listening-clock seconds at the centre of the analysis frame. */
  t: number;
  freq: number;
  clarity: number;
  rms: number;
}

export interface FastNote {
  midi: number;
  t: number;
}

export interface TrackerOutput {
  frames: PitchFrame[];
  notes: FastNote[];
  chroma: number[] | null | undefined;
  /** Peak level of the chunk, 0–1, for the input meter. */
  peak: number;
}

const FRAME = 2048;
const CHROMA_N = 8192;
const RING = 16384;
const VOICED_CLARITY = 0.86;
const GATE = 0.006;

export class Tracker {
  private readonly yin: Yin;
  private readonly chroma: Chroma;
  private readonly hop: number;
  private readonly chromaEvery: number;
  private ring = new Float32Array(RING);
  /** Absolute index of the next sample to be written. */
  private end = 0;
  private nextFrame = FRAME;
  private nextChroma = CHROMA_N;
  private frame = new Float32Array(FRAME);
  private cframe = new Float32Array(CHROMA_N);
  // onset tracking
  private cur = -1;
  private stable = 0;
  private lastEmit = -1;
  private quiet = 0;
  private rmsHist: number[] = [];
  private attack = false;

  constructor(readonly sampleRate: number) {
    this.yin = new Yin(FRAME, sampleRate);
    this.chroma = new Chroma(CHROMA_N, sampleRate);
    this.hop = sampleRate >= 44100 ? 512 : 256;
    this.chromaEvery = Math.round(sampleRate * 0.06);
  }

  private copy(dst: Float32Array, endAbs: number) {
    const n = dst.length;
    const start = endAbs - n;
    for (let i = 0; i < n; i++) dst[i] = this.ring[(start + i) & (RING - 1)];
  }

  push(t0: number, data: Float32Array): TrackerOutput {
    // A jump in the clock means the stream restarted; resync rather than analyse garbage.
    if (t0 !== this.end) {
      this.end = t0;
      this.nextFrame = t0 + FRAME;
      this.nextChroma = t0 + CHROMA_N;
      this.cur = -1;
      this.lastEmit = -1;
    }
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      this.ring[(this.end + i) & (RING - 1)] = data[i];
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    this.end += data.length;
    const out: TrackerOutput = { frames: [], notes: [], chroma: undefined, peak };

    while (this.nextFrame <= this.end) {
      this.copy(this.frame, this.nextFrame);
      const r = this.yin.detect(this.frame, GATE);
      const t = (this.nextFrame - FRAME / 2) / this.sampleRate;
      out.frames.push({ t, freq: r.freq, clarity: r.clarity, rms: r.rms });
      this.onsets(r.freq, r.clarity, r.rms, t, out.notes);
      this.nextFrame += this.hop;
    }
    while (this.nextChroma <= this.end) {
      this.copy(this.cframe, this.nextChroma);
      out.chroma = this.chroma.compute(this.cframe);
      this.nextChroma += this.chromaEvery;
    }
    return out;
  }

  private onsets(freq: number, clarity: number, rms: number, t: number, notes: FastNote[]) {
    // Attack = energy jumps well above its recent floor; lets a re-picked note of the same pitch count again.
    const h = this.rmsHist;
    h.push(rms);
    if (h.length > 8) h.shift();
    const floor = Math.min(...h.slice(0, -1));
    if (rms > GATE * 2 && rms > floor * 1.8) this.attack = true;

    const voiced = freq > 0 && clarity >= VOICED_CLARITY;
    if (!voiced) {
      if (++this.quiet >= 6) { this.lastEmit = -1; this.cur = -1; }
      this.stable = 0;
      return;
    }
    this.quiet = 0;
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    if (midi === this.cur) this.stable++;
    else { this.cur = midi; this.stable = 1; }
    if (this.stable === 3 && (midi !== this.lastEmit || this.attack)) {
      notes.push({ midi, t: t - (2 * this.hop) / this.sampleRate });
      this.lastEmit = midi;
      this.attack = false;
    }
  }
}
