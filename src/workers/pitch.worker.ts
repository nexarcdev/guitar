/// <reference lib="webworker" />
// Fast path: the core's tracker (YIN pitch, chroma, single-note onsets, noise floor) for the
// tuner, chord view and the provisional notes on the tab stream. Audio arrives on a port from
// the AudioWorklet; results leave as the same `analysis` messages the engine sends.

import { Core } from '../core/wasm';

let core: Core | null = null;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'cmd') {
    if (core) core.x.tracker_cmd(core.text(m.json));
  } else if (m.type === 'init') {
    core = new Core(m.module as WebAssembly.Module);
    core.x.tracker_init(m.sampleRate);
    for (const json of m.cmds as string[]) core.x.tracker_cmd(core.text(json));
    let levelAt = 0;
    (m.port as MessagePort).onmessage = (ev: MessageEvent<{ t0: number; data: Float32Array }>) => {
      const c = core!;
      const { t0, data } = ev.data;
      c.f32(c.x.tracker_buf(), data.length).set(data);
      post(c.read(c.x.tracker_push(t0, data.length)));
      // The app-wide floor goes to the monitored path and the ML pass ~10×/s.
      const now = performance.now();
      if (now - levelAt > 100) {
        levelAt = now;
        post({ type: 'level', floorDb: c.x.tracker_floor_db(), openDb: c.x.tracker_open_db() });
      }
    };
  }
};
