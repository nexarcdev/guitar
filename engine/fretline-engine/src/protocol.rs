//! The engine's transport: the shared protocol (fretline_core::protocol) as JSON text frames on
//! a localhost WebSocket. Only Fretline's own pages may connect: the engine can hear the guitar
//! and drive the speakers, and any web page can try to open ws://127.0.0.1.

pub const DEFAULT_PORT: u16 = 47831;

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
    fn only_fretline_origins_are_allowed() {
        assert!(origin_allowed("https://nexarcdev.github.io"));
        assert!(origin_allowed("http://localhost:5173"));
        assert!(!origin_allowed("https://evil.example"));
        assert!(!origin_allowed("https://nexarcdev.github.io.evil.example"));
        assert!(!origin_allowed("null"));
    }
}
