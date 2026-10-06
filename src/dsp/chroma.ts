// 12-bin pitch-class profile from a Hann-windowed FFT. Only interpolated spectral peaks that sit
// on a semitone count, and peaks explained as overtones of a lower note are discounted. That
// suppresses the leakage and overtone smear that make a plain chromagram hear E as E + B + G#.

import { fft } from './fft';

export const NO_PITCH = -120;

export interface ChromaFrame {
  chroma: number[];
  pitch: Float32Array;
}

export class Chroma {
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly win: Float64Array;
  private readonly mag: Float64Array;

  constructor(readonly size: number, readonly sampleRate: number, readonly fMin = 70, readonly fMax = 1400) {
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.mag = new Float64Array(size / 2);
    this.win = new Float64Array(size);
    for (let i = 0; i < size; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }

  /**
   * Normalised chroma (max = 1) plus per-MIDI pitch salience, or null when the frame is silent.
   * `pitch[m]` is the level in dB, relative to the strongest peak, of a spectral peak within
   * ±40 cents of MIDI note m's fundamental (NO_PITCH if there is none). Unlike chroma it is
   * octave-exact, which is what tells an open low E apart from the E on the D string.
   */
  compute(x: Float32Array, gate = 1e-12): ChromaFrame | null {
    const { size, re, im, win, mag, sampleRate } = this;
    for (let i = 0; i < size; i++) { re[i] = x[i] * win[i]; im[i] = 0; }
    fft(re, im);
    let tot = 0;
    for (let k = 1; k < size / 2; k++) { mag[k] = re[k] * re[k] + im[k] * im[k]; tot += mag[k]; }
    if (tot / size < gate) return null;
    const kMin = Math.ceil((this.fMin * size) / sampleRate);
    const kMax = Math.floor((this.fMax * size) / sampleRate);
    let peak = 0;
    for (let k = kMin; k <= kMax; k++) if (mag[k] > peak) peak = mag[k];
    const floor = peak * 3e-4;
    // Collect spectral peaks with sub-bin frequency, then keep only those that sit on a semitone.
    const peaks: Array<{ f: number; m: number }> = [];
    for (let k = Math.max(2, kMin); k <= kMax; k++) {
      const m = mag[k];
      if (m < floor || m < mag[k - 1] || m < mag[k + 1]) continue;
      const a = Math.log(mag[k - 1] + 1e-20), b = Math.log(m + 1e-20), c = Math.log(mag[k + 1] + 1e-20);
      const den = a - 2 * b + c;
      const off = den ? (0.5 * (a - c)) / den : 0;
      peaks.push({ f: ((k + off) * sampleRate) / size, m });
    }
    const out = new Array(12).fill(0);
    const pitch = new Float32Array(128).fill(NO_PITCH);
    const top = 10 * Math.log10(peak + 1e-30);
    for (const p of peaks) {
      const m = 69 + 12 * Math.log2(p.f / 440);
      const r = Math.round(m);
      if (r >= 0 && r < 128 && Math.abs(m - r) <= 0.4) pitch[r] = Math.max(pitch[r], 10 * Math.log10(p.m + 1e-30) - top);
    }
    for (const p of peaks) {
      const midi = 69 + 12 * Math.log2(p.f / 440);
      if (Math.abs(midi - Math.round(midi)) > 0.3) continue;
      // A peak that is the 2nd–6th harmonic of a stronger lower peak mostly belongs to that note.
      // The 5th harmonic (a major third up two octaves) is what turns Em into Emaj7 if left in.
      let own = 1;
      for (const h of [2, 3, 4, 5, 6]) {
        const sub = p.f / h;
        if (peaks.some((q) => Math.abs(1200 * Math.log2(q.f / sub)) < 35 && q.m > p.m * 0.3)) own *= h === 2 || h === 4 ? 0.6 : 0.2;
      }
      out[(((Math.round(midi) % 12) + 12) % 12)] += Math.sqrt(p.m) * own;
    }
    const mx = Math.max(...out);
    return mx > 0 ? { chroma: out.map((v) => v / mx), pitch } : null;
  }
}
