/// <reference lib="webworker" />
// Fast path: YIN pitch, chroma and single-note onsets for the tuner, chord view and the
// provisional notes on the tab stream. Audio arrives on a port from the capture worklet.

import { Tracker } from '../dsp/tracker';

let tracker: Tracker | null = null;

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'recalibrate') tracker?.recalibrate();
  else if (m.type === 'init') {
    tracker = new Tracker(m.sampleRate);
    const port = m.port as MessagePort;
    port.onmessage = (ev: MessageEvent<{ t0: number; data: Float32Array }>) => {
      if (!tracker) return;
      const out = tracker.push(ev.data.t0, ev.data.data);
      const clock = (ev.data.t0 + ev.data.data.length) / m.sampleRate;
      (self as unknown as Worker).postMessage({ type: 'analysis', clock, ...out });
    };
  }
};
