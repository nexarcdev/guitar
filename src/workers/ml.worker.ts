/// <reference lib="webworker" />
import './window-shim';
// Slow path: basic-pitch polyphonic transcription. The core (WebAssembly) does everything the
// engine does around the model (resampling, 2 s windows on a 1 s hop, silence skipping,
// normalisation, note decoding, clock mapping); only the network itself runs here, in
// TensorFlow.js, where the engine uses tract. Results leave as the engine's `notes` messages.

import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import wasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import simdUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import threadedUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import { Core } from '../core/wasm';

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

let core: Core | null = null;
let model: tf.GraphModel | null = null;
let backend = '';
let busy = false;
let disabled = false;

async function pickBackend(): Promise<string> {
  setWasmPaths({
    'tfjs-backend-wasm.wasm': wasmUrl,
    'tfjs-backend-wasm-simd.wasm': simdUrl,
    'tfjs-backend-wasm-threaded-simd.wasm': threadedUrl,
  });
  for (const b of ['webgl', 'wasm', 'cpu']) {
    try {
      if (await tf.setBackend(b)) {
        await tf.ready();
        return b;
      }
    } catch {
      /* try the next one */
    }
  }
  throw new Error('no tfjs backend');
}

/** basic-pitch's note-frame and onset activations for one window (172 × 88 each). */
async function infer(audio: Float32Array): Promise<[Float32Array, Float32Array]> {
  const input = tf.tensor3d(audio, [1, audio.length, 1]);
  // Output order follows basic-pitch: Identity_1 = note frames, Identity_2 = onsets.
  const [frames, onsets] = model!.execute(input, ['Identity_1', 'Identity_2']) as tf.Tensor[];
  const [f, o] = await Promise.all([frames.data(), onsets.data()]);
  input.dispose();
  frames.dispose();
  onsets.dispose();
  return [f as Float32Array, o as Float32Array];
}

async function init(m: { module: WebAssembly.Module; sampleRate: number; modelUrl: string; port: MessagePort; cmds: string[] }) {
  core = new Core(m.module);
  core.x.ml_init(m.sampleRate);
  for (const json of m.cmds) core.x.ml_cmd(core.text(json));
  post({ type: 'ml', status: 'loading', backend: '' });
  try {
    backend = await pickBackend();
    model = await tf.loadGraphModel(m.modelUrl);
    // Warm-up compiles shaders / kernels so the first real window is not reported as slow.
    await infer(new Float32Array(core.x.ml_window_len()));
    post({ type: 'ml', status: 'ready', backend });
  } catch (err) {
    post({ type: 'ml', status: 'unavailable', backend: String(err) });
    return;
  }
  m.port.onmessage = (ev: MessageEvent<{ t0: number; data: Float32Array }>) => {
    if (disabled) return;
    const c = core!;
    c.f32(c.x.ml_buf(), ev.data.data.length).set(ev.data.data);
    c.x.ml_push(ev.data.t0, ev.data.data.length);
    pump();
  };
}

async function pump() {
  if (busy || !model || !core || disabled) return;
  const c = core;
  const ptr = c.x.ml_next_window();
  if (!ptr) return;
  busy = true;
  const audio = c.f32(ptr, c.x.ml_window_len()).slice();
  const t = performance.now();
  try {
    const [f, o] = await infer(audio);
    c.f32(c.x.ml_frames(), f.length).set(f);
    c.f32(c.x.ml_onsets(), o.length).set(o);
    post(c.read(c.x.ml_decode()));
    if (c.x.ml_note_inference((performance.now() - t) / 1000)) {
      disabled = true;
      post({ type: 'ml', status: 'slow', backend });
    }
  } catch (err) {
    disabled = true;
    post({ type: 'ml', status: 'unavailable', backend: String(err) });
  }
  busy = false;
  pump();
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') init(m);
  else if (m.type === 'cmd') core?.x.ml_cmd(core.text(m.json));
  else if (m.type === 'level') core?.x.ml_set_floor(m.floorDb, m.openDb);
};
