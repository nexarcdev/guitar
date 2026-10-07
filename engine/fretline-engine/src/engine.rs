//! The engine core. Three kinds of threads meet here:
//!
//! * the backend's capture thread pushes the raw guitar into two lock-free rings: one to the
//!   speakers (monitor) and one to the web app (analysis);
//! * the backend's render thread drains the monitor ring through a drift-compensating reader,
//!   applies queued commands, runs the pedal chain and fills the speaker buffer;
//! * the supervisor thread owns all decisions: which devices are open in which mode, what the
//!   board looks like, who is connected. It reacts to client messages and stream errors and
//!   tells clients the resulting status. A pump thread ships analysis audio and meters.
//!
//! The audio threads never block on the supervisor: commands go through a queue they take with
//! `try_lock`, meters come back the same way, and the chain mutex is only contended while a
//! stream is being opened.

use crate::audio::{Backend, Stream};
use crate::log;
use crate::protocol::{self, ClientMsg, DeviceInfo, Latency, Meters, PedalMsg, ServerMsg, SlotView, Status, StreamInfo};
use crossbeam_channel::{Receiver, Sender};
use fretline_dsp::drift::DriftReader;
use fretline_dsp::looper::SLOTS;
use fretline_dsp::{Chain, Command, PedalKind, PedalSetting};
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// Samples per binary analysis frame.
const FRAME: usize = 1024;

pub enum Out {
    Text(String),
    Binary(Vec<u8>),
}

pub enum Event {
    Connected { id: u64, tx: Sender<Out> },
    Disconnected(u64),
    Msg(u64, ClientMsg),
    StreamError { output: bool, msg: String },
}

pub struct Client {
    pub id: u64,
    pub tx: Sender<Out>,
    pub listen: bool,
}

pub type Clients = Arc<Mutex<Vec<Client>>>;

fn send(c: &Client, m: Out) {
    // A client that can't keep up loses frames rather than stalling everyone.
    let _ = c.tx.try_send(m);
}

/// State the audio threads share with the supervisor and the pump.
struct Shared {
    mon_tx: Mutex<rtrb::Producer<f32>>,
    mon_rx: Mutex<rtrb::Consumer<f32>>,
    ana_tx: Mutex<rtrb::Producer<f32>>,
    /// Analysis samples the capture thread could not queue (keeps the listening clock honest).
    ana_dropped: AtomicU64,
    in_rate: AtomicU32,
    /// Current monitor backlog target, input samples.
    buffer: AtomicUsize,
    underruns: AtomicU64,
    chain: Mutex<Option<(u32, Chain)>>,
    pending: Mutex<Vec<Command>>,
    meters: Mutex<Meters>,
}

/// Pushes as much of `block` as fits; returns how many samples did not fit.
fn push_ring(p: &mut rtrb::Producer<f32>, block: &[f32]) -> usize {
    let n = p.slots().min(block.len());
    if let Ok(chunk) = p.write_chunk_uninit(n) {
        chunk.fill_from_iter(block[..n].iter().copied());
    }
    block.len() - n
}

fn db(x: f32) -> f32 {
    20.0 * x.max(1e-9).log10()
}

pub struct Supervisor {
    backend: Box<dyn Backend>,
    shared: Arc<Shared>,
    clients: Clients,
    events: Sender<Event>,
    tray: Arc<Mutex<String>>,
    // Desired state, as last set by any client.
    pedals: Vec<PedalSetting>,
    output_on: bool,
    input_id: String,
    output_id: String,
    exclusive_input: bool,
    exclusive_output: bool,
    // Actual state.
    inputs: Vec<DeviceInfo>,
    outputs: Vec<DeviceInfo>,
    input: Option<Box<dyn Stream>>,
    output: Option<Box<dyn Stream>>,
    input_retry: Instant,
    output_retry: Instant,
    error: Option<String>,
    last_status: Option<Status>,
}

impl Supervisor {
    pub fn new(backend: Box<dyn Backend>, clients: Clients, events: Sender<Event>, tray: Arc<Mutex<String>>) -> (Self, Pump) {
        let (mon_tx, mon_rx) = rtrb::RingBuffer::new(96000);
        let (ana_tx, ana_rx) = rtrb::RingBuffer::new(192000);
        let meters = Meters { slots: vec![SlotView { state: "empty", progress: 0.0 }; SLOTS], out_db: -120.0, ..Default::default() };
        let shared = Arc::new(Shared {
            mon_tx: Mutex::new(mon_tx),
            mon_rx: Mutex::new(mon_rx),
            ana_tx: Mutex::new(ana_tx),
            ana_dropped: AtomicU64::new(0),
            in_rate: AtomicU32::new(0),
            buffer: AtomicUsize::new(0),
            underruns: AtomicU64::new(0),
            chain: Mutex::new(None),
            pending: Mutex::new(Vec::new()),
            meters: Mutex::new(meters),
        });
        let pump = Pump { shared: shared.clone(), clients: clients.clone(), rx: ana_rx };
        let now = Instant::now();
        let sup = Self {
            backend,
            shared,
            clients,
            events,
            tray,
            pedals: PedalKind::ALL.iter().map(|&kind| PedalSetting { kind, on: false, level: 50.0 }).collect(),
            output_on: false,
            input_id: String::new(),
            output_id: String::new(),
            exclusive_input: true,
            exclusive_output: false,
            inputs: Vec::new(),
            outputs: Vec::new(),
            input: None,
            output: None,
            input_retry: now,
            output_retry: now,
            error: None,
            last_status: None,
        };
        (sup, pump)
    }

    pub fn run(mut self, rx: Receiver<Event>) {
        self.refresh_devices();
        let mut last_scan = Instant::now();
        loop {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(ev) => self.handle(ev),
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
                Err(_) => return,
            }
            while let Ok(ev) = rx.try_recv() {
                self.handle(ev);
            }
            let connected = !self.clients.lock().unwrap().is_empty();
            // No device notifications: rescan while someone is looking (cheap, every 2 s).
            if connected && last_scan.elapsed() > Duration::from_secs(2) {
                last_scan = Instant::now();
                self.refresh_devices();
            }
            self.reconcile();
            self.publish(false);
        }
    }

    fn handle(&mut self, ev: Event) {
        match ev {
            Event::Connected { id, tx } => {
                log!("client {id} connected");
                self.clients.lock().unwrap().push(Client { id, tx, listen: true });
                self.refresh_devices();
                self.reconcile();
                self.publish(true);
            }
            Event::Disconnected(id) => {
                log!("client {id} disconnected");
                self.clients.lock().unwrap().retain(|c| c.id != id);
            }
            Event::StreamError { output, msg } => {
                log!("{} stream error: {msg}", if output { "output" } else { "input" });
                self.error = Some(msg);
                let retry = Instant::now() + Duration::from_secs(1);
                if output {
                    self.output = None;
                    self.output_retry = retry;
                } else {
                    self.input = None;
                    self.input_retry = retry;
                }
            }
            Event::Msg(id, msg) => self.message(id, msg),
        }
    }

    fn message(&mut self, id: u64, msg: ClientMsg) {
        match msg {
            ClientMsg::Hello { client, version } => {
                log!("client {id} is {client} {}", version.unwrap_or_default());
                self.publish(true);
            }
            ClientMsg::Pedals { pedals } => {
                self.pedals = to_settings(&pedals);
                self.command(Command::Pedals(self.pedals.clone()));
            }
            ClientMsg::Output { on } => {
                self.output_on = on;
                self.command(Command::Output(on));
            }
            ClientMsg::Listen { on } => {
                if let Some(c) = self.clients.lock().unwrap().iter_mut().find(|c| c.id == id) {
                    c.listen = on;
                }
            }
            ClientMsg::Loop { cmd, slot } => {
                let c = match cmd.as_str() {
                    "tap" => Command::LoopTap(slot),
                    "stop" => Command::LoopStop(slot),
                    "clear" => Command::LoopClear(slot),
                    _ => return,
                };
                if self.output.is_some() {
                    self.command(c);
                }
            }
            ClientMsg::Floor { floor_db, open_db } => {
                if self.output.is_some() {
                    self.command(Command::Floor { floor_db, open_db });
                }
            }
            ClientMsg::Devices { input, output } => {
                if let Some(i) = input {
                    if i != self.input_id {
                        self.input_id = i;
                        self.close_input();
                    }
                }
                if let Some(o) = output {
                    if o != self.output_id {
                        self.output_id = o;
                        self.output = None;
                    }
                }
            }
            ClientMsg::Exclusive { input, output } => {
                if let Some(i) = input {
                    if i != self.exclusive_input {
                        self.exclusive_input = i;
                        self.close_input();
                    }
                }
                if let Some(o) = output {
                    if o != self.exclusive_output {
                        self.exclusive_output = o;
                        self.output = None;
                    }
                }
            }
        }
        self.reconcile();
        self.publish(false);
    }

    fn command(&self, c: Command) {
        self.shared.pending.lock().unwrap().push(c);
    }

    fn close_input(&mut self) {
        self.input = None;
        self.input_retry = Instant::now();
    }

    fn refresh_devices(&mut self) {
        self.inputs = self.backend.inputs();
        self.outputs = self.backend.outputs();
    }

    /// Opens or closes streams to match what clients need.
    fn reconcile(&mut self) {
        let (active, listening) = {
            let c = self.clients.lock().unwrap();
            (!c.is_empty(), c.iter().any(|c| c.listen))
        };
        let want_in = active && (listening || self.output_on);
        // Shared output stays open while connected so Output and the looper answer instantly;
        // exclusive output only while it is actually in use, so other apps get the device back.
        let want_out = active && (self.output_on || (!self.exclusive_output && want_in));
        let now = Instant::now();

        if !want_in && self.input.is_some() {
            log!("closing input");
            self.input = None;
        }
        if !want_out && self.output.is_some() {
            log!("closing output");
            self.output = None;
        }
        if want_in && self.input.is_none() && now >= self.input_retry {
            match self.open_input() {
                Ok(s) => {
                    log!("input open: {:?}", s.info());
                    self.input = Some(s);
                    self.error = None;
                    // The monitor resampler depends on the input's rate and period.
                    self.output = None;
                }
                Err(e) => {
                    log!("input failed: {e}");
                    self.error = Some(format!("Guitar input: {e}"));
                    self.input_retry = now + Duration::from_secs(2);
                }
            }
        }
        if want_out && self.output.is_none() && now >= self.output_retry {
            match self.open_output() {
                Ok(s) => {
                    log!("output open: {:?}", s.info());
                    self.output = Some(s);
                    if self.error.as_deref().is_some_and(|e| e.starts_with("Speakers")) {
                        self.error = None;
                    }
                    if let Some(l) = self.latency() {
                        let rate = self.output.as_ref().unwrap().info().rate as f32;
                        self.command(Command::Latency((l.total_ms / 1000.0 * rate).round() as usize));
                    }
                }
                Err(e) => {
                    log!("output failed: {e}");
                    self.error = Some(format!("Speakers: {e}"));
                    self.output_retry = now + Duration::from_secs(2);
                }
            }
        }
    }

    fn open_input(&mut self) -> Result<Box<dyn Stream>, String> {
        let shared = self.shared.clone();
        let make = Box::new(move |info: &StreamInfo| -> crate::audio::InputFn {
            shared.in_rate.store(info.rate, Ordering::Relaxed);
            Box::new(move |block: &[f32]| {
                if let Ok(mut p) = shared.mon_tx.try_lock() {
                    push_ring(&mut p, block);
                }
                if let Ok(mut p) = shared.ana_tx.try_lock() {
                    let lost = push_ring(&mut p, block);
                    if lost > 0 {
                        shared.ana_dropped.fetch_add(lost as u64, Ordering::Relaxed);
                    }
                }
            })
        });
        let tx = self.events.clone();
        let on_error = Box::new(move |msg: String| {
            let _ = tx.send(Event::StreamError { output: false, msg });
        });
        let id = self.input_id.clone();
        self.backend.open_input(&id, self.exclusive_input, make, on_error)
    }

    fn open_output(&mut self) -> Result<Box<dyn Stream>, String> {
        let shared = self.shared.clone();
        let input = self.input.as_ref().map(|s| (s.info().rate, s.info().period_ms));
        let init = vec![Command::Pedals(self.pedals.clone()), Command::Output(self.output_on)];
        shared.pending.lock().unwrap().clear();
        let make = Box::new(move |info: &StreamInfo| -> crate::audio::OutputFn {
            let rout = info.rate;
            let (rin, in_ms) = input.unwrap_or((rout, 0.0));
            let in_frames = (in_ms * rin as f32 / 1000.0) as usize;
            let out_in_frames = (info.period_ms * rin as f32 / 1000.0) as usize;
            let target = in_frames + out_in_frames / 2 + 48;
            let mut reader = DriftReader::with_rates(target, rin as f64 / rout as f64);
            reader.allow_growth(in_frames * 4 + out_in_frames + 256);
            shared.buffer.store(target, Ordering::Relaxed);
            {
                let mut slot = shared.chain.lock().unwrap();
                if slot.as_ref().map(|(r, _)| *r) != Some(rout) {
                    *slot = Some((rout, Chain::new(rout as f32)));
                }
                let chain = &mut slot.as_mut().unwrap().1;
                for c in init {
                    chain.apply(c);
                }
            }
            // Drop whatever piled up while nothing was reading.
            if let Ok(mut c) = shared.mon_rx.lock() {
                let n = c.slots();
                if let Ok(chunk) = c.read_chunk(n) {
                    chunk.commit_all();
                }
            }
            let mut local: Vec<Command> = Vec::with_capacity(64);
            let mut peak = 0.0f32;
            let mut since_meter = 0usize;
            let meter_every = (rout / 100) as usize;
            let mut last_underruns = 0;
            Box::new(move |out: &mut [f32]| {
                if let Ok(mut c) = shared.mon_rx.try_lock() {
                    let n = c.slots();
                    if let Ok(chunk) = c.read_chunk(n) {
                        let (a, b) = chunk.as_slices();
                        reader.push(a.iter().chain(b.iter()).copied());
                        chunk.commit_all();
                    }
                }
                reader.read(out);
                if reader.underruns != last_underruns {
                    last_underruns = reader.underruns;
                    shared.underruns.fetch_add(1, Ordering::Relaxed);
                    shared.buffer.store(reader.target(), Ordering::Relaxed);
                }
                if let Ok(mut q) = shared.pending.try_lock() {
                    if !q.is_empty() {
                        std::mem::swap(&mut *q, &mut local);
                    }
                }
                let Ok(mut slot) = shared.chain.lock() else { return };
                let Some((_, chain)) = slot.as_mut() else { return };
                for c in local.drain(..) {
                    chain.apply(c);
                }
                chain.process(out);
                for &v in out.iter() {
                    peak = peak.max(v.abs());
                }
                since_meter += out.len();
                if since_meter >= meter_every {
                    if let Ok(mut m) = shared.meters.try_lock() {
                        let cv = chain.conditioner();
                        let lv = chain.looper();
                        m.gain_db = cv.gain_db;
                        m.floor_db = cv.floor_db;
                        m.gate = cv.gate;
                        m.out_db = m.out_db.max(db(peak));
                        m.looper_len = lv.len;
                        m.looper_free = lv.free;
                        m.looper_rate = lv.rate;
                        for (s, (state, progress)) in m.slots.iter_mut().zip(lv.slots.iter()) {
                            s.state = state.name();
                            s.progress = *progress;
                        }
                        since_meter = 0;
                        peak = 0.0;
                    }
                }
            })
        });
        let tx = self.events.clone();
        let on_error = Box::new(move |msg: String| {
            let _ = tx.send(Event::StreamError { output: true, msg });
        });
        let id = self.output_id.clone();
        self.backend.open_output(&id, self.exclusive_output, make, on_error)
    }

    fn latency(&self) -> Option<Latency> {
        let i = self.input.as_ref()?.info();
        let o = self.output.as_ref()?.info();
        let input_ms = i.period_ms + i.device_ms;
        let buffer_ms = self.shared.buffer.load(Ordering::Relaxed) as f32 * 1000.0 / i.rate.max(1) as f32;
        let output_ms = o.period_ms + o.device_ms;
        Some(Latency { input_ms, buffer_ms, output_ms, total_ms: input_ms + buffer_ms + output_ms })
    }

    fn status(&self) -> Status {
        Status {
            protocol: protocol::PROTOCOL,
            version: VERSION.into(),
            inputs: self.inputs.clone(),
            outputs: self.outputs.clone(),
            input: self.input.as_ref().map(|s| s.info().clone()),
            output: self.output.as_ref().map(|s| s.info().clone()),
            latency: self.latency(),
            output_on: self.output_on,
            exclusive_input: self.exclusive_input,
            exclusive_output: self.exclusive_output,
            error: self.error.clone(),
        }
    }

    /// Sends the status to every client when it changed (or always, when `force`).
    fn publish(&mut self, force: bool) {
        let s = self.status();
        if !force && self.last_status.as_ref() == Some(&s) {
            return;
        }
        let text = serde_json::to_string(&ServerMsg::Status(s.clone())).unwrap_or_default();
        for c in self.clients.lock().unwrap().iter() {
            send(c, Out::Text(text.clone()));
        }
        let tray = match (&s.error, &s.latency, self.clients.lock().unwrap().len()) {
            (Some(e), _, _) => format!("Problem: {e}"),
            (None, _, 0) => "Waiting for Fretline".to_string(),
            (None, Some(l), _) => format!("Connected, about {:.0} ms", l.total_ms),
            (None, None, _) => "Connected".to_string(),
        };
        *self.tray.lock().unwrap() = tray;
        self.last_status = Some(s);
    }
}

fn to_settings(pedals: &[PedalMsg]) -> Vec<PedalSetting> {
    pedals
        .iter()
        .filter_map(|p| PedalKind::from_name(&p.name).map(|kind| PedalSetting { kind, on: p.on, level: p.level }))
        .collect()
}

/// Ships the raw guitar to listening clients in fixed frames, and meters to everyone at 30 Hz.
pub struct Pump {
    shared: Arc<Shared>,
    clients: Clients,
    rx: rtrb::Consumer<f32>,
}

impl Pump {
    pub fn run(mut self) {
        let mut acc: Vec<f32> = Vec::with_capacity(FRAME * 4);
        let mut clock: u64 = 0;
        let mut rate = 0u32;
        let mut last_meters = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(5));
            let r = self.shared.in_rate.load(Ordering::Relaxed);
            if r != rate {
                rate = r;
                acc.clear();
            }
            let n = self.rx.slots();
            if let Ok(chunk) = self.rx.read_chunk(n) {
                let (a, b) = chunk.as_slices();
                acc.extend_from_slice(a);
                acc.extend_from_slice(b);
                chunk.commit_all();
            }
            clock += self.shared.ana_dropped.swap(0, Ordering::Relaxed);
            let mut sent = 0;
            while acc.len() - sent >= FRAME {
                let frame = protocol::audio_frame(rate, clock as f64, &acc[sent..sent + FRAME]);
                for c in self.clients.lock().unwrap().iter().filter(|c| c.listen) {
                    send(c, Out::Binary(frame.clone()));
                }
                clock += FRAME as u64;
                sent += FRAME;
            }
            acc.drain(..sent);

            if last_meters.elapsed() >= Duration::from_millis(33) {
                last_meters = Instant::now();
                let clients = self.clients.lock().unwrap();
                if clients.is_empty() {
                    continue;
                }
                let m = {
                    let mut m = self.shared.meters.lock().unwrap();
                    let snap = m.clone();
                    m.out_db = -120.0;
                    snap
                };
                let m = Meters { underruns: self.shared.underruns.load(Ordering::Relaxed), ..m };
                let text = serde_json::to_string(&ServerMsg::Meters(m)).unwrap_or_default();
                for c in clients.iter() {
                    send(c, Out::Text(text.clone()));
                }
            }
        }
    }
}
