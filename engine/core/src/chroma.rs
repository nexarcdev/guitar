//! Pitch content of one analysis frame: a 12-bin chroma for naming chords from audio alone, the
//! octave-exact salience of every semitone, and the list of fundamentals that are actually
//! sounding once the harmonics of lower notes have been attributed to them.
//!
//! Levels are absolute. Each spectral peak is calibrated to the RMS dBFS a pure tone of that
//! amplitude would have, so the app can compare a note with the noise floor instead of with
//! whatever happens to be loudest in the frame (which made a pick transient or a decaying string
//! look like a chord).

use crate::fft::Fft;
use serde::Serialize;

pub const NO_PITCH: f32 = -120.0;
/// Fundamentals reported per frame; the app caps to the instrument's string count.
pub const MAX_FUNDAMENTALS: usize = 8;
/// Samples the analysis frame covers: the short band's window.
pub const FRAME_N: usize = SHORT_N;
pub const SHORT_N: usize = 8192;
const F_LO: f64 = 70.0;
const F_HI: f64 = 1400.0;
/// Peaks this far below the strongest one are leakage, not notes.
const REL_KEEP_DB: f32 = -40.0;
/// A peak counts as a note when it sits within this many semitones of one.
const SEMITONE_TOL: f64 = 0.35;
/// Highest harmonic a fundamental claims. A wound low E has audible partials well past the 8th
/// (the 14th showed up 15 dB under the fundamental on a phone recording).
const MAX_HARMONIC: usize = 16;
/// A partial may be this much louder than the loudest lower partial of its series (the
/// fundamental for the 2nd) and still belong to it. Measured on a phone recording of a real
/// guitar, whose low end rolls off: the 2nd and 3rd partials of the wound strings run 3 to 6 dB
/// above the fundamental, the plain high e's octave 15 dB above it for a moment after the pick,
/// higher partials at or below the loudest lower one. A string an octave or a twelfth above
/// another therefore cannot be told from that string's partial by level alone; the app recovers
/// such strings from `pitch` with chord knowledge.
const OWN_DB: [f32; 17] = [0.0, 0.0, 16.0, 6.0, 3.0, 3.0, 2.0, 1.0, 0.0, -1.0, -2.0, -3.0, -3.0, -3.0, -3.0, -3.0, -3.0];
/// Harmonic tolerance in cents: partial n of a stiff string runs sharp by roughly B·n² (B about
/// 4e-4 for a wound low string, so the 7th sits ~20 cents and the 14th ~80 cents sharp).
fn harmonic_tol_cents(n: usize) -> f64 {
    25.0 + 0.35 * (n * n) as f64
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fundamental {
    pub midi: u8,
    /// Sine-equivalent RMS dBFS: directly comparable with `Levels::floor_db`.
    pub db: f32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChromaFrame {
    pub chroma: [f32; 12],
    /// Per-MIDI pitch salience in dB relative to the strongest peak (NO_PITCH = none). Octave
    /// exact, which is what tells an open low E apart from the E on the D string.
    pub pitch: Vec<f32>,
    /// Sine-equivalent dBFS of the strongest peak; `pitch[m] + top_db` is note m's absolute level.
    pub top_db: f32,
    /// Notes left after the 2nd to 16th harmonics are attributed to lower notes, loudest first. A
    /// note an octave or a twelfth above a louder one is claimed as its harmonic (see OWN_DB).
    pub fundamentals: Vec<Fundamental>,
}

/// One FFT size analysing one frequency band.
struct Band {
    size: usize,
    sr: f64,
    f_min: f64,
    f_max: f64,
    fft: Fft,
    re: Vec<f64>,
    im: Vec<f64>,
    win: Vec<f64>,
    mag: Vec<f64>,
    /// Subtracted from 10·log10(power) to get a tone's RMS dBFS (Hann coherent gain, bin scaling).
    cal_db: f64,
}

impl Band {
    fn new(size: usize, sr: f64, f_min: f64, f_max: f64) -> Self {
        let win = (0..size).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (size - 1) as f64).cos()).collect();
        Self {
            size,
            sr,
            f_min,
            f_max,
            fft: Fft::new(size),
            re: vec![0.0; size],
            im: vec![0.0; size],
            win,
            mag: vec![0.0; size / 2 + 1],
            // A sine of amplitude A under a Hann window peaks at A·N/4, and its RMS is A/√2.
            cal_db: 20.0 * (size as f64 / 4.0).log10() + 10.0 * 2f64.log10(),
        }
    }

    /// Appends the band's interpolated spectral peaks as (Hz, sine-equivalent dBFS) and returns
    /// the mean power per bin, which the caller uses as a digital-silence check.
    fn peaks(&mut self, x: &[f32], out: &mut Vec<(f64, f32)>) -> f64 {
        let (size, sr) = (self.size, self.sr);
        debug_assert_eq!(x.len(), size);
        for i in 0..size {
            self.re[i] = x[i] as f64 * self.win[i];
            self.im[i] = 0.0;
        }
        self.fft.run(&mut self.re, &mut self.im, false);
        let mag = &mut self.mag;
        let mut tot = 0.0;
        for k in 1..size / 2 {
            mag[k] = self.re[k] * self.re[k] + self.im[k] * self.im[k];
            tot += mag[k];
        }
        let k_min = (self.f_min * size as f64 / sr).ceil().max(2.0) as usize;
        let k_max = ((self.f_max * size as f64 / sr).floor() as usize).min(size / 2 - 1);
        let mut peak = 0.0f64;
        for k in k_min..=k_max {
            peak = peak.max(mag[k]);
        }
        let floor = peak * 1e-4;
        for k in k_min..=k_max {
            let m = mag[k];
            if m <= 0.0 || m < floor || m < mag[k - 1] || m < mag[k + 1] {
                continue;
            }
            // Parabolic interpolation on log power: position and height of the true peak.
            let (a, b, c) = ((mag[k - 1] + 1e-30).ln(), (m + 1e-30).ln(), (mag[k + 1] + 1e-30).ln());
            let den = a - 2.0 * b + c;
            let off = if den != 0.0 { (0.5 * (a - c) / den).clamp(-0.5, 0.5) } else { 0.0 };
            let lp = b - 0.25 * (a - c) * off;
            let db = 10.0 * lp / std::f64::consts::LN_10 - self.cal_db;
            out.push(((k as f64 + off) * sr / size as f64, db as f32));
        }
        tot / size as f64
    }
}

pub struct Chroma {
    short: Band,
    peaks: Vec<(f64, f32)>,
    cands: Vec<Cand>,
}

#[derive(Clone, Copy)]
struct Cand {
    midi: u8,
    hz: f64,
    db: f32,
    explained: bool,
}

#[inline]
fn to_midi(hz: f64) -> f64 {
    69.0 + 12.0 * (hz / 440.0).log2()
}

impl Chroma {
    pub fn new(sample_rate: f64) -> Self {
        Self {
            short: Band::new(SHORT_N, sample_rate, F_LO, F_HI),
            peaks: Vec::with_capacity(512),
            cands: Vec::with_capacity(128),
        }
    }

    /// `x` is the last `FRAME_N` samples. Returns None when the frame is digital silence or has no
    /// peaks on a semitone.
    pub fn compute(&mut self, x: &[f32], gate: f64) -> Option<ChromaFrame> {
        debug_assert_eq!(x.len(), FRAME_N);
        self.peaks.clear();
        let mean = self.short.peaks(&x[x.len() - SHORT_N..], &mut self.peaks);
        if mean < gate || self.peaks.is_empty() {
            return None;
        }
        let top_db = self.peaks.iter().map(|p| p.1).fold(f32::NEG_INFINITY, f32::max);

        // Octave-exact salience, relative to the top peak (the app adds top_db back when it needs
        // absolute levels for arbitrary semitones).
        let mut pitch = vec![NO_PITCH; 128];
        for &(f, d) in &self.peaks {
            let midi = to_midi(f);
            let r = midi.round();
            if (0.0..128.0).contains(&r) && (midi - r).abs() <= 0.4 {
                let p = &mut pitch[r as usize];
                *p = p.max(d - top_db);
            }
        }

        // 12-bin chroma from amplitude, with harmonics of a stronger lower peak discounted. A peak
        // that is the 2nd–6th harmonic of a lower peak mostly belongs to that note; the 5th harmonic
        // (a major third up two octaves) turns Em into Emaj7 if left in.
        let mut out = [0.0f64; 12];
        for &(f, d) in &self.peaks {
            let midi = to_midi(f);
            if (midi - midi.round()).abs() > 0.3 {
                continue;
            }
            let mut own = 1.0;
            for h in [2.0, 3.0, 4.0, 5.0, 6.0] {
                let sub = f / h;
                // qm > m·0.3 in power is q_db > d − 5.23
                if self.peaks.iter().any(|&(qf, qd)| (1200.0 * (qf / sub).log2()).abs() < 35.0 && qd > d - 5.23) {
                    own *= if h == 2.0 || h == 4.0 { 0.6 } else { 0.2 };
                }
            }
            let pc = (midi.round() as i64).rem_euclid(12) as usize;
            out[pc] += 10f64.powf(d as f64 / 20.0) * own;
        }
        let mx = out.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if mx <= 0.0 {
            return None;
        }
        let mut chroma = [0.0f32; 12];
        for i in 0..12 {
            chroma[i] = (out[i] / mx) as f32;
        }

        let fundamentals = self.attribute(top_db);
        Some(ChromaFrame { chroma, pitch, top_db, fundamentals })
    }

    /// Lowest-first greedy attribution: each unexplained semitone peak is a fundamental and claims
    /// the peaks at 2 to 16 times its frequency unless one is far too loud to be a harmonic.
    fn attribute(&mut self, top_db: f32) -> Vec<Fundamental> {
        let cands = &mut self.cands;
        cands.clear();
        for &(hz, db) in &self.peaks {
            if db < top_db + REL_KEEP_DB {
                continue;
            }
            let midi = to_midi(hz);
            let r = midi.round();
            if !(0.0..128.0).contains(&r) || (midi - r).abs() > SEMITONE_TOL {
                continue;
            }
            let midi = r as u8;
            match cands.iter_mut().find(|c| c.midi == midi) {
                Some(c) if c.db < db => *c = Cand { midi, hz, db, explained: false },
                Some(_) => {}
                None => cands.push(Cand { midi, hz, db, explained: false }),
            }
        }
        cands.sort_by(|a, b| a.hz.total_cmp(&b.hz));
        let mut out: Vec<Fundamental> = Vec::new();
        for i in 0..cands.len() {
            if cands[i].explained {
                continue;
            }
            let cf = cands[i].hz;
            out.push(Fundamental { midi: cands[i].midi, db: cands[i].db });
            // The series envelope: each claimed partial raises the bar the next one is judged by.
            let mut reference = cands[i].db;
            for h in 2..=MAX_HARMONIC {
                let target = cf * h as f64;
                let tol = harmonic_tol_cents(h);
                for j in i + 1..cands.len() {
                    let c = &mut cands[j];
                    if c.explained || (1200.0 * (c.hz / target).log2()).abs() >= tol {
                        continue;
                    }
                    if c.db <= reference + OWN_DB[h] {
                        c.explained = true;
                        reference = reference.max(c.db);
                    }
                }
            }
        }
        out.sort_by(|a, b| b.db.total_cmp(&a.db));
        out.truncate(MAX_FUNDAMENTALS);
        out
    }
}
