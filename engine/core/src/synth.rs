//! The app's own sounds: plucked strings for strums, string previews and riff playback, and a
//! sine reference tone for tuning. Notes are scheduled in groups (a strum, a riff) on the
//! synth's sample clock and a group can be stopped as a whole.

use crate::util::Biquad;
use std::collections::VecDeque;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum VoiceKind {
    /// Triangle plus a little band-limited saw through a closing low-pass: a soft pick.
    #[default]
    Pluck,
    /// Pure sine with a held body: something to tune against.
    Reference,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NoteSpec {
    /// Seconds after the group starts.
    pub at: f64,
    pub hz: f64,
    /// Seconds until the note has died away.
    pub dur: f64,
    #[serde(default)]
    pub voice: VoiceKind,
}

const MAX_VOICES: usize = 48;
const PLUCK_PEAK: f32 = 0.16;
const REF_PEAK: f32 = 0.2;
/// Time to fade to silence (-80 dB) when a group is stopped early.
const STOP_SEC: f64 = 0.025;

struct Voice {
    group: u32,
    kind: VoiceKind,
    hz: f64,
    dur: f64,
    /// Sample (synth clock) at which it starts.
    start: u64,
    phase: f64,
    lp: Biquad,
    /// Release: gain multiplier per sample once stopped.
    release: Option<f32>,
    rel_gain: f32,
}

pub struct Synth {
    sr: f64,
    now: u64,
    voices: Vec<Voice>,
    /// Upcoming notes, kept sorted by start, so long riffs don't occupy voices early.
    queue: VecDeque<Voice>,
}

/// PolyBLEP residual for a band-limited saw.
#[inline]
fn blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let t = t / dt;
        t + t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

impl Synth {
    pub fn new(sample_rate: f64) -> Self {
        Self { sr: sample_rate, now: 0, voices: Vec::with_capacity(MAX_VOICES), queue: VecDeque::new() }
    }

    pub fn active(&self) -> bool {
        !self.voices.is_empty() || !self.queue.is_empty()
    }

    /// Schedules a group of notes starting `lead` seconds from now.
    pub fn play(&mut self, group: u32, notes: &[NoteSpec], lead: f64) {
        for n in notes {
            if !(n.hz > 0.0 && n.hz < self.sr / 2.0 && n.dur > 0.0 && n.at >= 0.0) {
                continue;
            }
            let start = self.now + ((lead + n.at) * self.sr).round() as u64;
            let mut lp = Biquad::default();
            lp.set_lowpass(self.sr as f32, (n.hz * 7.0).min(self.sr * 0.45) as f32, 0.707);
            let v = Voice { group, kind: n.voice, hz: n.hz, dur: n.dur, start, phase: 0.0, lp, release: None, rel_gain: 1.0 };
            let at = self.queue.partition_point(|q| q.start <= start);
            self.queue.insert(at, v);
        }
    }

    /// Fades out a group (or everything, with `None`) within 25 ms and drops its pending notes.
    pub fn stop(&mut self, group: Option<u32>) {
        let hit = |g: u32| group.map_or(true, |x| x == g);
        self.queue.retain(|v| !hit(v.group));
        let k = (1e-4f64.ln() / (STOP_SEC * self.sr)).exp() as f32;
        for v in self.voices.iter_mut().filter(|v| hit(v.group)) {
            v.release.get_or_insert(k);
        }
    }

    /// Adds the synth's sound to `out`.
    pub fn render(&mut self, out: &mut [f32]) {
        let n = out.len() as u64;
        let end = self.now + n;
        while self.queue.front().is_some_and(|v| v.start < end) {
            let v = self.queue.pop_front().unwrap();
            if self.voices.len() >= MAX_VOICES {
                // Steal the oldest voice.
                self.voices.remove(0);
            }
            self.voices.push(v);
        }
        let sr = self.sr;
        let now = self.now;
        self.voices.retain_mut(|v| {
            let tail = v.dur + 0.05;
            let from = v.start.saturating_sub(now) as usize;
            let dt = v.hz / sr;
            for (i, o) in out.iter_mut().enumerate().skip(from) {
                let t = (now + i as u64 - v.start) as f64 / sr;
                if t >= tail {
                    return false;
                }
                let s = match v.kind {
                    VoiceKind::Pluck => {
                        // Every 32 samples, glide the low-pass from 7× to 1.4× the fundamental.
                        if (now + i as u64 - v.start) % 32 == 0 {
                            let f = v.hz * 7.0 * (1.4f64 / 7.0).powf((t / v.dur).min(1.0));
                            v.lp.set_lowpass(sr as f32, f.min(sr * 0.45) as f32, 0.707);
                        }
                        let p = v.phase;
                        let tri = 1.0 - 4.0 * (p - 0.5).abs();
                        let saw = 2.0 * p - 1.0 - blep(p, dt);
                        let x = (tri + 0.25 * saw) as f32;
                        let g = if t < 0.006 {
                            PLUCK_PEAK * (t / 0.006) as f32
                        } else {
                            PLUCK_PEAK * (0.0001f64 / PLUCK_PEAK as f64).powf(((t - 0.006) / (v.dur - 0.006).max(1e-3)).min(1.2)) as f32
                        };
                        v.lp.process(x) * g
                    }
                    VoiceKind::Reference => {
                        // 20 ms fade in, held, then a 0.6 s fade out at the end.
                        let hold = (v.dur - 0.6).max(0.05);
                        let g = if t < 0.02 {
                            REF_PEAK * (t / 0.02) as f32
                        } else if t < hold {
                            REF_PEAK
                        } else {
                            REF_PEAK * (0.0001f64 / REF_PEAK as f64).powf(((t - hold) / 0.6).min(1.2)) as f32
                        };
                        (2.0 * std::f64::consts::PI * v.phase).sin() as f32 * g
                    }
                };
                v.phase += dt;
                if v.phase >= 1.0 {
                    v.phase -= 1.0;
                }
                let s = if let Some(k) = v.release {
                    v.rel_gain *= k;
                    if v.rel_gain < 1e-4 {
                        return false;
                    }
                    s * v.rel_gain
                } else {
                    s
                };
                *o += s;
            }
            true
        });
        self.now = end;
    }
}
