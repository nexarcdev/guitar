/// <reference path="./worklet-env.d.ts" />
// The web channel's audio thread: Fretline's core (WebAssembly) runs the monitored guitar
// (auto level, gate, pedals, looper) and the synth, exactly as the native engine does. It also
// keeps the listening clock and ships fixed chunks of the raw guitar to the analysis workers
// over their own MessagePorts, so audio never crosses the main thread.

import { Core, CHUNK } from '../../core/wasm';

class CoreProcessor extends AudioWorkletProcessor {
  private core: Core;
  private sinks: Array<{ id: string; port: MessagePort }> = [];
  private sinceMeters = 0;

  constructor(options?: unknown) {
    super();
    const o = (options as { processorOptions: { wasm: ArrayBuffer } }).processorOptions;
    this.core = new Core(o.wasm);
    this.core.x.audio_init(sampleRate);
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data;
      const x = this.core.x;
      if (m.type === 'cmd') x.audio_cmd(this.core.text(m.json));
      else if (m.type === 'listening') x.capture_listening(m.on ? 1 : 0);
      else if (m.type === 'clock') x.capture_continue(m.at);
      else if (m.type === 'sink') this.sinks.push({ id: m.id, port: m.port as MessagePort });
      else if (m.type === 'unsink') {
        this.sinks.filter((s) => s.id === m.id).forEach((s) => s.port.close());
        this.sinks = this.sinks.filter((s) => s.id !== m.id);
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    const n = out[0]?.length ?? 128;
    const { core } = this;
    const x = core.x;
    const buf = core.f32(x.audio_buf(), n);
    const ch = inputs[0];
    if (ch && ch.length) {
      // Interfaces often put the guitar on one side of a stereo pair: take the louder one.
      let src = ch[0];
      if (ch.length > 1) {
        let e0 = 0, e1 = 0;
        for (let i = 0; i < src.length; i++) { e0 += ch[0][i] * ch[0][i]; e1 += ch[1][i] * ch[1][i]; }
        if (e1 > e0) src = ch[1];
      }
      buf.set(src.subarray(0, n));
    } else buf.fill(0);
    const chunks = x.audio_process(n);
    for (let k = 0; k < chunks; k++) {
      const t0 = x.chunk_t0(k);
      const data = core.f32(x.chunk_ptr(k), CHUNK);
      this.sinks.forEach((s) => {
        const copy = data.slice();
        s.port.postMessage({ t0, data: copy }, [copy.buffer]);
      });
    }
    const res = core.f32(x.audio_buf(), n);
    for (const o of out) o.set(res);
    // Meters ~30×/s, as the engine sends them.
    this.sinceMeters += n;
    if (this.sinceMeters >= sampleRate / 30) {
      this.sinceMeters = 0;
      this.port.postMessage(core.read(x.audio_meters()));
    }
    return true;
  }
}

registerProcessor('fretline-core', CoreProcessor);
