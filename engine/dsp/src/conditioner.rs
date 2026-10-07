//! Input conditioner: noise floor tracking, noise gate and automatic level, a direct port of the
//! web app's ConditionerCore so the engine and the browser behave the same.

use crate::util::{db, lin, soft_clip};

pub const TARGET_DB: f32 = -14.0;
pub const MAX_GAIN_DB: f32 = 24.0;
const OPEN_DB: f32 = 12.0;
const CLOSE_DB: f32 = 6.0;
const CAL_SEC: f32 = 0.4;
const FLOOR_SEC: f32 = 2.5;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ConditionerView {
    pub floor_db: f32,
    pub peak_db: f32,
    pub gain_db: f32,
    pub gate: bool,
}

pub struct Conditioner {
    sr: f32,
    hist: Vec<f32>,
    hist_n: usize,
    hist_i: usize,
    block: usize,
    acc: Vec<f32>,
    age: f32,
    floor_db: f32,
    peak_db: f32,
    gain_db: f32,
    gain_lin: f32,
    gate: bool,
    gate_gain: f32,
    hold: f32,
    attack_step: f32,
    release_step: f32,
    ext: Option<(f32, f32, f32)>,
}

impl Conditioner {
    pub fn new(sr: f32) -> Self {
        let block = 128;
        let block_sec = block as f32 / sr;
        Self {
            sr,
            hist: vec![0.0; (FLOOR_SEC / block_sec).ceil() as usize],
            hist_n: 0,
            hist_i: 0,
            block,
            acc: Vec::with_capacity(block),
            age: 0.0,
            floor_db: -80.0,
            peak_db: -100.0,
            gain_db: 0.0,
            gain_lin: 1.0,
            gate: false,
            gate_gain: 0.0,
            hold: 0.0,
            attack_step: 1.0 / (0.002 * sr),
            release_step: 1.0 / (0.12 * sr),
            ext: None,
        }
    }

    /// App-wide floor and gate margin from the web app's analysis tracker.
    pub fn set_floor(&mut self, floor_db: f32, open_db: f32) {
        self.ext = Some((floor_db, open_db, 0.0));
    }

    pub fn recalibrate(&mut self) {
        self.hist_n = 0;
        self.hist_i = 0;
        self.age = 0.0;
    }

    pub fn view(&self) -> ConditionerView {
        ConditionerView { floor_db: self.floor_db, peak_db: self.peak_db, gain_db: self.gain_db, gate: self.gate }
    }

    /// Processes in place. Level analysis runs on 128-sample blocks regardless of buffer size.
    pub fn process(&mut self, buf: &mut [f32]) {
        for x in buf.iter_mut() {
            self.acc.push(*x);
            if self.acc.len() == self.block {
                let (mut sum, mut pk) = (0.0f32, 0.0f32);
                for &v in &self.acc {
                    sum += v * v;
                    pk = pk.max(v.abs());
                }
                let n = self.acc.len() as f32;
                self.track(db((sum / n).sqrt()), db(pk), n / self.sr);
                self.acc.clear();
            }
            let target = if self.gate { 1.0 } else { 0.0 };
            if self.gate_gain < target {
                self.gate_gain = (self.gate_gain + self.attack_step).min(target);
            } else if self.gate_gain > target {
                self.gate_gain = (self.gate_gain - self.release_step).max(target);
            }
            *x = soft_clip(*x * self.gain_lin * self.gate_gain);
        }
    }

    fn track(&mut self, level: f32, peak: f32, dt: f32) {
        let len = self.hist.len();
        self.hist[self.hist_i] = level;
        self.hist_i = (self.hist_i + 1) % len;
        if self.hist_n < len {
            self.hist_n += 1;
        }
        let min = self.hist[..self.hist_n].iter().cloned().fold(f32::INFINITY, f32::min);
        let target = (min + 3.0).max(-110.0);
        self.age += dt;
        if self.age < CAL_SEC || target < self.floor_db {
            self.floor_db = target;
        } else {
            let rate = if self.gate { 0.2 } else { 1.5 };
            self.floor_db += (target - self.floor_db).min(rate * dt);
        }
        let (mut open, mut close) = (OPEN_DB, CLOSE_DB);
        if let Some((f, o, age)) = self.ext.as_mut() {
            *age += dt;
            if *age < 1.0 {
                self.floor_db = *f;
                open = *o;
                close = *o - (OPEN_DB - CLOSE_DB);
            }
        }
        if level > self.floor_db + open {
            self.gate = true;
            self.hold = 0.08;
        } else if level < self.floor_db + close {
            self.hold -= dt;
            if self.hold <= 0.0 {
                self.gate = false;
            }
        }
        if self.gate {
            self.peak_db = peak.max(self.peak_db - dt);
        } else {
            self.peak_db = (self.floor_db + open).max(self.peak_db);
        }
        let want = (TARGET_DB - self.peak_db).clamp(0.0, MAX_GAIN_DB);
        if want > self.gain_db {
            self.gain_db = want.min(self.gain_db + 6.0 * dt);
        } else {
            self.gain_db = want.max(self.gain_db - 30.0 * dt);
        }
        self.gain_lin = lin(self.gain_db);
    }
}
