//! Four-slot synced looper, a mono port of the web app's LooperCore (same states and semantics):
//! the first recording sets the loop length, other slots record exactly one cycle aligned to the
//! shared phase, a playing slot can overdub, and overdubs are written behind the playhead by the
//! round-trip latency so they line up with what the player heard.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotState {
    Empty,
    Recording,
    Playing,
    Overdubbing,
    Stopped,
}

impl SlotState {
    pub fn name(self) -> &'static str {
        match self {
            SlotState::Empty => "empty",
            SlotState::Recording => "recording",
            SlotState::Playing => "playing",
            SlotState::Overdubbing => "overdubbing",
            SlotState::Stopped => "stopped",
        }
    }
}

pub const SLOTS: usize = 4;

struct Slot {
    state: SlotState,
    buf: Vec<f32>,
    written: usize,
}

pub struct LooperView {
    pub len: usize,
    pub free: bool,
    pub rate: f32,
    pub slots: [(SlotState, f32); SLOTS],
}

pub struct Looper {
    sr: f32,
    max_samples: usize,
    slots: [Slot; SLOTS],
    len: usize,
    phase: usize,
    master: Option<usize>,
    pub latency: usize,
}

impl Looper {
    pub fn new(sr: f32, max_seconds: f32) -> Self {
        Self {
            sr,
            max_samples: (sr * max_seconds) as usize,
            slots: std::array::from_fn(|_| Slot { state: SlotState::Empty, buf: Vec::new(), written: 0 }),
            len: 0,
            phase: 0,
            master: None,
            latency: 0,
        }
    }

    /// Allocates outside the audio thread where possible: called from the command handler, which
    /// runs at the start of a block (a 60 s buffer is ~11 MB, allocated once per new recording).
    pub fn tap(&mut self, i: usize) {
        if i >= SLOTS {
            return;
        }
        if let Some(m) = self.master {
            if m != i {
                self.close_master();
            }
        }
        let s = &mut self.slots[i];
        match s.state {
            SlotState::Empty => {
                if self.len == 0 {
                    s.buf = vec![0.0; self.max_samples];
                    self.master = Some(i);
                    self.phase = 0;
                } else {
                    s.buf = vec![0.0; self.len];
                }
                s.written = 0;
                s.state = SlotState::Recording;
            }
            SlotState::Recording => {
                if self.master == Some(i) {
                    self.close_master();
                } else {
                    s.state = SlotState::Playing;
                }
            }
            SlotState::Playing => s.state = SlotState::Overdubbing,
            SlotState::Overdubbing => s.state = SlotState::Playing,
            SlotState::Stopped => s.state = SlotState::Playing,
        }
    }

    pub fn stop(&mut self, i: usize) {
        if i >= SLOTS {
            return;
        }
        if self.slots[i].state == SlotState::Recording && self.master == Some(i) {
            self.close_master();
        }
        let s = &mut self.slots[i];
        if s.state != SlotState::Empty {
            s.state = if s.state == SlotState::Stopped { SlotState::Playing } else { SlotState::Stopped };
        }
    }

    pub fn clear(&mut self, i: usize) {
        if i >= SLOTS {
            return;
        }
        if self.master == Some(i) {
            self.master = None;
        }
        let s = &mut self.slots[i];
        s.state = SlotState::Empty;
        s.buf = Vec::new();
        s.written = 0;
        if self.slots.iter().all(|x| x.state == SlotState::Empty) {
            self.len = 0;
            self.phase = 0;
        }
    }

    fn close_master(&mut self) {
        if let Some(m) = self.master.take() {
            let s = &mut self.slots[m];
            let n = s.written.max(1);
            s.buf.truncate(n);
            s.buf.shrink_to_fit();
            s.state = SlotState::Playing;
            self.len = n;
            self.phase = 0;
        }
    }

    /// Returns the loop playback to add to the output for one input sample.
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        if let Some(m) = self.master {
            let s = &mut self.slots[m];
            if s.written < s.buf.len() {
                s.buf[s.written] = x;
                s.written += 1;
            }
            if s.written >= s.buf.len() {
                self.close_master();
            }
        }
        let mut out = 0.0;
        if self.len > 0 {
            let p = self.phase;
            let w = (p + self.len - self.latency % self.len) % self.len;
            for s in self.slots.iter_mut() {
                match s.state {
                    SlotState::Playing => out += s.buf[p],
                    SlotState::Overdubbing => {
                        out += s.buf[p];
                        s.buf[w] += x;
                    }
                    SlotState::Recording => {
                        s.buf[w] = x;
                        s.written += 1;
                        if s.written >= self.len {
                            s.state = SlotState::Playing;
                        }
                    }
                    _ => {}
                }
            }
            self.phase = (p + 1) % self.len;
        }
        out
    }

    pub fn view(&self) -> LooperView {
        let cap = self.max_samples as f32;
        LooperView {
            len: self.len,
            free: self.master.is_some(),
            rate: self.sr,
            slots: std::array::from_fn(|i| {
                let s = &self.slots[i];
                let progress = if self.master == Some(i) {
                    s.written as f32 / cap
                } else {
                    match s.state {
                        SlotState::Recording if self.len > 0 => s.written as f32 / self.len as f32,
                        SlotState::Playing | SlotState::Overdubbing if self.len > 0 => self.phase as f32 / self.len as f32,
                        _ => 0.0,
                    }
                };
                (s.state, progress)
            }),
        }
    }
}
