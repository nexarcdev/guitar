//! Fretline's audio and detection core, shared by every channel: compiled natively into the
//! engine and to WebAssembly for the browser, so both play and hear exactly the same way.
//! Platform-independent and allocation-free on the per-sample path.

pub mod chain;
pub mod chroma;
pub mod conditioner;
pub mod drift;
pub mod fft;
pub mod floor;
pub mod looper;
pub mod pedals;
pub mod resample;
pub mod synth;
pub mod tracker;
pub mod util;
pub mod yin;

pub use chain::{Chain, Command, PedalSetting};
pub use pedals::PedalKind;
