//! Bridges two audio clocks. The guitar input and the speakers are different devices whose
//! sample clocks drift apart by a few hundred ppm (and may run at different nominal rates);
//! feeding one straight into the other would slowly overflow or starve the buffer between them.
//! This reader keeps a small target backlog and steers its read speed (fractional resampling)
//! so the backlog stays put: low, constant latency and no clicks.

use std::collections::VecDeque;

pub struct DriftReader {
    pending: VecDeque<f32>,
    pos: f64,
    target: f64,
    max_target: f64,
    /// Input samples per output sample at nominal rates (e.g. 44100 / 48000).
    nominal: f64,
    ratio: f64,
    /// Smoothed backlog, so the controller reacts to drift, not to block-size jitter.
    avg: f64,
    /// Waiting for the backlog to reach the target (at start and after an underrun).
    priming: bool,
    /// Number of times the output ran dry after playback had started.
    pub underruns: u64,
}

impl DriftReader {
    /// `target` is the backlog (input samples) to hold between input and output, typically about
    /// one input period plus a small margin.
    pub fn new(target: usize) -> Self {
        Self::with_rates(target, 1.0)
    }

    /// `nominal` = input rate / output rate.
    pub fn with_rates(target: usize, nominal: f64) -> Self {
        let t = target.max(1) as f64;
        Self {
            pending: VecDeque::with_capacity(16384),
            pos: 0.0,
            target: t,
            max_target: t,
            nominal,
            ratio: nominal,
            avg: t,
            priming: true,
            underruns: 0,
        }
    }

    /// Lets the target grow (by 25% per underrun) up to `max` when the devices turn out to be
    /// burstier than their periods suggest.
    pub fn allow_growth(&mut self, max: usize) {
        self.max_target = (max as f64).max(self.target);
    }

    pub fn target(&self) -> usize {
        self.target as usize
    }

    pub fn backlog(&self) -> usize {
        self.pending.len()
    }

    pub fn push(&mut self, samples: impl IntoIterator<Item = f32>) {
        self.pending.extend(samples);
        // Far too much backlog (e.g. after the output stalled): drop to the target at once.
        let max = (self.target * 4.0).max(256.0) as usize;
        if self.pending.len() > max {
            let drop = self.pending.len() - self.target as usize;
            self.pending.drain(..drop);
            self.pos = 0.0;
        }
    }

    /// Fills `out` from the backlog, resampling by the nominal ratio, corrected within ±0.5% to
    /// hold the target.
    pub fn read(&mut self, out: &mut [f32]) {
        if self.priming {
            if (self.pending.len() as f64) < self.target {
                out.fill(0.0);
                return;
            }
            self.priming = false;
            self.avg = self.pending.len() as f64;
        }
        let have = self.pending.len() as f64 - self.pos;
        self.avg += (have - self.avg) * 0.05;
        let err = (self.avg - self.target) / self.target.max(1.0);
        self.ratio = self.nominal * (1.0 + (err * 0.002).clamp(-0.005, 0.005));
        for o in out.iter_mut() {
            let i = self.pos.floor() as usize;
            if i + 1 >= self.pending.len() {
                // Starved: emit silence and re-prime (to a slightly larger target) before resuming.
                *o = 0.0;
                if !self.priming {
                    self.underruns += 1;
                    self.priming = true;
                    self.target = (self.target * 1.25).min(self.max_target);
                }
                continue;
            }
            let frac = (self.pos - i as f64) as f32;
            let a = self.pending[i];
            let b = self.pending[i + 1];
            *o = a + (b - a) * frac;
            self.pos += self.ratio;
        }
        let consumed = self.pos.floor() as usize;
        let consumed = consumed.min(self.pending.len());
        self.pending.drain(..consumed);
        self.pos -= consumed as f64;
    }
}
