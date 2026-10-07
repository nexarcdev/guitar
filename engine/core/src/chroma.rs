//! 12-bin pitch-class profile from a Hann-windowed FFT. Only interpolated spectral peaks that sit
//! on a semitone count, and peaks explained as overtones of a lower note are discounted. That
//! suppresses the leakage and overtone smear that make a plain chromagram hear E as E + B + G#.

use crate::fft::Fft;
use serde::Serialize;

pub const NO_PITCH: f32 = -120.0;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ChromaFrame {
    pub chroma: [f32; 12],
    /// Per-MIDI pitch salience in dB relative to the strongest peak (NO_PITCH = none). Octave
    /// exact, which is what tells an open low E apart from the E on the D string.
    pub pitch: Vec<f32>,
}

pub struct Chroma {
    size: usize,
    sr: f64,
    f_min: f64,
    f_max: f64,
    fft: Fft,
    re: Vec<f64>,
    im: Vec<f64>,
    win: Vec<f64>,
    mag: Vec<f64>,
    peaks: Vec<(f64, f64)>,
}

impl Chroma {
    pub fn new(size: usize, sample_rate: f64) -> Self {
        let win = (0..size).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (size - 1) as f64).cos()).collect();
        Self {
            size,
            sr: sample_rate,
            f_min: 70.0,
            f_max: 1400.0,
            fft: Fft::new(size),
            re: vec![0.0; size],
            im: vec![0.0; size],
            win,
            mag: vec![0.0; size / 2 + 1],
            peaks: Vec::with_capacity(256),
        }
    }

    /// Normalised chroma (max = 1) plus per-MIDI pitch salience, or None when the frame is silent.
    pub fn compute(&mut self, x: &[f32], gate: f64) -> Option<ChromaFrame> {
        let (size, sr) = (self.size, self.sr);
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
        if tot / (size as f64) < gate {
            return None;
        }
        let k_min = (self.f_min * size as f64 / sr).ceil() as usize;
        let k_max = (self.f_max * size as f64 / sr).floor() as usize;
        let mut peak = 0.0f64;
        for k in k_min..=k_max {
            peak = peak.max(mag[k]);
        }
        let floor = peak * 3e-4;
        let peaks = &mut self.peaks;
        peaks.clear();
        for k in 2.max(k_min)..=k_max {
            let m = mag[k];
            if m < floor || m < mag[k - 1] || m < mag[k + 1] {
                continue;
            }
            let (a, b, c) = ((mag[k - 1] + 1e-20).ln(), (m + 1e-20).ln(), (mag[k + 1] + 1e-20).ln());
            let den = a - 2.0 * b + c;
            let off = if den != 0.0 { 0.5 * (a - c) / den } else { 0.0 };
            peaks.push(((k as f64 + off) * sr / size as f64, m));
        }
        let mut out = [0.0f64; 12];
        let mut pitch = vec![NO_PITCH; 128];
        let top = 10.0 * (peak + 1e-30).log10();
        for &(f, m) in peaks.iter() {
            let midi = 69.0 + 12.0 * (f / 440.0).log2();
            let r = midi.round();
            if (0.0..128.0).contains(&r) && (midi - r).abs() <= 0.4 {
                let v = (10.0 * (m + 1e-30).log10() - top) as f32;
                let p = &mut pitch[r as usize];
                *p = p.max(v);
            }
        }
        for &(f, m) in peaks.iter() {
            let midi = 69.0 + 12.0 * (f / 440.0).log2();
            if (midi - midi.round()).abs() > 0.3 {
                continue;
            }
            // A peak that is the 2nd–6th harmonic of a stronger lower peak mostly belongs to that
            // note. The 5th harmonic (a major third up two octaves) turns Em into Emaj7 if left in.
            let mut own = 1.0;
            for h in [2.0, 3.0, 4.0, 5.0, 6.0] {
                let sub = f / h;
                if peaks.iter().any(|&(qf, qm)| (1200.0 * (qf / sub).log2()).abs() < 35.0 && qm > m * 0.3) {
                    own *= if h == 2.0 || h == 4.0 { 0.6 } else { 0.2 };
                }
            }
            let pc = (midi.round() as i64).rem_euclid(12) as usize;
            out[pc] += m.sqrt() * own;
        }
        let mx = out.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if mx > 0.0 {
            let mut chroma = [0.0f32; 12];
            for i in 0..12 {
                chroma[i] = (out[i] / mx) as f32;
            }
            Some(ChromaFrame { chroma, pitch })
        } else {
            None
        }
    }
}
