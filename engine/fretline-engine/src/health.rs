//! What the player can see of the engine's inner workings without opening a log: how each device
//! stream keeps time, and a short list of events (streams opening, modes refused, the speakers
//! running dry, the buffer resizing, errors).
//!
//! Audio threads measure into a local `Timing` and hand it over with `try_lock`, so they never
//! wait; everything else here runs on the supervisor and analysis threads.

use crate::log;
use fretline_core::protocol::{EngineEvent, StreamHealth};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Timing of one stream's callbacks, accumulated between hand-overs.
#[derive(Clone, Copy, Debug, Default)]
pub struct Timing {
    pub calls: u64,
    pub late: u64,
    /// Worst gap between calls and worst time spent in one, since the last hand-over, ms.
    pub worst_gap_ms: f32,
    pub worst_work_ms: f32,
}

impl Timing {
    fn merge(&mut self, o: &Timing) {
        self.calls += o.calls;
        self.late += o.late;
        self.worst_gap_ms = self.worst_gap_ms.max(o.worst_gap_ms);
        self.worst_work_ms = self.worst_work_ms.max(o.worst_work_ms);
    }
}

/// Lives in an audio callback: times each call and hands the totals over when it can.
pub struct CallClock {
    late_after: Duration,
    last: Option<Instant>,
    local: Timing,
}

impl CallClock {
    pub fn new(period_ms: f32) -> Self {
        let period = Duration::from_secs_f32((period_ms / 1000.0).max(1e-4));
        Self { late_after: period + (period / 2).max(Duration::from_millis(1)), last: None, local: Timing::default() }
    }

    /// At the start of a call.
    pub fn begin(&mut self) -> Instant {
        let now = Instant::now();
        if let Some(last) = self.last {
            let gap = now - last;
            self.local.worst_gap_ms = self.local.worst_gap_ms.max(gap.as_secs_f32() * 1000.0);
            if gap > self.late_after {
                self.local.late += 1;
            }
        }
        self.last = Some(now);
        self.local.calls += 1;
        now
    }

    /// At the end of a call: records the work and hands everything over if the lock is free.
    pub fn end(&mut self, start: Instant, shared: &Mutex<Timing>) {
        let work = start.elapsed().as_secs_f32() * 1000.0;
        self.local.worst_work_ms = self.local.worst_work_ms.max(work);
        if let Ok(mut t) = shared.try_lock() {
            t.merge(&self.local);
            self.local = Timing::default();
        }
    }
}

/// The supervisor's view of one stream over the last 10 s.
#[derive(Default)]
pub struct StreamWatch {
    gaps: VecDeque<f32>,
    works: VecDeque<f32>,
    pub total: Timing,
    pub glitches: u64,
    pub restarts: u64,
    /// Totals already reported as events, and when the last report went out.
    reported_late: u64,
    reported_glitches: u64,
    reported_at: Option<Instant>,
}

const WATCH_TICKS: usize = 20;

impl StreamWatch {
    /// A new stream opened: its counters start over (restarts carry on).
    pub fn reset(&mut self) {
        *self = Self { restarts: self.restarts, ..Self::default() };
    }

    /// Takes what the audio thread handed over since the last tick.
    pub fn tick(&mut self, shared: &Mutex<Timing>, glitches: u64) {
        let t = std::mem::take(&mut *shared.lock().unwrap());
        self.total.calls += t.calls;
        self.total.late += t.late;
        self.gaps.push_back(t.worst_gap_ms);
        self.works.push_back(t.worst_work_ms);
        while self.gaps.len() > WATCH_TICKS {
            self.gaps.pop_front();
            self.works.pop_front();
        }
        self.glitches = glitches;
    }

    pub fn health(&self, period_ms: f32) -> StreamHealth {
        StreamHealth {
            period_ms,
            worst_gap_ms: self.gaps.iter().copied().fold(0.0, f32::max),
            worst_work_ms: self.works.iter().copied().fold(0.0, f32::max),
            late: self.total.late,
            glitches: self.glitches,
            restarts: self.restarts,
        }
    }

    /// New late calls and glitches since the last report, at most one report per 10 s so a
    /// jittery stretch reads as one line per 10 s rather than one per tick.
    pub fn news(&mut self) -> Option<(u64, u64)> {
        let late = self.total.late - self.reported_late;
        let glitches = self.glitches.saturating_sub(self.reported_glitches);
        if late + glitches == 0 || self.reported_at.is_some_and(|t| t.elapsed() < Duration::from_secs(10)) {
            return None;
        }
        self.reported_late = self.total.late;
        self.reported_glitches = self.glitches;
        self.reported_at = Some(Instant::now());
        Some((late, glitches))
    }
}

const KEEP: usize = 60;

/// Recent events, newest last. A repeat of the latest event from the same source counts up
/// instead of adding a line, so a retry loop reads as one line with a count.
#[derive(Default)]
pub struct Events {
    seq: u64,
    list: VecDeque<EngineEvent>,
}

pub type EventLog = Mutex<Events>;

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

impl Events {
    pub fn push(&mut self, level: &str, source: &str, text: String) {
        log!("[{level}] {source}: {text}");
        self.seq += 1;
        let at = now_ms();
        if let Some(e) = self.list.iter_mut().rev().find(|e| e.source == source) {
            if e.text == text && e.level == level {
                e.repeat += 1;
                e.at = at;
                e.seq = self.seq;
                return;
            }
        }
        self.list.push_back(EngineEvent { seq: self.seq, at, level: level.into(), source: source.into(), text, repeat: 1 });
        while self.list.len() > KEEP {
            self.list.pop_front();
        }
    }

    pub fn list(&self) -> Vec<EngineEvent> {
        self.list.iter().cloned().collect()
    }
}

pub fn event(log: &EventLog, level: &str, source: &str, text: String) {
    log.lock().unwrap().push(level, source, text);
}
