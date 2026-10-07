// Link to the Fretline engine: a small native app (Windows for now) that owns the guitar input
// and the speakers and runs the pedals at a few milliseconds of latency. It streams the raw
// guitar back here so the tuner, chords and tabs keep running in the browser unchanged.
// Protocol: engine/fretline-engine/src/protocol.rs.

export const NATIVE_URL = 'ws://127.0.0.1:47831';
export const NATIVE_PROTOCOL = 1;
export const NATIVE_DOWNLOAD = 'https://github.com/nexarcdev/guitar/releases/latest/download/FretlineEngineSetup.exe';

export type NativeConn = 'off' | 'connecting' | 'connected' | 'absent' | 'outdated';

export interface NativeDevice {
  id: string;
  name: string;
}

export interface NativeStream {
  id: string;
  name: string;
  rate: number;
  periodMs: number;
  deviceMs: number;
  mode: string;
}

export interface NativeStatus {
  protocol: number;
  version: string;
  inputs: NativeDevice[];
  outputs: NativeDevice[];
  input: NativeStream | null;
  output: NativeStream | null;
  latency: { inputMs: number; bufferMs: number; outputMs: number; totalMs: number } | null;
  outputOn: boolean;
  exclusiveInput: boolean;
  exclusiveOutput: boolean;
  error: string | null;
}

export interface NativeMeters {
  gainDb: number;
  floorDb: number;
  gate: boolean;
  outDb: number;
  underruns: number;
  looperLen: number;
  looperFree: boolean;
  looperRate: number;
  slots: Array<{ state: string; progress: number }>;
}

export type NativeMsg =
  | { type: 'hello'; client: string; version?: string }
  | { type: 'pedals'; pedals: Array<{ name: string; on: boolean; level: number }> }
  | { type: 'output'; on: boolean }
  | { type: 'listen'; on: boolean }
  | { type: 'loop'; cmd: 'tap' | 'stop' | 'clear'; slot: number }
  | { type: 'floor'; floorDb: number; openDb: number }
  | { type: 'devices'; input?: string; output?: string }
  | { type: 'exclusive'; input?: boolean; output?: boolean };

export interface NativeHandlers {
  /** Socket open and a compatible status received: send the full state now. */
  open(): void;
  conn(c: NativeConn): void;
  status(s: NativeStatus): void;
  meters(m: NativeMeters): void;
  /** Raw guitar, mono; `t0` is the engine's sample index of data[0]. */
  frame(rate: number, t0: number, data: Float32Array): void;
}

/** Parses a binary audio frame ("FLA1", u32 rate, f64 t0, f32 samples). */
export function parseFrame(buf: ArrayBuffer): { rate: number; t0: number; data: Float32Array } | null {
  if (buf.byteLength < 16 || (buf.byteLength - 16) % 4) return null;
  const v = new DataView(buf);
  if (v.getUint32(0, false) !== 0x464c4131) return null; // "FLA1"
  return { rate: v.getUint32(4, true), t0: v.getFloat64(8, true), data: new Float32Array(buf, 16) };
}

export class NativeLink {
  conn: NativeConn = 'off';
  private ws: WebSocket | null = null;
  private enabled = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private ready = false;

  constructor(private h: NativeHandlers) {}

  /** Starts or stops looking for the engine. Only called after the user opted in. */
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
      this.setConn('off');
    }
  }

  /** Try now (e.g. right after the user installed it) instead of waiting for the next retry. */
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

  send(m: NativeMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private setConn(c: NativeConn) {
    if (c === this.conn) return;
    this.conn = c;
    this.h.conn(c);
  }

  private connect() {
    this.retry = null;
    if (!this.enabled) return;
    if (this.conn !== 'connected') this.setConn(this.conn === 'off' ? 'connecting' : this.conn);
    let ws: WebSocket;
    try {
      ws = new WebSocket(NATIVE_URL);
    } catch {
      this.scheduleRetry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.ready = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', client: 'fretline-web', version: __APP_VERSION__ } satisfies NativeMsg));
    ws.onmessage = (e) => {
      if (ws !== this.ws) return;
      if (typeof e.data !== 'string') {
        if (!this.ready) return;
        const f = parseFrame(e.data as ArrayBuffer);
        if (f) this.h.frame(f.rate, f.t0, f.data);
        return;
      }
      let m: { type: string } & Record<string, unknown>;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type === 'status') {
        const s = m as unknown as NativeStatus;
        if (s.protocol !== NATIVE_PROTOCOL) {
          // An engine from another era: don't drive it with messages it may misread.
          this.setConn('outdated');
          this.h.status(s);
          return;
        }
        if (!this.ready) {
          this.ready = true;
          this.backoff = 1000;
          this.setConn('connected');
          this.h.open();
        }
        this.h.status(s);
      } else if (m.type === 'meters' && this.ready) this.h.meters(m as unknown as NativeMeters);
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
