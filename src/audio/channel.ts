// An audio channel is everything that turns the guitar into sound and analysis: the web channel
// runs Fretline's core in this browser (WebAssembly in an AudioWorklet and workers), the engine
// channel talks to the native engine. Both speak the same protocol (core/protocol.ts), so the
// app never needs to know which one it is using.

import type { ChannelMsg, ControlMsg } from '../core/protocol';

export type MicState = 'idle' | 'starting' | 'live' | 'denied' | 'nodevice' | 'insecure' | 'error';

export interface AudioChannel {
  readonly kind: 'web' | 'engine';
  send(m: ControlMsg): void;
  /** Every message the channel produces; set by the owner. */
  onMessage: (m: ChannelMsg) => void;
}
