//! Notification-area icon: the only UI the engine has. Shows the state (a dot on the Fretline
//! mark: gold waiting, green connected, red problem), opens the app, quits.

use crate::log;
use std::sync::{Arc, Mutex};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIconBuilder};
use windows::core::{w, HSTRING};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW, MsgWaitForMultipleObjects, PeekMessageW, TranslateMessage, MSG, PM_REMOVE, QS_ALLINPUT, SW_SHOWNORMAL, WM_QUIT};

pub const APP_URL: &str = "https://nexarcdev.github.io/guitar/";

#[derive(Clone, Copy, PartialEq)]
enum Dot {
    Waiting,
    Connected,
    Problem,
}

fn dot_for(status: &str) -> Dot {
    if status.starts_with("Problem") {
        Dot::Problem
    } else if status.starts_with("Connected") {
        Dot::Connected
    } else {
        Dot::Waiting
    }
}

/// The Fretline mark (gold-to-red rounded square with four strings) at 32 px, with a status dot.
fn icon(dot: Dot) -> Icon {
    const N: usize = 32;
    let mut px = vec![0u8; N * N * 4];
    let inside = |x: f32, y: f32, x0: f32, y0: f32, x1: f32, y1: f32, r: f32| {
        let cx = x.clamp(x0 + r, x1 - r);
        let cy = y.clamp(y0 + r, y1 - r);
        (x - cx).powi(2) + (y - cy).powi(2) <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1
    };
    let (gold, red, ink) = ([0xe9, 0xb9, 0x49], [0xe0, 0x40, 0x40], [0x14, 0x0b, 0x0c]);
    let dot_rgb = match dot {
        Dot::Waiting => [0xf6, 0xd9, 0x8a],
        Dot::Connected => [0x4a, 0xde, 0x80],
        Dot::Problem => [0xff, 0x55, 0x55],
    };
    for y in 0..N {
        for x in 0..N {
            let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
            let i = (y * N + x) * 4;
            let mut c: Option<[u8; 3]> = None;
            if inside(fx, fy, 1.0, 1.0, 31.0, 31.0, 7.0) {
                c = Some(ink);
            }
            if inside(fx, fy, 6.0, 6.0, 26.0, 26.0, 6.0) {
                let t = ((fx + fy) / 64.0).clamp(0.0, 1.0);
                let mut g = [0u8; 3];
                for k in 0..3 {
                    g[k] = (gold[k] as f32 * (1.0 - t) + red[k] as f32 * t) as u8;
                }
                let string = [11, 15, 19, 23].contains(&x) && (9..23).contains(&y);
                c = Some(if string { ink } else { g });
            }
            let (dx, dy) = (fx - 25.0, fy - 25.0);
            let d2 = dx * dx + dy * dy;
            if d2 <= 36.0 {
                c = Some(if d2 >= 20.0 { ink } else { dot_rgb });
            }
            if let Some(rgb) = c {
                px[i..i + 3].copy_from_slice(&rgb);
                px[i + 3] = 255;
            }
        }
    }
    Icon::from_rgba(px, N as u32, N as u32).expect("icon")
}

pub fn open_app() {
    unsafe {
        ShellExecuteW(None, w!("open"), &HSTRING::from(APP_URL), None, None, SW_SHOWNORMAL);
    }
}

/// Runs the tray on the main thread until the user quits.
pub fn run(status: Arc<Mutex<String>>) {
    let menu = Menu::new();
    let state = MenuItem::new("Waiting for Fretline", false, None);
    let open = MenuItem::new("Open Fretline", true, None);
    let quit = MenuItem::new("Quit Fretline engine", true, None);
    let _ = menu.append_items(&[&state, &PredefinedMenuItem::separator(), &open, &quit]);
    let mut dot = Dot::Waiting;
    let tray = match TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip("Fretline engine: waiting for Fretline")
        .with_icon(icon(dot))
        .build()
    {
        Ok(t) => t,
        Err(e) => {
            // No tray (e.g. a session without Explorer): keep the engine running headless.
            log!("tray unavailable: {e}");
            loop {
                std::thread::park();
            }
        }
    };
    let mut shown = String::new();
    loop {
        unsafe {
            MsgWaitForMultipleObjects(None, false, 100, QS_ALLINPUT);
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                if msg.message == WM_QUIT {
                    return;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        while let Ok(ev) = MenuEvent::receiver().try_recv() {
            if ev.id == *open.id() {
                open_app();
            } else if ev.id == *quit.id() {
                log!("quit from tray");
                std::process::exit(0);
            }
        }
        let now = status.lock().unwrap().clone();
        if now != shown {
            state.set_text(&now);
            let _ = tray.set_tooltip(Some(format!("Fretline engine: {now}")));
            let d = dot_for(&now);
            if d != dot {
                dot = d;
                let _ = tray.set_icon(Some(icon(dot)));
            }
            shown = now;
        }
    }
}
