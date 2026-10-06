// Four-slot synced looper. The first recording sets the loop length; every other slot records
// exactly one cycle aligned to the shared phase. A playing slot can overdub. Pure so it can be
// unit tested; looper.worklet.ts drives it from the audio thread.

export type SlotState = 'empty' | 'recording' | 'playing' | 'overdubbing' | 'stopped';

export interface SlotView {
  state: SlotState;
  /** 0–1 progress through the current pass (recording or playing). */
  progress: number;
}

export interface LooperView {
  slots: SlotView[];
  /** Loop length in samples, 0 until the first loop is closed. */
  len: number;
  /** True while the first loop is being recorded and has no length yet. */
  free: boolean;
  rate: number;
}

interface Slot {
  state: SlotState;
  l: Float32Array | null;
  r: Float32Array | null;
  /** Samples written in the current recording pass. */
  written: number;
}

export const SLOTS = 4;

export class LooperCore {
  private slots: Slot[] = Array.from({ length: SLOTS }, () => ({ state: 'empty' as SlotState, l: null, r: null, written: 0 }));
  private len = 0;
  private phase = 0;
  /** Slot recording the first loop, or -1. */
  private master = -1;
  /** Round-trip latency in samples: overdubs are written this far behind the playhead. */
  latency = 0;

  constructor(readonly sampleRate: number, readonly maxSeconds = 60) {}

  tap(i: number) {
    const s = this.slots[i];
    if (this.master >= 0 && this.master !== i) this.closeMaster();
    switch (s.state) {
      case 'empty':
        if (!this.len) {
          const cap = Math.floor(this.sampleRate * this.maxSeconds);
          s.l = new Float32Array(cap);
          s.r = new Float32Array(cap);
          this.master = i;
          this.phase = 0;
        } else {
          s.l = new Float32Array(this.len);
          s.r = new Float32Array(this.len);
        }
        s.written = 0;
        s.state = 'recording';
        break;
      case 'recording':
        if (this.master === i) this.closeMaster();
        else s.state = 'playing';
        break;
      case 'playing':
        s.state = 'overdubbing';
        break;
      case 'overdubbing':
        s.state = 'playing';
        break;
      case 'stopped':
        s.state = 'playing';
        break;
    }
  }

  stop(i: number) {
    const s = this.slots[i];
    if (s.state === 'recording' && this.master === i) this.closeMaster();
    if (s.state !== 'empty') s.state = s.state === 'stopped' ? 'playing' : 'stopped';
  }

  clear(i: number) {
    const s = this.slots[i];
    if (this.master === i) this.master = -1;
    s.state = 'empty';
    s.l = s.r = null;
    s.written = 0;
    if (this.slots.every((x) => x.state === 'empty')) {
      this.len = 0;
      this.phase = 0;
    }
  }

  private closeMaster() {
    const s = this.slots[this.master];
    const n = Math.max(1, s.written);
    s.l = s.l!.slice(0, n);
    s.r = s.r!.slice(0, n);
    s.state = 'playing';
    this.len = n;
    this.phase = 0;
    this.master = -1;
  }

  /** Processes one block. `inL/inR` may be the same array for mono input. */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array) {
    const n = outL.length;
    for (let k = 0; k < n; k++) {
      let l = 0, r = 0;
      if (this.master >= 0) {
        const m = this.slots[this.master];
        if (m.written < m.l!.length) {
          m.l![m.written] = inL[k];
          m.r![m.written] = inR[k];
          m.written++;
        }
        if (m.written >= m.l!.length) this.closeMaster();
      }
      if (this.len) {
        const p = this.phase;
        const w = (p - (this.latency % this.len) + this.len) % this.len;
        for (const s of this.slots) {
          if (s.state === 'playing' || s.state === 'overdubbing') {
            l += s.l![p];
            r += s.r![p];
          }
          if (s.state === 'overdubbing') {
            s.l![w] += inL[k];
            s.r![w] += inR[k];
          } else if (s.state === 'recording') {
            s.l![w] = inL[k];
            s.r![w] = inR[k];
            if (++s.written >= this.len) s.state = 'playing';
          }
        }
        this.phase = (p + 1) % this.len;
      }
      outL[k] = l;
      outR[k] = r;
    }
  }

  view(): LooperView {
    const cap = this.sampleRate * this.maxSeconds;
    return {
      len: this.len,
      rate: this.sampleRate,
      free: this.master >= 0,
      slots: this.slots.map((s, i) => ({
        state: s.state,
        progress:
          i === this.master ? s.written / cap
          : s.state === 'recording' ? s.written / this.len
          : s.state === 'playing' || s.state === 'overdubbing' ? this.phase / this.len
          : 0,
      })),
    };
  }
}
