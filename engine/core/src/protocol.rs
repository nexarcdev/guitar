//! The one vocabulary every Fretline audio channel speaks, whether it runs in the browser
//! (WebAssembly) or in the native engine (over a WebSocket). A client sends `ControlMsg`s and
//! receives `ChannelMsg`s; it never needs to know which channel it is talking to.
//!
//! Shared session state (pedals, Output, gate, noise floor, devices…) lives in the channel and
//! is broadcast whole, with a revision and an edit time, whenever it changes. That keeps any
//! number of controllers (a browser tab today, a tablet on the LAN later) in step: each renders
//! the state it receives and sends patches; the newest edit wins when a controller reconnects.
//! JSON, camelCase, tagged by `type`.

use crate::floor::FloorMode;
use crate::ml::MlNotes;
use crate::synth::NoteSpec;
use crate::tracker::TrackerOutput;
use serde::{Deserialize, Serialize};

/// Bump when a message changes incompatibly.
pub const PROTOCOL: u32 = 3;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PedalState {
    pub name: String,
    pub on: bool,
    pub level: f32,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FloorSetting {
    pub mode: FloorMode,
    /// Used in manual mode, dBFS.
    pub manual_db: f32,
}

impl Default for FloorSetting {
    fn default() -> Self {
        Self { mode: FloorMode::Auto, manual_db: -70.0 }
    }
}

/// Everything a controller can change, owned by the channel.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    /// Increments on every change.
    pub rev: u64,
    /// Wall-clock time (ms since 1970) of the last edit, for "newest edit wins" on reconnect.
    pub edited_at: f64,
    /// The board, in signal order.
    pub pedals: Vec<PedalState>,
    /// The guitar through the pedals to the speakers.
    pub output: bool,
    /// Noise gate margin above the floor, dB.
    pub gate_db: f32,
    /// Noise floor for the current input (remembered per input device).
    pub floor: FloorSetting,
    /// basic-pitch chord and tab transcription.
    pub ml: bool,
    /// Device ids in the channel's own namespace ('' = system default).
    pub input_id: String,
    pub output_id: String,
    /// Engine only: exclusive device access.
    pub exclusive_input: bool,
    pub exclusive_output: bool,
}

/// A partial `SessionState`: only the fields present change.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StatePatch {
    pub pedals: Option<Vec<PedalState>>,
    pub output: Option<bool>,
    pub gate_db: Option<f32>,
    pub floor: Option<FloorSetting>,
    pub ml: Option<bool>,
    pub input_id: Option<String>,
    pub output_id: Option<String>,
    pub exclusive_input: Option<bool>,
    pub exclusive_output: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LoopCmd {
    Tap,
    Stop,
    Clear,
}

/// Client → channel.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ControlMsg {
    Hello {
        client: String,
        #[serde(default)]
        version: Option<String>,
    },
    /// Change shared state. `at` = when the edit was made (ms since 1970); the channel's clock
    /// is used when absent.
    Set {
        state: StatePatch,
        #[serde(default)]
        at: Option<f64>,
    },
    /// This client wants analysis (tuner, chords, tabs). Per client, not shared.
    Listen { on: bool },
    /// Measure the noise floor afresh (strings muted).
    Recalibrate,
    Loop { cmd: LoopCmd, slot: usize },
    /// Synth notes (strums, string previews, riff playback, reference tones) as a group.
    Play {
        group: u32,
        notes: Vec<NoteSpec>,
        /// Seconds from now until `at` = 0 (default 50 ms).
        #[serde(default)]
        lead: Option<f64>,
    },
    /// Stop one group, or all synth sound.
    Stop {
        #[serde(default)]
        group: Option<u32>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub id: String,
    pub name: String,
    pub rate: u32,
    /// Processing period of the device stream, ms.
    pub period_ms: f32,
    /// Extra latency beyond the period, ms.
    pub device_ms: f32,
    /// "exclusive" | "low-latency shared" | "shared" | "browser" | "test"
    pub mode: String,
    /// Why the stream isn't in the mode asked for (e.g. exclusive refused), when it isn't.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Latency {
    pub input_ms: f32,
    pub buffer_ms: f32,
    pub output_ms: f32,
    pub total_ms: f32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub protocol: u32,
    pub version: String,
    /// "engine" | "web"
    pub kind: String,
    pub inputs: Vec<DeviceInfo>,
    pub outputs: Vec<DeviceInfo>,
    pub input: Option<StreamInfo>,
    pub output: Option<StreamInfo>,
    pub latency: Option<Latency>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MlState {
    #[default]
    Off,
    Loading,
    Ready,
    /// Inference can't keep up in real time here; transcription paused.
    Slow,
    Unavailable,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct MlStatus {
    pub status: MlState,
    /// What runs the model ("native", "webgl", "wasm", "cpu").
    pub backend: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SlotMsg {
    pub state: String,
    pub progress: f32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct LooperMsg {
    /// Loop length in samples, 0 until the first loop is closed.
    pub len: usize,
    /// The first loop is being recorded and has no length yet.
    pub free: bool,
    pub rate: f32,
    pub slots: Vec<SlotMsg>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meters {
    /// Automatic level applied to the monitored guitar, dB.
    pub gain_db: f32,
    /// What the channel sends to the speakers, dBFS (peak since the last meters).
    pub out_db: f32,
    pub underruns: u64,
    pub looper: LooperMsg,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Analysis {
    /// Listening-clock seconds at the end of this chunk.
    pub clock: f64,
    #[serde(flatten)]
    pub out: TrackerOutput,
}

/// How one device stream has been keeping time. Gaps and work are the worst in the last 10 s.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamHealth {
    /// The device's period: how often it should call, ms.
    pub period_ms: f32,
    /// Longest time between two calls, ms.
    pub worst_gap_ms: f32,
    /// Longest the engine took to handle one call, ms (over the period = can't keep up).
    pub worst_work_ms: f32,
    /// Calls that came more than half a period (and 1 ms) late, since the stream opened.
    pub late: u64,
    /// Glitches Windows reported: input data lost, or speakers that ran dry before we wrote.
    pub glitches: u64,
    /// Times the stream failed and was reopened since the engine started.
    pub restarts: u64,
}

/// The buffer between the guitar input and the speakers.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BufferHealth {
    /// What it holds now, ms.
    pub target_ms: f32,
    /// What the worst moment in the last 30 s needed, ms.
    pub needed_ms: f32,
    /// Safety margin on top, ms (widens for a while after the speakers ran dry).
    pub margin_ms: f32,
    /// Least audio left over in the last 30 s, ms (negative = ran dry by that much).
    pub lowest_ms: f32,
    /// The largest it may grow, ms.
    pub max_ms: f32,
    /// The input clock against the speakers' clock, ppm.
    pub drift_ppm: f32,
    /// Times the speakers ran out of guitar audio since the speakers opened.
    pub underruns: u64,
    /// How much the latest of those was short by, ms.
    pub last_short_ms: f32,
    /// Times audio piled up (the speakers stalled) and was skipped.
    pub overflows: u64,
    /// It wanted to be larger than `max_ms`.
    pub limited: bool,
}

/// Something the engine did or ran into, for the player to read without opening a log.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineEvent {
    /// Increments per event.
    pub seq: u64,
    /// ms since 1970.
    pub at: f64,
    /// "info" | "warn" | "error"
    pub level: String,
    /// "input" | "output" | "buffer" | "engine"
    pub source: String,
    pub text: String,
    /// How many times in a row it happened (`at` is the latest).
    pub repeat: u32,
}

/// Engine only, twice a second: timing, buffer and recent events.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Telemetry {
    pub input: Option<StreamHealth>,
    pub output: Option<StreamHealth>,
    pub buffer: Option<BufferHealth>,
    /// The latest events, oldest first.
    pub events: Vec<EngineEvent>,
}

/// Channel → client.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChannelMsg {
    Status(Status),
    State(SessionState),
    Analysis(Analysis),
    Notes(MlNotes),
    Ml(MlStatus),
    Meters(Meters),
    Telemetry(Telemetry),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_messages_parse_from_the_web_app() {
        let m: ControlMsg = serde_json::from_str(r#"{"type":"set","state":{"output":true,"floor":{"mode":"manual","manualDb":-62}}}"#).unwrap();
        let ControlMsg::Set { state, at } = m else { panic!() };
        assert_eq!(state.output, Some(true));
        assert_eq!(state.floor, Some(FloorSetting { mode: FloorMode::Manual, manual_db: -62.0 }));
        assert_eq!(at, None);
        let m: ControlMsg = serde_json::from_str(r#"{"type":"play","group":3,"notes":[{"at":0,"hz":110,"dur":1.4}]}"#).unwrap();
        assert!(matches!(m, ControlMsg::Play { group: 3, .. }));
        let m: ControlMsg = serde_json::from_str(r#"{"type":"recalibrate"}"#).unwrap();
        assert_eq!(m, ControlMsg::Recalibrate);
        let m: ControlMsg = serde_json::from_str(r#"{"type":"loop","cmd":"tap","slot":1}"#).unwrap();
        assert_eq!(m, ControlMsg::Loop { cmd: LoopCmd::Tap, slot: 1 });
    }

    #[test]
    fn channel_messages_are_tagged_camel_case() {
        let s = serde_json::to_string(&ChannelMsg::Ml(MlStatus { status: MlState::Ready, backend: "native".into() })).unwrap();
        assert_eq!(s, r#"{"type":"ml","status":"ready","backend":"native"}"#);
        let s = serde_json::to_string(&ChannelMsg::Meters(Meters::default())).unwrap();
        assert!(s.starts_with(r#"{"type":"meters","gainDb":0.0"#), "{s}");
    }
}
