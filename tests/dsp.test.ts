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
    const f = new Chroma(8192, SR).compute(tone([130.81, 164.81, 196], 8192))!;
    const c = f.chroma;
    // octave-exact: C3 (48), E3 (52), G3 (55) present; the open low E (40) is not
    expect(f.pitch[48]).toBeGreaterThan(-20);
    expect(f.pitch[52]).toBeGreaterThan(-20);
    expect(f.pitch[40]).toBeLessThan(-60);
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

import { Tracker } from '../src/dsp/tracker';
import { ConditionerCore } from '../src/audio/conditionerCore';

describe('adaptive baseline', () => {
  const noise = (n: number, a: number) => Float32Array.from({ length: n }, () => (Math.random() * 2 - 1) * a);
  function feed(tr: Tracker, x: Float32Array) {
    const outs = [];
    for (let i = 0; i + 1024 <= x.length; i += 1024) outs.push(tr.push(i, x.subarray(i, i + 1024)));
    return outs;
  }
  it('learns the floor in under half a second and never reads noise as pitch', () => {
    for (const a of [0.0005, 0.005, 0.03]) {
      const tr = new Tracker(SR);
      const outs = feed(tr, noise(SR * 3, a));
      const floor = outs[Math.round((0.5 * SR) / 1024)].levels.floorDb;
      expect(Math.abs(floor - 20 * Math.log10(a / Math.sqrt(3)))).toBeLessThan(6);
      expect(outs.flatMap((o) => o.frames).filter((f) => f.stable)).toHaveLength(0);
      expect(outs.flatMap((o) => o.notes)).toHaveLength(0);
    }
  });
  it('finds the same note at -6 dB and -40 dB', () => {
    for (const g of [0.5, 0.01]) {
      const tr = new Tracker(SR);
      const x = new Float32Array(SR * 2);
      x.set(noise(SR * 2, 0.0002));
      const t = tone([110], SR);
      for (let i = 0; i < t.length; i++) x[SR + i] += t[i] * g * Math.exp(-i / SR);
      const notes = feed(tr, x).flatMap((o) => o.notes);
      expect(notes.map((n) => n.midi)).toEqual([45]);
    }
  });
});

describe('conditioner (auto level + gate)', () => {
  it('boosts a quiet string toward the target and gates the noise between notes', () => {
    const c = new ConditionerCore(SR);
    const out = new Float32Array(128);
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const n = () => Float32Array.from({ length: 128 }, () => (Math.random() * 2 - 1) * 0.0003);
    for (let b = 0; b < SR / 128; b++) c.process(n(), out); // 1 s of hiss
    expect(rms(out)).toBeLessThan(1e-5);
    const t = tone([110], SR * 4);
    const quiet = t.map((v) => v * 0.02); // peaks around -38 dBFS
    for (let b = 0; b < (SR * 4) / 128; b++) c.process(quiet.subarray(b * 128, b * 128 + 128), out);
    expect(c.view().gainDb).toBeGreaterThan(20);
    expect(rms(out)).toBeGreaterThan(rms(quiet.subarray(0, 128)) * 8);
  });
});
