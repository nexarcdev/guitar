// The real-guitar fixture through the WASM tracker and the app's strum machine: the end-to-end
// check of the thresholds in src/theory/levels.ts. engine/core/tests/strums.rs is the Rust twin.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Core, CHUNK } from '../src/core/wasm';
import type { Analysis } from '../src/core/protocol';
import { StrumTracker, type Decided } from '../src/state/strum';
import { identifyMidi, STD_SETUP } from '../src/theory/music';
import { toVoicing } from '../src/theory/common';
import { judge } from '../src/theory/verdict';

const module = await WebAssembly.compile(readFileSync('src/core/fretline.wasm'));

/** 16-bit PCM WAV, mono. */
function wav(path: string): { x: Float32Array; rate: number } {
  const b = readFileSync(path);
  let rate = 48000;
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(off + 12);
    if (id === 'data') {
      const n = size / 2;
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(off + 8 + i * 2) / 32768;
      return { x, rate };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

function run() {
  const { x, rate } = wav('engine/core/tests/fixtures/strums.wav');
  const t = new Core(module);
  t.x.tracker_init(rate);
  const strums = new StrumTracker(6);
  const decided: Decided[] = [];
  for (let i = 0; i + CHUNK <= x.length; i += CHUNK) {
    t.f32(t.x.tracker_buf(), CHUNK).set(x.subarray(i, i + CHUNK));
    const a: Analysis = JSON.parse(t.read(t.x.tracker_push(i, CHUNK)));
    const d = strums.push(a);
    if (d) decided.push(d);
  }
  return decided;
}

describe('strums.wav through the WASM tracker and the strum machine', () => {
  const decided = run();
  const played = decided.filter((d) => !d.quiet && d.t > 1);
  const names = played.map((d) => identifyMidi(d.heard.map((f) => f.midi), STD_SETUP.offsets).name);

  it('hears every event once, names the strums, and the click at 3.9 s decides nothing', () => {
    // The click opens the gate, which closes again before the window: no frames, no decision.
    expect(decided.filter((d) => d.quiet)).toEqual([]);
    expect(decided).toHaveLength(10);
    expect(played.map((d) => d.heard.map((f) => f.midi).sort((a, b) => a - b))).toEqual([
      [43, 47, 50], [40, 47, 55], [43, 47, 50], [64], [59], [55], [50], [45], [40], [40, 45, 50, 55],
    ]);
    expect(names.slice(0, 3)).toEqual(['G', 'Em', 'G']);
    expect(names.slice(3, 9)).toEqual(['E', 'B', 'G', 'D', 'A', 'E']);
  });

  it('the peaks carry the strings the core folded into partials', () => {
    // Open strum: B3 and E4 are E2's partials to the core, present as peaks for the verdict.
    const open = played[9];
    expect(open.peaks.has(59) && open.peaks.has(64)).toBe(true);
    // Em: E3, B3, E4 of the full open voicing all have peaks.
    expect([52, 59, 64].every((m) => played[1].peaks.has(m))).toBe(true);
  });

  it('judges the strums against targets', () => {
    const G = toVoicing([3, 2, 0, 0, 0, 3], 1, STD_SETUP);
    const Em = toVoicing([0, 2, 2, 0, 0, 0], 1, STD_SETUP);
    const g = judge(G, played[0].heard.map((f) => f.midi), played[0].peaks, STD_SETUP);
    expect(['exact', 'sameName']).toContain(g.status);
    expect(g.fixes).toEqual([]);
    const em = judge(Em, played[1].heard.map((f) => f.midi), played[1].peaks, STD_SETUP);
    expect(['exact', 'sameName']).toContain(em.status);
    const wrong = judge(G, played[1].heard.map((f) => f.midi), played[1].peaks, STD_SETUP);
    expect(wrong.status).toBe('different');
    expect(wrong.heardName.name).toBe('Em');
    // A single open low E against an Em target: the low string is right, the rest is missing.
    const single = judge(Em, played[8].heard.map((f) => f.midi), played[8].peaks, STD_SETUP);
    expect(single.strings[0]).toBe('ok');
    expect(single.status).toBe('different');
  });
});
