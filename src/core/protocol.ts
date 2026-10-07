// The protocol every audio channel speaks (engine/core/src/protocol.rs is the source of truth).
// Clients send ControlMsg and receive ChannelMsg, whether the channel runs in this browser
// (WebAssembly) or in the native engine (WebSocket).

export const PROTOCOL = 2;

export type PedalName = 'Compressor' | 'Overdrive' | 'Distortion' | 'Fuzz' | 'Chorus' | 'Phaser' | 'Delay' | 'Reverb';

export interface PedalState {
  name: PedalName;
  on: boolean;
  level: number;
}

export type FloorMode = 'auto' | 'manual';

export interface FloorSetting {
  mode: FloorMode;
  manualDb: number;
}

export interface SessionState {
  rev: number;
  /** ms since 1970 of the last edit: the newest edit wins when channels meet. */
  editedAt: number;
  pedals: PedalState[];
  output: boolean;
  gateDb: number;
  floor: FloorSetting;
  ml: boolean;
  /** Device ids in the channel's own namespace ('' = system default). */
  inputId: string;
  outputId: string;
  exclusiveInput: boolean;
  exclusiveOutput: boolean;
}

export type StatePatch = Partial<Omit<SessionState, 'rev' | 'editedAt'>>;

export type VoiceKind = 'pluck' | 'reference';

export interface NoteSpec {
  /** Seconds after the group starts. */
  at: number;
  hz: number;
  dur: number;
  voice?: VoiceKind;
}

export type ControlMsg =
  | { type: 'hello'; client: string; version?: string }
  | { type: 'set'; state: StatePatch; at?: number }
  | { type: 'listen'; on: boolean }
  | { type: 'recalibrate' }
  | { type: 'loop'; cmd: 'tap' | 'stop' | 'clear'; slot: number }
  | { type: 'play'; group: number; notes: NoteSpec[]; lead?: number }
  | { type: 'stop'; group?: number };

export interface DeviceInfo {
  id: string;
  name: string;
}

export interface StreamInfo {
  id: string;
  name: string;
  rate: number;
  periodMs: number;
  deviceMs: number;
  /** 'exclusive' | 'low-latency shared' | 'shared' | 'browser' | 'test' */
  mode: string;
}

export interface Latency {
  inputMs: number;
  bufferMs: number;
  outputMs: number;
  totalMs: number;
}

export interface Status {
  protocol: number;
  version: string;
  kind: 'engine' | 'web';
  inputs: DeviceInfo[];
  outputs: DeviceInfo[];
  input: StreamInfo | null;
  output: StreamInfo | null;
  latency: Latency | null;
  error: string | null;
}

export interface PitchFrame {
  /** Listening-clock seconds at the centre of the analysis frame. */
  t: number;
  freq: number;
  clarity: number;
  rms: number;
  /** Gate open, clear pitch, and consistent with the last few frames: safe to show on a tuner. */
  stable: boolean;
}

export interface FastNote {
  midi: number;
  t: number;
}

export const NO_PITCH = -120;

/** Fundamentals reported per frame; the app caps to the instrument's string count. */
export const MAX_FUNDAMENTALS = 8;

export interface Fundamental {
  midi: number;
  /** Sine-equivalent RMS dBFS: directly comparable with Levels.floorDb. */
  db: number;
}

export interface ChromaFrame {
  chroma: number[];
  /** Per-MIDI pitch salience in dB relative to the strongest peak (NO_PITCH = none). Octave exact. */
  pitch: number[];
  /** Sine-equivalent dBFS of the strongest peak; pitch[m] + topDb is note m's absolute level. */
  topDb: number;
  /**
   * Notes left after the 2nd to 16th harmonics are attributed to lower notes, loudest first. A note
   * an octave or a twelfth above a louder one is claimed as its harmonic; the app recovers such
   * strings from `pitch` with chord knowledge.
   */
  fundamentals: Fundamental[];
}

export interface Levels {
  /** Noise floor in force, dBFS. */
  floorDb: number;
  /** The automatic estimate (differs from floorDb in manual mode). */
  measuredDb: number;
  floorMode: FloorMode;
  /** Progress (0–1) of a recalibration the player asked for. */
  measuring: number | null;
  openDb: number;
  sinceAttack: number;
  peakDb: number;
  gate: boolean;
  /** Pick attacks counted since the tracker started; diff between chunks to find new strums. */
  attacks: number;
  /** Loudest frame level (dBFS) since the latest attack. */
  attackDb: number;
}

export interface Analysis {
  type: 'analysis';
  /** Listening-clock seconds at the end of this chunk. */
  clock: number;
  frames: PitchFrame[];
  notes: FastNote[];
  /** Absent = no chroma frame in this chunk; null = gate closed (nothing playing). */
  chroma?: ChromaFrame | null;
  peak: number;
  levels: Levels;
}

export interface MlNote {
  midi: number;
  t: number;
  dur: number;
  amp: number;
}

export interface Notes {
  type: 'notes';
  from: number;
  to: number;
  notes: MlNote[];
}

export type MlState = 'off' | 'loading' | 'ready' | 'slow' | 'unavailable';

export type SlotState = 'empty' | 'recording' | 'playing' | 'overdubbing' | 'stopped';

export interface SlotView {
  state: SlotState;
  /** 0–1 through the current pass. */
  progress: number;
}

export interface LooperView {
  /** Loop length in samples, 0 until the first loop is closed. */
  len: number;
  /** The first loop is being recorded and has no length yet. */
  free: boolean;
  rate: number;
  slots: SlotView[];
}

export interface Meters {
  type: 'meters';
  gainDb: number;
  outDb: number;
  underruns: number;
  looper: LooperView;
}

export type ChannelMsg =
  | ({ type: 'status' } & Status)
  | ({ type: 'state' } & SessionState)
  | Analysis
  | Notes
  | { type: 'ml'; status: MlState; backend: string }
  | Meters;
