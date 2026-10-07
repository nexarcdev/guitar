//! Minimal logging: a file under %LOCALAPPDATA%\Fretline on Windows (the engine has no console),
//! stderr elsewhere.

use std::fs::File;
use std::io::Write;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static SINK: Mutex<Option<File>> = Mutex::new(None);

pub fn init() {
    #[cfg(windows)]
    if let Some(dir) = std::env::var_os("LOCALAPPDATA") {
        let dir = std::path::PathBuf::from(dir).join("Fretline");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("engine.log");
        // Keep one previous log; never let it grow without bound.
        if std::fs::metadata(&path).map(|m| m.len() > 1 << 20).unwrap_or(false) {
            let _ = std::fs::rename(&path, dir.join("engine.old.log"));
        }
        if let Ok(f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            *SINK.lock().unwrap() = Some(f);
        }
    }
}

pub fn write(line: std::fmt::Arguments) {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0);
    let text = format!("[{t:.3}] {line}\n");
    match SINK.lock().unwrap().as_mut() {
        Some(f) => {
            let _ = f.write_all(text.as_bytes());
        }
        None => eprint!("{text}"),
    }
}

#[macro_export]
macro_rules! log {
    ($($arg:tt)*) => { $crate::logging::write(format_args!($($arg)*)) };
}
