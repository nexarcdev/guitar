// The app's single entry point to sound and listening. It drives whichever audio channel is in
// charge (the web channel in this browser, or the native engine when the player uses it), and
// both speak the same protocol, so everything here is channel-agnostic:
//
//   app ──ControlMsg──▶ channel ──ChannelMsg──▶ app (state, status, analysis, notes, meters)
//
// It also keeps one listening clock for the app: each channel's clock is mapped so that switching
// channels or pausing never makes timestamps jump. Everything stateful lives outside React; the
// store subscribes to the events.

import type { AudioChannel, MicState } from './channel';
import { EngineChannel, type EngineConn } from './engineChannel';
import { WebChannel, type LatencyMode, type WebOptions } from './webChannel';
import type { Analysis, ChannelMsg, ControlMsg, LooperView, MlState, Notes, NoteSpec, SessionState, StatePatch, Status } from '../core/protocol';

export type { LatencyMode, MicState };

export interface EngineStatus {
  /** Which channel is in charge. */
  channel: 'web' | 'engine';
  mic: MicState;
  /** Sound can play (browsers keep audio suspended until the first tap). */
  running: boolean;
  ml: MlState;
  mlBackend: string;
  /** The active channel's devices, streams, latency and error. */
  status: Status | null;
  /** Link to the native engine ('off' = not in use). */
  engine: EngineConn;
  engineVersion: string;
  canPickOutput: boolean;
}

/**
 * The latest levels, for gauges that redraw every animation frame (no React state involved).
 * dBFS; `inAt`/`outAt` are performance.now() of the last reading, so stale input reads as off.
 */
export interface LiveLevels {
  /** Input RMS of the latest analysis frame, and the chunk's sample peak. */
  inDb: number;
  inPeakDb: number;
  inAt: number;
  outDb: number;
  outAt: number;
  /** Noise floor in force, the automatic estimate, and the gate margin above the floor. */
  floorDb: number;
  measuredDb: number;
  openDb: number;
  gate: boolean;
}

const dB = (x: number) => 20 * Math.log10(x + 1e-9);

type Events = {
  status: EngineStatus;
  state: SessionState;
  analysis: Analysis;
  notes: Notes;
  looper: LooperView;
  cond: { gainDb: number };
};
type Listener<K extends keyof Events> = (v: Events[K]) => void;

/** Shared settings that follow the player from one channel to the other (newest edit wins). */
const PORTABLE = ['pedals', 'output', 'gateDb', 'ml'] as const;

/**
 * Maps a channel's clock (seconds) onto the app's: offsets are kept per segment, so late results
 * (basic-pitch arrives 1–2 s after the audio) still land where their audio was.
 */
export class ClockMap {
  private segs: Array<{ from: number; offset: number }> = [];
  private last = -1;
  /** The app clock reached so far. */
  appNow = 0;

  /** Starts a new source: its next reading continues from the app clock. */
  reset() {
    this.segs = [];
    this.last = -1;
  }

  /** Feeds the chunk-end clock of a new analysis message (`chunk` = chunk duration). */
  advance(raw: number, chunk: number) {
    if (this.last < 0) this.segs.push({ from: raw - chunk, offset: this.appNow - (raw - chunk) });
    // A gap (nobody listening while another client kept the clock going) collapses, as a pause does.
    else if (raw - this.last > chunk * 1.5) this.segs.push({ from: raw - chunk, offset: this.map(this.last) - (raw - chunk) });
    if (this.segs.length > 32) this.segs.splice(0, this.segs.length - 32);
    this.last = raw;
    this.appNow = Math.max(this.appNow, this.map(raw));
  }

  map(raw: number) {
    let off = this.segs.length ? this.segs[0].offset : this.appNow - raw;
    for (const s of this.segs) if (raw >= s.from) off = s.offset;
    return raw + off;
  }
}

class AudioEngine {
  private web: WebChannel | null = null;
  private link = new EngineChannel();
  private engineOn = false;
  private active: AudioChannel | null = null;
  private listeners: { [K in keyof Events]: Set<Listener<K>> } = { status: new Set(), state: new Set(), analysis: new Set(), notes: new Set(), looper: new Set(), cond: new Set() };
  private clockMap = new ClockMap();
  private clockAt = 0;
  private listening = true;
  private outDb = -120;
  private group = 1;
  /** Last state each channel reported, for carrying settings across. */
  private states: { web?: SessionState; engine?: SessionState } = {};
  /** Waiting for the newly active channel's state to decide which settings win. */
  private reconcilePending = false;
  private statuses: { web?: Status; engine?: Status } = {};
  private ml: Record<'web' | 'engine', { status: MlState; backend: string }> = {
    web: { status: 'off', backend: '' },
    engine: { status: 'off', backend: '' },
  };

  levels: LiveLevels = { inDb: -120, inPeakDb: -120, inAt: 0, outDb: -120, outAt: 0, floorDb: -80, measuredDb: -80, openDb: 12, gate: false };
  status: EngineStatus = { channel: 'web', mic: 'idle', running: false, ml: 'off', mlBackend: '', status: null, engine: 'off', engineVersion: '', canPickOutput: false };
  /** The active channel's shared state. */
  state: SessionState | null = null;

  on<K extends keyof Events>(k: K, fn: Listener<K>) {
    this.listeners[k].add(fn);
    return () => void this.listeners[k].delete(fn);
  }
  private emit<K extends keyof Events>(k: K, v: Events[K]) {
    this.listeners[k].forEach((fn) => fn(v));
  }

  /** Creates the web channel and, if the player opted in, starts looking for the engine. */
  async init(opts: WebOptions & { engineOn: boolean }) {
    const web = await WebChannel.create(opts);
    this.web = web;
    web.onMessage = (m) => this.receive('web', m);
    web.onChange = () => this.refreshStatus();
    this.link.onMessage = (m) => this.receive('engine', m);
    this.link.onConn = (c) => this.onEngineConn(c);
    this.active = web;
    web.start();
    this.setEngine(opts.engineOn);
  }

  // ---- channels

  private activate(ch: AudioChannel) {
    if (this.active === ch) return;
    this.active = ch;
    this.clockMap.reset();
    this.reconcilePending = true;
    if (ch === this.web) {
      this.web.setActive(true);
      this.state = this.states.web ?? null;
      if (this.state) this.reconcile(this.state);
    } else {
      this.web?.setActive(false);
      this.link.send({ type: 'listen', on: this.listening });
      this.state = this.states.engine ?? null;
      if (this.state) this.reconcile(this.state);
    }
    this.refreshStatus();
  }

  /**
   * The channel just taking over and the one before may disagree on shared settings: whichever
   * was edited last wins, so a change made on either side is never lost.
   */
  private reconcile(now: SessionState) {
    this.reconcilePending = false;
    const other = this.active === this.web ? this.states.engine : this.states.web;
    this.emit('state', now);
    if (other && other.editedAt > now.editedAt) {
      const patch: StatePatch = {};
      for (const k of PORTABLE) (patch as Record<string, unknown>)[k] = other[k];
      this.active?.send({ type: 'set', state: patch, at: other.editedAt });
    }
  }

  private onEngineConn(c: EngineConn) {
    if (c === 'connected') this.activate(this.link);
    else if (this.active === this.link && this.web) this.activate(this.web);
    this.refreshStatus();
  }

  private receive(from: 'web' | 'engine', m: ChannelMsg) {
    const isActive = (from === 'web' ? this.web : this.link) === this.active;
    switch (m.type) {
      case 'state': {
        const { type: _, ...s } = m;
        this.states[from] = s;
        if (!isActive) return;
        this.state = s;
        if (this.reconcilePending) this.reconcile(s);
        else this.emit('state', s);
        return;
      }
      case 'status':
        this.statuses[from] = m;
        if (isActive) this.refreshStatus();
        return;
      case 'ml':
        this.ml[from] = { status: m.status, backend: m.backend };
        if (isActive) this.refreshStatus();
        return;
    }
    if (!isActive) return;
    switch (m.type) {
      case 'analysis': {
        const rate = this.status.status?.input?.rate || 48000;
        this.clockMap.advance(m.clock, 1024 / rate);
        const map = (t: number) => this.clockMap.map(t);
        this.clockAt = performance.now();
        const L = this.levels;
        const last = m.frames[m.frames.length - 1];
        if (last) L.inDb = dB(last.rms);
        L.inPeakDb = dB(m.peak);
        L.inAt = this.clockAt;
        L.floorDb = m.levels.floorDb;
        L.measuredDb = m.levels.measuredDb;
        L.openDb = m.levels.openDb;
        L.gate = m.levels.gate;
        this.emit('analysis', { ...m, clock: map(m.clock), frames: m.frames.map((f) => ({ ...f, t: map(f.t) })), notes: m.notes.map((n) => ({ ...n, t: map(n.t) })) });
        return;
      }
      case 'notes': {
        const map = (t: number) => this.clockMap.map(t);
        this.emit('notes', { ...m, from: map(m.from), to: map(m.to), notes: m.notes.map((n) => ({ ...n, t: map(n.t) })) });
        return;
      }
      case 'meters':
        this.outDb = m.outDb;
        this.levels.outDb = m.outDb;
        this.levels.outAt = performance.now();
        this.emit('looper', m.looper);
        this.emit('cond', { gainDb: m.gainDb });
        return;
    }
  }

  private refreshStatus() {
    const web = this.web;
    const onEngine = this.active === this.link;
    const st = onEngine ? this.statuses.engine : this.statuses.web;
    const ml = onEngine ? this.ml.engine : this.ml.web;
    this.status = {
      channel: onEngine ? 'engine' : 'web',
      // The engine owns the input: live while its stream is open.
      mic: onEngine ? (st?.input ? 'live' : st?.error ? 'error' : this.listening || this.state?.output ? 'starting' : 'idle') : (web?.mic ?? 'idle'),
      running: onEngine ? true : (web?.running ?? false),
      ml: ml.status,
      mlBackend: ml.backend,
      status: st ?? null,
      engine: this.link.conn,
      engineVersion: this.link.version,
      canPickOutput: onEngine || !!web?.canPickOutput,
    };
    this.emit('status', this.status);
  }

  /** Use the native engine whenever it is running (only after the player opted in). */
  setEngine(on: boolean) {
    this.engineOn = on;
    this.link.enable(on);
    this.refreshStatus();
  }

  retryEngine() {
    this.link.retryNow();
  }

  /** At start-up, wait briefly for the engine so the browser mic isn't opened just to be closed. */
  waitForEngine(ms: number) {
    return this.engineOn ? this.link.waitConnected(ms) : Promise.resolve(false);
  }

  isEngine() {
    return this.active === this.link;
  }

  // ---- the protocol, for the app

  send(m: ControlMsg) {
    this.active?.send(m);
  }

  /** Change shared settings (pedals, Output, gate, noise floor, ML, devices). */
  set(patch: StatePatch) {
    this.send({ type: 'set', state: patch, at: Date.now() });
  }

  setListening(on: boolean) {
    this.listening = on;
    this.send({ type: 'listen', on });
    this.refreshStatus();
  }

  /** Measure the noise floor afresh (strings muted). */
  recalibrate() {
    this.send({ type: 'recalibrate' });
  }

  loop(cmd: 'tap' | 'stop' | 'clear', slot: number) {
    this.send({ type: 'loop', cmd, slot });
  }

  /** Opens the input again (after a permission change or plugging something in). */
  retryInput() {
    if (!this.isEngine()) this.web?.retry();
  }

  // ---- sounds

  private play(notes: NoteSpec[], lead = 0.05) {
    const group = this.group++;
    this.send({ type: 'play', group, notes, lead });
    return { stop: () => this.send({ type: 'stop', group }) };
  }

  pluck(hz: number, when = 0, dur = 1.1) {
    return this.play([{ at: when, hz, dur, voice: 'pluck' }]);
  }

  reference(hz: number) {
    return this.play([{ at: 0, hz, dur: 1.8, voice: 'reference' }], 0.02);
  }

  /** Plays notes from `from` seconds in. Returns the `now()` time that maps to t = 0. */
  playNotes(notes: Array<{ t: number; hz: number }>, from: number) {
    const lead = 0.05;
    const p = this.play(
      notes.filter((n) => n.t >= from).map((n) => ({ at: n.t - from, hz: n.hz, dur: 0.7, voice: 'pluck' as const })),
      lead,
    );
    return { zero: this.now() + lead - from, stop: p.stop };
  }

  /** Seconds, for timing playback on screen. */
  now() {
    return performance.now() / 1000;
  }

  /** Listening-clock seconds, extrapolated between analysis chunks so the stream moves smoothly. */
  clock() {
    const base = this.clockMap.appNow;
    if (!this.listening || this.status.mic !== 'live' || !this.status.running) return base;
    return base + Math.min(0.25, (performance.now() - this.clockAt) / 1000);
  }

  /** Browsers start audio suspended; any tap may resume it. */
  resume() {
    this.web?.resume();
  }

  /** What the active channel sends to the speakers, dBFS (peak over the last ~33 ms). */
  outputDb() {
    return this.outDb;
  }

  /** Estimated delay from string to speaker through Output, ms (0 if unknown). */
  delayMs() {
    return Math.round(this.status.status?.latency?.totalMs ?? 0);
  }

  // ---- browser-only diagnostics

  latencyBreakdown() {
    return this.web?.latencyBreakdown() ?? null;
  }

  diagnostics() {
    return this.web?.diagnostics() ?? null;
  }

  async pauseForTest() {
    await this.web?.pauseForTest();
  }

  async resumeAfterTest() {
    await this.web?.resumeAfterTest();
  }
}

export const engine = new AudioEngine();
