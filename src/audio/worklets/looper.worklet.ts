/// <reference path="./worklet-env.d.ts" />
import { LooperCore } from '../looperCore';

const VIEW_EVERY = Math.round(sampleRate / 30);

class LooperProcessor extends AudioWorkletProcessor {
  private core = new LooperCore(sampleRate);
  private since = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'tap') this.core.tap(m.slot);
      else if (m.type === 'stop') this.core.stop(m.slot);
      else if (m.type === 'clear') this.core.clear(m.slot);
      else if (m.type === 'latency') this.core.latency = Math.max(0, Math.round(m.samples));
      this.port.postMessage(this.core.view());
    };
  }

  private zeros = new Float32Array(128);
  private scratch = new Float32Array(128);

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    const n = out[0].length;
    if (this.zeros.length !== n) { this.zeros = new Float32Array(n); this.scratch = new Float32Array(n); }
    const inp = inputs[0];
    const l = inp && inp[0] ? inp[0] : this.zeros;
    const r = inp && inp[1] ? inp[1] : l;
    this.core.process(l, r, out[0], out[1] ?? this.scratch);
    this.since += n;
    if (this.since >= VIEW_EVERY) {
      this.since = 0;
      this.port.postMessage(this.core.view());
    }
    return true;
  }
}

registerProcessor('fretline-looper', LooperProcessor);
