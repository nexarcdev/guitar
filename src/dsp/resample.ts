// Streaming windowed-sinc resampler. Used to feed basic-pitch, which expects 22.05 kHz mono.

const PHASES = 256;

export class Resampler {
  private readonly ratio: number;
  private readonly half: number;
  private readonly cutoff: number;
  private hist: Float32Array;
  /** Kernel precomputed at PHASES fractional offsets: no trig per output sample. */
  private table: Float32Array;
  /** Fractional read position into `hist` for the next output sample. */
  private pos: number;

  constructor(readonly inRate: number, readonly outRate: number, half = 16) {
    this.ratio = inRate / outRate;
    this.half = half;
    // Anti-alias below the lower Nyquist with a little transition room.
    this.cutoff = Math.min(1, outRate / inRate) * 0.92;
    this.hist = new Float32Array(half * 2);
    this.pos = half;
    const taps = half * 2;
    this.table = new Float32Array((PHASES + 1) * taps);
    for (let ph = 0; ph <= PHASES; ph++) {
      const frac = ph / PHASES;
      for (let k = -half + 1; k <= half; k++) this.table[ph * taps + (k + half - 1)] = this.kernel(k - frac);
    }
  }

  private kernel(x: number) {
    if (x === 0) return this.cutoff;
    const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / (this.half + 1)) + 0.08 * Math.cos((2 * Math.PI * x) / (this.half + 1));
    return (Math.sin(Math.PI * this.cutoff * x) / (Math.PI * x)) * w;
  }

  process(input: Float32Array): Float32Array {
    const buf = new Float32Array(this.hist.length + input.length);
    buf.set(this.hist);
    buf.set(input, this.hist.length);
    const out: number[] = [];
    const h = this.half;
    let p = this.pos;
    const taps = h * 2;
    const tb = this.table;
    while (p + h < buf.length) {
      const c = Math.floor(p);
      const row = Math.round((p - c) * PHASES) * taps;
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += buf[c - h + 1 + k] * tb[row + k];
      out.push(acc);
      p += this.ratio;
    }
    const keep = Math.floor(p) - h;
    this.hist = buf.slice(keep);
    this.pos = p - keep;
    return Float32Array.from(out);
  }
}
