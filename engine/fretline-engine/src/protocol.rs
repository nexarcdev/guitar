//! Messages between the Fretline web app and the engine over the localhost WebSocket.
//!
//! Text frames are JSON (below). Binary frames, engine → web only, carry the guitar signal for
//! the web app's tuner/chords/tabs analysis:
//!   bytes 0..4  b"FLA1"
//!   bytes 4..8  u32 LE sample rate
//!   bytes 8..16 f64 LE index of the first sample (the engine's listening clock)
//!   bytes 16..  f32 LE mono samples

use serde::{Deserialize, Serialize};

pub const PROTOCOL: u32 = 1;
pub const DEFAULT_PORT: u16 = 47831;

#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ClientMsg {
    Hello { client: String, version: Option<String> },
    Pedals { pedals: Vec<PedalMsg> },
    Output { on: bool },
    Listen { on: bool },
    Loop { cmd: String, slot: usize },
    Floor { floor_db: f32, open_db: f32 },
    /// Device ids as listed in `Status`; empty string = system default.
    Devices { input: Option<String>, output: Option<String> },
    /// Exclusive mode per device. Exclusive input bypasses Windows input effects (noise
    /// reduction etc.) and shortens the input path; exclusive output is the lowest latency but
    /// silences other apps on that device while Fretline's Output is on.
    Exclusive { input: Option<bool>, output: Option<bool> },
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct PedalMsg {
    pub name: String,
    pub on: bool,
    pub level: f32,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub id: String,
    pub name: String,
    pub rate: u32,
    /// Processing period of the device stream, ms.
    pub period_ms: f32,
    /// Extra latency the driver reports beyond the period, ms.
    pub device_ms: f32,
    /// "exclusive" | "low-latency shared" | "shared" | "test"
    pub mode: String,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Latency {
    pub input_ms: f32,
    pub buffer_ms: f32,
    pub output_ms: f32,
    pub total_ms: f32,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub protocol: u32,
    pub version: String,
    pub inputs: Vec<DeviceInfo>,
    pub outputs: Vec<DeviceInfo>,
    pub input: Option<StreamInfo>,
    pub output: Option<StreamInfo>,
    pub latency: Option<Latency>,
    pub output_on: bool,
    pub exclusive_input: bool,
    pub exclusive_output: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlotView {
    pub state: &'static str,
    pub progress: f32,
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meters {
    pub gain_db: f32,
    pub floor_db: f32,
    pub gate: bool,
    /// Level actually sent to the speakers, dBFS.
    pub out_db: f32,
    pub underruns: u64,
    pub looper_len: usize,
    pub looper_free: bool,
    pub looper_rate: f32,
    pub slots: Vec<SlotView>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMsg {
    Status(Status),
    Meters(Meters),
}

pub fn audio_frame(rate: u32, t0: f64, samples: &[f32]) -> Vec<u8> {
    let mut b = Vec::with_capacity(16 + samples.len() * 4);
    b.extend_from_slice(b"FLA1");
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&t0.to_le_bytes());
    for s in samples {
        b.extend_from_slice(&s.to_le_bytes());
    }
    b
}

/// Only Fretline's own pages may talk to the engine: it can hear the guitar and drive the speakers.
pub fn origin_allowed(origin: &str) -> bool {
    let o = origin.trim_end_matches('/');
    o == "https://nexarcdev.github.io"
        || o.starts_with("http://localhost:")
        || o == "http://localhost"
        || o.starts_with("http://127.0.0.1:")
        || o == "http://127.0.0.1"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_web_messages() {
        let m: ClientMsg = serde_json::from_str(r#"{"type":"floor","floorDb":-70.5,"openDb":12}"#).unwrap();
        assert_eq!(m, ClientMsg::Floor { floor_db: -70.5, open_db: 12.0 });
        let m: ClientMsg = serde_json::from_str(r#"{"type":"pedals","pedals":[{"name":"Delay","on":true,"level":45}]}"#).unwrap();
        assert!(matches!(m, ClientMsg::Pedals { .. }));
        let m: ClientMsg = serde_json::from_str(r#"{"type":"devices","input":"abc"}"#).unwrap();
        assert_eq!(m, ClientMsg::Devices { input: Some("abc".into()), output: None });
    }

    #[test]
    fn serializes_status_for_the_web() {
        let s = serde_json::to_string(&ServerMsg::Status(Status { output_on: true, ..Default::default() })).unwrap();
        assert!(s.contains(r#""type":"status""#) && s.contains(r#""outputOn":true"#), "{s}");
    }

    #[test]
    fn only_fretline_origins_are_allowed() {
        assert!(origin_allowed("https://nexarcdev.github.io"));
        assert!(origin_allowed("http://localhost:5173"));
        assert!(!origin_allowed("https://evil.example"));
        assert!(!origin_allowed("https://nexarcdev.github.io.evil.example"));
        assert!(!origin_allowed("null"));
    }

    #[test]
    fn audio_frames_have_the_documented_layout() {
        let f = audio_frame(48000, 1024.0, &[0.5, -0.25]);
        assert_eq!(&f[0..4], b"FLA1");
        assert_eq!(u32::from_le_bytes(f[4..8].try_into().unwrap()), 48000);
        assert_eq!(f64::from_le_bytes(f[8..16].try_into().unwrap()), 1024.0);
        assert_eq!(f32::from_le_bytes(f[16..20].try_into().unwrap()), 0.5);
        assert_eq!(f.len(), 24);
    }
}
