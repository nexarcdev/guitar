import { create } from 'zustand';
import { engine, type EngineStatus, type LatencyMode } from '../audio/engine';
import { DEFAULT_PEDALS, toStates, withTypes, type Pedal } from '../audio/pedals';
import { NO_PITCH, type Analysis, type ChromaFrame, type FloorSetting, type LooperView, type Notes, type SessionState, type StatePatch } from '../core/protocol';
import {
  chordFromChroma, fretMidi, identifyMidi, nameSet, openStrings, pcOf, sameArr, shapeFor, STD_SETUP, TUNINGS,
  type ChordName, type Offsets, type Setup, type Frets,
} from '../theory/music';
import { finger } from '../theory/fingering';
import { mergeWindow } from '../theory/merge';
import { riffDur, type SaveKind, type TabNote, type TimeSig } from '../theory/stream';
import * as db from './db';
import { trail } from './trail';
import { confirmFrame } from '../theory/confirm';

export type TabId = 'tuner' | 'chords' | 'tabs' | 'pedals';
export type GateLevel = 'low' | 'normal' | 'high';
/** dB above the noise floor at which each gate setting opens. */
export const GATE_DB: Record<GateLevel, number> = { low: 8, normal: 12, high: 18 };
export const gateLevelOf = (db: number): GateLevel => (db <= 10 ? 'low' : db >= 15 ? 'high' : 'normal');
export const BUF_SEC = 60;

export interface Heard extends ChordName {
  frets: Frets | null;
  /** Listening clock when it was decided. */
  t: number;
}

interface PlayState {
  zero: number;
  stop: () => void;
}

export interface State {
  hydrated: boolean;
  tab: TabId;
  setup: Setup;
  setupOpen: boolean;
  listening: boolean;
  /** Mirrors session.output (set at once on a local change). */
  output: boolean;
  engine: EngineStatus;
  /** The active channel's shared settings (pedals, Output, gate, noise floor, ML, devices). */
  session: SessionState | null;
  level: number;
  /** Measured input baseline, noise floor mode and the automatic level applied to the input. */
  levels: { floorDb: number; measuredDb: number; floorMode: 'auto' | 'manual'; measuring: number | null; peakDb: number; gate: boolean; gainDb: number };
  // tuner
  tString: number;
  auto: boolean;
  detected: number | null;
  cents: number;
  freq: number;
  voiced: boolean;
  tuned: number[];
  headstock: 'split' | 'inline';
  /** Browser audio buffer size: 'lowest', 'interactive' or 'playback'. Applies on reload. */
  latency: LatencyMode;
  /** Use the native engine when it's running (opt-in: probing localhost can prompt). */
  engineOn: boolean;
  // chords
  frets: Frets;
  baseFret: number;
  heard: Heard | null;
  history: Array<{ name: string; frets: Frets | null }>;
  chordMode: 'identify' | 'confirm';
  confirm: { heard: number[]; wrong: number[]; ok: boolean };
  /** Exact pitches heard recently by the ML pass, for octave-accurate confirm. */
  mlRecent: Array<{ midi: number; t: number }>;
  // stream
  buf: TabNote[];
  hoverSpan: SaveKind | null;
  toast: { text: string; until: number } | null;
  riffs: db.Riff[];
  riffTab: 'saved' | 'deleted';
  curRiff: string | null;
  rplaying: boolean;
  /** Paused playhead position (s) while a riff is open but not playing. */
  playAt: number;
  timeSig: TimeSig;
  gapBeats: number;
  streamSettingsOpen: boolean;
  // pedals
  pedals: Pedal[];
  drag: number | null;
  looper: LooperView;
}

const initial: State = {
  hydrated: false,
  tab: 'tuner',
  setup: STD_SETUP,
  setupOpen: false,
  listening: true,
  output: false,
  engine: engine.status,
  session: null,
  level: 0,
  levels: { floorDb: -80, measuredDb: -80, floorMode: 'auto', measuring: null, peakDb: -100, gate: false, gainDb: 0 },
  tString: 5,
  auto: true,
  detected: null,
  cents: 0,
  freq: 0,
  voiced: false,
  tuned: [],
  headstock: 'split',
  latency: 'lowest',
  engineOn: false,
  frets: [-1, 3, 2, 0, 1, 0],
  baseFret: 1,
  heard: null,
  history: [],
  chordMode: 'identify',
  confirm: { heard: [], wrong: [], ok: false },
  mlRecent: [],
  buf: [],
  hoverSpan: null,
  toast: null,
  riffs: [],
  riffTab: 'saved',
  curRiff: null,
  rplaying: false,
  playAt: 0,
  timeSig: '4/4',
  gapBeats: 3,
  streamSettingsOpen: false,
  pedals: DEFAULT_PEDALS,
  drag: null,
  looper: { len: 0, rate: 48000, free: false, slots: [0, 1, 2, 3].map(() => ({ state: 'empty', progress: 0 })) },
};

export const useStore = create<State>()(() => initial);
const get = useStore.getState;
const set = useStore.setState;

// ---------------------------------------------------------------- persistence

// Client preferences live here. Shared settings belong to the audio channel's session: the web
// channel saves its own (key 'webSession'), the engine keeps its own on disk.
const PERSIST: Array<keyof State> = ['tab', 'setup', 'timeSig', 'gapBeats', 'chordMode', 'headstock', 'latency', 'engineOn'];
/** Keys from before the channel kept the session, read once to seed it. */
const LEGACY = ['pedals', 'gateLevel', 'mlOn', 'deviceId', 'outputId', 'nativeOn'] as const;

let webSession: string | null = null;
let legacy: StatePatch | undefined;

export async function hydrate() {
  try {
    await db.migrateLegacy();
    const [riffs, saved, ...vals] = await Promise.all([db.loadRiffs(), db.getKV('webSession'), ...[...PERSIST, ...LEGACY].map((k) => db.getKV(k))]);
    const patch: Partial<State> = { riffs };
    PERSIST.forEach((k, i) => {
      if (vals[i] !== undefined) (patch as Record<string, unknown>)[k] = vals[i];
    });
    const old = Object.fromEntries(LEGACY.map((k, i) => [k, vals[PERSIST.length + i]])) as Record<(typeof LEGACY)[number], unknown>;
    if (typeof saved === 'string') webSession = saved;
    else {
      legacy = {};
      const names = (ps: Pedal[]) => ps.map((p) => p.name).sort().join();
      if (Array.isArray(old.pedals) && names(old.pedals as Pedal[]) === names(DEFAULT_PEDALS)) legacy.pedals = toStates(old.pedals as Pedal[]);
      if (typeof old.gateLevel === 'string' && old.gateLevel in GATE_DB) legacy.gateDb = GATE_DB[old.gateLevel as GateLevel];
      if (typeof old.mlOn === 'boolean') legacy.ml = old.mlOn;
      if (typeof old.deviceId === 'string') legacy.inputId = old.deviceId;
      if (typeof old.outputId === 'string') legacy.outputId = old.outputId;
    }
    if (patch.engineOn === undefined && old.nativeOn === true) patch.engineOn = true;
    if (!(await db.getKV('latencyV2'))) {
      // Earlier builds could switch to Safe buffers automatically (and defaulted to 'interactive');
      // start everyone on the new lowest-latency default once.
      patch.latency = 'lowest';
      db.setKV('latencyV2', true);
    }
    set({ ...patch, hydrated: true });
  } catch {
    set({ hydrated: true });
  }
  let prev = get();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  useStore.subscribe((s) => {
    // Advance first: side effects below can update the store again (re-entering here).
    const old = prev;
    prev = s;
    for (const k of PERSIST) {
      if (s[k] !== old[k]) {
        clearTimeout(timers.get(k));
        const v = s[k];
        timers.set(k, setTimeout(() => db.setKV(k, v), 250));
      }
    }
    if (s.frets !== old.frets || s.baseFret !== old.baseFret || s.setup !== old.setup) {
      shapeAt = engine.clock();
      okSince = okUntil = 0;
      wrongHits.fill(0);
    }
    if (s.engineOn !== old.engineOn) engine.setEngine(s.engineOn);
  });
}

/** Starts the audio channels (after hydrate and attachEngine). */
export async function startAudio() {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  await engine.init({
    latency: get().latency,
    saved: webSession,
    legacy,
    engineOn: get().engineOn,
    onSave(json) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => db.setKV('webSession', json), 250);
    },
  });
}

// ---------------------------------------------------------------- engine wiring

let fastHand = 3;
let mlHand = 3;
let chCand = '';
let chCount = 0;
let lastPitchPc = -1;
let lastVoicedAt = 0;
let stIdx = -1;
let stSince = 0;
let lastLevel = 0;
let lastLevelsAt = 0;
let lastTunerAt = 0;

function strings() {
  return openStrings(get().setup.offsets);
}

/** Local edits win over echoes of older state for a moment (knob drags send many changes). */
let pedalsEditedAt = 0;

export function attachEngine() {
  engine.on('status', (st) => set({ engine: st }));
  engine.on('state', (st) => {
    const patch: Partial<State> = { session: st, output: st.output };
    if (performance.now() - pedalsEditedAt > 400) patch.pedals = withTypes(st.pedals);
    set(patch);
  });
  engine.on('looper', (v) => set({ looper: v }));
  engine.on('cond', (v) => {
    const l = get().levels;
    if (Math.abs(v.gainDb - l.gainDb) > 0.5) set({ levels: { ...l, gainDb: v.gainDb } });
  });
  engine.on('analysis', onAnalysis);
  engine.on('notes', onNotes);
}

function onAnalysis(a: Analysis) {
  const s = get();
  if (!s.listening) return;
  const patch: Partial<State> = {};
  const now = performance.now();

  // input meter (decays so peaks are visible) and the measured baseline, ~5×/s
  const lvl = Math.max(a.peak, lastLevel * 0.85);
  if (Math.abs(lvl - lastLevel) > 0.01) { lastLevel = lvl; if (s.setupOpen) patch.level = lvl; }
  if (now - lastLevelsAt > 200) {
    lastLevelsAt = now;
    const l = a.levels;
    const o = s.levels;
    if (
      Math.abs(l.floorDb - o.floorDb) > 0.5 || Math.abs(l.measuredDb - o.measuredDb) > 0.5 || Math.abs(l.peakDb - o.peakDb) > 0.5 ||
      l.gate !== o.gate || l.floorMode !== o.floorMode || (l.measuring == null) !== (o.measuring == null) || Math.abs((l.measuring ?? 0) - (o.measuring ?? 0)) > 0.05
    )
      patch.levels = { ...o, floorDb: l.floorDb, measuredDb: l.measuredDb, floorMode: l.floorMode, measuring: l.measuring, peakDb: l.peakDb, gate: l.gate };
  }

  // tuner: only stable readings (gate open, clear pitch, agrees with the last few frames)
  const T = strings();
  let latest: { freq: number } | null = null;
  for (const f of a.frames) {
    if (f.stable && f.freq > 50 && f.freq < 1200) {
      latest = f;
      lastPitchPc = pcOf(69 + 12 * Math.log2(f.freq / 440));
      if (s.tab === 'tuner') {
        const idx = targetString(f.freq, T, s.auto, s.tString);
        trail.push(Math.max(-50, Math.min(50, 1200 * Math.log2(f.freq / T[idx].hz))), now);
      }
    }
  }
  if (latest) lastVoicedAt = now;
  if (s.tab === 'tuner') {
    if (latest && now - lastTunerAt < 33) {
      // Readings arrive ~90×/s; the trail canvas gets all of them, React gets ~30/s.
    } else if (latest) {
      lastTunerAt = now;
      const idx = targetString(latest.freq, T, s.auto, s.tString);
      const c = Math.max(-50, Math.min(50, 1200 * Math.log2(latest.freq / T[idx].hz)));
      Object.assign(patch, { freq: latest.freq, cents: c, detected: idx, voiced: true });
      // Held within ±4¢ for 1.5 s marks the string done.
      const ok = Math.abs(c) < 4;
      if (idx !== stIdx) { stIdx = idx; stSince = ok ? now : 0; }
      else if (!ok) stSince = 0;
      else if (!stSince) stSince = now;
      if (stSince && now - stSince > 1500 && !s.tuned.includes(idx)) { patch.tuned = [...s.tuned, idx]; stSince = 0; }
    } else if (s.voiced && (!a.levels.gate || now - lastVoicedAt > 450)) patch.voiced = false;
  }

  // chord: chroma decides fast, ML refines later
  sinceAttack = a.levels.sinceAttack;
  if (a.chroma !== undefined) chromaFrame(a.chroma, a.clock, patch);

  // fast single notes onto the stream
  if (a.notes.length) {
    const add: TabNote[] = [];
    for (const n of a.notes) {
      const r = finger([n.midi], s.setup, fastHand);
      if (!r.placed.length) continue;
      fastHand = r.hand;
      add.push({ s: r.placed[0].s, f: r.placed[0].f, t: +n.t.toFixed(3), m: n.midi, p: true });
    }
    if (add.length) patch.buf = trim([...(patch.buf ?? s.buf), ...add], a.clock);
  }
  if (Object.keys(patch).length) set(patch);
}

function targetString(freq: number, T: ReturnType<typeof openStrings>, auto: boolean, fixed: number) {
  if (!auto) return fixed;
  let idx = fixed, best = Infinity;
  T.forEach((st, i) => {
    const d = Math.abs(1200 * Math.log2(freq / st.hz));
    if (d < best) { best = d; idx = i; }
  });
  return idx;
}

const trim = (b: TabNote[], clock: number) => (b.length && b[0].t < clock - BUF_SEC ? b.filter((n) => n.t > clock - BUF_SEC) : b);

// Confirm keeps a short per-pitch hold (strings ring and flicker) that empties as soon as the
// gate closes, so silence can never read as "heard".
const pitchHold = new Float32Array(128).fill(NO_PITCH);
let silentFrames = 0;
let okSince = 0;
let okUntil = 0;
const wrongHits = new Array(6).fill(0);
/** Listening clock when the confirm shape last changed: older ML notes belong to the previous shape. */
let shapeAt = 0;
/** Seconds since the tracker last heard a pick attack. */
let sinceAttack = Infinity;
/** Confirm only listens for this long after a real attack, so noise during a pause can't light it up. */
const CONFIRM_AFTER_ATTACK = 6;

function chromaFrame(cf: ChromaFrame | null, clock: number, patch: Partial<State>) {
  const s = get();
  const confirming = s.chordMode === 'confirm' && s.tab === 'chords';
  if (!cf) {
    chCand = '';
    if (++silentFrames >= 2) pitchHold.fill(NO_PITCH);
  } else {
    silentFrames = 0;
    for (let m = 0; m < 128; m++) pitchHold[m] = Math.max(cf.pitch[m], pitchHold[m] - 3);
  }
  if (confirming) updateConfirm(cf ? pitchHold : null, clock, patch);
  if (!cf) return;
  // YIN only locks on when one pitch dominates, so a fresh clean reading means a single note is
  // ringing: name the note rather than reading its overtones as a chord.
  const mono = lastPitchPc >= 0 && performance.now() - lastVoicedAt < 150;
  const r = mono ? nameSet([lastPitchPc], lastPitchPc, s.setup.offsets) : chordFromChroma(cf.chroma, null, s.setup.offsets);
  if (!r) {
    chCand = '';
    return;
  }
  if (chCand === r.name) chCount++;
  else { chCand = r.name; chCount = 1; }
  if (chCount === 4) setHeard(r, clock, patch);
}

/**
 * Confirmed means every string of the shape sounding and no muted string ringing, held for
 * 200 ms. Once confirmed it stays green briefly through flicker, but drops the moment the
 * strings stop or a wrong string rings. A wrong string must show in 2 of the last 3 frames.
 */
function updateConfirm(pitch: ArrayLike<number> | null, clock: number, patch: Partial<State>) {
  const s = get();
  const now = performance.now();
  if (sinceAttack > CONFIRM_AFTER_ATTACK) pitch = null;
  const f = confirmFrame({ frets: s.frets, baseFret: s.baseFret, setup: s.setup, pitch, mlRecent: pitch ? s.mlRecent.filter((m) => m.t >= shapeAt) : [], clock });
  for (let i = 0; i < 6; i++) wrongHits[i] = Math.max(0, Math.min(3, wrongHits[i] + (f.wrong.includes(i) ? 1 : -1)));
  const wrong = [0, 1, 2, 3, 4, 5].filter((i) => wrongHits[i] >= 2);
  const full = f.played.length > 0 && f.heard.length === f.played.length && !wrong.length;
  if (full) {
    if (!okSince) okSince = now;
    if (now - okSince >= 200) okUntil = now + 400;
  } else okSince = 0;
  const ok = !wrong.length && !!pitch && now < okUntil;
  const prev = s.confirm;
  if (prev.ok !== ok || !sameArr(prev.heard, f.heard) || !sameArr(prev.wrong, wrong)) patch.confirm = { heard: f.heard, wrong, ok };
}
function setHeard(r: ChordName, t: number, patch: Partial<State>) {
  const s = get();
  const cur = patch.heard ?? s.heard;
  if (cur && cur.name === r.name) return;
  const frets = shapeFor(r.name, s.setup);
  patch.heard = { ...r, frets, t };
  if (r.root != null) patch.history = [{ name: r.name, frets }, ...(patch.history ?? s.history)].slice(0, 8);
}

function onNotes(m: Notes) {
  const s = get();
  if (!s.listening) return;
  const r = mergeWindow(s.buf, m.from, m.to, m.notes, s.setup, mlHand);
  mlHand = r.hand;
  const patch: Partial<State> = { buf: trim(r.buf, m.to) };
  // Only notes that survived ghost cleanup count as evidence for Confirm.
  const recent = [...s.mlRecent.filter((x) => x.t > m.to - 3), ...r.chords.flatMap((c) => c.midis.map((midi) => ({ midi, t: c.t })))];
  patch.mlRecent = recent;
  // The ML pass hears the actual voicing, bass included. It may refine the chroma decision for the
  // same strum (chroma decides ~0.25–0.5 s after the onset), or fill in a strum chroma missed, but
  // it never overrides a newer chord: ML results arrive 1–2 s late.
  const last = r.chords.filter((c) => new Set(c.midis.map(pcOf)).size >= 3).pop();
  if (last) {
    const name = identifyMidi(last.midis, s.setup.offsets);
    const h = s.heard;
    const sameStrum = !!h && h.t >= last.t - 0.2 && h.t <= last.t + 0.8;
    const missed = !h || h.t < last.t - 0.2;
    if (name.root != null && (sameStrum || missed) && h?.name !== name.name) {
      const frets = shapeFor(name.name, s.setup);
      patch.heard = { ...name, frets, t: sameStrum && h ? h.t : last.t };
      const replace = sameStrum && h && s.history[0]?.name === h.name;
      patch.history = [{ name: name.name, frets }, ...(replace ? s.history.slice(1) : s.history)].slice(0, 8);
    }
  }
  set(patch);
}

// ---------------------------------------------------------------- actions

export const actions = {
  selectTab(tab: TabId) {
    const s = get();
    if (s.tab === tab) return;
    actions.stopRiff();
    set({ tab, drag: null, streamSettingsOpen: false });
  },
  setListening(on: boolean) {
    engine.setListening(on);
    set({ listening: on, voiced: on && get().voiced });
  },
  setOutput(on: boolean) {
    engine.set({ output: on });
    set({ output: on });
  },
  /** Shared settings (go to the active audio channel, which echoes the new state). */
  setSession(patch: StatePatch) {
    engine.set(patch);
  },
  setFloor(floor: FloorSetting) {
    engine.set({ floor });
  },
  recalibrate() {
    engine.recalibrate();
  },
  saveSetup(p: Partial<Setup>) {
    const s = get();
    set({ setup: { offsets: p.offsets ?? s.setup.offsets, capo: p.capo ?? s.setup.capo }, detected: null });
  },
  setTuning(offsets: Offsets) {
    actions.saveSetup({ offsets });
  },
  selectDevice(id: string) {
    engine.set({ inputId: id });
  },
  pluckString(i: number, offsets = get().setup.offsets) {
    engine.pluck(openStrings(offsets)[i].hz, 0, 1.4);
  },
  // tuner
  selectString(i: number) {
    set({ tString: i, detected: null, auto: false });
  },
  resetTuned() {
    trail.clear();
    stSince = 0;
    set({ tuned: [], tString: 0, detected: null });
  },
  // chords
  strum() {
    const s = get();
    s.frets.forEach((f, i) => {
      if (f >= 0) engine.pluck(440 * Math.pow(2, (fretMidi(i, f === 0 ? 0 : f + s.baseFret - 1, s.setup) - 69) / 12), i * 0.045, 1.6);
    });
  },
  // riffs
  saveRiff(notes: TabNote[], label: string, count: number) {
    const s = get();
    const now = Date.now();
    const b = notes[0].t;
    const r: db.Riff = {
      id: 'r' + now.toString(36),
      name: 'Riff ' + (s.riffs.filter((x) => !x.deletedAt).length + 1),
      notes: notes.map((n) => ({ s: n.s, f: n.f, t: +(n.t - b).toFixed(3), ...(n.m != null ? { m: n.m } : {}) })),
      setup: { offsets: [...s.setup.offsets] as unknown as Offsets, capo: s.setup.capo },
      createdAt: now,
      ts: now,
    };
    db.putRiff(r);
    set({ riffs: [...s.riffs, r], hoverSpan: null, riffTab: 'saved', toast: { text: 'Saved ' + r.name + ' · ' + label + ' · ' + count + (count === 1 ? ' note' : ' notes'), until: performance.now() + 2200 } });
  },
  updateRiff(id: string, p: Partial<db.Riff>) {
    const riffs = get().riffs.map((r) => (r.id === id ? { ...r, ...p } : r));
    const r = riffs.find((x) => x.id === id);
    if (r) db.putRiff(r);
    set({ riffs });
  },
  renameRiff(id: string, name: string) {
    actions.updateRiff(id, { name: name.trim() || 'Untitled riff' });
  },
  deleteRiff(id: string) {
    if (get().curRiff === id) actions.closeRiff();
    actions.updateRiff(id, { deletedAt: Date.now() });
  },
  restoreRiff(id: string) {
    const r = get().riffs.find((x) => x.id === id);
    if (!r) return;
    const { deletedAt: _d, ...rest } = r;
    void _d;
    const next = { ...rest, ts: Date.now() };
    db.putRiff(next);
    set({ riffs: get().riffs.map((x) => (x.id === id ? next : x)) });
  },
  forgetRiff(id: string) {
    db.deleteRiffs([id]);
    set({ riffs: get().riffs.filter((x) => x.id !== id) });
  },
  emptyDeleted() {
    const gone = get().riffs.filter((r) => r.deletedAt).map((r) => r.id);
    db.deleteRiffs(gone);
    set({ riffs: get().riffs.filter((r) => !r.deletedAt) });
  },
  async importRiffs(file: File) {
    try {
      const rs = db.parseFile(await file.text());
      await db.putRiffs(rs);
      set({ riffs: [...get().riffs, ...rs], riffTab: 'saved', toast: { text: 'Imported ' + rs.length + (rs.length === 1 ? ' riff' : ' riffs'), until: performance.now() + 2200 } });
    } catch (e) {
      set({ toast: { text: (e as Error).message || 'Could not read that file', until: performance.now() + 2600 } });
    }
  },
  exportRiffs() {
    const rs = get().riffs.filter((r) => !r.deletedAt);
    const url = URL.createObjectURL(db.exportFile(rs));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fretline-riffs-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  openRiff(id: string, play: boolean) {
    actions.stopRiff();
    set({ curRiff: id, playAt: 0 });
    if (play) actions.playRiff();
  },
  closeRiff() {
    actions.stopRiff();
    set({ curRiff: null, playAt: 0 });
  },
  playRiff() {
    const s = get();
    const r = s.riffs.find((x) => x.id === s.curRiff);
    if (!r) return;
    const from = s.playAt >= riffDur(r.notes) ? 0 : s.playAt;
    const setup = r.setup ?? STD_SETUP;
    const { zero, stop } = engine.playNotes(
      r.notes.map((n) => ({ t: n.t, hz: 440 * Math.pow(2, (fretMidi(n.s, n.f, setup) - 69) / 12) })),
      from,
    );
    const end = setTimeout(() => {
      play = null;
      set({ rplaying: false, playAt: 0 });
    }, (riffDur(r.notes) + 0.3 - from) * 1000 + 50);
    play = { zero, stop: () => { clearTimeout(end); stop(); } };
    set({ rplaying: true });
  },
  stopRiff() {
    if (play) {
      const at = engine.now() - play.zero;
      play.stop();
      play = null;
      set({ rplaying: false, playAt: Math.max(0, at) });
    }
  },
  togglePlay() {
    if (get().rplaying) actions.stopRiff();
    else actions.playRiff();
  },
  /** Current riff playhead in seconds. */
  playhead() {
    return play ? engine.now() - play.zero : get().playAt;
  },
  // pedals
  setPedal(i: number, p: Partial<Pedal>) {
    actions.setPedals(get().pedals.map((q, k) => (k === i ? { ...q, ...p } : q)));
  },
  /** The whole board, in signal order (reorder, toggle, knob). */
  setPedals(pedals: Pedal[]) {
    pedalsEditedAt = performance.now();
    set({ pedals });
    engine.set({ pedals: toStates(pedals) });
  },
};

let play: PlayState | null = null;

export const isKnownTuning = (o: Offsets) => TUNINGS.some(([, x]) => sameArr(x, o));
