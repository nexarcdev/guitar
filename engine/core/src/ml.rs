//! basic-pitch polyphonic transcription, everything except the neural network itself (which each
//! channel runs with its own runtime: tract in the engine, TensorFlow.js in the browser).
//!
//! Windows are 2 s with a 1 s hop, and only onsets in the middle second of each window are
//! reported, so consecutive windows tile the timeline and the model's unreliable edges are never
//! used. Windows that are only noise are skipped (normalising silence makes the model
//! hallucinate), and quiet playing is brought up to a consistent level.
//!
//! The note decoder is a port of `outputToNotesPoly` from Spotify's basic-pitch-ts
//! (Apache-2.0, Copyright 2022 Spotify AB), with the settings the app has always used.

use crate::resample::Resampler;
use serde::Serialize;

pub const ML_RATE: f64 = 22050.0;
const FFT_HOP: usize = 256;
/// Samples the model consumes per window (2 s minus one hop).
pub const ML_WINDOW: usize = 22050 * 2 - FFT_HOP;
pub const FRAME_SEC: f64 = FFT_HOP as f64 / ML_RATE;
/// Model output frames per window, and pitches per frame (piano range, MIDI 21–108).
pub const N_FRAMES: usize = 172;
pub const N_PITCH: usize = 88;
const MIDI_OFFSET: i32 = 21;
const HOP: usize = 22050;
const EDGE: usize = (ML_WINDOW - HOP) / 2;
const RING: usize = 1 << 17;
const BLOCK: usize = 1024;
const MAX_GAIN: f32 = 100.0;
/// Give up once inference runs this far behind real time for several windows in a row.
const SLOW_RATIO: f64 = 0.8;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct MlNote {
    pub midi: i32,
    /// Listening-clock seconds.
    pub t: f64,
    pub dur: f64,
    pub amp: f32,
}

/// Notes whose onsets fall in [from, to) (listening-clock seconds). Covers the whole range, so
/// an empty list means "nothing was played here", which lets the app drop provisional notes.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct MlNotes {
    pub from: f64,
    pub to: f64,
    pub notes: Vec<MlNote>,
}

/// One window ready for the model: `ML_WINDOW` samples at 22.05 kHz, already normalised.
pub struct MlWindow {
    pub audio: Vec<f32>,
    k: u64,
    w_start: i64,
}

pub struct MlStream {
    in_rate: f64,
    rs: Option<Resampler>,
    ring: Vec<f32>,
    /// Absolute 22.05 kHz index of the next write.
    end: i64,
    /// Listening-clock sample (input rate) at which `end` was zero.
    origin: u64,
    /// Listening-clock sample expected next; anything else restarts the timeline.
    next_t0: Option<u64>,
    k: u64,
    floor_db: f32,
    open_db: f32,
    slow: u32,
    scratch: Vec<f32>,
}

impl MlStream {
    pub fn new(in_rate: f64) -> Self {
        Self {
            in_rate,
            rs: None,
            ring: vec![0.0; RING],
            end: 0,
            origin: 0,
            next_t0: None,
            k: 0,
            floor_db: -60.0,
            open_db: 12.0,
            slow: 0,
            scratch: Vec::with_capacity(4096),
        }
    }

    /// The app-wide noise floor and gate margin (from the tracker's NoiseFloor).
    pub fn set_floor(&mut self, floor_db: f32, open_db: f32) {
        self.floor_db = floor_db;
        self.open_db = open_db;
    }

    pub fn reset(&mut self) {
        self.rs = None;
        self.ring.fill(0.0);
        self.end = 0;
        self.k = 0;
        self.next_t0 = None;
    }

    /// Input-rate audio; `t0` = listening-clock sample index of `data[0]`.
    pub fn push(&mut self, t0: u64, data: &[f32]) {
        if self.next_t0 != Some(t0) {
            self.reset();
        }
        self.next_t0 = Some(t0 + data.len() as u64);
        let rs = self.rs.get_or_insert_with(|| Resampler::new(self.in_rate, ML_RATE));
        if self.end == 0 {
            self.origin = t0;
        }
        self.scratch.clear();
        rs.process(data, &mut self.scratch);
        for (i, &v) in self.scratch.iter().enumerate() {
            self.ring[(self.end as usize + i) & (RING - 1)] = v;
        }
        self.end += self.scratch.len() as i64;
    }

    /// Next window worth running the model on, if one is complete.
    pub fn next_window(&mut self) -> Option<MlWindow> {
        loop {
            // Window k trusts onsets in [k·HOP, (k+1)·HOP) and spans [k·HOP − EDGE, … + ML_WINDOW).
            let mut w_end = (self.k * HOP as u64) as i64 - EDGE as i64 + ML_WINDOW as i64;
            if w_end > self.end {
                return None;
            }
            // Fell behind: skip ahead instead of building an ever-growing backlog.
            if self.end - w_end > (HOP * 2) as i64 {
                self.k = ((self.end - ML_WINDOW as i64 + EDGE as i64) / HOP as i64).max(0) as u64;
                w_end = (self.k * HOP as u64) as i64 - EDGE as i64 + ML_WINDOW as i64;
            }
            let w_start = w_end - ML_WINDOW as i64;
            let mut audio = vec![0.0f32; ML_WINDOW];
            for (i, v) in audio.iter_mut().enumerate() {
                let a = w_start + i as i64;
                *v = if a < 0 || a < self.end - RING as i64 { 0.0 } else { self.ring[a as usize & (RING - 1)] };
            }
            let (peak, run) = self.levels(&audio);
            if run < 2 {
                self.k += 1;
                continue;
            }
            let gain = (0.5 / (peak + 1e-9)).min(MAX_GAIN);
            if gain > 1.0 {
                audio.iter_mut().for_each(|v| *v *= gain);
            }
            let w = MlWindow { audio, k: self.k, w_start };
            self.k += 1;
            return Some(w);
        }
    }

    /// Peak, and the longest run of consecutive blocks above the gate (a click lights up one).
    fn levels(&self, w: &[f32]) -> (f32, u32) {
        let (mut peak, mut run, mut best) = (0.0f32, 0u32, 0u32);
        for b in w.chunks_exact(BLOCK) {
            let mut sum = 0.0f64;
            for &v in b {
                sum += v as f64 * v as f64;
                peak = peak.max(v.abs());
            }
            let d = (20.0 * ((sum / BLOCK as f64).sqrt() + 1e-12).log10()) as f32;
            run = if d > self.floor_db + self.open_db { run + 1 } else { 0 };
            best = best.max(run);
        }
        (peak, best)
    }

    /// Turns the model's output for `w` into notes on the listening clock. `frames` and
    /// `onsets` are N_FRAMES × N_PITCH, row-major.
    pub fn decode(&self, w: &MlWindow, frames: &[f32], onsets: &[f32]) -> MlNotes {
        let from = (w.k * HOP as u64) as f64;
        let to = from + HOP as f64;
        let sec = |a: f64| (self.origin as f64 + a / ML_RATE * self.in_rate) / self.in_rate;
        let notes = notes_poly(frames, onsets)
            .into_iter()
            .filter_map(|e| {
                let a = w.w_start as f64 + e.start_frame as f64 * FRAME_SEC * ML_RATE;
                (a >= from && a < to).then(|| MlNote {
                    midi: e.pitch_midi,
                    t: sec(a),
                    dur: e.duration_frames as f64 * FRAME_SEC,
                    amp: e.amplitude,
                })
            })
            .collect();
        MlNotes { from: sec(from), to: sec(to), notes }
    }

    /// Records how long inference took; true once it has been too slow to keep up for a while.
    pub fn note_inference(&mut self, seconds: f64) -> bool {
        self.slow = if seconds > SLOW_RATIO * (HOP as f64 / ML_RATE) { self.slow + 1 } else { 0 };
        self.slow >= 4
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct NoteEvent {
    pub start_frame: usize,
    pub duration_frames: usize,
    pub pitch_midi: i32,
    pub amplitude: f32,
}

/// `outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, 1400, 60, true, 11)` from basic-pitch.
/// Computed in f64 like the JavaScript original, so thresholds compare identically.
pub fn notes_poly(frames_in: &[f32], onsets_in: &[f32]) -> Vec<NoteEvent> {
    const ONSET_THRESH: f64 = 0.5;
    const FRAME_THRESH: f64 = 0.3;
    const MIN_NOTE_LEN: usize = 5;
    const ENERGY_TOL: usize = 11;
    const MAX_FREQ_IDX: usize = 87;
    let p = N_PITCH;
    let n = frames_in.len() / p;
    let mut frames: Vec<f64> = frames_in.iter().map(|&v| v as f64).collect();
    let mut onsets: Vec<f64> = onsets_in.iter().map(|&v| v as f64).collect();
    let at = |r: usize, c: usize| r * p + c;

    // constrainFrequency(maxFreq 1400 Hz, minFreq 60 Hz): JS fill() truncates the fractional index.
    let hz_to_midi = |hz: f64| 12.0 * (hz.log2() - 440f64.log2()) + 69.0;
    let max_idx = (hz_to_midi(1400.0) - MIDI_OFFSET as f64).trunc() as usize;
    let min_idx = (hz_to_midi(60.0) - MIDI_OFFSET as f64).trunc() as usize;
    for r in 0..n {
        for c in (0..min_idx).chain(max_idx..p) {
            onsets[at(r, c)] = 0.0;
            frames[at(r, c)] = 0.0;
        }
    }

    // getInferredOnsets: add onsets where frame activations jump (min over 1- and 2-frame diffs).
    let n_diff = 2;
    let mut diff = vec![0.0f64; n * p];
    for r in n_diff..n {
        for c in 0..p {
            let m = (1..=n_diff).map(|d| frames[at(r, c)] - frames[at(r - d, c)]).fold(f64::INFINITY, f64::min);
            diff[at(r, c)] = m.max(0.0);
        }
    }
    let onset_max = onsets.iter().fold(0.0f64, |a, &v| a.max(v));
    let diff_max = diff.iter().fold(0.0f64, |a, &v| a.max(v));
    // With no frame differences at all, JS divides 0 by 0 and every comparison on the NaNs fails,
    // so no onsets survive; reproduce that rather than "fix" it.
    let inferred: Vec<f64> = onsets.iter().zip(&diff).map(|(&o, &d)| if diff_max == 0.0 { f64::NAN } else { o.max(onset_max * d / diff_max) }).collect();

    // Peaks over time (argrelmax, order 1) above the onset threshold, latest first.
    let mut starts: Vec<(usize, usize)> = Vec::new();
    for r in 0..n {
        for c in 0..p {
            let v = inferred[at(r, c)];
            let left = r == 0 || v > inferred[at(r - 1, c)];
            let right = r + 1 >= n || v > inferred[at(r + 1, c)];
            if left && right && v > ONSET_THRESH {
                starts.push((r, c));
            }
        }
    }
    starts.reverse();

    let mut energy = frames.clone();
    let mut events = Vec::new();
    let clear = |energy: &mut [f64], r: usize, c: usize| {
        energy[at(r, c)] = 0.0;
        if c < MAX_FREQ_IDX {
            energy[at(r, c + 1)] = 0.0;
        }
        if c > 0 {
            energy[at(r, c - 1)] = 0.0;
        }
    };
    let mean = |frames: &[f64], a: usize, b: usize, c: usize| ((a..b).map(|r| frames[at(r, c)]).sum::<f64>() / (b - a) as f64) as f32;
    for (start, c) in starts {
        if start >= n - 1 {
            continue;
        }
        let mut i = start + 1;
        let mut k = 0;
        while i < n - 1 && k < ENERGY_TOL {
            k = if energy[at(i, c)] < FRAME_THRESH { k + 1 } else { 0 };
            i += 1;
        }
        i -= k;
        if i - start <= MIN_NOTE_LEN {
            continue;
        }
        for j in start..i {
            clear(&mut energy, j, c);
        }
        events.push(NoteEvent { start_frame: start, duration_frames: i - start, pitch_midi: c as i32 + MIDI_OFFSET, amplitude: mean(&frames, start, i, c) });
    }

    // Melodia trick: follow the strongest remaining energy both ways to recover notes whose
    // onsets were missed.
    loop {
        // Same tie-breaking as the JS: earliest row, last column within it.
        let (mut best, mut mid, mut c) = (0.0f64, 0usize, 0usize);
        for r in 0..n {
            let row = &energy[at(r, 0)..at(r, 0) + p];
            let (mut col, mut mx) = (0usize, f64::NEG_INFINITY);
            for (j, &v) in row.iter().enumerate() {
                if !(mx > v) {
                    mx = v;
                    col = j;
                }
            }
            if mx > best {
                best = mx;
                mid = r;
                c = col;
            }
        }
        if best <= FRAME_THRESH {
            break;
        }
        energy[at(mid, c)] = 0.0;
        let mut i = mid + 1;
        let mut k = 0;
        while i < n - 1 && k < ENERGY_TOL {
            k = if energy[at(i, c)] < FRAME_THRESH { k + 1 } else { 0 };
            clear(&mut energy, i, c);
            i += 1;
        }
        let i_end = i - 1 - k;
        let mut i = mid as i64 - 1;
        let mut k = 0;
        while i > 0 && k < ENERGY_TOL {
            k = if energy[at(i as usize, c)] < FRAME_THRESH { k + 1 } else { 0 };
            clear(&mut energy, i as usize, c);
            i -= 1;
        }
        let i_start = (i + 1 + k as i64) as usize;
        if i_end <= i_start || i_end - i_start <= MIN_NOTE_LEN {
            continue;
        }
        events.push(NoteEvent { start_frame: i_start, duration_frames: i_end - i_start, pitch_midi: c as i32 + MIDI_OFFSET, amplitude: mean(&frames, i_start, i_end, c) });
    }
    events
}
