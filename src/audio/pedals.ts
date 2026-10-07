// The pedalboard as the UI shows it. The pedals themselves live in Fretline's core (Rust), the
// same code in the browser and the engine; this is only their labels and the starting board.

import type { PedalName, PedalState } from '../core/protocol';

export type { PedalName };

export interface Pedal extends PedalState {
  /** Category label printed on the pedal. */
  type: string;
}

const TYPES: Record<PedalName, string> = {
  Compressor: 'DYNAMICS',
  Overdrive: 'GAIN',
  Distortion: 'GAIN',
  Fuzz: 'GAIN',
  Chorus: 'MOD',
  Phaser: 'MOD',
  Delay: 'TIME',
  Reverb: 'SPACE',
};

/** Same as the core's starting board (engine/core/src/session.rs). */
export const DEFAULT_PEDALS: Pedal[] = (
  [
    ['Compressor', 55], ['Overdrive', 62], ['Distortion', 70], ['Fuzz', 48],
    ['Chorus', 40], ['Phaser', 35], ['Delay', 45], ['Reverb', 58],
  ] as const
).map(([name, level]) => ({ name, type: TYPES[name], level, on: name === 'Overdrive' || name === 'Delay' }));

export const withTypes = (ps: PedalState[]): Pedal[] => ps.map((p) => ({ ...p, type: TYPES[p.name] ?? '' }));
export const toStates = (ps: Pedal[]): PedalState[] => ps.map(({ name, on, level }) => ({ name, on, level }));
