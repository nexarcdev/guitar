//! Real-time guitar DSP for the Fretline low-latency engine. Platform-independent and allocation-
//! free on the per-sample path, so it can be unit tested anywhere and run on a real-time thread.

pub mod chain;
pub mod conditioner;
pub mod drift;
pub mod looper;
pub mod pedals;
pub mod util;

pub use chain::{Chain, Command, PedalSetting};
pub use pedals::PedalKind;
