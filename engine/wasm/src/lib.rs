//! Fretline's core for the browser. One WebAssembly module, instantiated separately in each
//! realm that needs a part of it: the main thread runs the Session, the AudioWorklet runs the
//! AudioSide and Capture, one worker runs the TrackerSide, another the MlSide around TensorFlow.js.
//!
//! ABI (no bindings generator, so it also works inside an AudioWorklet):
//! * Text in: `in_buf(len)` returns where to write `len` UTF-8 bytes, then call the function with
//!   `len`. Text out: functions return a byte length; read that many bytes at `out_ptr()`.
//! * Audio: `*_buf()` returns a fixed f32 buffer to fill (or read) in place.
//! * Clock values are f64 sample indices.

use fretline_core::ml::{MlWindow, ML_WINDOW, N_FRAMES, N_PITCH};
use fretline_core::protocol::{ChannelMsg, ControlMsg};
use fretline_core::session::Session;
use fretline_core::sides::{AudioCmd, AudioSide, Capture, ListenCmd, MlSide, TrackerSide, CHUNK};
use std::cell::RefCell;

const AUDIO_MAX: usize = 4096;

#[derive(Default)]
struct Realm {
    input: Vec<u8>,
    out: Vec<u8>,
    session: Option<Session>,
    audio: Option<AudioSide>,
    audio_buf: Vec<f32>,
    capture: Capture,
    chunks: Vec<f32>,
    chunk_t0: Vec<f64>,
    meters: fretline_core::protocol::Meters,
    tracker: Option<TrackerSide>,
    tracker_buf: Vec<f32>,
    ml: Option<MlSide>,
    ml_buf: Vec<f32>,
    window: Option<MlWindow>,
    frames: Vec<f32>,
    onsets: Vec<f32>,
}

thread_local! {
    static R: RefCell<Realm> = RefCell::new(Realm::default());
}

fn with<T>(f: impl FnOnce(&mut Realm) -> T) -> T {
    R.with(|r| f(&mut r.borrow_mut()))
}

fn input(r: &Realm, len: u32) -> &str {
    std::str::from_utf8(&r.input[..len as usize]).unwrap_or("")
}

fn emit(r: &mut Realm, json: String) -> u32 {
    r.out = json.into_bytes();
    r.out.len() as u32
}

// ---- text exchange

#[no_mangle]
pub extern "C" fn in_buf(len: u32) -> *mut u8 {
    with(|r| {
        r.input.resize(len as usize, 0);
        r.input.as_mut_ptr()
    })
}

#[no_mangle]
pub extern "C" fn out_ptr() -> *const u8 {
    with(|r| r.out.as_ptr())
}

// ---- session (main thread)

/// `len` 0 starts a default session; otherwise the bytes are a saved session.
#[no_mangle]
pub extern "C" fn session_load(len: u32) {
    with(|r| r.session = Some(if len == 0 { Session::default() } else { Session::load(input(r, len)) }));
}

/// Applies a ControlMsg; returns the Effects as JSON (an invalid message has no effects).
#[no_mangle]
pub extern "C" fn session_apply(len: u32, now_ms: f64) -> u32 {
    with(|r| {
        let msg: Option<ControlMsg> = serde_json::from_str(input(r, len)).ok();
        let fx = match (msg, r.session.as_mut()) {
            (Some(m), Some(s)) => s.apply(&m, now_ms),
            _ => Default::default(),
        };
        emit(r, serde_json::to_string(&fx).unwrap_or_default())
    })
}

#[no_mangle]
pub extern "C" fn session_initial() -> u32 {
    with(|r| {
        let fx = r.session.get_or_insert_with(Session::default).initial();
        emit(r, serde_json::to_string(&fx).unwrap_or_default())
    })
}

/// The state as a `state` ChannelMsg.
#[no_mangle]
pub extern "C" fn session_state() -> u32 {
    with(|r| {
        let s = r.session.get_or_insert_with(Session::default).state.clone();
        emit(r, serde_json::to_string(&ChannelMsg::State(s)).unwrap_or_default())
    })
}

#[no_mangle]
pub extern "C" fn session_save() -> u32 {
    with(|r| {
        let s = r.session.get_or_insert_with(Session::default).save();
        emit(r, s)
    })
}

// ---- audio side + capture (AudioWorklet)

#[no_mangle]
pub extern "C" fn audio_init(sample_rate: f32) {
    with(|r| {
        r.audio = Some(AudioSide::new(sample_rate));
        r.audio_buf = vec![0.0; AUDIO_MAX];
        r.chunks = Vec::with_capacity(CHUNK * 8);
        r.chunk_t0 = Vec::with_capacity(8);
    });
}

#[no_mangle]
pub extern "C" fn audio_cmd(len: u32) {
    with(|r| {
        if let Ok(cmd) = serde_json::from_str::<AudioCmd>(input(r, len)) {
            if let Some(a) = r.audio.as_mut() {
                a.apply(cmd);
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn audio_buf() -> *mut f32 {
    with(|r| r.audio_buf.as_mut_ptr())
}

/// The first `n` samples of `audio_buf` hold the guitar; they are captured for analysis, then
/// replaced by what goes to the speakers. Returns how many analysis chunks completed.
#[no_mangle]
pub extern "C" fn audio_process(n: u32) -> u32 {
    with(|r| {
        let n = (n as usize).min(AUDIO_MAX);
        r.chunks.clear();
        r.chunk_t0.clear();
        let Realm { capture, chunks, chunk_t0, audio_buf, audio, .. } = r;
        capture.push(&audio_buf[..n], |t0, c| {
            chunks.extend_from_slice(c);
            chunk_t0.push(t0 as f64);
        });
        if let Some(a) = audio.as_mut() {
            a.process(&mut audio_buf[..n]);
        }
        r.chunk_t0.len() as u32
    })
}

#[no_mangle]
pub extern "C" fn chunk_ptr(i: u32) -> *const f32 {
    with(|r| r.chunks[i as usize * CHUNK..].as_ptr())
}

#[no_mangle]
pub extern "C" fn chunk_t0(i: u32) -> f64 {
    with(|r| r.chunk_t0[i as usize])
}

#[no_mangle]
pub extern "C" fn capture_listening(on: u32) {
    with(|r| r.capture.listening = on != 0);
}

#[no_mangle]
pub extern "C" fn capture_continue(at: f64) {
    with(|r| r.capture.continue_from(at as u64));
}

#[no_mangle]
pub extern "C" fn capture_clock() -> f64 {
    with(|r| r.capture.clock() as f64)
}

/// Meters as a `meters` ChannelMsg (output peak since the last call).
#[no_mangle]
pub extern "C" fn audio_meters() -> u32 {
    with(|r| {
        r.meters.out_db = -120.0;
        if let Some(a) = r.audio.as_mut() {
            a.meters_into(&mut r.meters);
        }
        let s = serde_json::to_string(&ChannelMsg::Meters(r.meters.clone())).unwrap_or_default();
        emit(r, s)
    })
}

// ---- tracker side (pitch worker)

#[no_mangle]
pub extern "C" fn tracker_init(sample_rate: f64) {
    with(|r| {
        r.tracker = Some(TrackerSide::new(sample_rate));
        r.tracker_buf = vec![0.0; CHUNK * 4];
    });
}

#[no_mangle]
pub extern "C" fn tracker_cmd(len: u32) {
    with(|r| {
        if let Ok(cmd) = serde_json::from_str::<ListenCmd>(input(r, len)) {
            if let Some(t) = r.tracker.as_mut() {
                t.apply(&cmd);
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn tracker_buf() -> *mut f32 {
    with(|r| r.tracker_buf.as_mut_ptr())
}

/// Analyses the first `n` samples of `tracker_buf`; returns an `analysis` ChannelMsg.
#[no_mangle]
pub extern "C" fn tracker_push(t0: f64, n: u32) -> u32 {
    with(|r| {
        let n = (n as usize).min(r.tracker_buf.len());
        let Some(t) = r.tracker.as_mut() else { return 0 };
        let a = t.push(t0 as u64, &r.tracker_buf[..n]);
        let s = serde_json::to_string(&ChannelMsg::Analysis(a)).unwrap_or_default();
        emit(r, s)
    })
}

#[no_mangle]
pub extern "C" fn tracker_floor_db() -> f32 {
    with(|r| r.tracker.as_ref().map_or(-80.0, |t| t.level().0))
}

#[no_mangle]
pub extern "C" fn tracker_open_db() -> f32 {
    with(|r| r.tracker.as_ref().map_or(12.0, |t| t.level().1))
}

// ---- ML side (ML worker; inference runs in TensorFlow.js between next_window and decode)

#[no_mangle]
pub extern "C" fn ml_init(sample_rate: f64) {
    with(|r| {
        r.ml = Some(MlSide::new(sample_rate));
        r.ml_buf = vec![0.0; CHUNK * 4];
        r.frames = vec![0.0; N_FRAMES * N_PITCH];
        r.onsets = vec![0.0; N_FRAMES * N_PITCH];
    });
}

#[no_mangle]
pub extern "C" fn ml_cmd(len: u32) {
    with(|r| {
        if let Ok(cmd) = serde_json::from_str::<ListenCmd>(input(r, len)) {
            if let Some(m) = r.ml.as_mut() {
                m.apply(&cmd);
            }
        }
    });
}

#[no_mangle]
pub extern "C" fn ml_set_floor(floor_db: f32, open_db: f32) {
    with(|r| {
        if let Some(m) = r.ml.as_mut() {
            m.set_floor(floor_db, open_db);
        }
    });
}

#[no_mangle]
pub extern "C" fn ml_buf() -> *mut f32 {
    with(|r| r.ml_buf.as_mut_ptr())
}

#[no_mangle]
pub extern "C" fn ml_push(t0: f64, n: u32) {
    with(|r| {
        let n = (n as usize).min(r.ml_buf.len());
        if let Some(m) = r.ml.as_mut() {
            m.push(t0 as u64, &r.ml_buf[..n]);
        }
    });
}

/// The next window to run the model on (`ML_WINDOW` samples), or null.
#[no_mangle]
pub extern "C" fn ml_next_window() -> *const f32 {
    with(|r| {
        r.window = r.ml.as_mut().and_then(|m| m.next_window());
        r.window.as_ref().map_or(std::ptr::null(), |w| w.audio.as_ptr())
    })
}

#[no_mangle]
pub extern "C" fn ml_window_len() -> u32 {
    ML_WINDOW as u32
}

/// Where to write the model's note-frame and onset outputs (N_FRAMES × N_PITCH each).
#[no_mangle]
pub extern "C" fn ml_frames() -> *mut f32 {
    with(|r| r.frames.as_mut_ptr())
}

#[no_mangle]
pub extern "C" fn ml_onsets() -> *mut f32 {
    with(|r| r.onsets.as_mut_ptr())
}

/// Decodes the current window; returns a `notes` ChannelMsg (0 if there is no window).
#[no_mangle]
pub extern "C" fn ml_decode() -> u32 {
    with(|r| {
        let (Some(m), Some(w)) = (r.ml.as_ref(), r.window.take()) else { return 0 };
        let notes = m.decode(&w, &r.frames, &r.onsets);
        let s = serde_json::to_string(&ChannelMsg::Notes(notes)).unwrap_or_default();
        emit(r, s)
    })
}

/// Records an inference time; 1 once the device has been too slow to keep up.
#[no_mangle]
pub extern "C" fn ml_note_inference(seconds: f64) -> u32 {
    with(|r| r.ml.as_mut().is_some_and(|m| m.note_inference(seconds)) as u32)
}
