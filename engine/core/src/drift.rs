//! Bridges two audio clocks. The guitar input and the speakers are different devices whose
//! sample clocks drift apart by a few hundred ppm (and may run at different nominal rates);
//! feeding one straight into the other would slowly overflow or starve the buffer between them.
//! This reader keeps a target backlog and steers its read speed (fractional resampling) so the
//! backlog stays put: low, constant latency and no clicks.
//!
//! The target is sized from measurement, not guessed. Before every read the reader knows how
//! much input has arrived and how much this read consumes, so it knows exactly how much backlog
//! that read needed: the read's consumption minus how far the backlog had dipped below its
//! average. The worst such need over the last 30 s (never less than the two block sizes imply),
//! plus a small margin, is the target. When the
//! timing gets worse the target rises at once, by the measured amount. When it improves the
//! target comes back down: quickly from the starting guess until the first underrun, then
//! by a twentieth of the excess per second, and never sooner than a minute after the last
//! underrun. Each underrun
//! also widens the margin for a while (Windows stalls tend to come back), and fades the sound
//! out and back in rather than cutting it.

use std::collections::VecDeque;

/// Window over which the worst need is kept, in one-second buckets.
const WINDOW: usize = 30;
/// No shrinking until this long after an underrun, seconds.
const HOLD_SEC: f64 = 60.0;
/// The margin goes back down one step after this long without an underrun, seconds.
const CALM_SEC: f64 = 120.0;
/// Shrink speed once calm: this part of the excess per second, at least `SHRINK` s per second.
const SHRINK_PART: f64 = 0.05;
const SHRINK: f64 = 0.00005;
/// Before the first underrun: shrink after this many seconds of measurement, this fast.
const SETTLE_SEC: usize = 3;
const SETTLE_SHRINK: f64 = 0.5;
/// Base safety margin over the measured need, seconds (at least `MIN_MARGIN` samples).
const MARGIN_SEC: f64 = 0.0005;
const MIN_MARGIN: f64 = 16.0;
/// The margin grows by the base margin per recent underrun, up to this many times the base.
const MAX_MARGIN_STEPS: u32 = 4;
/// Fade length around an underrun, samples.
const FADE: usize = 64;

/// What the reader has measured, for telemetry. Lengths are input samples.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DriftStats {
    pub target: usize,
    /// What the worst read of the window needed, before the margin.
    pub needed: usize,
    pub margin: usize,
    /// Least backlog left after a read in the window; negative when a read ran dry by that much.
    pub lowest: i64,
    pub max_target: usize,
    pub underruns: u64,
    /// The backlog piled up far past the target (the output stalled) and was cut back.
    pub overflows: u64,
    /// How much the latest underrun was short by.
    pub last_short: usize,
    /// Read speed correction, ppm: positive when the input clock runs fast against the output.
    pub drift_ppm: f32,
    /// The target wanted to be larger than `max_target`.
    pub limited: bool,
}

pub struct DriftReader {
    pending: VecDeque<f32>,
    pos: f64,
    target: f64,
    max_target: f64,
    /// Input samples per output sample at nominal rates (e.g. 44100 / 48000).
    nominal: f64,
    ratio: f64,
    ratio_avg: f64,
    /// Smoothed backlog, so the controller reacts to drift, not to block-size jitter.
    avg: f64,
    /// The backlog averaged over about a second: the level dips are measured from.
    level: f64,
    /// Waiting for the backlog to reach the target (at start and after an underrun).
    priming: bool,
    /// Output samples left in the fade-in after priming.
    fade_in: usize,
    /// After an underrun, until input arrives again: what the read that ran dry needed, plus the
    /// input samples' worth of time the output has waited since, i.e. how long the stall was.
    dry_base: f64,
    dry: f64,
    dry_counting: bool,
    /// Backlog at the end of the last read, to tell when new input has arrived.
    last_len: usize,
    /// Number of times the output ran dry after playback had started.
    pub underruns: u64,
    overflows: u64,
    last_short: usize,
    limited: bool,
    rate: f64,
    base_margin: f64,
    /// Recent underruns, each widening the margin; one is forgiven per `CALM_SEC`.
    recent: u32,
    /// Input samples consumed since the last underrun, and since the margin last stepped down.
    calm: f64,
    since_forgive: f64,
    /// Worst need and least slack per one-second bucket.
    needs: [f64; WINDOW],
    slacks: [f64; WINDOW],
    filled: usize,
    head: usize,
    bucket_need: f64,
    bucket_slack: f64,
    bucket_fill: f64,
    largest_push: usize,
    largest_read: usize,
}

impl DriftReader {
    /// `target` is the starting backlog (input samples) to hold between input and output; it
    /// adapts from there.
    pub fn new(target: usize) -> Self {
        Self::with_rates(target, 1.0)
    }

    /// `nominal` = input rate / output rate.
    pub fn with_rates(target: usize, nominal: f64) -> Self {
        let t = target.max(1) as f64;
        let mut r = Self {
            pending: VecDeque::with_capacity(16384),
            pos: 0.0,
            target: t,
            max_target: t * 8.0,
            nominal,
            ratio: nominal,
            ratio_avg: nominal,
            avg: t,
            level: t,
            priming: true,
            fade_in: 0,
            dry_base: 0.0,
            dry: 0.0,
            dry_counting: false,
            last_len: 0,
            underruns: 0,
            overflows: 0,
            last_short: 0,
            limited: false,
            rate: 0.0,
            base_margin: 0.0,
            recent: 0,
            calm: 0.0,
            since_forgive: 0.0,
            needs: [0.0; WINDOW],
            slacks: [0.0; WINDOW],
            filled: 0,
            head: 0,
            bucket_need: 0.0,
            bucket_slack: f64::INFINITY,
            bucket_fill: 0.0,
            largest_push: 0,
            largest_read: 0,
        };
        r.set_input_rate(48000.0);
        r
    }

    /// The input's sample rate, which sets the margin and the measurement windows (48 kHz until
    /// told otherwise).
    pub fn set_input_rate(&mut self, rate: f64) {
        self.rate = rate.max(1.0);
        self.base_margin = (MARGIN_SEC * self.rate).max(MIN_MARGIN);
    }

    /// The largest target allowed, input samples.
    pub fn allow_growth(&mut self, max: usize) {
        self.max_target = (max as f64).max(self.target);
    }

    pub fn target(&self) -> usize {
        self.target as usize
    }

    pub fn backlog(&self) -> usize {
        self.pending.len()
    }

    fn margin(&self) -> f64 {
        self.base_margin * (1 + self.recent.min(MAX_MARGIN_STEPS)) as f64
    }

    pub fn stats(&self) -> DriftStats {
        let (need, slack) = self.window();
        DriftStats {
            target: self.target as usize,
            needed: need.max(0.0) as usize,
            margin: self.margin() as usize,
            lowest: if slack.is_finite() { slack.floor() as i64 } else { self.target as i64 },
            max_target: self.max_target as usize,
            underruns: self.underruns,
            overflows: self.overflows,
            last_short: self.last_short,
            drift_ppm: ((self.ratio_avg / self.nominal - 1.0) * 1e6) as f32,
            limited: self.limited,
        }
    }

    /// Worst need and least slack over the window, including the bucket in progress. The need
    /// is never below what perfectly steady devices would need at their worst relative phase (a
    /// read just before a burst arrives), which the window may not have caught yet when the two
    /// clocks drift past each other slowly.
    fn window(&self) -> (f64, f64) {
        let (p, r) = (self.largest_push as f64, self.largest_read as f64);
        let mut need = self.bucket_need.max(r + 1.0 + (p + r) / 2.0);
        let mut slack = self.bucket_slack;
        for i in 0..self.filled {
            need = need.max(self.needs[i]);
            slack = slack.min(self.slacks[i]);
        }
        (need, slack)
    }

    pub fn push(&mut self, samples: impl IntoIterator<Item = f32>) {
        let before = self.pending.len();
        self.pending.extend(samples);
        self.largest_push = self.largest_push.max(self.pending.len() - before);
        // Far too much backlog (e.g. after the output stalled): drop to the target at once.
        let max = (self.target * 4.0).max(self.target + 4.0 * (self.largest_push + self.largest_read) as f64).max(512.0) as usize;
        if self.pending.len() > max {
            let drop = self.pending.len() - self.target as usize;
            self.pending.drain(..drop);
            self.pos = 0.0;
            self.avg = self.target;
            self.level = self.target;
            self.overflows += 1;
        }
    }

    /// Sets the target to `want`, within the allowed range.
    fn set_target(&mut self, want: f64) {
        self.limited = want > self.max_target;
        self.target = want.clamp(1.0, self.max_target);
    }

    /// Fills `out` from the backlog, resampling by the nominal ratio, corrected within ±0.5% to
    /// hold the target.
    pub fn read(&mut self, out: &mut [f32]) {
        let n = out.len();
        if n == 0 {
            return;
        }
        self.largest_read = self.largest_read.max((n as f64 * self.nominal).ceil() as usize);
        let have = self.pending.len() as f64 - self.pos;
        // Input samples a read at `ratio` reaches: the last output sample interpolates two.
        let reach = |ratio: f64, pos: f64| (pos + (n - 1) as f64 * ratio).floor() + 2.0 - pos;
        if self.priming {
            if self.dry_counting {
                if self.pending.len() > self.last_len {
                    self.dry_counting = false;
                } else {
                    // Still nothing new: the stall is at least this long.
                    self.dry += n as f64 * self.nominal;
                    let stall = self.dry_base + self.dry;
                    self.bucket_need = self.bucket_need.max(stall);
                    self.set_target(self.target.max(stall + self.margin()));
                }
            }
            self.last_len = self.pending.len();
            if have < self.target.max(reach(self.ratio, self.pos)) {
                out.fill(0.0);
                self.tick(n as f64 * self.nominal);
                return;
            }
            self.priming = false;
            self.avg = have;
            self.level = have;
            self.fade_in = FADE;
        }
        self.avg += (have - self.avg) * 0.05;
        let err = (self.avg - self.target) / self.target.max(1.0);
        self.ratio = self.nominal * (1.0 + (err * 0.005).clamp(-0.005, 0.005));
        self.ratio_avg += (self.ratio - self.ratio_avg) * 0.01;
        let need = reach(self.ratio, self.pos);
        // The backlog this read needed if the average sat at the target: what it consumes, plus
        // how far the backlog had dipped below its average. The average is a slow one, so a stall
        // of a few milliseconds shows in full rather than dragging the average down with it.
        let needed = (need + self.level - have).max(0.0);
        self.level += (have - self.level) * (n as f64 * self.nominal / self.rate).min(1.0);
        self.bucket_need = self.bucket_need.max(needed);
        self.bucket_slack = self.bucket_slack.min(have - need);

        if have < need {
            self.underrun(out, need - have, needed);
        } else {
            for o in out.iter_mut() {
                let i = self.pos.floor() as usize;
                let frac = (self.pos - i as f64) as f32;
                let a = self.pending[i];
                let b = self.pending[i + 1];
                let mut v = a + (b - a) * frac;
                if self.fade_in > 0 {
                    v *= 1.0 - self.fade_in as f32 / FADE as f32;
                    self.fade_in -= 1;
                }
                *o = v;
                self.pos += self.ratio;
            }
        }
        let consumed = (self.pos.floor() as usize).min(self.pending.len());
        self.pending.drain(..consumed);
        self.pos -= consumed as f64;
        self.last_len = self.pending.len();
        self.tick((n as f64 * self.nominal).max(consumed as f64));
    }

    /// The backlog ran dry `short` samples before the end of this read: play what there is,
    /// fading out, then size the target to what the read needed and prime again.
    fn underrun(&mut self, out: &mut [f32], short: f64, needed: f64) {
        let mut played = 0;
        for o in out.iter_mut() {
            let i = self.pos.floor() as usize;
            if i + 1 >= self.pending.len() {
                break;
            }
            let frac = (self.pos - i as f64) as f32;
            let a = self.pending[i];
            let b = self.pending[i + 1];
            *o = a + (b - a) * frac;
            self.pos += self.ratio;
            played += 1;
        }
        let fade = played.min(FADE);
        for (k, o) in out[played - fade..played].iter_mut().enumerate() {
            *o *= 1.0 - (k + 1) as f32 / fade as f32;
        }
        out[played..].fill(0.0);
        self.underruns += 1;
        self.last_short = short.ceil() as usize;
        self.recent = (self.recent + 1).min(MAX_MARGIN_STEPS);
        self.calm = 0.0;
        self.since_forgive = 0.0;
        self.priming = true;
        self.dry_base = needed;
        self.dry = 0.0;
        self.dry_counting = true;
        let want = self.target.max(needed + self.margin());
        self.set_target(want);
    }

    /// Bookkeeping per read: `samples` = input samples' worth of time this read covered.
    fn tick(&mut self, samples: f64) {
        self.calm += samples;
        self.since_forgive += samples;
        if self.recent > 0 && self.calm >= CALM_SEC * self.rate && self.since_forgive >= CALM_SEC * self.rate {
            self.recent -= 1;
            self.since_forgive = 0.0;
        }
        self.bucket_fill += samples;
        if self.bucket_fill < self.rate {
            return;
        }
        // A second has passed: close the bucket and resize.
        self.bucket_fill -= self.rate;
        self.needs[self.head] = self.bucket_need;
        self.slacks[self.head] = self.bucket_slack;
        self.head = (self.head + 1) % WINDOW;
        self.filled = (self.filled + 1).min(WINDOW);
        self.bucket_need = 0.0;
        self.bucket_slack = f64::INFINITY;
        let (need, _) = self.window();
        let want = need + self.margin();
        if want > self.target {
            // Timing got worse without running dry yet: grow by the measured amount now.
            self.set_target(want);
        } else if self.underruns == 0 && self.filled >= SETTLE_SEC {
            // Never ran dry: the starting guess was generous, settle quickly.
            self.set_target((self.target - ((self.target - want) * SETTLE_SHRINK).max(SHRINK * self.rate)).max(want));
        } else if self.calm >= HOLD_SEC * self.rate {
            self.set_target((self.target - ((self.target - want) * SHRINK_PART).max(SHRINK * self.rate)).max(want));
        } else {
            self.limited = want > self.max_target;
        }
    }
}
