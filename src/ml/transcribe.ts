// One basic-pitch inference over a single model window. Shared by the ML worker and the
// Node smoke test, so `tf` is injected rather than imported.

import type * as TF from '@tensorflow/tfjs';
import { outputToNotesPoly } from '@spotify/basic-pitch';

export const ML_RATE = 22050;
const FFT_HOP = 256;
/** Samples the model consumes per window (2 s minus one hop), from basic-pitch's constants. */
export const ML_WINDOW = ML_RATE * 2 - FFT_HOP;
export const FRAME_SEC = FFT_HOP / ML_RATE;

export interface MlNote {
  midi: number;
  /** Seconds from the start of the window. */
  start: number;
  dur: number;
  amp: number;
}

export async function transcribeWindow(tf: typeof TF, model: TF.GraphModel, audio: Float32Array): Promise<MlNote[]> {
  if (audio.length !== ML_WINDOW) throw new Error('window must be ' + ML_WINDOW + ' samples');
  const input = tf.tensor3d(audio, [1, ML_WINDOW, 1]);
  // Output order follows basic-pitch: Identity_1 = frames, Identity_2 = onsets.
  const [frames, onsets] = model.execute(input, ['Identity_1', 'Identity_2']) as TF.Tensor3D[];
  const [f, o] = await Promise.all([frames.array(), onsets.array()]);
  input.dispose();
  frames.dispose();
  onsets.dispose();
  const events = outputToNotesPoly(f[0], o[0], 0.5, 0.3, 5, true, 1400, 60, true);
  return events.map((e) => ({
    midi: e.pitchMidi,
    start: e.startFrame * FRAME_SEC,
    dur: e.durationFrames * FRAME_SEC,
    amp: e.amplitude,
  }));
}
