/// <reference lib="webworker" />
import './window-shim';
// Slow path: basic-pitch polyphonic transcription on 2 s windows with a 1 s hop. Only onsets in
// the middle second of each window are reported, so consecutive windows tile the timeline and
// the model's unreliable edges are never used.

import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import wasmUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import simdUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import threadedUrl from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import { Resampler } from '../dsp/resample';
import { transcribeWindow, ML_RATE, ML_WINDOW } from '../ml/transcribe';

const HOP = ML_RATE;
const EDGE = (ML_WINDOW - HOP) / 2;
const RING = 1 << 17;
/** Give up once inference runs this far behind real time for several windows in a row. */
const SLOW_RATIO = 0.8;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

let model: tf.GraphModel | null = null;
let rs: Resampler | null = null;
let ring = new Float32Array(RING);
/** Absolute 22.05 kHz sample index of the next write. */
let end = 0;
/** Input-clock sample at which `end` was zero, so outputs can be mapped back to the listening clock. */
let origin = 0;
let inRate = 48000;
let k = 0;
let busy = false;
let slowCount = 0;
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

async function init(sampleRate: number, modelUrl: string, port: MessagePort) {
  inRate = sampleRate;
  try {
    const backend = await pickBackend();
    model = await tf.loadGraphModel(modelUrl);
    // Warm-up compiles shaders / kernels so the first real window is not reported as slow.
    await transcribeWindow(tf, model, new Float32Array(ML_WINDOW));
    post({ type: 'status', status: 'ready', backend });
  } catch (err) {
    post({ type: 'status', status: 'unavailable', detail: String(err) });
    return;
  }
  port.onmessage = (ev: MessageEvent<{ t0: number; data: Float32Array }>) => push(ev.data.t0, ev.data.data);
}

function push(t0: number, data: Float32Array) {
  if (disabled) return;
  if (!rs) {
    rs = new Resampler(inRate, ML_RATE);
    origin = t0;
  }
  const out = rs.process(data);
  for (let i = 0; i < out.length; i++) ring[(end + i) & (RING - 1)] = out[i];
  end += out.length;
  pump();
}

async function pump() {
  if (busy || !model) return;
  // Window k trusts onsets in [k·HOP, (k+1)·HOP) and spans [k·HOP − EDGE, k·HOP − EDGE + ML_WINDOW).
  let wEnd = k * HOP - EDGE + ML_WINDOW;
  if (wEnd > end) return;
  // If we fell behind, skip ahead instead of building an ever-growing backlog.
  if (end - wEnd > HOP * 2) {
    k = Math.floor((end - ML_WINDOW + EDGE) / HOP);
    wEnd = k * HOP - EDGE + ML_WINDOW;
  }
  busy = true;
  const wStart = wEnd - ML_WINDOW;
  const win = new Float32Array(ML_WINDOW);
  for (let i = 0; i < ML_WINDOW; i++) {
    const a = wStart + i;
    win[i] = a < 0 || a < end - RING ? 0 : ring[a & (RING - 1)];
  }
  const t = performance.now();
  try {
    const notes = await transcribeWindow(tf, model, win);
    const from = k * HOP;
    const to = from + HOP;
    const sec = (a: number) => (origin + (a / ML_RATE) * inRate) / inRate;
    post({
      type: 'notes',
      from: sec(from),
      to: sec(to),
      notes: notes
        .filter((n) => {
          const a = wStart + n.start * ML_RATE;
          return a >= from && a < to;
        })
        .map((n) => ({ midi: n.midi, t: sec(wStart + n.start * ML_RATE), dur: n.dur, amp: n.amp })),
    });
    const took = (performance.now() - t) / 1000;
    slowCount = took > SLOW_RATIO * (HOP / ML_RATE) ? slowCount + 1 : 0;
    if (slowCount >= 4) {
      disabled = true;
      post({ type: 'status', status: 'slow' });
    }
  } catch (err) {
    disabled = true;
    post({ type: 'status', status: 'unavailable', detail: String(err) });
  }
  k++;
  busy = false;
  pump();
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') init(m.sampleRate, m.modelUrl, m.port);
  else if (m.type === 'reset') {
    // The listening clock jumped (new input device): start a fresh timeline.
    rs = null;
    ring = new Float32Array(RING);
    end = 0;
    k = 0;
  }
};
