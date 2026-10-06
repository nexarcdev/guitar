// Turns a stream of audio chunks into pitch frames, chroma frames and fast single-note onsets.
// Runs inside the pitch worker; kept free of worker APIs so it can be tested directly.
//
// Everything is judged relative to a continuously measured noise floor rather than a fixed
// level, so a quiet guitar cable works as well as a hot interface: the gate opens ~12 dB above
// the floor and closes ~6 dB above it, which also stops decaying strings and hum from
// producing readings.

import { Yin } from './yin';
import { Chroma, type ChromaFrame } from './chroma';

export interface PitchFrame {
  /** Listening-clock seconds at the centre of the analysis frame. */
  t: number;
  freq: number;
  clarity: number;
  rms: number;
  /** Gate open, clear pitch, and consistent with the last few frames: safe to show on a tuner. */
  stable: boolean;
}

export interface FastNote {
  midi: number;
  t: number;
}

export interface Levels {
  /** Measured noise floor, dBFS. */
  floorDb: number;
  /** Gate threshold above the floor in use (dB). */
  openDb: number;
  /** Seconds since the last pick attack (Infinity if none yet). */
  sinceAttack: number;
  /** Recent playing peak, dBFS (decays slowly). */
  peakDb: number;
  gate: boolean;
}

export interface TrackerOutput {
  frames: PitchFrame[];
  notes: FastNote[];
  /** undefined = no chroma frame in this chunk; null = gate closed (nothing playing). */
  chroma: ChromaFrame | null | undefined;
  /** Peak level of the chunk, 0–1, for the input meter. */
  peak: number;
  levels: Levels;
}

const FRAME = 2048;
const CHROMA_N = 8192;
const RING = 16384;
const VOICED_CLARITY = 0.9;
/** Default gate threshold above the floor (dB); the gate closes 6 dB lower. */
export const OPEN_DB = 12;
const HYSTERESIS_DB = 6;
/** The level must clear the threshold this many frames in a row: guitar attacks do, clicks and crackle don't. */
const OPEN_FRAMES = 2;
/** Below this the input is digital silence regardless of the floor. */
const ABS_MIN_DB = -90;
/**
 * Floor = 20th percentile of frame levels over the last 5 s. A percentile, not the minimum: the
 * single quietest moment of steady noise sits several dB below its typical level, and a floor
 * that low lets ordinary noise open the gate during long pauses.
 */
const FLOOR_SEC = 5;
const FLOOR_PCT = 0.2;
const CAL_SEC = 0.4;
/** Floor rise rates (dB/s) while playing and while idle. */
const RISE_PLAYING = 0.2;
const RISE_IDLE = 1.5;
/** After an attack, wait this long for the pitch to settle before naming the note. */
const ATTACK_SEC = 0.3;
const SETTLE_FRAMES = 5;
/** Legato notes must hold this many frames within this many dB of the picked level. */
const LEGATO_FRAMES = 8;
const LEGATO_DROP_DB = 9;

const db = (x: number) => 20 * Math.log10(x + 1e-12);

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
  // level tracking
  private hist: Float32Array;
  private histN = 0;
  private histI = 0;
  private floorDb = -80;
  private age = 0;
  private openDb = OPEN_DB;
  private above = 0;
  private sorted: Float32Array;
  private peakDb = -100;
  private gate = false;
  private recent: number[] = [];
  private sinceAttack = Infinity;
  // pitch stability
  private pitches: number[] = [];
  // onset tracking
  private cand: number[] = [];
  private lastEmit = -1;
  private quiet = 0;
  private attack = false;
  private notePeak = -100;

  constructor(readonly sampleRate: number) {
    this.yin = new Yin(FRAME, sampleRate);
    this.chroma = new Chroma(CHROMA_N, sampleRate);
    this.hop = sampleRate >= 44100 ? 512 : 256;
    this.chromaEvery = Math.round(sampleRate * 0.06);
    this.hist = new Float32Array(Math.ceil((FLOOR_SEC * sampleRate) / this.hop));
    this.sorted = new Float32Array(this.hist.length);
  }

  /** Noise gate margin above the floor: lower hears quieter playing, higher ignores more noise. */
  setOpenDb(db: number) {
    this.openDb = db;
  }

  /** Start a fresh baseline, e.g. after switching input device. */
  recalibrate() {
    this.histN = 0;
    this.histI = 0;
    this.age = 0;
    this.gate = false;
  }

  levels(): Levels {
    return { floorDb: this.floorDb, openDb: this.openDb, sinceAttack: this.sinceAttack, peakDb: this.peakDb, gate: this.gate };
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
      this.cand = [];
      this.lastEmit = -1;
      this.pitches = [];
    }
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      this.ring[(this.end + i) & (RING - 1)] = data[i];
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    this.end += data.length;
    const out: TrackerOutput = { frames: [], notes: [], chroma: undefined, peak, levels: this.levels() };

    while (this.nextFrame <= this.end) {
      this.copy(this.frame, this.nextFrame);
      const t = (this.nextFrame - FRAME / 2) / this.sampleRate;
      let rms = 0;
      for (let i = 0; i < FRAME; i++) rms += this.frame[i] * this.frame[i];
      rms = Math.sqrt(rms / FRAME);
      const level = db(rms);
      this.track(level);
      // YIN only runs while something is playing; the gate is the noise rejection, not YIN.
      const r = this.gate ? this.yin.detect(this.frame, 0) : { freq: -1, clarity: 0, rms };
      const stable = this.stability(r.freq, r.clarity);
      out.frames.push({ t, freq: r.freq, clarity: r.clarity, rms, stable });
      this.onsets(r.freq, r.clarity, level, t, out.notes);
      this.nextFrame += this.hop;
    }
    while (this.nextChroma <= this.end) {
      this.copy(this.cframe, this.nextChroma);
      out.chroma = this.gate ? this.chroma.compute(this.cframe) : null;
      this.nextChroma += this.chromaEvery;
    }
    out.levels = this.levels();
    return out;
  }

  /** Noise floor (rolling minimum), playing peak, gate with hysteresis, attack detection. */
  private track(level: number) {
    const h = this.hist;
    h[this.histI] = level;
    this.histI = (this.histI + 1) % h.length;
    if (this.histN < h.length) this.histN++;
    const sv = this.sorted.subarray(0, this.histN);
    sv.set(h.subarray(0, this.histN));
    sv.sort();
    const target = Math.max(-110, sv[Math.floor((this.histN - 1) * FLOOR_PCT)]);
    const dt = this.hop / this.sampleRate;
    this.age += dt;
    // Calibrate from the first ~0.4 s. After that the floor drops at once to quieter noise but
    // rises slowly, so minutes of continuous strumming can't lift it into the music.
    if (this.age < CAL_SEC || target < this.floorDb) this.floorDb = target;
    else this.floorDb += Math.min(target - this.floorDb, (this.gate ? RISE_PLAYING : RISE_IDLE) * dt);

    this.above = level > Math.max(this.floorDb + this.openDb, ABS_MIN_DB) ? this.above + 1 : 0;
    if (!this.gate && this.above >= OPEN_FRAMES) this.gate = true;
    else if (this.gate && level < this.floorDb + this.openDb - HYSTERESIS_DB) this.gate = false;

    if (this.gate) this.peakDb = Math.max(level, this.peakDb);
    else this.peakDb = Math.max(this.floorDb, this.peakDb - 0.02);

    // Attack: a jump of 6 dB over the quietest of the last ~80 ms while the gate is open.
    const rc = this.recent;
    rc.push(level);
    if (rc.length > 8) rc.shift();
    const prev = rc.slice(0, -1);
    this.sinceAttack += this.hop / this.sampleRate;
    // Attack: the level jumps above everything in the last ~80 ms (beating on a ringing string
    // dips and recovers but never exceeds its recent maximum).
    if (this.gate && prev.length && level > Math.max(...prev) + 3 && level > Math.min(...prev) + 6) {
      this.attack = true;
      this.sinceAttack = 0;
      this.cand = [];
      this.notePeak = level;
    }
    if (this.gate) this.notePeak = Math.max(this.notePeak, level);
  }

  /** A reading is stable when it agrees (±35 cents) with the median of the last five voiced frames. */
  private stability(freq: number, clarity: number) {
    if (!this.gate || freq <= 0 || clarity < VOICED_CLARITY) {
      this.pitches = [];
      return false;
    }
    const m = 69 + 12 * Math.log2(freq / 440);
    const p = this.pitches;
    p.push(m);
    if (p.length > 5) p.shift();
    if (p.length < 3) return false;
    const med = [...p].sort((a, b) => a - b)[p.length >> 1];
    return Math.abs(m - med) < 0.35;
  }

  private onsets(freq: number, clarity: number, level: number, t: number, notes: FastNote[]) {
    const voiced = this.gate && freq > 0 && clarity >= VOICED_CLARITY;
    if (!voiced) {
      if (++this.quiet >= 6) { this.lastEmit = -1; this.cand = []; }
      return;
    }
    this.quiet = 0;
    const m = 69 + 12 * Math.log2(freq / 440);
    const emit = (midi: number) => {
      notes.push({ midi, t: t - ((this.cand.length - 1) * this.hop) / this.sampleRate });
      this.lastEmit = midi;
      this.cand = [];
    };
    if (this.attack) {
      // Picked notes start sharp; judge the pitch by the median of the frames after the attack.
      this.cand.push(m);
      if (this.cand.length >= SETTLE_FRAMES) {
        const sorted = [...this.cand].sort((a, b) => a - b);
        const med = sorted[sorted.length >> 1];
        const tail = this.cand.slice(-3);
        if (Math.max(...tail) - Math.min(...tail) < 0.6) emit(Math.round(med));
        else if (this.cand.length > SETTLE_FRAMES * 3) this.cand = [];
        if (this.lastEmit === Math.round(med)) this.attack = false;
      }
      if (this.sinceAttack > ATTACK_SEC) { this.attack = false; this.cand = []; }
      return;
    }
    // Legato (hammer-on, pull-off, slide): a new pitch that holds while the note is still
    // near its picked level. A string being muted or dying away doesn't qualify.
    const r = Math.round(m);
    if (r === this.lastEmit || level < this.notePeak - LEGATO_DROP_DB) { this.cand = []; return; }
    if (this.cand.length && Math.round(this.cand[this.cand.length - 1]) !== r) this.cand = [];
    this.cand.push(m);
    if (this.cand.length >= LEGATO_FRAMES) emit(r);
  }
}
