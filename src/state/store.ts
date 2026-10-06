import { create } from 'zustand';
import { engine, type EngineStatus, type Analysis, type MlNotes } from '../audio/engine';
import { DEFAULT_PEDALS, type Pedal } from '../audio/pedals';
import type { LooperView } from '../audio/looperCore';
import {
  chordFromChroma, fretMidi, identifyMidi, nameSet, openStrings, pcOf, sameArr, shapeFor, STD_SETUP, TUNINGS,
  type ChordName, type Offsets, type Setup, type Shape,
} from '../theory/music';
import { finger } from '../theory/fingering';
import { mergeWindow } from '../theory/merge';
import { riffDur, type SaveKind, type TabNote, type TimeSig } from '../theory/stream';
import * as db from './db';
import { trail } from './trail';

export type TabId = 'tuner' | 'chords' | 'tabs' | 'pedals';
export const BUF_SEC = 60;

export interface Heard extends ChordName {
  frets: Shape | null;
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
  output: boolean;
  engine: EngineStatus;
  deviceId: string;
  level: number;
  // tuner
  tString: number;
  auto: boolean;
  detected: number | null;
  cents: number;
  freq: number;
  voiced: boolean;
  tuned: number[];
  headstock: 'split' | 'inline';
  // chords
  frets: Shape;
  baseFret: number;
  heard: Heard | null;
  history: Array<{ name: string; frets: Shape | null }>;
  chordMode: 'identify' | 'confirm';
  chroma: number[];
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
  deviceId: '',
  level: 0,
  tString: 5,
  auto: true,
  detected: null,
  cents: 0,
  freq: 0,
  voiced: false,
  tuned: [],
  headstock: 'split',
  frets: [-1, 3, 2, 0, 1, 0],
  baseFret: 1,
  heard: null,
  history: [],
  chordMode: 'identify',
  chroma: [],
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

const PERSIST: Array<keyof State> = ['tab', 'setup', 'pedals', 'timeSig', 'gapBeats', 'chordMode', 'deviceId', 'headstock'];

export async function hydrate() {
  try {
    await db.migrateLegacy();
    const [riffs, ...vals] = await Promise.all([db.loadRiffs(), ...PERSIST.map((k) => db.getKV(k))]);
    const patch: Partial<State> = { riffs };
    PERSIST.forEach((k, i) => {
      if (vals[i] !== undefined) (patch as Record<string, unknown>)[k] = vals[i];
    });
    // Pedal list must contain exactly the known pedals; anything else is a stale save.
    const names = (ps: Pedal[]) => ps.map((p) => p.name).sort().join();
    if (patch.pedals && (!Array.isArray(patch.pedals) || names(patch.pedals) !== names(DEFAULT_PEDALS))) delete patch.pedals;
    set({ ...patch, hydrated: true });
  } catch {
    set({ hydrated: true });
  }
  let prev = get();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  useStore.subscribe((s) => {
    for (const k of PERSIST) {
      if (s[k] !== prev[k]) {
        clearTimeout(timers.get(k));
        const v = s[k];
        timers.set(k, setTimeout(() => db.setKV(k, v), 250));
      }
    }
    if (s.pedals !== prev.pedals) engine.applyPedals(s.pedals);
    prev = s;
  });
  engine.applyPedals(get().pedals);
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

function strings() {
  return openStrings(get().setup.offsets);
}

export function attachEngine() {
  engine.on('status', (st) => set({ engine: st }));
  engine.on('looper', (v) => set({ looper: v }));
  engine.on('analysis', onAnalysis);
  engine.on('ml', onMl);
}

function onAnalysis(a: Analysis) {
  const s = get();
  if (!s.listening) return;
  const patch: Partial<State> = {};
  const now = performance.now();

  // input meter (decays so peaks are visible)
  const lvl = Math.max(a.peak, lastLevel * 0.85);
  if (Math.abs(lvl - lastLevel) > 0.01) { lastLevel = lvl; if (s.setupOpen) patch.level = lvl; }

  // tuner: open strings only, measured against the tuned target
  const T = strings();
  let latest: { freq: number } | null = null;
  for (const f of a.frames) {
    if (f.freq > 0 && f.clarity > 0.9 && f.freq > 50 && f.freq < 1200) {
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
    if (latest) {
      const idx = targetString(latest.freq, T, s.auto, s.tString);
      const c = Math.max(-50, Math.min(50, 1200 * Math.log2(latest.freq / T[idx].hz)));
      Object.assign(patch, { freq: latest.freq, cents: c, detected: idx, voiced: true });
      // Held within ±4¢ for 1.5 s marks the string done.
      const ok = Math.abs(c) < 4;
      if (idx !== stIdx) { stIdx = idx; stSince = ok ? now : 0; }
      else if (!ok) stSince = 0;
      else if (!stSince) stSince = now;
      if (stSince && now - stSince > 1500 && !s.tuned.includes(idx)) { patch.tuned = [...s.tuned, idx]; stSince = 0; }
    } else if (s.voiced && now - lastVoicedAt > 450) patch.voiced = false;
  }

  // chord: chroma decides fast, ML refines later
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

function chromaFrame(c: number[] | null, clock: number, patch: Partial<State>) {
  const s = get();
  const confirm = s.chordMode === 'confirm' && s.tab === 'chords';
  if (!c) {
    chCand = '';
    if (confirm && s.chroma.length) patch.chroma = s.chroma.map((v) => v * 0.8).map((v) => (v < 0.05 ? 0 : v));
    return;
  }
  // Strings ring and decay; hold each pitch class briefly so confirm doesn't flicker.
  if (confirm) patch.chroma = c.map((v, i) => Math.max(v, (s.chroma[i] ?? 0) * 0.85));
  // YIN only locks on when one pitch dominates, so a fresh clean reading means a single note is
  // ringing: name the note rather than reading its overtones as a chord.
  const mono = lastPitchPc >= 0 && performance.now() - lastVoicedAt < 150;
  const r = mono ? nameSet([lastPitchPc], lastPitchPc, s.setup.offsets) : chordFromChroma(c, null, s.setup.offsets);
  if (!r) {
    chCand = '';
    return;
  }
  if (chCand === r.name) chCount++;
  else { chCand = r.name; chCount = 1; }
  if (chCount === 4) setHeard(r, clock, patch);
}

function setHeard(r: ChordName, t: number, patch: Partial<State>) {
  const s = get();
  const cur = patch.heard ?? s.heard;
  if (cur && cur.name === r.name) return;
  const frets = shapeFor(r.name, s.setup);
  patch.heard = { ...r, frets, t };
  if (r.root != null) patch.history = [{ name: r.name, frets }, ...(patch.history ?? s.history)].slice(0, 8);
}

function onMl(m: MlNotes) {
  const s = get();
  if (!s.listening) return;
  const r = mergeWindow(s.buf, m.from, m.to, m.notes, s.setup, mlHand);
  mlHand = r.hand;
  const patch: Partial<State> = { buf: trim(r.buf, m.to) };
  const recent = [...s.mlRecent.filter((x) => x.t > m.to - 3), ...m.notes.map((n) => ({ midi: n.midi, t: n.t }))];
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
    engine.setOutput(on);
    set({ output: on });
  },
  saveSetup(p: Partial<Setup>) {
    const s = get();
    set({ setup: { offsets: p.offsets ?? s.setup.offsets, capo: p.capo ?? s.setup.capo }, detected: null });
  },
  setTuning(offsets: Offsets) {
    actions.saveSetup({ offsets });
  },
  selectDevice(id: string) {
    set({ deviceId: id });
    engine.start(id);
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
    const { zero, voices } = engine.playNotes(
      r.notes.map((n) => ({ t: n.t, hz: 440 * Math.pow(2, (fretMidi(n.s, n.f, setup) - 69) / 12) })),
      from,
    );
    const end = setTimeout(() => {
      play = null;
      set({ rplaying: false, playAt: 0 });
    }, (riffDur(r.notes) + 0.3 - from) * 1000 + 50);
    play = { zero, stop: () => { clearTimeout(end); voices.forEach((v) => v.stop()); } };
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
    set({ pedals: get().pedals.map((q, k) => (k === i ? { ...q, ...p } : q)) });
  },
};

let play: PlayState | null = null;

export const isKnownTuning = (o: Offsets) => TUNINGS.some(([, x]) => sameArr(x, o));
