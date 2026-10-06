import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as tf from '@tensorflow/tfjs';
import { transcribeWindow, ML_RATE, ML_WINDOW } from '../src/ml/transcribe';

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

/** Karplus-Strong plucks: closer to a real string than additive sines. */
function pluck(out: Float32Array, midi: number, at: number, amp = 0.25) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const p = Math.round(ML_RATE / f);
  const buf = Float32Array.from({ length: p }, () => Math.random() * 2 - 1);
  const s0 = Math.round(at * ML_RATE);
  for (let i = 0, k = 0; s0 + i < out.length; i++, k = (k + 1) % p) {
    const v = buf[k];
    buf[k] = 0.996 * 0.5 * (buf[k] + buf[(k + 1) % p]);
    out[s0 + i] += v * amp;
  }
}

describe('basic-pitch transcription', () => {
  it('transcribes a strummed C major chord and a following single note', async () => {
    await tf.setBackend('cpu');
    const model = await loadModel();
    const a = new Float32Array(ML_WINDOW);
    [48, 52, 55, 60, 64].forEach((m, i) => pluck(a, m, 0.3 + i * 0.015));
    pluck(a, 67, 1.3, 0.3);
    const t = performance.now();
    const notes = await transcribeWindow(tf, model, a);
    const ms = performance.now() - t;
    console.log('inference ms', ms.toFixed(0), notes.map((n) => `${n.midi}@${n.start.toFixed(2)}`).join(' '));
    const chord = new Set(notes.filter((n) => n.start < 0.6).map((n) => n.midi % 12));
    expect([0, 4, 7].every((pc) => chord.has(pc))).toBe(true);
    expect(notes.some((n) => n.midi === 67 && Math.abs(n.start - 1.3) < 0.1)).toBe(true);
  }, 60000);
});
