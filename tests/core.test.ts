// The web channel's use of Fretline's core (WebAssembly), realm by realm, the way the app wires
// it: Session on the main thread, AudioSide + Capture in the worklet, tracker and ML workers.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as tf from '@tensorflow/tfjs';
import { Core, CHUNK } from '../src/core/wasm';
import type { Analysis, ChannelMsg, Notes, SessionState } from '../src/core/protocol';

const module = new WebAssembly.Module(readFileSync('src/core/fretline.wasm'));
const SR = 48000;

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

/** Karplus-Strong plucks: closer to a real string than additive sines. */
function pluck(out: Float32Array, midi: number, at: number, amp: number, sr: number, rnd: () => number) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const p = Math.round(sr / f);
  const buf = Float32Array.from({ length: p }, () => rnd());
  const s0 = Math.round(at * sr);
  for (let i = 0, k = 0; s0 + i < out.length; i++, k = (k + 1) % p) {
    const v = buf[k];
    buf[k] = 0.996 * 0.5 * (buf[k] + buf[(k + 1) % p]);
    out[s0 + i] += v * amp;
  }
}

describe('session (main thread)', () => {
  it('turns messages into state and commands, and remembers floors per device', () => {
    const c = new Core(module);
    c.x.session_load(0);
    const apply = (m: object) => JSON.parse(c.read(c.x.session_apply(c.text(JSON.stringify(m)), 1000)));
    let fx = apply({ type: 'set', state: { output: true } });
    expect(fx.audio).toEqual([{ type: 'output', on: true }]);
    expect(fx.state.rev).toBe(1);
    apply({ type: 'set', state: { inputId: 'cable' } });
    apply({ type: 'set', state: { floor: { mode: 'manual', manualDb: -55 } } });
    fx = apply({ type: 'set', state: { inputId: 'mic' } });
    expect(fx.state.floor.mode).toBe('auto');
    fx = apply({ type: 'set', state: { inputId: 'cable' } });
    expect(fx.state.floor).toEqual({ mode: 'manual', manualDb: -55 });
    expect(apply({ type: 'recalibrate' }).listen).toEqual([{ type: 'recalibrate', explicit: true }]);
    // Saved and restored.
    const saved = c.read(c.x.session_save());
    const d = new Core(module);
    d.x.session_load(d.text(saved));
    const st: ChannelMsg = JSON.parse(d.read(d.x.session_state()));
    expect((st as SessionState & { type: 'state' }).inputId).toBe('cable');
  });
});

describe('worklet → tracker (web channel audio path)', () => {
  it('captures on the listening clock and hears a plucked A2', () => {
    const w = new Core(module);
    w.x.audio_init(SR);
    const t = new Core(module);
    t.x.tracker_init(SR);
    const sig = new Float32Array(SR * 3);
    const rnd = rng(3);
    for (let i = 0; i < sig.length; i++) sig[i] = rnd() * 0.0003;
    pluck(sig, 45, 1.2, 0.3, SR, rnd);
    const notes: number[] = [];
    const chromas: Array<ChromaFrame & { clock: number }> = [];
    let last: Analysis | null = null;
    let chunks = 0;
    for (let b = 0; b + 128 <= sig.length; b += 128) {
      w.f32(w.x.audio_buf(), 128).set(sig.subarray(b, b + 128));
      const n = w.x.audio_process(128);
      for (let k = 0; k < n; k++) {
        expect(w.x.chunk_t0(k)).toBe(chunks * CHUNK);
        chunks++;
        t.f32(t.x.tracker_buf(), CHUNK).set(w.f32(w.x.chunk_ptr(k), CHUNK));
        last = JSON.parse(t.read(t.x.tracker_push(w.x.chunk_t0(k), CHUNK)));
        notes.push(...last!.notes.map((x) => x.midi));
        if (last!.chroma) chromas.push({ ...last!.chroma, clock: last!.clock });
      }
    }
    expect(notes).toEqual([45]);
    expect(last!.clock).toBeCloseTo((chunks * CHUNK) / SR, 6);
    expect(last!.levels.floorDb).toBeLessThan(-70);
    // One pluck is one attack, and the chroma frames name it as one fundamental at an absolute level.
    expect(last!.levels.attacks).toBe(1);
    // Judged as the app does: 150 ms after the attack (the transient is broadband) and well above
    // the floor (the tail decays into the noise).
    const cf = chromas.filter((c) => c.clock >= 1.2 + 0.15 && c.fundamentals.length && c.topDb > last!.levels.floorDb + 20);
    expect(cf.length).toBeGreaterThan(3);
    expect(cf.map((c) => c.fundamentals[0].midi)).toEqual(cf.map(() => 45));
    expect(cf.every((c) => c.fundamentals[0].db <= c.topDb + 1e-3 && c.fundamentals[0].db > last!.levels.floorDb + 12)).toBe(true);
    // Listening off: the clock stops.
    w.x.capture_listening(0);
    const before = w.x.capture_clock();
    w.f32(w.x.audio_buf(), 128).fill(0.1);
    for (let i = 0; i < 40; i++) w.x.audio_process(128);
    expect(w.x.capture_clock()).toBe(before);
  });

  it('plays the synth through the worklet even with Output off', () => {
    const w = new Core(module);
    w.x.audio_init(SR);
    w.x.audio_cmd(w.text(JSON.stringify({ type: 'play', group: 1, notes: [{ at: 0, hz: 440, dur: 1, voice: 'reference' }], lead: 0 })));
    let peak = 0;
    for (let b = 0; b < 200; b++) {
      w.f32(w.x.audio_buf(), 128).fill(0);
      w.x.audio_process(128);
      for (const v of w.f32(w.x.audio_buf(), 128)) peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(0.15);
    const m = JSON.parse(w.read(w.x.audio_meters()));
    expect(m.type).toBe('meters');
    expect(m.looper.slots).toHaveLength(4);
  });
});

async function loadModel() {
  const json = JSON.parse(readFileSync('public/model/model.json', 'utf8'));
  const bin = readFileSync('public/model/group1-shard1of1.bin');
  return tf.loadGraphModel({
    load: async () => ({
      modelTopology: json.modelTopology,
      format: json.format,
      generatedBy: json.generatedBy,
      convertedBy: json.convertedBy,
      weightSpecs: json.weightsManifest[0].weights,
      weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    }),
  });
}

describe('ML worker path (core windows + TensorFlow.js + core decoding)', () => {
  it('transcribes a strummed C major chord and a following G', async () => {
    await tf.setBackend('cpu');
    const model = await loadModel();
    const c = new Core(module);
    c.x.ml_init(SR);
    c.x.ml_set_floor(-80, 12);
    const sig = new Float32Array(SR * 6);
    const rnd = rng(9);
    [48, 52, 55, 60, 64].forEach((m, i) => pluck(sig, m, 1.3 + i * 0.015, 0.25, SR, rnd));
    pluck(sig, 67, 2.3, 0.3, SR, rnd);
    const notes: Notes['notes'] = [];
    for (let i = 0; i + CHUNK <= sig.length; i += CHUNK) {
      c.f32(c.x.ml_buf(), CHUNK).set(sig.subarray(i, i + CHUNK));
      c.x.ml_push(i, CHUNK);
      for (let ptr = c.x.ml_next_window(); ptr; ptr = c.x.ml_next_window()) {
        const audio = c.f32(ptr, c.x.ml_window_len()).slice();
        const input = tf.tensor3d(audio, [1, audio.length, 1]);
        const [f, o] = model.execute(input, ['Identity_1', 'Identity_2']) as tf.Tensor[];
        c.f32(c.x.ml_frames(), f.size).set(f.dataSync() as Float32Array);
        c.f32(c.x.ml_onsets(), o.size).set(o.dataSync() as Float32Array);
        const r: Notes = JSON.parse(c.read(c.x.ml_decode()));
        notes.push(...r.notes);
      }
    }
    const chord = new Set(notes.filter((n) => n.t > 1.2 && n.t < 1.6).map((n) => n.midi % 12));
    expect([0, 4, 7].every((pc) => chord.has(pc))).toBe(true);
    expect(notes.some((n) => n.midi === 67 && Math.abs(n.t - 2.3) < 0.1)).toBe(true);
  }, 60000);
});
