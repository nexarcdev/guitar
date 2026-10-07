//! The engine: one channel of the shared core, hosted natively. Threads:
//!
//! * capture (backend): pushes the raw guitar into two lock-free rings, monitor and analysis;
//! * render (backend): drift-compensates the monitor ring and runs the core's AudioSide
//!   (conditioner, pedals, looper, synth) into the speakers;
//! * analysis: the core's Capture (listening clock), TrackerSide and MlSide; sends analysis,
//!   notes and meters to clients;
//! * ml: basic-pitch inference (model.rs) for windows the MlSide hands it;
//! * supervisor: the core's Session (shared state, persistence), client bookkeeping, and which
//!   devices are open in which mode.
//!
//! Audio threads never wait on the others: commands reach the render thread through a queue it
//! takes with `try_lock`, the noise floor through atomics, meters come back the same way.

use crate::audio::{Backend, Stream};
use crate::log;
use crate::model::Model;
use crossbeam_channel::{Receiver, Sender};
use fretline_core::drift::DriftReader;
use fretline_core::ml::MlWindow;
use fretline_core::protocol::{ChannelMsg, ControlMsg, DeviceInfo, Latency, Meters, MlState, MlStatus, Status, StreamInfo, PROTOCOL};
use fretline_core::session::Session;
use fretline_core::sides::{AudioCmd, AudioSide, Capture, ListenCmd, MlSide, TrackerSide};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub enum Event {
    Connected { id: u64, tx: Sender<String> },
    Disconnected(u64),
    Msg(u64, ControlMsg),
    StreamError { output: bool, msg: String },
}

pub struct Client {
    pub id: u64,
    pub tx: Sender<String>,
    pub listen: bool,
}

pub type Clients = Arc<Mutex<Vec<Client>>>;

fn json(m: &ChannelMsg) -> String {
    serde_json::to_string(m).unwrap_or_default()
}

/// Sends to every client (or only listening ones). A client that can't keep up loses messages
/// rather than stalling everyone.
fn broadcast(clients: &Clients, text: &str, listening_only: bool) {
    for c in clients.lock().unwrap().iter().filter(|c| c.listen || !listening_only) {
        let _ = c.tx.try_send(text.to_string());
    }
}

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

/// State the audio threads share with the supervisor and the analysis thread.
struct Shared {
    mon_tx: Mutex<rtrb::Producer<f32>>,
    mon_rx: Mutex<rtrb::Consumer<f32>>,
    ana_tx: Mutex<rtrb::Producer<f32>>,
    /// Current monitor backlog target, input samples.
    buffer: AtomicUsize,
    underruns: AtomicU64,
    audio: Mutex<Option<AudioSide>>,
    pending: Mutex<Vec<AudioCmd>>,
    meters: Mutex<Meters>,
    synth_active: AtomicBool,
    /// The tracker's noise floor and gate margin (f32 bits), for the monitored path.
    floor_db: AtomicU32,
    open_db: AtomicU32,
}

/// Pushes as much of `block` as fits.
fn push_ring(p: &mut rtrb::Producer<f32>, block: &[f32]) {
    let n = p.slots().min(block.len());
    if let Ok(chunk) = p.write_chunk_uninit(n) {
        chunk.fill_from_iter(block[..n].iter().copied());
    }
}

/// Messages from the supervisor to the analysis thread.
enum AnaMsg {
    /// A new input stream at this rate.
    Input(u32),
    Cmd(ListenCmd),
    Listening(bool),
    /// Tell everyone the current ML status (a client connected).
    Resend,
}

pub struct Supervisor {
    backend: Box<dyn Backend>,
    shared: Arc<Shared>,
    clients: Clients,
    events: Sender<Event>,
    ana: Sender<AnaMsg>,
    tray: Arc<Mutex<String>>,
    session: Session,
    session_path: Option<PathBuf>,
    session_dirty: bool,
    inputs: Vec<DeviceInfo>,
    outputs: Vec<DeviceInfo>,
    input: Option<Box<dyn Stream>>,
    output: Option<Box<dyn Stream>>,
    input_retry: Instant,
    output_retry: Instant,
    /// Exclusive mode asked for but not granted (usually the device was still busy, e.g. the
    /// browser hadn't released it yet): try once more a moment later.
    input_upgrade: Option<Instant>,
    output_upgrade: Option<Instant>,
    /// That one retry has been spent (reset when the player changes device or mode).
    input_upgrade_tried: bool,
    output_upgrade_tried: bool,
    /// Keep the output open until then for synth notes (matters for exclusive output).
    synth_until: Instant,
    listening: bool,
    error: Option<String>,
    last_status: Option<Status>,
}

impl Supervisor {
    pub fn new(backend: Box<dyn Backend>, clients: Clients, events: Sender<Event>, tray: Arc<Mutex<String>>, session_path: Option<PathBuf>) -> (Self, Analysis) {
        let (mon_tx, mon_rx) = rtrb::RingBuffer::new(96000);
        let (ana_tx, ana_rx) = rtrb::RingBuffer::new(192000);
        let shared = Arc::new(Shared {
            mon_tx: Mutex::new(mon_tx),
            mon_rx: Mutex::new(mon_rx),
            ana_tx: Mutex::new(ana_tx),
            buffer: AtomicUsize::new(0),
            underruns: AtomicU64::new(0),
            audio: Mutex::new(None),
            pending: Mutex::new(Vec::new()),
            meters: Mutex::new(Meters { out_db: -120.0, ..Default::default() }),
            synth_active: AtomicBool::new(false),
            floor_db: AtomicU32::new((-80.0f32).to_bits()),
            open_db: AtomicU32::new(12.0f32.to_bits()),
        });
        let session = match session_path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()) {
            Some(s) => Session::load(&s),
            None => Session::default(),
        };
        let (ana, ana_rx_msgs) = crossbeam_channel::unbounded();
        let analysis = Analysis { shared: shared.clone(), clients: clients.clone(), rx: ana_rx, msgs: ana_rx_msgs, initial: session.initial().listen };
        let now = Instant::now();
        let sup = Self {
            backend,
            shared,
            clients,
            events,
            ana,
            tray,
            session,
            session_path,
            session_dirty: false,
            inputs: Vec::new(),
            outputs: Vec::new(),
            input: None,
            output: None,
            input_retry: now,
            output_retry: now,
            input_upgrade: None,
            output_upgrade: None,
            input_upgrade_tried: false,
            output_upgrade_tried: false,
            synth_until: now,
            listening: false,
            error: None,
            last_status: None,
        };
        (sup, analysis)
    }

    pub fn run(mut self, rx: Receiver<Event>) {
        self.refresh_devices();
        let mut last_scan = Instant::now();
        let mut last_save = Instant::now();
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
            // Knob drags change state many times a second; save at most once a second.
            if self.session_dirty && last_save.elapsed() > Duration::from_secs(1) {
                last_save = Instant::now();
                self.save();
            }
            self.reconcile();
            self.publish(false);
        }
    }

    fn save(&mut self) {
        self.session_dirty = false;
        if let Some(p) = &self.session_path {
            if let Err(e) = std::fs::write(p, self.session.save()) {
                log!("could not save session: {e}");
            }
        }
    }

    fn handle(&mut self, ev: Event) {
        match ev {
            Event::Connected { id, tx } => {
                log!("client {id} connected");
                let _ = tx.try_send(json(&ChannelMsg::State(self.session.state.clone())));
                self.clients.lock().unwrap().push(Client { id, tx, listen: true });
                self.refresh_devices();
                self.update_listening();
                let _ = self.ana.send(AnaMsg::Resend);
                self.reconcile();
                self.publish(true);
            }
            Event::Disconnected(id) => {
                log!("client {id} disconnected");
                self.clients.lock().unwrap().retain(|c| c.id != id);
                self.update_listening();
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

    fn message(&mut self, id: u64, msg: ControlMsg) {
        match &msg {
            ControlMsg::Hello { client, version } => {
                log!("client {id} is {client} {}", version.clone().unwrap_or_default());
            }
            ControlMsg::Listen { on } => {
                if let Some(c) = self.clients.lock().unwrap().iter_mut().find(|c| c.id == id) {
                    c.listen = *on;
                }
                self.update_listening();
            }
            ControlMsg::Play { notes, lead, .. } => {
                let end = notes.iter().map(|n| n.at + n.dur).fold(0.0, f64::max) + lead.unwrap_or(0.05) + 0.5;
                self.synth_until = self.synth_until.max(Instant::now() + Duration::from_secs_f64(end.min(600.0)));
            }
            _ => {}
        }
        let before = self.session.state.clone();
        let fx = self.session.apply(&msg, now_ms());
        if !fx.audio.is_empty() {
            self.shared.pending.lock().unwrap().extend(fx.audio);
        }
        for c in fx.listen {
            let _ = self.ana.send(AnaMsg::Cmd(c));
        }
        if let Some(st) = fx.state {
            self.session_dirty = true;
            broadcast(&self.clients, &json(&ChannelMsg::State(st)), false);
        }
        if fx.devices {
            let s = &self.session.state;
            let input_changed = s.input_id != before.input_id || s.exclusive_input != before.exclusive_input;
            let output_changed = s.output_id != before.output_id || s.exclusive_output != before.exclusive_output;
            if input_changed {
                self.input_upgrade_tried = false;
                self.close_input();
            }
            if output_changed {
                self.output_upgrade_tried = false;
                self.output = None;
            }
        }
        self.reconcile();
        self.publish(false);
    }

    fn update_listening(&mut self) {
        let any = self.clients.lock().unwrap().iter().any(|c| c.listen);
        if any != self.listening {
            self.listening = any;
            let _ = self.ana.send(AnaMsg::Listening(any));
        }
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
        let active = !self.clients.lock().unwrap().is_empty();
        let output_on = self.session.state.output;
        let exclusive_output = self.session.state.exclusive_output;
        let now = Instant::now();
        let synth = now < self.synth_until || self.shared.synth_active.load(Ordering::Relaxed);
        let want_in = active && (self.listening || output_on);
        // Shared output stays open while connected so Output, the looper and the synth answer
        // instantly; exclusive output only while in use, so other apps get the device back.
        let want_out = active && (output_on || synth || (!exclusive_output && want_in));

        if !want_in && self.input.is_some() {
            log!("closing input");
            self.input = None;
            self.input_upgrade = None;
            self.input_upgrade_tried = false;
        }
        if !want_out && self.output.is_some() {
            log!("closing output");
            self.output = None;
            self.output_upgrade = None;
            self.output_upgrade_tried = false;
        }
        if self.input_upgrade.is_some_and(|t| now >= t) && self.input.is_some() {
            log!("retrying exclusive input");
            self.input = None;
            self.input_upgrade = None;
            self.input_upgrade_tried = true;
        }
        if self.output_upgrade.is_some_and(|t| now >= t) && self.output.is_some() {
            log!("retrying exclusive output");
            self.output = None;
            self.output_upgrade = None;
            self.output_upgrade_tried = true;
        }
        if want_in && self.input.is_none() && now >= self.input_retry {
            match self.open_input() {
                Ok(s) => {
                    log!("input open: {:?}", s.info());
                    let missed = self.session.state.exclusive_input && s.info().mode != "exclusive" && s.info().mode != "test";
                    self.input_upgrade = (missed && !self.input_upgrade_tried).then(|| now + Duration::from_secs(3));
                    let _ = self.ana.send(AnaMsg::Input(s.info().rate));
                    for c in self.session.initial().listen {
                        let _ = self.ana.send(AnaMsg::Cmd(c));
                    }
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
                    let missed = exclusive_output && s.info().mode != "exclusive" && s.info().mode != "test";
                    self.output_upgrade = (missed && !self.output_upgrade_tried).then(|| now + Duration::from_secs(3));
                    self.output = Some(s);
                    if self.error.as_deref().is_some_and(|e| e.starts_with("Speakers")) {
                        self.error = None;
                    }
                    if let Some(l) = self.latency() {
                        let rate = self.output.as_ref().unwrap().info().rate as f32;
                        let samples = (l.total_ms / 1000.0 * rate).round() as usize;
                        self.shared.pending.lock().unwrap().push(AudioCmd::Latency { samples });
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
        let make = Box::new(move |_: &StreamInfo| -> crate::audio::InputFn {
            Box::new(move |block: &[f32]| {
                if let Ok(mut p) = shared.mon_tx.try_lock() {
                    push_ring(&mut p, block);
                }
                if let Ok(mut p) = shared.ana_tx.try_lock() {
                    push_ring(&mut p, block);
                }
            })
        });
        let tx = self.events.clone();
        let on_error = Box::new(move |msg: String| {
            let _ = tx.send(Event::StreamError { output: false, msg });
        });
        let s = &self.session.state;
        let (id, exclusive) = (s.input_id.clone(), s.exclusive_input);
        self.backend.open_input(&id, exclusive, make, on_error)
    }

    fn open_output(&mut self) -> Result<Box<dyn Stream>, String> {
        let shared = self.shared.clone();
        let input = self.input.as_ref().map(|s| (s.info().rate, s.info().period_ms));
        let init = self.session.initial().audio;
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
                // The AudioSide outlives output streams (loops keep playing across a device
                // change) unless the rate changes.
                let mut slot = shared.audio.lock().unwrap();
                if slot.as_ref().map(|a| a.sample_rate()) != Some(rout as f32) {
                    *slot = Some(AudioSide::new(rout as f32));
                }
                let side = slot.as_mut().unwrap();
                for c in init {
                    side.apply(c);
                }
            }
            // Drop whatever piled up while nothing was reading.
            if let Ok(mut c) = shared.mon_rx.lock() {
                let n = c.slots();
                if let Ok(chunk) = c.read_chunk(n) {
                    chunk.commit_all();
                }
            }
            let mut local: Vec<AudioCmd> = Vec::with_capacity(64);
            let mut since_meter = 0usize;
            let meter_every = (rout / 100) as usize;
            let mut last_underruns = 0;
            let mut level = (0u32, 0u32);
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
                let Ok(mut slot) = shared.audio.lock() else { return };
                let Some(side) = slot.as_mut() else { return };
                for c in local.drain(..) {
                    side.apply(c);
                }
                let now = (shared.floor_db.load(Ordering::Relaxed), shared.open_db.load(Ordering::Relaxed));
                if now != level {
                    level = now;
                    side.apply(AudioCmd::Level { floor_db: f32::from_bits(now.0), open_db: f32::from_bits(now.1) });
                }
                side.process(out);
                since_meter += out.len();
                if since_meter >= meter_every {
                    if let Ok(mut m) = shared.meters.try_lock() {
                        side.meters_into(&mut m);
                        since_meter = 0;
                    }
                    shared.synth_active.store(side.synth_active(), Ordering::Relaxed);
                }
            })
        });
        let tx = self.events.clone();
        let on_error = Box::new(move |msg: String| {
            let _ = tx.send(Event::StreamError { output: true, msg });
        });
        let s = &self.session.state;
        let (id, exclusive) = (s.output_id.clone(), s.exclusive_output);
        self.backend.open_output(&id, exclusive, make, on_error)
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
            protocol: PROTOCOL,
            version: VERSION.into(),
            kind: "engine".into(),
            inputs: self.inputs.clone(),
            outputs: self.outputs.clone(),
            input: self.input.as_ref().map(|s| s.info().clone()),
            output: self.output.as_ref().map(|s| s.info().clone()),
            latency: self.latency(),
            error: self.error.clone(),
        }
    }

    /// Sends the status to every client when it changed (or always, when `force`).
    fn publish(&mut self, force: bool) {
        let s = self.status();
        if !force && self.last_status.as_ref() == Some(&s) {
            return;
        }
        broadcast(&self.clients, &json(&ChannelMsg::Status(s.clone())), false);
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

/// The listening half: tracker and basic-pitch over the raw guitar, results to clients.
pub struct Analysis {
    shared: Arc<Shared>,
    clients: Clients,
    rx: rtrb::Consumer<f32>,
    msgs: Receiver<AnaMsg>,
    /// Settings to apply when the sides are (re)created before the supervisor's own arrive.
    initial: Vec<ListenCmd>,
}

impl Analysis {
    pub fn run(mut self) {
        let mut capture = Capture::default();
        capture.listening = false;
        let mut sides: Option<(TrackerSide, MlSide)> = None;
        let mut cmds: Vec<ListenCmd> = std::mem::take(&mut self.initial);
        let mut acc: Vec<f32> = Vec::with_capacity(8192);
        let mut last_meters = Instant::now();
        let mut last_level = Instant::now();

        // ML runs on its own thread with at most one window in flight. The model loads at start
        // (~0.1 s) so clients see "ready" or "unavailable" straight away.
        let (win_tx, win_rx) = crossbeam_channel::bounded::<MlWindow>(1);
        let (res_tx, res_rx) = crossbeam_channel::unbounded::<(MlWindow, Result<(Vec<f32>, Vec<f32>, f64), String>)>();
        let ml = Arc::new(Mutex::new(MlView { on: true, model: MlState::Loading, sent: None }));
        {
            let ml = ml.clone();
            let clients = self.clients.clone();
            std::thread::Builder::new()
                .name("ml".into())
                .spawn(move || {
                    let model = Model::load();
                    match &model {
                        Ok(_) => log!("ML model ready"),
                        Err(e) => log!("ML unavailable: {e}"),
                    }
                    ml.lock().unwrap().model = if model.is_ok() { MlState::Ready } else { MlState::Unavailable };
                    publish_ml(&ml, &clients, false);
                    for w in win_rx {
                        let r = match &model {
                            Ok(m) => {
                                let t = Instant::now();
                                let (mut f, mut o) = (Vec::new(), Vec::new());
                                m.run(&w.audio, &mut f, &mut o).map(|_| (f, o, t.elapsed().as_secs_f64()))
                            }
                            Err(e) => Err(e.clone()),
                        };
                        if res_tx.send((w, r)).is_err() {
                            return;
                        }
                    }
                })
                .unwrap();
        }
        let mut busy = false;

        loop {
            // Messages from the supervisor.
            loop {
                match self.msgs.try_recv() {
                    Ok(AnaMsg::Input(rate)) => {
                        let mut t = TrackerSide::new(rate as f64);
                        let mut m = MlSide::new(rate as f64);
                        for c in &cmds {
                            t.apply(c);
                            m.apply(c);
                        }
                        sides = Some((t, m));
                        acc.clear();
                    }
                    Ok(AnaMsg::Cmd(c)) => {
                        if let ListenCmd::Ml { on } = c {
                            ml.lock().unwrap().on = on;
                            publish_ml(&ml, &self.clients, false);
                        }
                        if let Some((t, m)) = sides.as_mut() {
                            t.apply(&c);
                            m.apply(&c);
                        }
                        // Remember settings (not one-off actions) for sides created later.
                        if !matches!(c, ListenCmd::Recalibrate { .. } | ListenCmd::Reset) {
                            cmds.retain(|x| std::mem::discriminant(x) != std::mem::discriminant(&c));
                            cmds.push(c);
                        }
                    }
                    Ok(AnaMsg::Listening(on)) => capture.listening = on,
                    Ok(AnaMsg::Resend) => publish_ml(&ml, &self.clients, true),
                    Err(crossbeam_channel::TryRecvError::Empty) => break,
                    Err(_) => return,
                }
            }

            // New audio → listening clock → tracker and ML.
            let n = self.rx.slots();
            if let Ok(chunk) = self.rx.read_chunk(n) {
                let (a, b) = chunk.as_slices();
                acc.extend_from_slice(a);
                acc.extend_from_slice(b);
                chunk.commit_all();
            }
            if let Some((tracker, side)) = sides.as_mut() {
                let clients = &self.clients;
                capture.push(&acc, |t0, data| {
                    let a = tracker.push(t0, data);
                    broadcast(clients, &json(&ChannelMsg::Analysis(a)), true);
                    side.push(t0, data);
                });
                if last_level.elapsed() >= Duration::from_millis(100) {
                    last_level = Instant::now();
                    let (floor, open) = tracker.level();
                    side.set_floor(floor, open);
                    self.shared.floor_db.store(floor.to_bits(), Ordering::Relaxed);
                    self.shared.open_db.store(open.to_bits(), Ordering::Relaxed);
                }
                // Results back from the ML thread.
                while let Ok((w, r)) = res_rx.try_recv() {
                    busy = false;
                    match r {
                        Ok((f, o, secs)) => {
                            broadcast(clients, &json(&ChannelMsg::Notes(side.decode(&w, &f, &o))), true);
                            if side.note_inference(secs) {
                                log!("ML too slow ({secs:.2} s per window); pausing it");
                                side.on = false;
                                ml.lock().unwrap().model = MlState::Slow;
                                publish_ml(&ml, clients, false);
                            }
                        }
                        Err(e) => {
                            log!("ML failed: {e}");
                            side.on = false;
                        }
                    }
                }
                if !busy && ml.lock().unwrap().model == MlState::Ready {
                    if let Some(w) = side.next_window() {
                        busy = win_tx.try_send(w).is_ok();
                    }
                }
            }
            acc.clear();

            if last_meters.elapsed() >= Duration::from_millis(33) {
                last_meters = Instant::now();
                if !self.clients.lock().unwrap().is_empty() {
                    let m = {
                        let mut m = self.shared.meters.lock().unwrap();
                        let snap = m.clone();
                        m.out_db = -120.0;
                        snap
                    };
                    let m = Meters { underruns: self.shared.underruns.load(Ordering::Relaxed), ..m };
                    broadcast(&self.clients, &json(&ChannelMsg::Meters(m)), false);
                }
            }
            std::thread::sleep(Duration::from_millis(4));
        }
    }
}

/// What clients see of ML: the player's switch combined with the model's state.
struct MlView {
    on: bool,
    model: MlState,
    sent: Option<MlState>,
}

fn publish_ml(ml: &Mutex<MlView>, clients: &Clients, force: bool) {
    let status = {
        let mut v = ml.lock().unwrap();
        let s = if v.on { v.model } else { MlState::Off };
        if !force && v.sent == Some(s) {
            return;
        }
        v.sent = Some(s);
        s
    };
    broadcast(clients, &json(&ChannelMsg::Ml(MlStatus { status, backend: "native".into() })), false);
}
