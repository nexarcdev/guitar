import { describe, expect, it } from 'vitest';
import { Yin } from '../src/dsp/yin';
import { Chroma } from '../src/dsp/chroma';
import { Resampler } from '../src/dsp/resample';

const SR = 48000;
/** Harmonic-rich pluck-ish tone: sawtooth-like partials with decay. */
function tone(freqs: number[], n: number, sr = SR) {
  const x = new Float32Array(n);
  for (const f of freqs) for (let h = 1; h <= 6; h++) for (let i = 0; i < n; i++) x[i] += (0.3 / h / freqs.length) * Math.sin((2 * Math.PI * f * h * i) / sr);
  return x;
}

describe('yin', () => {
  const yin = new Yin(2048, SR);
  it.each([55, 82.41, 110, 146.83, 196, 246.94, 329.63, 880])('detects %f Hz within 3 cents', (f) => {
    const r = yin.detect(tone([f], 2048));
    expect(Math.abs(1200 * Math.log2(r.freq / f))).toBeLessThan(3);
    expect(r.clarity).toBeGreaterThan(0.8);
  });
  it('rejects silence and noise', () => {
    expect(yin.detect(new Float32Array(2048)).freq).toBe(-1);
    const noise = Float32Array.from({ length: 2048 }, () => (Math.random() * 2 - 1) * 0.3);
    expect(yin.detect(noise).clarity).toBeLessThan(0.8);
  });
});

describe('chroma', () => {
  it('finds the pitch classes of a C major triad and suppresses overtones', () => {
    const c = new Chroma(8192, SR).compute(tone([130.81, 164.81, 196], 8192))!;
    const top = c.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]).sort((a, b) => a - b);
    expect(top).toEqual([0, 4, 7]);
  });
});

describe('resampler', () => {
  it('preserves a 440 Hz tone when going 48k → 22.05k in chunks', () => {
    const r = new Resampler(48000, 22050);
    const src = tone([440], 48000);
    const parts: Float32Array[] = [];
    for (let i = 0; i < src.length; i += 128) parts.push(r.process(src.subarray(i, i + 128)));
    const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    expect(Math.abs(out.length - 22050)).toBeLessThan(40);
    const y = new Yin(2048, 22050).detect(out.subarray(5000, 7048));
    expect(Math.abs(1200 * Math.log2(y.freq / 440))).toBeLessThan(3);
  });
});
