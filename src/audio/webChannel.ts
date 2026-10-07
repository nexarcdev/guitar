// The web channel: Fretline's core running in this browser. The core's Session (WebAssembly, main
// thread) owns the shared state exactly as it does in the engine; its AudioSide and Capture run
// in an AudioWorklet, the tracker and basic-pitch in two workers. This file is only the
// browser-specific glue the engine does natively: opening the mic and speakers, and moving
// messages between those realms.
//
//   mic ─▶ core worklet (auto level, gate, pedals, looper, synth) ─▶ speakers
//              └─ listening-clock chunks ─MessagePorts─▶ pitch worker, ML worker

import coreWorkletUrl from './worklets/core.worklet.ts?worker&url';
import coreWasmUrl from '../core/fretline.wasm?url';
import { Core } from '../core/wasm';
import { PROTOCOL, type ChannelMsg, type ControlMsg, type DeviceInfo, type SessionState, type StatePatch, type Status } from '../core/protocol';
import type { AudioChannel, MicState } from './channel';

export type LatencyMode = 'lowest' | 'interactive' | 'playback';

export interface WebOptions {
  /** Audio buffer size preference, applied when the AudioContext is created. */
  latency: LatencyMode;
  /** The saved session (from `onSave`), or null for a new one. */
  saved: string | null;
  onSave(json: string): void;
  /** Settings from before the core kept the session, applied once to a new session. */
  legacy?: StatePatch;
}

interface Effects {
  state: SessionState | null;
  audio: unknown[];
  listen: unknown[];
  devices: boolean;
}

export interface LatencyBreakdown {
  inputMs: number;
  inputSource: 'measured' | 'reported' | 'typical';
  engineMs: number;
  outputMs: number;
  pedalsMs: number;
  totalMs: number;
}

export class WebChannel implements AudioChannel {
  readonly kind = 'web';
  onMessage: (m: ChannelMsg) => void = () => {};
  /** Mic and context changes (for the empty states and the Sound check). */
  onChange: () => void = () => {};
  mic: MicState = 'idle';
  /** AudioContext running (browsers keep it suspended until the first tap). */
  running = false;
  canPickOutput = false;
  inputs: DeviceInfo[] = [];
  outputs: DeviceInfo[] = [];
  state!: SessionState;

  private session: Core;
  private ac: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private nodeReady: Promise<void> | null = null;
  private queue: string[] = [];
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private pitchW: Worker | null = null;
  private mlW: Worker | null = null;
  private workerRate = 0;
  private listening = true;
  /** Off while the engine channel is in charge: no mic, no sound. */
  private active = true;
  private releasedHidden = false;
  private testing = false;
  private pending: Promise<void> | null = null;
  private error: string | null = null;

  private constructor(
    private module: WebAssembly.Module,
    private bytes: ArrayBuffer,
    private opts: WebOptions,
  ) {
    this.session = new Core(module);
    const x = this.session.x;
    if (opts.saved) x.session_load(this.session.text(opts.saved));
    else {
      x.session_load(0);
      // Carry settings over from before; dated 0 so any newer edit elsewhere still wins.
      if (opts.legacy) this.session.read(x.session_apply(this.session.text(JSON.stringify({ type: 'set', state: opts.legacy, at: 0 })), 0));
    }
    this.state = JSON.parse(this.session.read(x.session_state()));
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  static async create(opts: WebOptions): Promise<WebChannel> {
    const bytes = await (await fetch(coreWasmUrl)).arrayBuffer();
    const module = await WebAssembly.compile(bytes);
    return new WebChannel(module, bytes, opts);
  }

  /** Announces the current state and status (the owner calls this once it listens). */
  start() {
    this.onMessage({ ...this.state, type: 'state' });
    this.publishStatus();
  }

  // ---- protocol

  send(m: ControlMsg) {
    if (m.type === 'hello') return;
    if (m.type === 'listen') {
      this.listening = m.on;
      this.node?.port.postMessage({ type: 'listening', on: m.on });
      this.sync();
      return;
    }
    // The synth and looper need the audio graph: make sure it exists (this runs from a tap).
    if (m.type === 'play' || m.type === 'loop') this.context();
    const x = this.session.x;
    const fx: Effects = JSON.parse(this.session.read(x.session_apply(this.session.text(JSON.stringify(m)), Date.now())));
    this.dispatch(fx);
  }

  private dispatch(fx: Effects) {
    for (const c of fx.audio) this.audioCmd(JSON.stringify(c));
    for (const c of fx.listen) this.listenCmd(JSON.stringify(c));
    if (fx.state) {
      const prev = this.state;
      this.state = fx.state;
      this.opts.onSave(this.session.read(this.session.x.session_save()));
      this.onMessage({ ...fx.state, type: 'state' });
      if (fx.devices) {
        if (fx.state.inputId !== prev.inputId && this.active) this.openInput(fx.state.inputId);
        if (fx.state.outputId !== prev.outputId) this.applySink();
      }
      if (fx.state.output !== prev.output) {
        this.routeInput();
        this.sync();
      }
    }
  }

  private audioCmd(json: string) {
    if (this.node) this.node.port.postMessage({ type: 'cmd', json });
    else this.queue.push(json);
  }

  private listenCmd(json: string) {
    this.pitchW?.postMessage({ type: 'cmd', json });
    this.mlW?.postMessage({ type: 'cmd', json });
  }

  private initial(): Effects {
    return JSON.parse(this.session.read(this.session.x.session_initial()));
  }

  // ---- activity (the engine channel takes over)

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (!on) {
      this.closeInput();
      this.audioCmd(JSON.stringify({ type: 'stop', group: null }));
      for (let i = 0; i < 4; i++) this.audioCmd(JSON.stringify({ type: 'loop', cmd: 'clear', slot: i }));
      this.setMic('idle');
    } else this.sync();
  }

  // ---- audio graph

  /** Creates the context and graph on first use. Safe to call from any click handler. */
  context(sampleRate?: number): AudioContext {
    if (!this.ac) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      let ac: AudioContext;
      try {
        // 'lowest' asks for the smallest buffer the device allows (a numeric hint of 0).
        const hint = this.opts.latency === 'lowest' ? 0 : this.opts.latency;
        ac = new C({ latencyHint: hint, ...(sampleRate ? { sampleRate } : {}) });
      } catch {
        ac = new C();
      }
      this.ac = ac;
      this.canPickOutput = 'setSinkId' in ac;
      ac.onstatechange = () => {
        this.running = ac.state === 'running';
        this.onChange();
      };
      this.nodeReady = ac.audioWorklet.addModule(coreWorkletUrl).then(() => {
        const node = new AudioWorkletNode(ac, 'fretline-core', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: { wasm: this.bytes },
        });
        node.port.onmessage = (e) => this.onMessage(JSON.parse(e.data as string));
        node.port.postMessage({ type: 'listening', on: this.listening });
        node.connect(ac.destination);
        this.node = node;
        for (const c of this.initial().audio) node.port.postMessage({ type: 'cmd', json: JSON.stringify(c) });
        this.queue.splice(0).forEach((json) => node.port.postMessage({ type: 'cmd', json }));
        this.setupWorkers();
        this.routeInput();
      });
      this.applySink();
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    this.running = this.ac.state === 'running';
    return this.ac;
  }

  resume() {
    if (this.ac && this.ac.state !== 'running') this.ac.resume().catch(() => {});
  }

  private setupWorkers() {
    const ac = this.ac;
    if (!ac || !this.node || (this.pitchW && this.workerRate === ac.sampleRate)) return;
    this.pitchW?.terminate();
    this.mlW?.terminate();
    this.node.port.postMessage({ type: 'unsink', id: 'pitch' });
    this.node.port.postMessage({ type: 'unsink', id: 'ml' });
    this.workerRate = ac.sampleRate;
    const cmds = this.initial().listen.map((c) => JSON.stringify(c));

    this.pitchW = new Worker(new URL('../workers/pitch.worker.ts', import.meta.url), { type: 'module' });
    const pc = new MessageChannel();
    this.pitchW.postMessage({ type: 'init', module: this.module, sampleRate: ac.sampleRate, port: pc.port2, cmds }, [pc.port2]);
    this.node.port.postMessage({ type: 'sink', id: 'pitch', port: pc.port1 }, [pc.port1]);
    this.pitchW.onmessage = (e) => {
      const m = e.data;
      if (typeof m === 'string') this.onMessage(JSON.parse(m));
      else if (m.type === 'level') {
        // One noise floor for the whole channel: the tracker's goes to the monitored path and ML.
        this.node?.port.postMessage({ type: 'cmd', json: JSON.stringify({ type: 'level', floorDb: m.floorDb, openDb: m.openDb }) });
        this.mlW?.postMessage(m);
      }
    };

    this.mlW = new Worker(new URL('../workers/ml.worker.ts', import.meta.url), { type: 'module' });
    const mc = new MessageChannel();
    const modelUrl = new URL(import.meta.env.BASE_URL + 'model/model.json', location.href).href;
    this.mlW.postMessage({ type: 'init', module: this.module, sampleRate: ac.sampleRate, modelUrl, port: mc.port2, cmds }, [mc.port2]);
    this.node.port.postMessage({ type: 'sink', id: 'ml', port: mc.port1 }, [mc.port1]);
    this.mlW.onmessage = (e) => {
      const m = e.data;
      const msg: ChannelMsg = typeof m === 'string' ? JSON.parse(m) : m;
      // The player's switch wins over the worker's own state.
      if (msg.type === 'ml' && !this.state.ml) return;
      this.onMessage(msg);
    };
    this.mlW.onerror = () => this.onMessage({ type: 'ml', status: 'unavailable', backend: '' });
    if (!this.state.ml) this.onMessage({ type: 'ml', status: 'off', backend: '' });
  }

  // ---- input

  private openInput(deviceId: string) {
    if (this.pending) return this.pending;
    this.pending = this.open(deviceId).finally(() => (this.pending = null));
    return this.pending;
  }

  /** Retry opening the input (after a permission change or plugging something in). */
  retry() {
    this.openInput(this.state.inputId);
  }

  private setMic(mic: MicState) {
    if (mic === this.mic) return;
    this.mic = mic;
    this.onChange();
    this.publishStatus();
  }

  private async open(deviceId: string) {
    if (!this.active) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.setMic('insecure');
      return;
    }
    this.setMic('starting');
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
        // A remembered interface that is unplugged should not lock the player out.
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
      this.setMic(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nodevice' : 'error');
      return;
    }
    if (!(this.listening || this.state.output) || !this.active) {
      stream.getTracks().forEach((t) => t.stop());
      this.setMic('idle');
      return;
    }
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings() as MediaTrackSettings & { latency?: number };
    // Run the context at the input's own rate when we can, so the live input isn't resampled.
    const ac = this.context(settings.sampleRate);
    await this.nodeReady;
    if (!this.active) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.closeInput();
    this.stream = stream;
    this.src = ac.createMediaStreamSource(stream);
    this.routeInput();
    track.onended = () => this.setMic('nodevice');
    const rt = (ac.baseLatency || 0) + ((ac as AudioContext & { outputLatency?: number }).outputLatency || 0) + (settings.latency ?? 0.01);
    this.audioCmd(JSON.stringify({ type: 'latency', samples: Math.round(rt * ac.sampleRate) }));
    this.setMic('live');
    this.refreshDevices();
    navigator.mediaDevices.ondevicechange = () => this.refreshDevices();
  }

  /** The physical device behind the browser's virtual "default" input, if it can be resolved. */
  private async realDefaultId(): Promise<string> {
    try {
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const virt = all.find((d) => d.deviceId === 'default');
      const real = all.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
      if (!real.length || !real[0].label) return '';
      if (virt) {
        const match = real.find((d) => d.groupId === virt.groupId) ?? real.find((d) => virt.label.endsWith(d.label));
        if (match) return match.deviceId;
      }
      return real[0].deviceId;
    } catch {
      return '';
    }
  }

  /**
   * The guitar only reaches the core's input while something needs it; the core itself mutes
   * the monitored path when Output is off, so this only saves work.
   */
  private routeInput() {
    if (!this.src || !this.node) return;
    try {
      this.src.disconnect();
    } catch {
      /* not connected */
    }
    this.src.connect(this.node);
  }

  private closeInput() {
    if (this.src) {
      try {
        this.src.disconnect();
      } catch {
        /* not connected */
      }
      this.src = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      this.stream = null;
    }
  }

  /** Mic stays open while anything needs it: analysis (listening) or the amp (Output). */
  private sync() {
    if (this.testing || !this.active) return;
    const need = this.listening || this.state.output;
    if (need && !this.stream) {
      if (this.mic !== 'denied' && this.mic !== 'insecure') this.openInput(this.state.inputId);
    } else if (!need && this.stream) {
      this.closeInput();
      this.setMic('idle');
    }
  }

  /** Releases the mic while the tab is hidden (unless Output needs it), reopens it on return. */
  private onVisibility = () => {
    if (!this.active) return;
    if (document.hidden) {
      if (this.stream && !this.state.output) {
        this.releasedHidden = true;
        this.closeInput();
      }
    } else if (this.releasedHidden) {
      this.releasedHidden = false;
      this.sync();
    }
  };

  async refreshDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const list = (kind: MediaDeviceKind, fallback: string) =>
        all
          .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications')
          .map((d, i) => ({ id: d.deviceId, name: d.label || fallback + ' ' + (i + 1) }));
      this.inputs = list('audioinput', 'Input');
      this.outputs = list('audiooutput', 'Output');
      this.publishStatus();
    } catch {
      /* enumerate is best effort */
    }
  }

  /** Route all of Fretline's sound to the chosen output device ('' = system default). */
  private async applySink() {
    const ac = this.ac as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ac?.setSinkId) return;
    try {
      await ac.setSinkId(this.state.outputId);
    } catch {
      // Unplugged or not allowed: fall back to the system default.
      await ac.setSinkId('').catch(() => {});
    }
  }

  // ---- sound test (browser only)

  /** Releases the input and silences the channel so the Sound test can use fresh audio setups. */
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

  // ---- status

  /**
   * Where the delay from string to speaker goes when playing through Output. Input comes from
   * Chrome's live track stats when available, then the track's reported latency, else a typical
   * 10 ms.
   */
  latencyBreakdown(): LatencyBreakdown {
    const ac = this.ac;
    const t = this.stream?.getAudioTracks()[0] as (MediaStreamTrack & { stats?: { latency?: number; averageLatency?: number } }) | undefined;
    const st = t?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    let inputMs = 10;
    let inputSource: LatencyBreakdown['inputSource'] = 'typical';
    const live = t?.stats?.averageLatency ?? t?.stats?.latency;
    if (typeof live === 'number' && live > 0) {
      inputMs = live;
      inputSource = 'measured';
    } else if (typeof st?.latency === 'number' && st.latency > 0) {
      inputMs = st.latency * 1000;
      inputSource = 'reported';
    }
    const engineMs = ac ? (ac.baseLatency || 0) * 1000 : 0;
    const outputMs = ac ? ((ac as AudioContext & { outputLatency?: number }).outputLatency || 0) * 1000 : 0;
    return {
      inputMs: Math.round(inputMs),
      inputSource,
      engineMs: Math.round(engineMs),
      outputMs: Math.round(outputMs),
      pedalsMs: 0,
      totalMs: Math.round(inputMs + engineMs + outputMs),
    };
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
      inputLabel: t?.label ?? '',
      micOpen: !!t && t.readyState === 'live',
    };
  }

  private publishStatus() {
    const t = this.stream?.getAudioTracks()[0];
    const st = t?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
    const lb = this.latencyBreakdown();
    const ac = this.ac;
    const status: Status = {
      protocol: PROTOCOL,
      version: __APP_VERSION__,
      kind: 'web',
      inputs: this.inputs,
      outputs: this.outputs,
      input: t ? { id: st?.deviceId ?? '', name: t.label, rate: st?.sampleRate ?? 0, periodMs: lb.inputMs, deviceMs: 0, mode: 'browser' } : null,
      output: ac ? { id: this.state.outputId, name: '', rate: ac.sampleRate, periodMs: lb.engineMs, deviceMs: lb.outputMs, mode: 'browser' } : null,
      latency: ac && t ? { inputMs: lb.inputMs, bufferMs: lb.engineMs, outputMs: lb.outputMs, totalMs: lb.totalMs } : null,
      error: this.error,
    };
    this.onMessage({ ...status, type: 'status' });
  }
}
