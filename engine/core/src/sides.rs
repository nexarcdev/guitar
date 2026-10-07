//! The working halves of a channel, each meant for one thread or realm:
//!
//! * `AudioSide`: the monitored guitar (conditioner, pedals, looper) plus the synth, on the
//!   real-time audio thread (engine render callback, or the browser's AudioWorklet).
//! * `Capture`: the listening clock and fixed-size analysis chunks, wherever the input arrives.
//! * `TrackerSide`: tuner, chroma and fast onsets (engine analysis thread, or a browser worker).
//! * `MlSide`: basic-pitch around an inference runtime supplied by the host.
//!
//! They are driven by commands that `Session` derives from client messages, so every host
//! behaves the same; hosts only move audio and messages between them.

use crate::chain::{Chain, Command, PedalSetting};
use crate::looper::SLOTS;
use crate::ml::{MlNotes, MlStream, MlWindow};
use crate::protocol::{Analysis, FloorSetting, LoopCmd, LooperMsg, Meters, SlotMsg};
use crate::synth::{NoteSpec, Synth};
use crate::tracker::Tracker;
use serde::{Deserialize, Serialize};

/// Samples per analysis chunk.
pub const CHUNK: usize = 1024;
/// Default synth lead: notes are scheduled this far ahead so they start on time.
pub const SYNTH_LEAD: f64 = 0.05;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AudioCmd {
    Pedals { pedals: Vec<PedalSetting> },
    Output { on: bool },
    Loop { cmd: LoopCmd, slot: usize },
    /// The app-wide noise floor and gate margin, from the tracker.
    Level { floor_db: f32, open_db: f32 },
    /// Round trip in samples, so overdubs line up with what the player heard.
    Latency { samples: usize },
    /// New input: let the auto level settle afresh.
    Recalibrate,
    Play { group: u32, notes: Vec<NoteSpec>, lead: f64 },
    Stop { group: Option<u32> },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ListenCmd {
    Gate { db: f32 },
    Floor { setting: FloorSetting },
    /// `explicit`: the player asked (strings muted); otherwise a new device.
    Recalibrate { explicit: bool },
    Ml { on: bool },
    /// New input device: fresh timeline and baseline.
    Reset,
}

pub struct AudioSide {
    sr: f32,
    chain: Chain,
    synth: Synth,
    peak: f32,
}

impl AudioSide {
    pub fn new(sample_rate: f32) -> Self {
        Self { sr: sample_rate, chain: Chain::new(sample_rate), synth: Synth::new(sample_rate as f64), peak: 0.0 }
    }

    pub fn sample_rate(&self) -> f32 {
        self.sr
    }

    pub fn apply(&mut self, cmd: AudioCmd) {
        match cmd {
            AudioCmd::Pedals { pedals } => self.chain.apply(Command::Pedals(pedals)),
            AudioCmd::Output { on } => self.chain.apply(Command::Output(on)),
            AudioCmd::Loop { cmd, slot } => self.chain.apply(match cmd {
                LoopCmd::Tap => Command::LoopTap(slot),
                LoopCmd::Stop => Command::LoopStop(slot),
                LoopCmd::Clear => Command::LoopClear(slot),
            }),
            AudioCmd::Level { floor_db, open_db } => self.chain.apply(Command::Floor { floor_db, open_db }),
            AudioCmd::Latency { samples } => self.chain.apply(Command::Latency(samples)),
            AudioCmd::Recalibrate => self.chain.apply(Command::Recalibrate),
            AudioCmd::Play { group, notes, lead } => self.synth.play(group, &notes, lead),
            AudioCmd::Stop { group } => self.synth.stop(group),
        }
    }

    /// `buf` holds the guitar on entry and what goes to the speakers on exit.
    pub fn process(&mut self, buf: &mut [f32]) {
        self.chain.process(buf);
        self.synth.render(buf);
        for &v in buf.iter() {
            self.peak = self.peak.max(v.abs());
        }
    }

    /// The synth has notes playing or scheduled (an exclusive output must stay open for them).
    pub fn synth_active(&self) -> bool {
        self.synth.active()
    }

    /// Fills `m` without allocating once its slot list exists; resets the output peak.
    pub fn meters_into(&mut self, m: &mut Meters) {
        let lv = self.chain.looper();
        m.gain_db = self.chain.conditioner().gain_db;
        m.out_db = m.out_db.max(20.0 * (self.peak + 1e-9).log10());
        self.peak = 0.0;
        m.looper.len = lv.len;
        m.looper.free = lv.free;
        m.looper.rate = lv.rate;
        if m.looper.slots.len() != SLOTS {
            m.looper.slots = vec![SlotMsg::default(); SLOTS];
        }
        for (s, (state, progress)) in m.looper.slots.iter_mut().zip(lv.slots.iter()) {
            if s.state != state.name() {
                s.state = state.name().to_string();
            }
            s.progress = *progress;
        }
    }

    pub fn meters(&mut self) -> Meters {
        let mut m = Meters { out_db: -120.0, looper: LooperMsg::default(), ..Default::default() };
        self.meters_into(&mut m);
        m
    }
}

/// The listening clock: counts input samples only while someone listens, and cuts the input
/// into fixed chunks stamped with it, so pausing collapses cleanly in every timestamp.
pub struct Capture {
    pub listening: bool,
    clock: u64,
    buf: Vec<f32>,
}

impl Default for Capture {
    fn default() -> Self {
        Self { listening: true, clock: 0, buf: Vec::with_capacity(CHUNK) }
    }
}

impl Capture {
    /// Continue from another clock (e.g. when a different source takes over) without a jump back.
    pub fn continue_from(&mut self, at: u64) {
        self.clock = self.clock.max(at);
        self.buf.clear();
    }

    pub fn clock(&self) -> u64 {
        self.clock
    }

    pub fn push(&mut self, data: &[f32], mut chunk: impl FnMut(u64, &[f32])) {
        if !self.listening {
            return;
        }
        for &v in data {
            self.buf.push(v);
            if self.buf.len() == CHUNK {
                chunk(self.clock, &self.buf);
                self.clock += CHUNK as u64;
                self.buf.clear();
            }
        }
    }
}

pub struct TrackerSide {
    tracker: Tracker,
}

impl TrackerSide {
    pub fn new(sample_rate: f64) -> Self {
        Self { tracker: Tracker::new(sample_rate) }
    }

    pub fn apply(&mut self, cmd: &ListenCmd) {
        match cmd {
            ListenCmd::Gate { db } => self.tracker.set_open_db(*db),
            ListenCmd::Floor { setting } => {
                self.tracker.floor.mode = setting.mode;
                self.tracker.floor.manual_db = setting.manual_db;
            }
            ListenCmd::Recalibrate { explicit } => self.tracker.recalibrate(*explicit),
            ListenCmd::Reset => self.tracker.recalibrate(false),
            ListenCmd::Ml { .. } => {}
        }
    }

    pub fn push(&mut self, t0: u64, data: &[f32]) -> Analysis {
        let out = self.tracker.push(t0, data);
        Analysis { clock: (t0 + data.len() as u64) as f64 / self.tracker.sample_rate(), out }
    }

    /// The floor and gate margin in force, for `AudioCmd::Level` and `MlSide::set_floor`.
    pub fn level(&self) -> (f32, f32) {
        (self.tracker.floor.db(), self.tracker.open_db())
    }
}

pub struct MlSide {
    stream: MlStream,
    pub on: bool,
}

impl MlSide {
    pub fn new(sample_rate: f64) -> Self {
        Self { stream: MlStream::new(sample_rate), on: true }
    }

    pub fn apply(&mut self, cmd: &ListenCmd) {
        match cmd {
            ListenCmd::Ml { on } => {
                self.on = *on;
                if !on {
                    self.stream.reset();
                }
            }
            ListenCmd::Reset => self.stream.reset(),
            _ => {}
        }
    }

    pub fn set_floor(&mut self, floor_db: f32, open_db: f32) {
        self.stream.set_floor(floor_db, open_db);
    }

    pub fn push(&mut self, t0: u64, data: &[f32]) {
        if self.on {
            self.stream.push(t0, data);
        }
    }

    pub fn next_window(&mut self) -> Option<MlWindow> {
        if self.on { self.stream.next_window() } else { None }
    }

    pub fn decode(&self, w: &MlWindow, frames: &[f32], onsets: &[f32]) -> MlNotes {
        self.stream.decode(w, frames, onsets)
    }

    /// True once inference has been too slow to keep up for several windows.
    pub fn note_inference(&mut self, seconds: f64) -> bool {
        self.stream.note_inference(seconds)
    }
}
