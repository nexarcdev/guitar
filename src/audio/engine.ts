// The app is the amp. Signal flow:
//   input ─┬─ capture worklet ──ports──▶ pitch worker, ML worker   (analysis, only while listening)
//          └─ inBus ─▶ pedal chain ─▶ chainOut ─┬────────────────▶ master (output toggle) ─▶ speakers
//                                               └─ looper worklet ─▶ master
// Everything stateful lives here, outside React; the store subscribes to events.

import captureUrl from './worklets/capture.worklet.ts?worker&url';
import looperUrl from './worklets/looper.worklet.ts?worker&url';
import conditionerUrl from './worklets/conditioner.worklet.ts?worker&url';
import type { ConditionerView } from './conditionerCore';
import { makeFx, type FxNode, type Pedal, type PedalName } from './pedals';
import { pluck, referenceTone, type Voice } from './synth';
import type { LooperView } from './looperCore';
import type { TrackerOutput } from '../dsp/tracker';

export type MicState = 'idle' | 'starting' | 'live' | 'denied' | 'nodevice' | 'insecure' | 'error';
export type MlStatus = 'off' | 'loading' | 'ready' | 'slow' | 'unavailable';

export interface InputDevice {
  id: string;
  label: string;
}

export interface EngineStatus {
  mic: MicState;
  /** AudioContext is running (browsers keep it suspended until the first tap). */
  running: boolean;
  ml: MlStatus;
  mlBackend: string;
  devices: InputDevice[];
  /** Device actually in use. */
  deviceId: string;
}

export interface Analysis extends TrackerOutput {
  clock: number;
}

export interface MlNotes {
  from: number;
  to: number;
  notes: Array<{ midi: number; t: number; dur: number; amp: number }>;
}

type Events = {
  cond: ConditionerView;
  analysis: Analysis;
  ml: MlNotes;
  looper: LooperView;
  status: EngineStatus;
};
type Listener<K extends keyof Events> = (v: Events[K]) => void;

class AudioEngine {
  private ac: AudioContext | null = null;
  private modules: Promise<void> | null = null;
  private inBus!: GainNode;
  private chainOut!: GainNode;
  private master!: GainNode;
  private fx = new Map<PedalName, FxNode>();
  private fxOrder = '';
  private pedals: Pedal[] = [];
  private capture: AudioWorkletNode | null = null;
  private looper: AudioWorkletNode | null = null;
  private cond: AudioWorkletNode | null = null;
  /** Mic was released because the tab went to the background; reopen when it comes back. */
  private releasedHidden = false;
  private floorSentAt = 0;
  private openDb = 12;
  private mlEnabled = true;
  private tap: AnalyserNode | null = null;
  private tapBuf: Float32Array<ArrayBuffer> | null = null;
  /** Everything audible goes through here: the amp path, the synth, and riff playback. */
  private out!: GainNode;
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private pitchW: Worker | null = null;
  private mlW: Worker | null = null;
  private listeners: { [K in keyof Events]: Set<Listener<K>> } = { cond: new Set(), analysis: new Set(), ml: new Set(), looper: new Set(), status: new Set() };
  private clockBase = 0;
  private clockAt = 0;
  private pending: Promise<void> | null = null;
  private wantDevice = '';

  listening = true;
  output = false;
  /** Audio buffer size preference; 'playback' trades latency for robustness on struggling systems. */
  latency: 'interactive' | 'playback' = 'interactive';
  status: EngineStatus = { mic: 'idle', running: false, ml: 'off', mlBackend: '', devices: [], deviceId: '' };

  on<K extends keyof Events>(k: K, fn: Listener<K>) {
    this.listeners[k].add(fn);
    return () => void this.listeners[k].delete(fn);
  }
  private emit<K extends keyof Events>(k: K, v: Events[K]) {
    this.listeners[k].forEach((fn) => fn(v));
  }
  private setStatus(p: Partial<EngineStatus>) {
    this.status = { ...this.status, ...p };
    this.emit('status', this.status);
  }

  /** Creates the context and graph on first use. Safe to call from any click handler. */
  context(sampleRate?: number): AudioContext {
    if (!this.ac) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      let ac: AudioContext;
      try {
        ac = new C({ latencyHint: this.latency, ...(sampleRate ? { sampleRate } : {}) });
      } catch {
        ac = new C();
      }
      this.ac = ac;
      this.inBus = ac.createGain();
      this.chainOut = ac.createGain();
      this.master = ac.createGain();
      this.master.gain.value = this.output ? 1 : 0;
      this.out = ac.createGain();
      this.out.connect(ac.destination);
      this.tap = ac.createAnalyser();
      this.tap.fftSize = 2048;
      this.out.connect(this.tap);
      this.master.connect(this.out);
      this.chainOut.connect(this.master);
      ac.onstatechange = () => this.setStatus({ running: ac.state === 'running' });
      this.modules = Promise.all([captureUrl, looperUrl, conditionerUrl].map((u) => ac.audioWorklet.addModule(u))).then(() => {
        this.capture = new AudioWorkletNode(ac, 'fretline-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
        // Monitored path: input → conditioner (auto level + noise gate) → pedals.
        this.cond = new AudioWorkletNode(ac, 'fretline-conditioner', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        this.cond.port.onmessage = (e) => this.emit('cond', e.data as ConditionerView);
        this.cond.connect(this.inBus);
        this.capture.port.postMessage({ type: 'listening', on: this.listening });
        this.looper = new AudioWorkletNode(ac, 'fretline-looper', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
        this.looper.port.onmessage = (e) => this.emit('looper', e.data as LooperView);
        this.chainOut.connect(this.looper);
        this.looper.connect(this.master);
        this.startWorkers(ac);
      });
      this.applyPedals(this.pedals);
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    this.setStatus({ running: this.ac.state === 'running' });
    return this.ac;
  }

  private startWorkers(ac: AudioContext) {
    if (!this.capture) return;
    this.pitchW = new Worker(new URL('../workers/pitch.worker.ts', import.meta.url), { type: 'module' });
    const pc = new MessageChannel();
    this.pitchW.postMessage({ type: 'init', sampleRate: ac.sampleRate, port: pc.port2 }, [pc.port2]);
    this.capture.port.postMessage({ type: 'sink', id: 'pitch', port: pc.port1 }, [pc.port1]);
    this.pitchW.postMessage({ type: 'gate', openDb: this.openDb });
    this.pitchW.onmessage = (e) => {
      const a = e.data as Analysis;
      this.clockBase = a.clock;
      this.clockAt = performance.now();
      // One noise floor for the whole app: share the tracker's with the auto level and the ML pass.
      const now = performance.now();
      if (now - this.floorSentAt > 200) {
        this.floorSentAt = now;
        const msg = { type: 'floor', floorDb: a.levels.floorDb, openDb: a.levels.openDb };
        this.cond?.port.postMessage(msg);
        this.mlW?.postMessage(msg);
      }
      this.emit('analysis', a);
    };
    if (this.mlEnabled) this.startMl(ac);
  }

  private startMl(ac: AudioContext) {
    if (!this.capture || this.mlW) return;

    this.mlW = new Worker(new URL('../workers/ml.worker.ts', import.meta.url), { type: 'module' });
    const mc = new MessageChannel();
    this.setStatus({ ml: 'loading' });
    this.mlW.postMessage(
      { type: 'init', sampleRate: ac.sampleRate, modelUrl: new URL(import.meta.env.BASE_URL + 'model/model.json', location.href).href, port: mc.port2 },
      [mc.port2],
    );
    this.capture.port.postMessage({ type: 'sink', id: 'ml', port: mc.port1 }, [mc.port1]);
    this.mlW.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'status') this.setStatus({ ml: m.status, mlBackend: m.backend ?? this.status.mlBackend });
      else if (m.type === 'notes') this.emit('ml', m as MlNotes);
    };
    this.mlW.onerror = () => this.setStatus({ ml: 'unavailable' });
  }

  /** Listening-clock seconds, extrapolated between analysis chunks so the stream moves smoothly. */
  clock() {
    if (!this.listening || this.status.mic !== 'live' || !this.status.running) return this.clockBase;
    return this.clockBase + Math.min(0.25, (performance.now() - this.clockAt) / 1000);
  }

  // ---- input

  async start(deviceId = this.wantDevice) {
    this.wantDevice = deviceId;
    if (this.pending) return this.pending;
    this.pending = this.open(deviceId).finally(() => (this.pending = null));
    return this.pending;
  }

  private async open(deviceId: string) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.setStatus({ mic: 'insecure' });
      return;
    }
    this.setStatus({ mic: 'starting' });
    const constraints = (id: string): MediaStreamConstraints => ({
      audio: {
        ...(id ? { deviceId: { exact: id } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
      },
    });
    let stream: MediaStream;
    try {
      // Open the interface by its real device id. On Windows, opening the virtual "default" or
      // "communications" device counts as a call and triggers ducking, which turns down every
      // other sound, including this app's own output.
      const want = deviceId || (await this.realDefaultId());
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints(want));
      } catch (e) {
        // A remembered interface that is unplugged should not lock the user out.
        if (want && (e as DOMException).name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia(constraints(''));
        else throw e;
      }
      // First run: labels and ids only appear after permission, so the first open may have used
      // the virtual default. Swap to the real device straight away.
      const opened = stream.getAudioTracks()[0]?.getSettings().deviceId ?? '';
      if (!want && (opened === '' || opened === 'default' || opened === 'communications')) {
        const real = await this.realDefaultId();
        if (real) {
          stream.getTracks().forEach((t) => t.stop());
          stream = await navigator.mediaDevices.getUserMedia(constraints(real));
        }
      }
    } catch (e) {
      const name = (e as DOMException).name;
      this.setStatus({
        mic: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nodevice' : 'error',
      });
      return;
    }
    if (!(this.listening || this.output)) {
      stream.getTracks().forEach((t) => t.stop());
      this.setStatus({ mic: 'idle' });
      return;
    }
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings() as MediaTrackSettings & { latency?: number };
    // Run the engine at the input's own sample rate when we can (the mic usually opens before any
    // sound is played). Chrome then converts once, on the way to the speakers, instead of
    // resampling the live input inside the graph.
    const ac = this.context(settings.sampleRate);
    await this.modules;
    const switched = settings.deviceId !== this.status.deviceId;
    this.closeInput();
    this.stream = stream;
    this.src = ac.createMediaStreamSource(stream);
    this.routeInput();
    if (this.capture) this.src.connect(this.capture);
    track.onended = () => this.setStatus({ mic: 'nodevice' });
    if (switched) {
      // New input, new noise floor: measure the baseline again.
      this.cond?.port.postMessage({ type: 'recalibrate' });
      this.pitchW?.postMessage({ type: 'recalibrate' });
    }
    const rt = (ac.baseLatency || 0) + ((ac as AudioContext & { outputLatency?: number }).outputLatency || 0) + (settings.latency ?? 0.01);
    this.looper?.port.postMessage({ type: 'latency', samples: rt * ac.sampleRate });
    this.setStatus({ mic: 'live', deviceId: settings.deviceId ?? '' });
    this.refreshDevices();
    navigator.mediaDevices.ondevicechange = () => this.refreshDevices();
  }

  /** The physical device behind the browser's virtual "default" input, if it can be resolved. */
  private async realDefaultId(): Promise<string> {
    try {
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const virt = all.find((d) => d.deviceId === 'default');
      const real = all.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
      if (!real.length || !real[0].label) return ''; // no permission yet: ids are not usable
      if (virt) {
        const match = real.find((d) => d.groupId === virt.groupId) ?? real.find((d) => virt.label.endsWith(d.label));
        if (match) return match.deviceId;
      }
      return real[0].deviceId;
    } catch {
      return '';
    }
  }

  /** Releases the input and silences the engine so the Sound test can use fresh audio setups. */
  private testing = false;
  async pauseForTest() {
    this.testing = true;
    this.closeInput();
    await this.ac?.suspend().catch(() => {});
  }
  async resumeAfterTest() {
    this.testing = false;
    await this.ac?.resume().catch(() => {});
    this.sync();
  }

  /** Noise gate margin above the floor, app-wide. */
  setGate(openDb: number) {
    this.openDb = openDb;
    this.pitchW?.postMessage({ type: 'gate', openDb });
  }

  /** Chord detection (basic-pitch) on or off; off frees the GPU/CPU and leaves single-note tabs. */
  setMl(on: boolean) {
    this.mlEnabled = on;
    if (!on && this.mlW) {
      this.mlW.terminate();
      this.mlW = null;
      this.capture?.port.postMessage({ type: 'unsink', id: 'ml' });
      this.setStatus({ ml: 'off' });
    } else if (on && this.ac && this.capture && !this.mlW) this.startMl(this.ac);
  }

  /** What Fretline is sending to the speakers right now, dBFS (or 'NaN' if the graph is poisoned). */
  outputDb(): number | 'NaN' {
    if (!this.tap) return -120;
    const b = (this.tapBuf ??= new Float32Array(this.tap.fftSize));
    this.tap.getFloatTimeDomainData(b);
    let sum = 0;
    for (let i = 0; i < b.length; i++) {
      if (Number.isNaN(b[i])) return 'NaN';
      sum += b[i] * b[i];
    }
    return 20 * Math.log10(Math.sqrt(sum / b.length) + 1e-9);
  }

  /** Snapshot for the Sound check panel. */
  diagnostics() {
    const ac = this.ac;
    const t = this.stream?.getAudioTracks()[0];
    const st = t?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    return {
      state: ac?.state ?? 'not started',
      sampleRate: ac?.sampleRate ?? 0,
      outputMs: ac ? Math.round((((ac as AudioContext & { outputLatency?: number }).outputLatency || 0) + (ac.baseLatency || 0)) * 1000) : 0,
      inputRate: st?.sampleRate ?? 0,
      ml: this.status.ml,
      backend: this.status.mlBackend,
      inputLabel: t?.label ?? '',
      micOpen: !!t && t.readyState === 'live',
    };
  }

  /** Releases the mic while the tab is hidden (unless it's needed for Output), and reopens it on return. */
  private onVisibility = () => {
    if (document.hidden) {
      if (this.stream && !this.output) {
        this.releasedHidden = true;
        this.closeInput();
      }
    } else if (this.releasedHidden) {
      this.releasedHidden = false;
      this.sync();
    }
  };

  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  private closeInput() {
    this.inputRouted = false;
    if (this.src) {
      try { this.src.disconnect(); } catch { /* not connected */ }
      this.src = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => { t.onended = null; t.stop(); });
      this.stream = null;
    }
  }

  stop() {
    this.closeInput();
    this.setStatus({ mic: 'idle' });
  }

  async refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const devices = all
        .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || 'Input ' + (i + 1) }));
      this.setStatus({ devices });
    } catch {
      /* enumerate is best effort */
    }
  }

  setListening(on: boolean) {
    this.listening = on;
    this.capture?.port.postMessage({ type: 'listening', on });
    this.sync();
  }

  setOutput(on: boolean) {
    this.output = on;
    const ac = this.context();
    this.master.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.02);
    this.routeInput();
    this.sync();
  }

  /**
   * The guitar only feeds the amp path (auto level, pedals, looper) while Output is on. Listening
   * alone just needs the raw signal at the capture tap, which keeps the audio thread light.
   */
  private inputRouted = false;
  private routeInput() {
    if (!this.src || !this.cond) return;
    if (this.output && !this.inputRouted) {
      this.src.connect(this.cond);
      this.inputRouted = true;
    } else if (!this.output && this.inputRouted) {
      try { this.src.disconnect(this.cond); } catch { /* already disconnected */ }
      this.inputRouted = false;
    }
  }

  /** Mic stays open while anything needs it: analysis (listening) or the amp (output). */
  private sync() {
    if (this.testing) return;
    const need = this.listening || this.output;
    if (need && !this.stream) {
      if (this.status.mic !== 'denied' && this.status.mic !== 'insecure') this.start();
    } else if (!need && this.stream) this.stop();
  }

  // ---- pedals

  applyPedals(ps: Pedal[]) {
    this.pedals = ps;
    const ac = this.ac;
    if (!ac) return;
    for (const p of ps) if (p.on && !this.fx.has(p.name)) this.fx.set(p.name, makeFx(ac, p.name));
    // Only switched-on pedals are in the signal path. A bypassed pedal is fully disconnected, so
    // it costs nothing (a reverb or 2x-oversampled drive still burns CPU when merely muted).
    const active = ps.filter((p) => p.on);
    const order = active.map((p) => p.name).join();
    if (order !== this.fxOrder) {
      this.fxOrder = order;
      this.inBus.disconnect();
      this.fx.forEach((n) => n.o.disconnect());
      let prev: AudioNode = this.inBus;
      for (const p of active) {
        const n = this.fx.get(p.name)!;
        prev.connect(n.i);
        prev = n.o;
      }
      prev.connect(this.chainOut);
    }
    const t = ac.currentTime;
    for (const p of active) {
      const n = this.fx.get(p.name)!;
      n.set(p.level);
      n.dry.gain.setTargetAtTime(!p.on || n.mix ? 1 : 0, t, 0.01);
      n.wet.gain.setTargetAtTime(!p.on ? 0 : n.mix ? n.mix(p.level) : 1, t, 0.01);
    }
  }

  // ---- looper

  loop(cmd: 'tap' | 'stop' | 'clear', slot: number) {
    this.context();
    this.modules?.then(() => this.looper?.port.postMessage({ type: cmd, slot }));
  }

  // ---- synth

  pluck(freq: number, when = 0, d = 1.1): Voice {
    const ac = this.context();
    return pluck(ac, freq, ac.currentTime + when, d, this.out);
  }

  reference(freq: number) {
    const ac = this.context();
    referenceTone(ac, freq, this.out);
  }

  /** Schedules a list of notes from `from` seconds in. Returns the audio time that maps to t = 0. */
  playNotes(notes: Array<{ t: number; hz: number }>, from: number): { zero: number; voices: Voice[] } {
    const ac = this.context();
    const zero = ac.currentTime + 0.05 - from;
    const voices = notes.filter((n) => n.t >= from).map((n) => pluck(ac, n.hz, zero + n.t, 0.7, this.out));
    return { zero, voices };
  }

  now() {
    return this.ac ? this.ac.currentTime : 0;
  }

  /** Browsers start contexts suspended; any tap may resume. */
  resume() {
    if (this.ac && this.ac.state !== 'running') this.ac.resume().catch(() => {});
  }
}

export const engine = new AudioEngine();
