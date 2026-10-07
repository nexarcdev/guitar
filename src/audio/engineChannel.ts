// The engine channel: Fretline's native engine (a small app on this computer) owns the guitar
// input and the speakers, plays the pedals a few milliseconds from the strings, and does all the
// listening with the same core the web channel runs. It is reached over a localhost WebSocket.
//
// Fretline only looks for it after the player opts in: probing localhost can make the browser
// ask for local network access, which nobody without the engine should see.

import type { AudioChannel } from './channel';
import { PROTOCOL, type ChannelMsg, type ControlMsg } from '../core/protocol';

export const ENGINE_URL = 'ws://127.0.0.1:47831';
export const ENGINE_DOWNLOAD = 'https://github.com/nexarcdev/guitar/releases/latest/download/FretlineEngineSetup.exe';

export type EngineConn = 'off' | 'connecting' | 'connected' | 'absent' | 'outdated';

export class EngineChannel implements AudioChannel {
  readonly kind = 'engine';
  onMessage: (m: ChannelMsg) => void = () => {};
  /** Connection changes; `connected` means a compatible engine answered. */
  onConn: (c: EngineConn) => void = () => {};
  conn: EngineConn = 'off';
  /** Version of the engine that answered (also when outdated). */
  version = '';
  private ws: WebSocket | null = null;
  private enabled = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private ready = false;
  /** Messages that arrived before the status proved the engine compatible. */
  private early: ChannelMsg[] = [];

  constructor(private url = ENGINE_URL) {}

  /** Starts or stops looking for the engine. */
  enable(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.backoff = 1000;
      this.connect();
    } else {
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      const ws = this.ws;
      this.ws = null;
      ws?.close();
      this.ready = false;
      this.setConn('off');
    }
  }

  /** Try now (e.g. right after the player installed it) instead of waiting for the next retry. */
  retryNow() {
    if (!this.enabled || this.ws) return;
    if (this.retry) clearTimeout(this.retry);
    this.backoff = 1000;
    this.connect();
  }

  /** Resolves true once connected, false if not within `ms`. */
  waitConnected(ms: number): Promise<boolean> {
    if (this.conn === 'connected') return Promise.resolve(true);
    if (!this.enabled) return Promise.resolve(false);
    return new Promise((resolve) => {
      const t0 = performance.now();
      const poll = () => {
        if (this.conn === 'connected') resolve(true);
        else if (this.conn === 'absent' || this.conn === 'outdated' || !this.enabled || performance.now() - t0 > ms) resolve(false);
        else setTimeout(poll, 25);
      };
      poll();
    });
  }

  send(m: ControlMsg) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private setConn(c: EngineConn) {
    if (c === this.conn) return;
    this.conn = c;
    this.onConn(c);
  }

  private connect() {
    this.retry = null;
    if (!this.enabled) return;
    if (this.conn === 'off') this.setConn('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.ready = false;
    this.early = [];
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', client: 'fretline-web', version: __APP_VERSION__ } satisfies ControlMsg));
    ws.onmessage = (e) => {
      if (ws !== this.ws || typeof e.data !== 'string') return;
      let m: ChannelMsg;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'status') {
        this.version = m.version;
        if (m.protocol !== PROTOCOL) {
          // An engine from another era: don't drive it with messages it may misread.
          this.setConn('outdated');
          return;
        }
        if (!this.ready) {
          this.ready = true;
          this.backoff = 1000;
          this.setConn('connected');
          this.early.splice(0).forEach((x) => this.onMessage(x));
        }
      }
      if (this.ready) this.onMessage(m);
      else if (this.early.length < 16) this.early.push(m);
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.ws = null;
      const was = this.ready;
      this.ready = false;
      if (!this.enabled) return;
      if (this.conn !== 'outdated') this.setConn(was ? 'connecting' : 'absent');
      if (was) this.backoff = 1000;
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (!this.enabled || this.retry) return;
    this.retry = setTimeout(() => this.connect(), this.backoff);
    // Not running: look again every few seconds at first, then every 30 s.
    this.backoff = Math.min(30000, this.backoff * 2);
  }
}
