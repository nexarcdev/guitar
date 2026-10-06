// Input conditioner for the monitored signal (what you hear through Output and what the looper
// records). Quiet guitar cables come in 20–30 dB low, so this measures the noise floor and your
// playing level and applies an automatic gain, with a noise gate so the boost never turns the
// cable's hiss into audible noise between notes. Pure so it can be unit tested.

const db = (x: number) => 20 * Math.log10(x + 1e-12);
const lin = (d: number) => Math.pow(10, d / 20);

/** Where playing peaks should land after the boost (dBFS). */
export const TARGET_DB = -14;
export const MAX_GAIN_DB = 24;
const OPEN_DB = 12;
const CLOSE_DB = 6;
const CAL_SEC = 0.4;
const FLOOR_SEC = 2.5;

export interface ConditionerView {
  floorDb: number;
  peakDb: number;
  gainDb: number;
  gate: boolean;
}

export class ConditionerCore {
  private hist: Float32Array;
  private histN = 0;
  private histI = 0;
  private age = 0;
  floorDb = -80;
  peakDb = -100;
  gainDb = 0;
  gate = false;
  private gateGain = 0;
  private hold = 0;
  private readonly blockSec: number;
  private readonly attackStep: number;
  private readonly releaseStep: number;

  constructor(readonly sampleRate: number, readonly block = 128) {
    this.blockSec = block / sampleRate;
    this.hist = new Float32Array(Math.ceil(FLOOR_SEC / this.blockSec));
    // per-sample ramps: ~2 ms gate attack, ~120 ms release
    this.attackStep = 1 / (0.002 * sampleRate);
    this.releaseStep = 1 / (0.12 * sampleRate);
  }

  process(input: Float32Array, output: Float32Array) {
    const n = input.length;
    let sum = 0, pk = 0;
    for (let i = 0; i < n; i++) {
      sum += input[i] * input[i];
      const a = Math.abs(input[i]);
      if (a > pk) pk = a;
    }
    const level = db(Math.sqrt(sum / n));
    this.track(level, db(pk), n / this.sampleRate);

    const g = lin(this.gainDb);
    const target = this.gate ? 1 : 0;
    for (let i = 0; i < n; i++) {
      if (this.gateGain < target) this.gateGain = Math.min(target, this.gateGain + this.attackStep);
      else if (this.gateGain > target) this.gateGain = Math.max(target, this.gateGain - this.releaseStep);
      let y = input[i] * g * this.gateGain;
      // Gentle safety clip above -2 dBFS instead of hard digital clipping.
      if (y > 0.8) y = 0.8 + 0.2 * Math.tanh((y - 0.8) / 0.2);
      else if (y < -0.8) y = -0.8 + 0.2 * Math.tanh((y + 0.8) / 0.2);
      output[i] = y;
    }
  }

  private track(level: number, peak: number, dt: number) {
    const h = this.hist;
    h[this.histI] = level;
    this.histI = (this.histI + 1) % h.length;
    if (this.histN < h.length) this.histN++;
    let min = Infinity;
    for (let i = 0; i < this.histN; i++) if (h[i] < min) min = h[i];
    const target = Math.max(-110, min + 3);
    this.age += dt;
    if (this.age < CAL_SEC || target < this.floorDb) this.floorDb = target;
    else this.floorDb += Math.min(target - this.floorDb, (this.gate ? 0.2 : 1.5) * dt);
    // Prefer the shared floor while it's fresh, so every part of the app agrees on what's noise.
    let open = OPEN_DB, close = CLOSE_DB;
    if (this.ext && (this.ext.age += dt) < 1) {
      this.floorDb = this.ext.floorDb;
      open = this.ext.openDb;
      close = this.ext.openDb - (OPEN_DB - CLOSE_DB);
    }

    if (level > this.floorDb + open) {
      this.gate = true;
      this.hold = 0.08;
    } else if (level < this.floorDb + close) {
      this.hold -= dt;
      if (this.hold <= 0) this.gate = false;
    }

    // Playing level: the recent peak while the gate is open, decaying 1 dB/s. It holds during
    // silence, so the boost doesn't creep up between songs and blast the next note.
    if (this.gate) this.peakDb = Math.max(peak, this.peakDb - dt);
    else this.peakDb = Math.max(this.floorDb + open, this.peakDb);

    // Gain chases the target upward at 6 dB/s and backs off fast (30 dB/s) on loud hits.
    const want = Math.max(0, Math.min(MAX_GAIN_DB, TARGET_DB - this.peakDb));
    if (want > this.gainDb) this.gainDb = Math.min(want, this.gainDb + 6 * dt);
    else this.gainDb = Math.max(want, this.gainDb - 30 * dt);
  }

  /** App-wide floor and gate margin from the analysis tracker; overrides the local estimate. */
  private ext: { floorDb: number; openDb: number; age: number } | null = null;
  setFloor(floorDb: number, openDb: number) {
    this.ext = { floorDb, openDb, age: 0 };
  }

  recalibrate() {
    this.histN = 0;
    this.histI = 0;
    this.age = 0;
  }

  view(): ConditionerView {
    return { floorDb: this.floorDb, peakDb: this.peakDb, gainDb: this.gainDb, gate: this.gate };
  }
}
