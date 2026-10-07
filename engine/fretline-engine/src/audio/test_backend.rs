//! A device-free backend for development and end-to-end tests: the "guitar" is a WAV file (or a
//! built-in plucked-string phrase) played in real time and looped, and the "speakers" are a
//! real-time clock that can record what they were given to a WAV file.

use super::{Backend, ErrorFn, MakeInput, MakeOutput, Stream};
use crate::protocol::{DeviceInfo, StreamInfo};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const BLOCK: usize = 128;
const OUT_RATE: u32 = 48000;

pub struct TestBackend {
    wav: Option<PathBuf>,
    record: Option<PathBuf>,
}

impl TestBackend {
    pub fn new(wav: Option<PathBuf>, record: Option<PathBuf>) -> Self {
        Self { wav, record }
    }
}

struct TestStream {
    info: StreamInfo,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl Stream for TestStream {
    fn info(&self) -> &StreamInfo {
        &self.info
    }
}

impl Drop for TestStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

/// Runs `tick` every `BLOCK` frames of real time until stopped.
fn paced(rate: u32, stop: Arc<AtomicBool>, mut tick: impl FnMut() + Send + 'static) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let period = Duration::from_secs_f64(BLOCK as f64 / rate as f64);
        let mut next = Instant::now();
        while !stop.load(Ordering::Relaxed) {
            tick();
            next += period;
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else if now - next > Duration::from_millis(200) {
                next = now; // fell far behind (suspended); don't burst to catch up
            }
        }
    })
}

fn stream_info(id: &str, name: &str, rate: u32) -> StreamInfo {
    StreamInfo { id: id.into(), name: name.into(), rate, period_ms: BLOCK as f32 * 1000.0 / rate as f32, device_ms: 0.0, mode: "test".into() }
}

fn load_wav(path: &PathBuf) -> Result<(Vec<f32>, u32), String> {
    let mut r = hound::WavReader::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let spec = r.spec();
    let ch = spec.channels.max(1) as usize;
    let raw: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().filter_map(Result::ok).collect(),
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().filter_map(Result::ok).map(|v| v as f32 * scale).collect()
        }
    };
    let mono = raw.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect::<Vec<_>>();
    if mono.is_empty() {
        return Err(format!("{}: no samples", path.display()));
    }
    Ok((mono, spec.sample_rate))
}

/// Karplus-Strong plucks: single notes, then an A major chord, with a little hiss underneath.
fn phrase(rate: u32) -> Vec<f32> {
    let sr = rate as f32;
    let mut out = vec![0.0f32; (sr * 6.0) as usize];
    let mut seed = 12345u64;
    let mut rnd = move || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) as f32 / (1u64 << 31) as f32 * 2.0 - 1.0
    };
    let events: [(f32, &[f32]); 4] = [(0.0, &[110.0]), (1.5, &[146.83]), (3.0, &[196.0]), (4.5, &[110.0, 138.59, 164.81, 220.0])];
    for (at, freqs) in events {
        for &f in freqs {
            let n = (sr / f).round() as usize;
            let mut line: Vec<f32> = (0..n).map(|_| rnd() * 0.25).collect();
            let start = (at * sr) as usize;
            let len = (sr * 1.45) as usize;
            for i in 0..len.min(out.len() - start) {
                let j = i % n;
                let k = (i + 1) % n;
                let v = line[j];
                line[j] = 0.996 * 0.5 * (line[j] + line[k]);
                out[start + i] += v;
            }
        }
    }
    for v in out.iter_mut() {
        *v += rnd() * 0.0003;
    }
    out
}

impl Backend for TestBackend {
    fn inputs(&mut self) -> Vec<DeviceInfo> {
        vec![DeviceInfo { id: "test-in".into(), name: "Test guitar (WAV)".into() }]
    }

    fn outputs(&mut self) -> Vec<DeviceInfo> {
        vec![DeviceInfo { id: "test-out".into(), name: "Test speakers".into() }]
    }

    fn open_input(&mut self, _id: &str, _exclusive: bool, make: MakeInput, _on_error: ErrorFn) -> Result<Box<dyn Stream>, String> {
        let (samples, rate) = match &self.wav {
            Some(p) => load_wav(p)?,
            None => (phrase(48000), 48000),
        };
        let info = stream_info("test-in", "Test guitar (WAV)", rate);
        let mut cb = make(&info);
        let stop = Arc::new(AtomicBool::new(false));
        let mut pos = 0usize;
        let mut block = vec![0.0f32; BLOCK];
        let join = paced(rate, stop.clone(), move || {
            for v in block.iter_mut() {
                *v = samples[pos];
                pos = (pos + 1) % samples.len();
            }
            cb(&block);
        });
        Ok(Box::new(TestStream { info, stop, join: Some(join) }))
    }

    fn open_output(&mut self, _id: &str, _exclusive: bool, make: MakeOutput, _on_error: ErrorFn) -> Result<Box<dyn Stream>, String> {
        let info = stream_info("test-out", "Test speakers", OUT_RATE);
        let mut cb = make(&info);
        let stop = Arc::new(AtomicBool::new(false));
        let mut writer = match &self.record {
            Some(p) => {
                let spec = hound::WavSpec { channels: 1, sample_rate: OUT_RATE, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
                Some(hound::WavWriter::create(p, spec).map_err(|e| format!("{}: {e}", p.display()))?)
            }
            None => None,
        };
        let mut block = vec![0.0f32; BLOCK];
        let mut n = 0usize;
        let join = paced(OUT_RATE, stop.clone(), move || {
            cb(&mut block);
            if let Some(w) = writer.as_mut() {
                for &v in &block {
                    let _ = w.write_sample(v);
                }
                n += 1;
                if n % 375 == 0 {
                    let _ = w.flush(); // keeps the header valid if the process is killed
                }
            }
        });
        Ok(Box::new(TestStream { info, stop, join: Some(join) }))
    }
}
