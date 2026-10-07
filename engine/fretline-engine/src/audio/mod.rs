//! Audio device backends. Every backend delivers the guitar as mono f32 blocks on its own
//! real-time thread and asks for mono f32 blocks for the speakers on another; channel layout,
//! sample formats and device modes stay inside the backend.

pub mod test_backend;
#[cfg(windows)]
pub mod wasapi;

use crate::protocol::{DeviceInfo, StreamInfo};

/// Called on the capture thread with each block of guitar samples.
pub type InputFn = Box<dyn FnMut(&[f32]) + Send>;
/// Called on the render thread to fill each block for the speakers.
pub type OutputFn = Box<dyn FnMut(&mut [f32]) + Send>;
/// Builds the block callback once the stream's real format (rate, period) is known.
pub type MakeInput = Box<dyn FnOnce(&StreamInfo) -> InputFn + Send>;
pub type MakeOutput = Box<dyn FnOnce(&StreamInfo) -> OutputFn + Send>;
/// Reports a fatal stream error (device unplugged, format changed) from the audio thread.
pub type ErrorFn = Box<dyn Fn(String) + Send>;

/// A running stream; dropping it stops the device and joins its thread.
pub trait Stream: Send {
    fn info(&self) -> &StreamInfo;
}

pub trait Backend: Send {
    fn inputs(&mut self) -> Vec<DeviceInfo>;
    fn outputs(&mut self) -> Vec<DeviceInfo>;
    /// `id` empty = system default.
    fn open_input(&mut self, id: &str, exclusive: bool, make: MakeInput, on_error: ErrorFn) -> Result<Box<dyn Stream>, String>;
    fn open_output(&mut self, id: &str, exclusive: bool, make: MakeOutput, on_error: ErrorFn) -> Result<Box<dyn Stream>, String>;
}
