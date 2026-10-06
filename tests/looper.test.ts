import { describe, expect, it } from 'vitest';
import { LooperCore } from '../src/audio/looperCore';

const block = (v: number, n = 128) => new Float32Array(n).fill(v);
function run(l: LooperCore, input: number, blocks: number) {
  const outL = new Float32Array(128), outR = new Float32Array(128);
  const res: number[] = [];
  for (let b = 0; b < blocks; b++) {
    const i = block(input);
    l.process(i, i, outL, outR);
    res.push(...outL);
  }
  return res;
}

describe('looper', () => {
  it('first recording sets the length; second slot records one synced cycle then plays', () => {
    const l = new LooperCore(1000);
    l.tap(0);
    run(l, 1, 4); // 512 samples of 1
    l.tap(0);
    expect(l.view().len).toBe(512);
    expect(l.view().slots[0].state).toBe('playing');
    expect(run(l, 0, 4).every((v) => v === 1)).toBe(true);
    l.tap(1);
    run(l, 0.5, 4);
    expect(l.view().slots[1].state).toBe('playing');
    expect(run(l, 0, 4).every((v) => v === 1.5)).toBe(true);
  });
  it('overdubs on top of a playing slot, stops, and resets length when all are cleared', () => {
    const l = new LooperCore(1000);
    l.tap(0); run(l, 1, 2); l.tap(0);
    l.tap(0); // overdub
    expect(l.view().slots[0].state).toBe('overdubbing');
    run(l, 1, 2);
    l.tap(0);
    expect(run(l, 0, 2).every((v) => v === 2)).toBe(true);
    l.stop(0);
    expect(run(l, 0, 2).every((v) => v === 0)).toBe(true);
    l.clear(0);
    expect(l.view().len).toBe(0);
  });
  it('writes overdubs behind the playhead by the round-trip latency', () => {
    const l = new LooperCore(1000);
    l.tap(0); run(l, 0, 2); l.tap(0); // 256 silent samples
    l.latency = 10;
    l.tap(1);
    const outL = new Float32Array(128), outR = new Float32Array(128);
    const imp = new Float32Array(128); imp[20] = 1; // heard at phase 20
    l.process(imp, imp, outL, outR);
    run(l, 0, 1);
    const played = run(l, 0, 2);
    expect(played.indexOf(1)).toBe(10);
  });
});
