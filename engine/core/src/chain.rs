//! The full monitored signal path: input conditioner → pedals (in the player's order, each with a
//! click-free 10 ms on/off fade) → looper → master (Output on/off). Runs on the audio thread;
//! all changes arrive as `Command`s applied at the start of a block.

use crate::conditioner::{Conditioner, ConditionerView};
use crate::looper::{Looper, LooperView};
use crate::pedals::{Pedal, PedalKind};
use crate::util::{soft_clip, Ramp};

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PedalSetting {
    pub kind: PedalKind,
    pub on: bool,
    pub level: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    /// Full pedalboard in signal order.
    Pedals(Vec<PedalSetting>),
    Output(bool),
    LoopTap(usize),
    LoopStop(usize),
    LoopClear(usize),
    /// App-wide noise floor and gate margin from the web app.
    Floor { floor_db: f32, open_db: f32 },
    /// Round-trip latency in samples, for overdub alignment.
    Latency(usize),
    Recalibrate,
}

struct Slot {
    kind: PedalKind,
    pedal: Pedal,
    level: f32,
    mix: Ramp,
}

pub struct Chain {
    sr: f32,
    cond: Conditioner,
    slots: Vec<Slot>,
    looper: Looper,
    master: Ramp,
}

impl Chain {
    pub fn new(sr: f32) -> Self {
        let slots = PedalKind::ALL
            .iter()
            .map(|&k| Slot { kind: k, pedal: Pedal::new(k, sr), level: 50.0, mix: Ramp::new(0.0, 0.01, sr) })
            .collect();
        Self { sr, cond: Conditioner::new(sr), slots, looper: Looper::new(sr, 60.0), master: Ramp::new(0.0, 0.02, sr) }
    }

    pub fn apply(&mut self, cmd: Command) {
        match cmd {
            Command::Pedals(list) => {
                // Reorder to match the board; unknown/missing pedals keep their state at the end.
                let mut ordered = Vec::with_capacity(self.slots.len());
                for p in &list {
                    if let Some(pos) = self.slots.iter().position(|s| s.kind == p.kind) {
                        let mut s = self.slots.remove(pos);
                        s.level = p.level.clamp(0.0, 100.0);
                        s.mix.target = if p.on { 1.0 } else { 0.0 };
                        ordered.push(s);
                    }
                }
                ordered.append(&mut self.slots);
                self.slots = ordered;
            }
            Command::Output(on) => self.master.target = if on { 1.0 } else { 0.0 },
            Command::LoopTap(i) => self.looper.tap(i),
            Command::LoopStop(i) => self.looper.stop(i),
            Command::LoopClear(i) => self.looper.clear(i),
            Command::Floor { floor_db, open_db } => self.cond.set_floor(floor_db, open_db),
            Command::Latency(n) => self.looper.latency = n,
            Command::Recalibrate => self.cond.recalibrate(),
        }
    }

    pub fn output_on(&self) -> bool {
        self.master.target > 0.0
    }

    /// Processes a mono block in place: `buf` holds the guitar on entry, the speaker signal on exit.
    pub fn process(&mut self, buf: &mut [f32]) {
        self.cond.process(buf);
        // Output off and faded out: nothing here is audible, so skip the pedals and looper.
        // (The conditioner keeps running so the auto level is settled when Output comes on.)
        if self.master.target == 0.0 && self.master.idle() {
            buf.fill(0.0);
            return;
        }
        let sr = self.sr;
        for x in buf.iter_mut() {
            let mut y = *x;
            for s in self.slots.iter_mut() {
                let m = s.mix.next();
                if m > 0.0 {
                    let w = s.pedal.process(y, s.level, sr);
                    y += (w - y) * m;
                }
            }
            y += self.looper.process(y);
            *x = soft_clip(y) * self.master.next();
        }
    }

    pub fn conditioner(&self) -> ConditionerView {
        self.cond.view()
    }

    pub fn looper(&self) -> LooperView {
        self.looper.view()
    }
}
