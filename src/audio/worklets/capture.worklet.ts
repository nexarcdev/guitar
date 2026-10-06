/// <reference path="./worklet-env.d.ts" />
// Taps the raw input for analysis. While listening it advances a sample clock and ships
// fixed-size chunks straight to the analysis workers over their own MessagePorts, so audio
// never crosses the main thread. Paused = no clock advance and no chunks.

const CHUNK = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  private listening = true;
  private clock = 0;
  private buf = new Float32Array(CHUNK);
  private fill = 0;
  private sinks: Array<{ id: string; port: MessagePort }> = [];

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'listening') this.listening = m.on;
      else if (m.type === 'sink') this.sinks.push({ id: m.id, port: m.port as MessagePort });
      else if (m.type === 'unsink') {
        this.sinks.filter((x) => x.id === m.id).forEach((x) => x.port.close());
        this.sinks = this.sinks.filter((x) => x.id !== m.id);
      }
    };
  }

  process(inputs: Float32Array[][]) {
    const ch = inputs[0];
    if (!this.listening || !ch || !ch.length) return true;
    // Interfaces often present the guitar on one channel of a stereo pair: analyse the louder one.
    let src = ch[0];
    if (ch.length > 1) {
      let e0 = 0, e1 = 0;
      for (let i = 0; i < src.length; i++) { e0 += ch[0][i] * ch[0][i]; e1 += ch[1][i] * ch[1][i]; }
      if (e1 > e0) src = ch[1];
    }
    const n = src.length;
    for (let i = 0; i < n; i++) {
      this.buf[this.fill++] = src[i];
      if (this.fill === CHUNK) {
        const t0 = this.clock + i + 1 - CHUNK;
        this.sinks.forEach((sk, k) => {
          const data = k === this.sinks.length - 1 ? this.buf : this.buf.slice();
          sk.port.postMessage({ t0, data }, [data.buffer]);
        });
        this.buf = new Float32Array(CHUNK);
        this.fill = 0;
      }
    }
    this.clock += n;
    return true;
  }
}

registerProcessor('fretline-capture', CaptureProcessor);
