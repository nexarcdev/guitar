//! The app-wide noise floor. One estimate drives everything that needs to tell playing from
//! background noise: the tracker's gate, the monitored path's auto level and gate, and the ML
//! pass's silence skipping.
//!
//! Auto: the 20th percentile of frame levels over the last 5 s. A percentile, not the minimum: the
//! single quietest moment of steady noise sits several dB below its typical level, and a floor
//! that low lets ordinary noise open the gate during long pauses. It calibrates quickly, then
//! drops at once to quieter noise but rises slowly, so minutes of strumming can't lift it.
//!
//! Recalibrate: forget everything and measure afresh for 1.5 s (strings muted), e.g. when the
//! app started while a string was still ringing.
//!
//! Manual: a fixed floor chosen by the player; the automatic estimate keeps running for display.

use serde::{Deserialize, Serialize};

const FLOOR_SEC: f64 = 5.0;
const FLOOR_PCT: f64 = 0.2;
/// Calibration after a start or device switch.
const CAL_SEC: f64 = 0.4;
/// Calibration the player asked for (strings muted on purpose): long enough to be robust.
pub const RECAL_SEC: f64 = 1.5;
/// Rise rates (dB/s) while playing and while idle.
const RISE_PLAYING: f64 = 0.2;
const RISE_IDLE: f64 = 1.5;
pub const MIN_DB: f32 = -110.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum FloorMode {
    #[default]
    Auto,
    Manual,
}

pub struct NoiseFloor {
    hist: Vec<f32>,
    sorted: Vec<f32>,
    hist_n: usize,
    hist_i: usize,
    target: f32,
    estimate: f64,
    age: f64,
    cal: f64,
    /// Calibration was requested by the player (shown as progress).
    explicit: bool,
    dt: f64,
    pub mode: FloorMode,
    pub manual_db: f32,
}

impl NoiseFloor {
    /// `dt` = seconds between level readings.
    pub fn new(dt: f64) -> Self {
        let n = (FLOOR_SEC / dt).ceil() as usize;
        Self {
            hist: vec![0.0; n],
            sorted: vec![0.0; n],
            hist_n: 0,
            hist_i: 0,
            target: -80.0,
            estimate: -80.0,
            age: 0.0,
            cal: CAL_SEC,
            explicit: false,
            dt,
            mode: FloorMode::Auto,
            manual_db: -70.0,
        }
    }

    /// Start a fresh baseline: `explicit` when the player asked (longer, shown as progress).
    pub fn recalibrate(&mut self, explicit: bool) {
        self.hist_n = 0;
        self.hist_i = 0;
        self.age = 0.0;
        self.cal = if explicit { RECAL_SEC } else { CAL_SEC };
        self.explicit = explicit;
    }

    /// Feeds one level reading (dBFS); `gate` = currently playing.
    pub fn push(&mut self, level: f32, gate: bool) {
        let len = self.hist.len();
        self.hist[self.hist_i] = level;
        self.hist_i = (self.hist_i + 1) % len;
        if self.hist_n < len {
            self.hist_n += 1;
        }
        // The percentile moves slowly; re-sorting every 4th reading is plenty.
        if self.hist_n < 8 || self.hist_i & 3 == 0 {
            let n = self.hist_n;
            self.sorted[..n].copy_from_slice(&self.hist[..n]);
            self.sorted[..n].sort_by(f32::total_cmp);
            self.target = self.sorted[((n - 1) as f64 * FLOOR_PCT).floor() as usize].max(MIN_DB);
        }
        let target = self.target as f64;
        self.age += self.dt;
        if self.age < self.cal || target < self.estimate {
            self.estimate = target;
        } else {
            self.estimate += (target - self.estimate).min((if gate { RISE_PLAYING } else { RISE_IDLE }) * self.dt);
        }
        if self.explicit && self.age >= self.cal {
            self.explicit = false;
        }
    }

    /// The floor in force (manual or automatic), dBFS.
    pub fn db(&self) -> f32 {
        match self.mode {
            FloorMode::Auto => self.estimate as f32,
            FloorMode::Manual => self.manual_db,
        }
    }

    /// The automatic estimate, whatever the mode.
    pub fn measured_db(&self) -> f32 {
        self.estimate as f32
    }

    /// Progress (0–1) of a calibration the player asked for, if one is running.
    pub fn measuring(&self) -> Option<f32> {
        (self.explicit && self.age < self.cal).then(|| (self.age / self.cal) as f32)
    }
}
