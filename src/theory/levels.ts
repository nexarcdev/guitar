// Level and timing thresholds for judging a strum. Calibrated on engine/core/tests/fixtures/strums.wav
// (a phone recording of real chords and single strings); engine/core/tests/strums.rs mirrors them
// and is the test that must keep passing when any of these move.

/** A strum is judged on the chroma frames this long after its (last) attack: after the pick
 * transient, before the strings decay. */
export const WINDOW_START = 0.15;
export const WINDOW_END = 0.6;
/** Attacks closer than this are one strum being swept. */
export const STRUM_MERGE = 0.15;
/** The window's loudest peak must clear the floor by this much, else nothing was played. */
export const STRUM_MIN_ABOVE_FLOOR = 20;
/** A note counts when it clears the noise floor by this much... */
export const NOTE_MIN_ABOVE_FLOOR = 12;
/** ...and sits within this much of the loudest note (a string 30 dB down was not struck). */
export const NOTE_MAX_BELOW_TOP = 30;
/** ...in at least this fraction of the window's frames. */
export const NOTE_MIN_FRAMES = 1 / 3;
/** A note already sounding in the last frame before the attack belongs to this strum only if the
 * attack raised it by this much: a ringing string keeps decaying, a re-struck one comes back up. */
export const RESTRIKE_DB = 2;
/** The last frame ending at least this long before the attack is "before". */
export const PRE_END = 0.03;
