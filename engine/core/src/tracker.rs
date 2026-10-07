//! Turns a stream of audio chunks into pitch frames, chroma frames and fast single-note onsets.
//!
//! Everything is judged relative to the noise floor (floor.rs) rather than a fixed level, so a
//! quiet guitar cable works as well as a hot interface: the gate opens ~12 dB above the floor and
//! closes ~6 dB above it, which also stops decaying strings and hum from producing readings.

use crate::chroma::{Chroma, ChromaFrame, FRAME_N, SHORT_N};
use crate::floor::{FloorMode, NoiseFloor};
use crate::yin::Yin;
use serde::Serialize;
use std::collections::VecDeque;

const FRAME: usize = 2048;
/// Ring buffer length: a power of two no shorter than the chroma frame.
const RING: usize = 65536;
const _: () = assert!(RING >= FRAME_N && RING.is_power_of_two());
const VOICED_CLARITY: f64 = 0.9;
/// Default gate threshold above the floor (dB); the gate closes 6 dB lower.
pub const OPEN_DB: f32 = 12.0;
const HYSTERESIS_DB: f32 = 6.0;
/// The level must clear the threshold this many frames in a row: attacks do, clicks don't.
const OPEN_FRAMES: u32 = 2;
/// Below this the input is digital silence regardless of the floor.
const ABS_MIN_DB: f32 = -90.0;
/// After an attack, wait this long for the pitch to settle before naming the note.
const ATTACK_SEC: f64 = 0.3;
const SETTLE_FRAMES: usize = 5;
/// Legato notes must hold this many frames within this many dB of the picked level.
const LEGATO_FRAMES: usize = 8;
const LEGATO_DROP_DB: f32 = 9.0;
/// "Never" for seconds-since-attack, kept finite so it survives JSON.
pub const NEVER: f64 = 1e9;
/// The floor rises slowly only while a recently struck note is still sounding. A gate that is open
/// with no attack for this long is sitting on noise, and the floor must be free to catch up.
const PLAYING_SEC: f64 = 2.5;
/// The level still ramps for a few frames after an attack; a jump within this is the same attack.
const ATTACK_DEBOUNCE: f64 = 0.04;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct PitchFrame {
    /// Listening-clock seconds at the centre of the analysis frame.
    pub t: f64,
    pub freq: f64,
    pub clarity: f64,
    pub rms: f64,
    /// Gate open, clear pitch, and consistent with the last few frames: safe to show on a tuner.
    pub stable: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct FastNote {
    pub midi: i32,
    pub t: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Levels {
    /// Noise floor in force, dBFS.
    pub floor_db: f32,
    /// The automatic estimate (differs from floor_db in manual mode).
    pub measured_db: f32,
    pub floor_mode: FloorMode,
    /// Progress (0–1) of a recalibration the player asked for.
    pub measuring: Option<f32>,
    /// Gate threshold above the floor in use (dB).
    pub open_db: f32,
    /// Seconds since the last pick attack (NEVER if none yet).
    pub since_attack: f64,
    /// Recent playing peak, dBFS (decays slowly).
    pub peak_db: f32,
    pub gate: bool,
    /// Pick attacks counted since the tracker started. The app diffs this between chunks to open a
    /// per-strum window; `since_attack` alone can miss an attack that landed mid-chunk.
    pub attacks: u32,
    /// Loudest frame level (dBFS) since the latest attack.
    pub attack_db: f32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct TrackerOutput {
    pub frames: Vec<PitchFrame>,
    pub notes: Vec<FastNote>,
    /// Absent = no chroma frame in this chunk; null = gate closed (nothing playing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chroma: Option<Option<ChromaFrame>>,
    /// Peak level of the chunk, 0–1, for the input meter.
    pub peak: f32,
    pub levels: Levels,
}

fn db(x: f64) -> f32 {
    (20.0 * (x + 1e-12).log10()) as f32
}

pub struct Tracker {
    sr: f64,
    yin: Yin,
    chroma: Chroma,
    hop: usize,
    chroma_every: usize,
    ring: Vec<f32>,
    /// Absolute index of the next sample to be written.
    end: u64,
    next_frame: u64,
    next_chroma: u64,
    frame: Vec<f32>,
    cframe: Vec<f32>,
    pub floor: NoiseFloor,
    open_db: f32,
    above: u32,
    peak_db: f32,
    gate: bool,
    recent: VecDeque<f32>,
    since_attack: f64,
    pitches: VecDeque<f64>,
    cand: Vec<f64>,
    last_emit: i32,
    quiet: u32,
    attack: bool,
    attacks: u32,
    note_peak: f32,
}

impl Tracker {
    pub fn new(sample_rate: f64) -> Self {
        let hop = if sample_rate >= 44100.0 { 512 } else { 256 };
        Self {
            sr: sample_rate,
            yin: Yin::new(FRAME, sample_rate),
            chroma: Chroma::new(sample_rate),
            hop,
            chroma_every: (sample_rate * 0.06).round() as usize,
            ring: vec![0.0; RING],
            end: 0,
            next_frame: FRAME as u64,
            // The first chroma frame comes once the short band has data; the long band reads the
            // cleared ring until it fills.
            next_chroma: SHORT_N as u64,
            frame: vec![0.0; FRAME],
            cframe: vec![0.0; FRAME_N],
            floor: NoiseFloor::new(hop as f64 / sample_rate),
            open_db: OPEN_DB,
            above: 0,
            peak_db: -100.0,
            gate: false,
            recent: VecDeque::with_capacity(9),
            since_attack: NEVER,
            pitches: VecDeque::with_capacity(6),
            cand: Vec::with_capacity(32),
            last_emit: -1,
            quiet: 0,
            attack: false,
            attacks: 0,
            note_peak: -100.0,
        }
    }

    pub fn sample_rate(&self) -> f64 {
        self.sr
    }

    /// Noise gate margin above the floor: lower hears quieter playing, higher ignores more noise.
    pub fn set_open_db(&mut self, db: f32) {
        self.open_db = db;
    }

    pub fn open_db(&self) -> f32 {
        self.open_db
    }

    /// Start a fresh baseline: `explicit` when the player asked for it.
    pub fn recalibrate(&mut self, explicit: bool) {
        self.floor.recalibrate(explicit);
        self.gate = false;
    }

    pub fn levels(&self) -> Levels {
        Levels {
            floor_db: self.floor.db(),
            measured_db: self.floor.measured_db(),
            floor_mode: self.floor.mode,
            measuring: self.floor.measuring(),
            open_db: self.open_db,
            since_attack: self.since_attack,
            peak_db: self.peak_db,
            gate: self.gate,
            attacks: self.attacks,
            attack_db: self.note_peak,
        }
    }

    fn copy(ring: &[f32], dst: &mut [f32], end_abs: u64) {
        let n = dst.len() as u64;
        let start = end_abs - n;
        for (i, d) in dst.iter_mut().enumerate() {
            *d = ring[((start + i as u64) as usize) & (RING - 1)];
        }
    }

    /// `t0` = listening-clock sample index of `data[0]`.
    pub fn push(&mut self, t0: u64, data: &[f32]) -> TrackerOutput {
        // A jump in the clock means the stream restarted; resync rather than analyse garbage.
        if t0 != self.end {
            self.end = t0;
            self.next_frame = t0 + FRAME as u64;
            self.next_chroma = t0 + SHORT_N as u64;
            self.ring.fill(0.0);
            self.cand.clear();
            self.last_emit = -1;
            self.pitches.clear();
        }
        let mut peak = 0.0f32;
        for (i, &v) in data.iter().enumerate() {
            self.ring[((self.end + i as u64) as usize) & (RING - 1)] = v;
            peak = peak.max(v.abs());
        }
        self.end += data.len() as u64;
        let mut out = TrackerOutput { frames: Vec::new(), notes: Vec::new(), chroma: None, peak, levels: self.levels() };

        while self.next_frame <= self.end {
            Self::copy(&self.ring, &mut self.frame, self.next_frame);
            let t = (self.next_frame as f64 - FRAME as f64 / 2.0) / self.sr;
            let mut rms = 0.0f64;
            for &v in &self.frame {
                rms += v as f64 * v as f64;
            }
            rms = (rms / FRAME as f64).sqrt();
            let level = db(rms);
            self.track(level);
            // YIN only runs while something is playing; the gate is the noise rejection, not YIN.
            let (freq, clarity) = if self.gate {
                let r = self.yin.detect(&self.frame, 0.0);
                (r.freq, r.clarity)
            } else {
                (-1.0, 0.0)
            };
            let stable = self.stability(freq, clarity);
            out.frames.push(PitchFrame { t, freq, clarity, rms, stable });
            self.onsets(freq, clarity, level, t, &mut out.notes);
            self.next_frame += self.hop as u64;
        }
        while self.next_chroma <= self.end {
            Self::copy(&self.ring, &mut self.cframe, self.next_chroma);
            out.chroma = Some(if self.gate { self.chroma.compute(&self.cframe, 1e-12) } else { None });
            self.next_chroma += self.chroma_every as u64;
        }
        out.levels = self.levels();
        out
    }

    /// Noise floor, playing peak, gate with hysteresis, attack detection.
    fn track(&mut self, level: f32) {
        self.floor.push(level, self.gate && self.since_attack < PLAYING_SEC);
        let floor = self.floor.db();
        self.above = if level > (floor + self.open_db).max(ABS_MIN_DB) { self.above + 1 } else { 0 };
        let mut attack = false;
        if !self.gate && self.above >= OPEN_FRAMES {
            // Playing starts: the gate opening is the first attack.
            self.gate = true;
            attack = true;
        } else if self.gate && level < floor + self.open_db - HYSTERESIS_DB {
            self.gate = false;
        }
        self.peak_db = if self.gate { level.max(self.peak_db) } else { floor.max(self.peak_db - 0.02) };

        // Attack: the level jumps above everything in the last ~80 ms (beating on a ringing
        // string dips and recovers but never exceeds its recent maximum).
        self.recent.push_back(level);
        if self.recent.len() > 8 {
            self.recent.pop_front();
        }
        self.since_attack += self.hop as f64 / self.sr;
        let n = self.recent.len() - 1;
        if self.gate && n > 0 && self.since_attack > ATTACK_DEBOUNCE {
            let prev = self.recent.iter().take(n);
            let (mx, mn) = prev.fold((f32::NEG_INFINITY, f32::INFINITY), |(a, b), &v| (a.max(v), b.min(v)));
            if level > mx + 3.0 && level > mn + 6.0 {
                attack = true;
            }
        }
        if attack {
            self.attack = true;
            self.attacks += 1;
            self.since_attack = 0.0;
            self.cand.clear();
            self.note_peak = level;
        }
        if self.gate {
            self.note_peak = self.note_peak.max(level);
        }
    }

    /// A reading is stable when it agrees (±35 cents) with the median of the last five voiced frames.
    fn stability(&mut self, freq: f64, clarity: f64) -> bool {
        if !self.gate || freq <= 0.0 || clarity < VOICED_CLARITY {
            self.pitches.clear();
            return false;
        }
        let m = 69.0 + 12.0 * (freq / 440.0).log2();
        self.pitches.push_back(m);
        if self.pitches.len() > 5 {
            self.pitches.pop_front();
        }
        if self.pitches.len() < 3 {
            return false;
        }
        let mut s: Vec<f64> = self.pitches.iter().copied().collect();
        s.sort_by(f64::total_cmp);
        (m - s[s.len() >> 1]).abs() < 0.35
    }

    fn emit(&mut self, midi: i32, t: f64, notes: &mut Vec<FastNote>) {
        let back = (self.cand.len() as f64 - 1.0) * self.hop as f64 / self.sr;
        notes.push(FastNote { midi, t: t - back });
        self.last_emit = midi;
        self.cand.clear();
    }

    fn onsets(&mut self, freq: f64, clarity: f64, level: f32, t: f64, notes: &mut Vec<FastNote>) {
        let voiced = self.gate && freq > 0.0 && clarity >= VOICED_CLARITY;
        if !voiced {
            self.quiet += 1;
            if self.quiet >= 6 {
                self.last_emit = -1;
                self.cand.clear();
            }
            return;
        }
        self.quiet = 0;
        let m = 69.0 + 12.0 * (freq / 440.0).log2();
        if self.attack {
            // Picked notes start sharp; judge the pitch by the median of the frames after the attack.
            self.cand.push(m);
            if self.cand.len() >= SETTLE_FRAMES {
                let mut sorted = self.cand.clone();
                sorted.sort_by(f64::total_cmp);
                let med = sorted[sorted.len() >> 1];
                let tail = &self.cand[self.cand.len() - 3..];
                let (mx, mn) = tail.iter().fold((f64::NEG_INFINITY, f64::INFINITY), |(a, b), &v| (a.max(v), b.min(v)));
                if mx - mn < 0.6 {
                    self.emit(med.round() as i32, t, notes);
                } else if self.cand.len() > SETTLE_FRAMES * 3 {
                    self.cand.clear();
                }
                if self.last_emit == med.round() as i32 {
                    self.attack = false;
                }
            }
            if self.since_attack > ATTACK_SEC {
                self.attack = false;
                self.cand.clear();
            }
            return;
        }
        // Legato (hammer-on, pull-off, slide): a new pitch that holds while the note is still
        // near its picked level. A string being muted or dying away doesn't qualify.
        let r = m.round() as i32;
        if r == self.last_emit || level < self.note_peak - LEGATO_DROP_DB {
            self.cand.clear();
            return;
        }
        if let Some(&last) = self.cand.last() {
            if last.round() as i32 != r {
                self.cand.clear();
            }
        }
        self.cand.push(m);
        if self.cand.len() >= LEGATO_FRAMES {
            self.emit(r, t, notes);
        }
    }
}
