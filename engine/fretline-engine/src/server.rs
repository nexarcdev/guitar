//! Localhost WebSocket server. Each connection gets a thread that relays parsed messages to the
//! supervisor and drains that client's outbound queue. Only Fretline's own origins are accepted:
//! any web page can try to open ws://127.0.0.1, and this one can hear the guitar.

use crate::engine::{Event, Out};
use crate::log;
use crate::protocol::{origin_allowed, ClientMsg};
use crossbeam_channel::{RecvTimeoutError, Sender};
use std::io::ErrorKind;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::protocol::WebSocketConfig;
use tungstenite::error::ProtocolError;
use tungstenite::{Error, Message};

pub fn serve(listener: TcpListener, events: Sender<Event>) {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let events = events.clone();
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        std::thread::spawn(move || {
            if let Err(e) = client(id, stream, &events) {
                log!("client {id}: {e}");
            }
        });
    }
}

fn client(id: u64, stream: TcpStream, events: &Sender<Event>) -> Result<(), String> {
    stream.set_nodelay(true).ok();
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let check = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        let origin = req.headers().get("origin").and_then(|v| v.to_str().ok()).unwrap_or("");
        if origin_allowed(origin) {
            Ok(resp)
        } else {
            log!("refused origin {origin:?}");
            let mut r = ErrorResponse::new(Some("Fretline engine only accepts the Fretline app.".into()));
            *r.status_mut() = tungstenite::http::StatusCode::FORBIDDEN;
            Err(r)
        }
    };
    // A client that stops reading must not grow memory without bound.
    let config = WebSocketConfig::default().max_write_buffer_size(8 << 20);
    let mut ws = tungstenite::accept_hdr_with_config(stream, check, Some(config)).map_err(|e| format!("handshake: {e}"))?;
    ws.get_mut().set_nonblocking(true).map_err(|e| e.to_string())?;

    let (tx, rx) = crossbeam_channel::bounded::<Out>(256);
    events.send(Event::Connected { id, tx }).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        loop {
            // Inbound: everything that's ready.
            loop {
                match ws.read() {
                    Ok(Message::Text(t)) => match serde_json::from_str::<ClientMsg>(t.as_str()) {
                        Ok(m) => events.send(Event::Msg(id, m)).map_err(|e| e.to_string())?,
                        Err(e) => log!("client {id}: bad message {e}: {}", t.as_str()),
                    },
                    Ok(Message::Close(_)) => return Ok(()),
                    Ok(_) => {}
                    Err(Error::Io(e)) if e.kind() == ErrorKind::WouldBlock => break,
                    Err(Error::ConnectionClosed | Error::AlreadyClosed) => return Ok(()),
                    // A closed tab doesn't always say goodbye.
                    Err(Error::Protocol(ProtocolError::ResetWithoutClosingHandshake)) => return Ok(()),
                    Err(e) => return Err(e.to_string()),
                }
            }
            // Outbound: wait briefly for something to send, then send all that's queued.
            let first = match rx.recv_timeout(Duration::from_millis(4)) {
                Ok(m) => Some(m),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return Ok(()),
            };
            for m in first.into_iter().chain(rx.try_iter()) {
                let msg = match m {
                    Out::Text(t) => Message::text(t),
                    Out::Binary(b) => Message::binary(b),
                };
                match ws.write(msg) {
                    Ok(()) => {}
                    // Queued; the socket is just busy.
                    Err(Error::Io(e)) if e.kind() == ErrorKind::WouldBlock => {}
                    Err(Error::WriteBufferFull(_)) => {}
                    Err(e) => return Err(e.to_string()),
                }
            }
            match ws.flush() {
                Ok(()) => {}
                Err(Error::Io(e)) if e.kind() == ErrorKind::WouldBlock => {}
                Err(Error::ConnectionClosed) => return Ok(()),
                Err(e) => return Err(e.to_string()),
            }
        }
    })();
    let _ = events.send(Event::Disconnected(id));
    result
}
