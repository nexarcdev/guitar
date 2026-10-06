// YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002) with the difference
// function computed through FFT cross-correlation, so a 2048-sample frame costs O(N log N).

import { fft } from './fft';

export interface PitchResult {
  /** Hz, or -1 when unvoiced. */
  freq: number;
  /** 1 − aperiodicity at the chosen lag; ~1 for a clean string, low for noise. */
  clarity: number;
  rms: number;
}

export class Yin {
  private readonly w: number;
  private readonly size: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly re2: Float64Array;
  private readonly im2: Float64Array;
  private readonly d: Float64Array;

  /** `frame` samples are analysed; lags up to frame/2 are searched. */
  constructor(
    readonly frame: number,
    readonly sampleRate: number,
    readonly threshold = 0.12,
    readonly minFreq = 45,
    readonly maxFreq = 1400,
  ) {
    this.w = frame / 2;
    this.size = frame * 2;
    this.re = new Float64Array(this.size);
    this.im = new Float64Array(this.size);
    this.re2 = new Float64Array(this.size);
    this.im2 = new Float64Array(this.size);
    this.d = new Float64Array(this.w);
  }

  detect(x: Float32Array, gate = 0.008): PitchResult {
    const { w, size, re, im, re2, im2, d, frame } = this;
    let rms = 0;
    for (let i = 0; i < frame; i++) rms += x[i] * x[i];
    rms = Math.sqrt(rms / frame);
    if (rms < gate) return { freq: -1, clarity: 0, rms };

    // c(τ) = Σ_{j<w} x[j]·x[j+τ] via FFT(x) · conj(FFT(x[0..w)))
    re.fill(0); im.fill(0); re2.fill(0); im2.fill(0);
    for (let i = 0; i < frame; i++) re[i] = x[i];
    for (let i = 0; i < w; i++) re2[i] = x[i];
    fft(re, im);
    fft(re2, im2);
    for (let k = 0; k < size; k++) {
      const ar = re[k], ai = im[k], br = re2[k], bi = -im2[k];
      re[k] = ar * br - ai * bi;
      im[k] = ar * bi + ai * br;
    }
    fft(re, im, true);

    // d(τ) = e(0) + e(τ) − 2c(τ), with e(τ) = Σ_{j<w} x[j+τ]² maintained incrementally
    let e0 = 0;
    for (let j = 0; j < w; j++) e0 += x[j] * x[j];
    let et = e0;
    d[0] = 0;
    for (let t = 1; t < w; t++) {
      et += x[t + w - 1] * x[t + w - 1] - x[t - 1] * x[t - 1];
      d[t] = e0 + et - (2 * re[t]) / size;
    }
    // cumulative mean normalised difference
    let sum = 0;
    d[0] = 1;
    for (let t = 1; t < w; t++) {
      sum += d[t];
      d[t] = sum > 0 ? (d[t] * t) / sum : 1;
    }

    const tMin = Math.max(2, Math.floor(this.sampleRate / this.maxFreq));
    const tMax = Math.min(w - 2, Math.ceil(this.sampleRate / this.minFreq));
    let tau = -1;
    for (let t = tMin; t < tMax; t++) {
      if (d[t] < this.threshold) {
        while (t + 1 < tMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      // No dip under threshold: take the global minimum but report low clarity.
      let m = Infinity;
      for (let t = tMin; t < tMax; t++) if (d[t] < m) { m = d[t]; tau = t; }
      if (tau < 0 || m > 0.35) return { freq: -1, clarity: 1 - Math.min(1, m), rms };
    }
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    const shift = den ? (a - c) / (2 * den) : 0;
    const t = tau + Math.max(-1, Math.min(1, shift));
    return { freq: this.sampleRate / t, clarity: 1 - Math.min(1, b), rms };
  }
}
