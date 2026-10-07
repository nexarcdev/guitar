// The app is the amp. Signal flow:
//   input ─┬─ capture worklet ──ports──▶ pitch worker, ML worker   (analysis, only while listening)
//          └─ inBus ─▶ pedal chain ─▶ chainOut ─┬────────────────▶ master (output toggle) ─▶ speakers
//                                               └─ looper worklet ─▶ master
// Everything stateful lives here, outside React; the store subscribes to events.
//
// With the Fretline engine (native.ts) connected, the guitar, pedals, looper and speakers move
// to the native app; the browser mic closes and the analysis workers are fed from the socket
// instead of the capture worklet. Everything else (synth, riff playback) stays in the browser.

import captureUrl from './worklets/capture.worklet.ts?worker&url';
import looperUrl from './worklets/looper.worklet.ts?worker&url';
import conditionerUrl from './worklets/conditioner.worklet.ts?worker&url';
import type { ConditionerView } from './conditionerCore';
import { makeFx, type FxNode, type Pedal, type PedalName } from './pedals';
import { pluck, referenceTone, type Voice } from './synth';
import type { LooperView } from './looperCore';
import type { TrackerOutput } from '../dsp/tracker';
import { NativeLink, type NativeConn, type NativeMeters, type NativeStatus } from './native';

export type LatencyMode = 'lowest' | 'interactive' | 'playback';

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
  /** Audio output devices (speakers, headphones, interface outputs). */
  outputs: InputDevice[];
  /** Output device in use ('' = system default). */
  outputId: string;
  /** setSinkId is available, so the output can be chosen. */
  canPickOutput: boolean;
  /** Device actually in use. */
  deviceId: string;
  /** Link to the native low-latency engine ('off' = not in use). */
  native: NativeConn;
  nativeStatus: NativeStatus | null;
}

export interface NativePrefs {
  on: boolean;
  input: string;
  output: string;
  exclusiveInput: boolean;
  exclusiveOutput: boolean;
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
  latency: LatencyMode = 'lowest';
  status: EngineStatus = { mic: 'idle', running: false, ml: 'off', mlBackend: '', devices: [], deviceId: '', outputs: [], outputId: '', canPickOutput: false, native: 'off', nativeStatus: null };
  /** Output device to use when the context is (re)created; '' = system default. */
  outputId = '';

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
        // 'lowest' asks for the smallest buffer the device allows (a numeric hint of 0): in Chrome
        // that's ~3 ms + ~8 ms of output buffering, versus ~10 + ~32 ms for 'interactive'.
        const hint = this.latency === 'lowest' ? 0 : this.latency;
        ac = new C({ latencyHint: hint, ...(sampleRate ? { sampleRate } : {}) });
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
      });
      this.applyPedals(this.pedals);
    }
    if (this.outputId && !this.sinkApplied) {
      this.sinkApplied = true;
      this.setOutputDevice(this.outputId);
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    this.setStatus({ running: this.ac.state === 'running' });
    return this.ac;
  }

  /**
   * Analysis workers run at the rate of whatever feeds them: the capture worklet (browser input)
   * or the native engine's stream. Switching feed or rate re-creates them.
   */
  private feed: 'capture' | 'native' | null = null;
  private workerRate = 0;
  private pitchPort: MessagePort | null = null;
  private mlPort: MessagePort | null = null;

  private setupWorkers(rate: number, feed: 'capture' | 'native') {
    if (this.pitchW && rate === this.workerRate && feed === this.feed) return;
    if (feed === 'capture' && !this.capture) return;
    this.stopWorkers();
    this.feed = feed;
    this.workerRate = rate;
    // Keep the listening clock running on from where it was, whichever source takes over.
    const at = Math.round(this.clockBase * rate);
    if (feed === 'capture') this.capture!.port.postMessage({ type: 'clock', at });
    else this.nativeClock = at;
    this.startPitch();
    if (this.mlEnabled) this.startMl();
  }

  private stopWorkers() {
    this.pitchW?.terminate();
    this.mlW?.terminate();
    this.pitchW = this.mlW = null;
    this.capture?.port.postMessage({ type: 'unsink', id: 'pitch' });
    this.capture?.port.postMessage({ type: 'unsink', id: 'ml' });
    this.pitchPort?.close();
    this.mlPort?.close();
    this.pitchPort = this.mlPort = null;
  }

  /** Hands one end of a worker's audio channel to its feed. */
  private attachFeed(id: 'pitch' | 'ml', port: MessagePort) {
    if (this.feed === 'capture') this.capture?.port.postMessage({ type: 'sink', id, port }, [port]);
    else if (id === 'pitch') this.pitchPort = port;
    else this.mlPort = port;
  }

  private startPitch() {
    this.pitchW = new Worker(new URL('../workers/pitch.worker.ts', import.meta.url), { type: 'module' });
    const pc = new MessageChannel();
    this.pitchW.postMessage({ type: 'init', sampleRate: this.workerRate, port: pc.port2 }, [pc.port2]);
    this.attachFeed('pitch', pc.port1);
    this.pitchW.postMessage({ type: 'gate', openDb: this.openDb });
    this.pitchW.onmessage = (e) => {
      const a = e.data as Analysis;
      this.clockBase = a.clock;
      this.clockAt = performance.now();
      // One noise floor for the whole app: share the tracker's with the auto level and the ML pass.
      const now = performance.now();
      if (now - this.floorSentAt > 200) {
        this.floorSentAt = now;
        const msg = { type: 'floor', floorDb: a.levels.floorDb, openDb: a.levels.openDb } as const;
        if (this.isNative()) this.native.send(msg);
        else this.cond?.port.postMessage(msg);
        this.mlW?.postMessage(msg);
      }
      this.emit('analysis', a);
    };
  }

  private startMl() {
    if (!this.feed || this.mlW) return;

    this.mlW = new Worker(new URL('../workers/ml.worker.ts', import.meta.url), { type: 'module' });
    const mc = new MessageChannel();
    this.setStatus({ ml: 'loading' });
    this.mlW.postMessage(
      { type: 'init', sampleRate: this.workerRate, modelUrl: new URL(import.meta.env.BASE_URL + 'model/model.json', location.href).href, port: mc.port2 },
      [mc.port2],
    );
    this.attachFeed('ml', mc.port1);
    this.mlW.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'status') this.setStatus({ ml: m.status, mlBackend: m.backend ?? this.status.mlBackend });
      else if (m.type === 'notes') this.emit('ml', m as MlNotes);
    };
    this.mlW.onerror = () => this.setStatus({ ml: 'unavailable' });
  }

  /** Listening-clock seconds, extrapolated between analysis chunks so the stream moves smoothly. */
  clock() {
    if (!this.listening || this.status.mic !== 'live' || (!this.status.running && !this.isNative())) return this.clockBase;
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
    if (this.isNative()) return;
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
        // Smallest capture buffer the device offers: every millisecond here is heard through Output.
        latency: { ideal: 0 },
      } as MediaTrackConstraints,
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
    if (!(this.listening || this.output) || this.isNative()) {
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
    if (this.isNative()) {
      // The engine connected while the mic was opening.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.setupWorkers(ac.sampleRate, 'capture');
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
      this.mlPort?.close();
      this.mlPort = null;
      this.setStatus({ ml: 'off' });
    } else if (on && !this.mlW) this.startMl();
  }

  /** What Fretline is sending to the speakers right now, dBFS (or 'NaN' if the graph is poisoned). */
  outputDb(): number | 'NaN' {
    if (this.isNative()) return this.nativeMeters?.outDb ?? -120;
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

  private sinkApplied = false;

  /** Route all of Fretline's sound to a specific output device ('' = system default). */
  async setOutputDevice(id: string) {
    this.outputId = id;
    const ac = this.ac as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ac?.setSinkId) return;
    try {
      await ac.setSinkId(id);
      this.setStatus({ outputId: id });
    } catch {
      // Unplugged or not allowed: fall back to the system default.
      await ac.setSinkId('').catch(() => {});
      this.outputId = '';
      this.setStatus({ outputId: '' });
    }
  }

  /**
   * Where the delay from string to speaker goes when playing through Output. Input comes from
   * Chrome's live track stats when available, then the track's reported latency, else a typical
   * 10 ms. The compressor adds its fixed 6 ms look-ahead when it's on.
   */
  latencyBreakdown() {
    const nl = this.isNative() ? this.status.nativeStatus?.latency : null;
    if (nl) {
      // Engine estimate: device periods plus the small buffer that absorbs clock drift.
      return {
        inputMs: Math.round(nl.inputMs * 10) / 10,
        inputSource: 'measured' as 'measured' | 'reported' | 'typical',
        engineMs: Math.round(nl.bufferMs * 10) / 10,
        outputMs: Math.round(nl.outputMs * 10) / 10,
        pedalsMs: 0,
        totalMs: Math.round(nl.totalMs),
        native: true,
      };
    }
    const ac = this.ac;
    const t = this.stream?.getAudioTracks()[0] as (MediaStreamTrack & { stats?: { latency?: number; averageLatency?: number } }) | undefined;
    const st = t?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    let inputMs = 10;
    let inputSource: 'measured' | 'reported' | 'typical' = 'typical';
    const live = t?.stats?.averageLatency ?? t?.stats?.latency;
    if (typeof live === 'number' && live > 0) {
      inputMs = live; // MediaStreamTrackAudioStats reports milliseconds
      inputSource = 'measured';
    } else if (typeof st?.latency === 'number' && st.latency > 0) {
      inputMs = st.latency * 1000;
      inputSource = 'reported';
    }
    const engineMs = ac ? (ac.baseLatency || 0) * 1000 : 0;
    const outputMs = ac ? ((ac as AudioContext & { outputLatency?: number }).outputLatency || 0) * 1000 : 0;
    const pedalsMs = this.pedals.some((p) => p.on && p.name === 'Compressor') ? 6 : 0;
    return {
      inputMs: Math.round(inputMs),
      inputSource,
      engineMs: Math.round(engineMs),
      outputMs: Math.round(outputMs),
      pedalsMs,
      totalMs: Math.round(inputMs + engineMs + outputMs + pedalsMs),
      native: false,
    };
  }

  delayMs(): number {
    return this.ac || this.isNative() ? this.latencyBreakdown().totalMs : 0;
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
      inputMs: Math.round((st?.latency ?? 0) * 1000),
      inputRate: st?.sampleRate ?? 0,
      ml: this.status.ml,
      backend: this.status.mlBackend,
      inputLabel: t?.label ?? '',
      micOpen: !!t && t.readyState === 'live',
    };
  }

  /** Releases the mic while the tab is hidden (unless it's needed for Output), and reopens it on return. */
  private onVisibility = () => {
    if (this.isNative()) {
      // Same rule for the engine: it closes the input when nobody listens and Output is off.
      this.native.send({ type: 'listen', on: this.listening && !(document.hidden && !this.output) });
      return;
    }
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
      const outputs = all
        .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || 'Output ' + (i + 1) }));
      this.setStatus({ devices, outputs, canPickOutput: !!this.ac && 'setSinkId' in this.ac });
    } catch {
      /* enumerate is best effort */
    }
  }

  setListening(on: boolean) {
    this.listening = on;
    this.capture?.port.postMessage({ type: 'listening', on });
    this.native.send({ type: 'listen', on });
    this.sync();
  }

  setOutput(on: boolean) {
    this.output = on;
    this.native.send({ type: 'output', on });
    if (this.isNative()) return;
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
    if (this.testing || this.isNative()) return;
    const need = this.listening || this.output;
    if (need && !this.stream) {
      if (this.status.mic !== 'denied' && this.status.mic !== 'insecure') this.start();
    } else if (!need && this.stream) this.stop();
  }

  // ---- pedals

  applyPedals(ps: Pedal[]) {
    this.pedals = ps;
    this.native.send({ type: 'pedals', pedals: ps.map((p) => ({ name: p.name, on: p.on, level: p.level })) });
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
    if (this.isNative()) return this.native.send({ type: 'loop', cmd, slot });
    this.context();
    this.modules?.then(() => this.looper?.port.postMessage({ type: cmd, slot }));
  }

  // ---- native engine

  private native = new NativeLink({
    open: () => this.onNativeOpen(),
    conn: (c) => this.onNativeConn(c),
    status: (st) => this.onNativeStatus(st),
    meters: (m) => this.onNativeMeters(m),
    frame: (rate, t0, data) => this.onNativeFrame(rate, t0, data),
  });
  private nativePrefs: NativePrefs = { on: false, input: '', output: '', exclusiveInput: true, exclusiveOutput: false };
  private nativeMeters: NativeMeters | null = null;
  private nativeClock = 0;
  private nativeLastT0 = -1;
  private lastLooperJson = '';

  isNative() {
    return this.native.conn === 'connected';
  }

  /** Applies the user's engine settings; turning it on starts looking for the engine. */
  setNative(p: NativePrefs) {
    const prev = this.nativePrefs;
    this.nativePrefs = p;
    this.native.enable(p.on);
    if (p.input !== prev.input || p.output !== prev.output) this.native.send({ type: 'devices', input: p.input, output: p.output });
    if (p.exclusiveInput !== prev.exclusiveInput || p.exclusiveOutput !== prev.exclusiveOutput)
      this.native.send({ type: 'exclusive', input: p.exclusiveInput, output: p.exclusiveOutput });
  }

  /** Waits briefly for the engine at startup so the browser mic isn't opened just to be closed. */
  waitForNative(ms: number) {
    return this.native.waitConnected(ms);
  }

  retryNative() {
    this.native.retryNow();
  }

  private onNativeOpen() {
    // The engine takes over the guitar: free the browser input and its amp path.
    this.closeInput();
    if (this.master && this.ac) this.master.gain.setTargetAtTime(0, this.ac.currentTime, 0.02);
    // Loops recorded in the browser can't move to the engine; stop them rather than play on top.
    for (let i = 0; i < 4; i++) this.looper?.port.postMessage({ type: 'clear', slot: i });
    this.nativeLastT0 = -1;
    const p = this.nativePrefs;
    this.native.send({ type: 'devices', input: p.input, output: p.output });
    this.native.send({ type: 'exclusive', input: p.exclusiveInput, output: p.exclusiveOutput });
    this.native.send({ type: 'pedals', pedals: this.pedals.map((x) => ({ name: x.name, on: x.on, level: x.level })) });
    this.native.send({ type: 'output', on: this.output });
    this.native.send({ type: 'listen', on: this.listening && !(document.hidden && !this.output) });
  }

  private onNativeConn(c: NativeConn) {
    this.setStatus({ native: c, ...(c === 'off' ? { nativeStatus: null } : {}) });
    if (c !== 'connected' && this.feed === 'native') {
      // Engine gone: back to the browser input, workers and amp path, as before.
      this.stopWorkers();
      this.feed = null;
      this.nativeMeters = null;
      this.setStatus({ mic: 'idle' });
      if (this.ac && this.master) this.master.gain.setTargetAtTime(this.output ? 1 : 0, this.ac.currentTime, 0.02);
      this.sync();
    } else if (c !== 'connected' && this.status.mic === 'idle') this.sync();
  }

  private onNativeStatus(st: NativeStatus) {
    const mic: MicState = !this.isNative() ? this.status.mic : st.input ? 'live' : st.error ? 'error' : this.listening || this.output ? 'starting' : 'idle';
    this.setStatus({ nativeStatus: st, mic });
    if (this.isNative() && st.input) {
      const switched = st.input.id !== this.status.deviceId;
      this.setupWorkers(st.input.rate, 'native');
      if (switched) {
        this.setStatus({ deviceId: st.input.id });
        this.pitchW?.postMessage({ type: 'recalibrate' });
      }
    }
  }

  private onNativeMeters(m: NativeMeters) {
    this.nativeMeters = m;
    this.emit('cond', { floorDb: m.floorDb, peakDb: -100, gainDb: m.gainDb, gate: m.gate });
    const view: LooperView = {
      len: m.looperLen,
      free: m.looperFree,
      rate: m.looperRate,
      slots: m.slots.map((x) => ({ state: x.state as LooperView['slots'][number]['state'], progress: x.progress })),
    };
    const j = JSON.stringify(view);
    if (j !== this.lastLooperJson) {
      this.lastLooperJson = j;
      this.emit('looper', view);
    }
  }

  /**
   * The engine's sample index runs whether or not anyone listens; the app's listening clock
   * pauses with Listening, exactly like the capture worklet. Short drops in the engine's
   * stream still advance the clock, so notes after them keep their timing.
   */
  private onNativeFrame(rate: number, t0: number, data: Float32Array) {
    if (!this.listening) {
      this.nativeLastT0 = -1; // a pause is not a gap: the clock stops with Listening
      return;
    }
    if (this.feed !== 'native' || rate !== this.workerRate) return;
    if (this.nativeLastT0 >= 0) {
      const gap = t0 - (this.nativeLastT0 + data.length);
      if (gap > 0 && gap < rate * 2) this.nativeClock += gap;
    }
    this.nativeLastT0 = t0;
    if (this.mlPort) {
      const copy = data.slice();
      this.mlPort.postMessage({ t0: this.nativeClock, data: copy }, [copy.buffer]);
    }
    if (this.pitchPort) {
      const copy = data.slice();
      this.pitchPort.postMessage({ t0: this.nativeClock, data: copy }, [copy.buffer]);
    }
    this.nativeClock += data.length;
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
