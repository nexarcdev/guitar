/// <reference path="./worklet-env.d.ts" />
import { ConditionerCore } from '../conditionerCore';

const VIEW_EVERY = Math.round(sampleRate / 5);

class ConditionerProcessor extends AudioWorkletProcessor {
  private core = new ConditionerCore(sampleRate);
  private since = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'recalibrate') this.core.recalibrate();
      else if (e.data?.type === 'floor') this.core.setFloor(e.data.floorDb, e.data.openDb);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!inp || !inp.length) {
      for (const ch of out) ch.fill(0);
      return true;
    }
    // Same channel choice as the analysis tap: interfaces often put the guitar on one side.
    let src = inp[0];
    if (inp.length > 1) {
      let e0 = 0, e1 = 0;
      for (let i = 0; i < src.length; i++) { e0 += inp[0][i] * inp[0][i]; e1 += inp[1][i] * inp[1][i]; }
      if (e1 > e0) src = inp[1];
    }
    this.core.process(src, out[0]);
    for (let c = 1; c < out.length; c++) out[c].set(out[0]);
    this.since += src.length;
    if (this.since >= VIEW_EVERY) {
      this.since = 0;
      this.port.postMessage(this.core.view());
    }
    return true;
  }
}

registerProcessor('fretline-conditioner', ConditionerProcessor);
