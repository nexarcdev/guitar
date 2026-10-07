//! Fretline low-latency engine. Owns the guitar input and the speakers, runs the pedalboard at a
//! few milliseconds of latency, and streams the guitar to the Fretline web app (which keeps doing
//! all the listening: tuner, chords, tabs) over ws://127.0.0.1:47831.
//!
//! Usage: fretline-engine [--port N] [--test] [--test-wav FILE] [--record FILE]
//!   --test          use the device-free test backend (default off Windows)
//!   --test-wav      play FILE as the guitar (implies --test)
//!   --record        write what the speakers would play to FILE (test backend)

#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod audio;
mod engine;
mod logging;
mod protocol;
mod server;
#[cfg(windows)]
mod tray;

use audio::test_backend::TestBackend;
use audio::Backend;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

struct Args {
    port: u16,
    test: bool,
    wav: Option<PathBuf>,
    record: Option<PathBuf>,
}

fn args() -> Args {
    let mut a = Args { port: protocol::DEFAULT_PORT, test: !cfg!(windows), wav: None, record: None };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--port" => a.port = it.next().and_then(|v| v.parse().ok()).unwrap_or(a.port),
            "--test" => a.test = true,
            "--test-wav" => {
                a.test = true;
                a.wav = it.next().map(PathBuf::from);
            }
            "--record" => a.record = it.next().map(PathBuf::from),
            _ => log!("ignoring argument {arg}"),
        }
    }
    a
}

fn main() {
    logging::init();
    let a = args();
    log!("Fretline engine {} starting", engine::VERSION);

    // Binding doubles as the single-instance check.
    let listener = match TcpListener::bind(("127.0.0.1", a.port)) {
        Ok(l) => l,
        Err(e) => {
            log!("port {} unavailable ({e}); is the engine already running?", a.port);
            return;
        }
    };

    let backend: Box<dyn Backend> = if a.test {
        Box::new(TestBackend::new(a.wav, a.record))
    } else {
        platform_backend()
    };

    let clients = Arc::new(Mutex::new(Vec::new()));
    let tray_status = Arc::new(Mutex::new("Waiting for Fretline".to_string()));
    let (tx, rx) = crossbeam_channel::unbounded();
    let (sup, pump) = engine::Supervisor::new(backend, clients, tx.clone(), tray_status.clone());
    std::thread::Builder::new().name("supervisor".into()).spawn(move || sup.run(rx)).unwrap();
    std::thread::Builder::new().name("pump".into()).spawn(move || pump.run()).unwrap();
    std::thread::Builder::new().name("server".into()).spawn(move || server::serve(listener, tx)).unwrap();
    log!("listening on 127.0.0.1:{}", a.port);

    #[cfg(windows)]
    tray::run(tray_status);
    #[cfg(not(windows))]
    {
        let _ = tray_status;
        loop {
            std::thread::park();
        }
    }
}

#[cfg(windows)]
fn platform_backend() -> Box<dyn Backend> {
    Box::new(audio::wasapi::Wasapi::new())
}

#[cfg(not(windows))]
fn platform_backend() -> Box<dyn Backend> {
    Box::new(TestBackend::new(None, None))
}
