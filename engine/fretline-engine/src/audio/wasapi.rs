//! Windows audio through WASAPI, no middleware, so we control every buffer.
//!
//! Each stream tries, in order:
//! 1. exclusive mode (when asked): the device's smallest period, no Windows audio engine and no
//!    input/output effects in the path (so "AI noise reduction" style processing can't touch
//!    the guitar). Other apps can't use that device meanwhile.
//! 2. low-latency shared mode (IAudioClient3): the audio engine's smallest period the driver
//!    allows (often 2–3 ms with the inbox drivers), other apps keep playing.
//! 3. regular shared mode (10 ms period) as a last resort.
//!
//! Streams are event driven on their own thread with "Pro Audio" MMCSS priority.

use super::{Backend, ErrorFn, InputFn, MakeInput, MakeOutput, OutputFn, Stream};
use crate::log;
use fretline_core::protocol::{DeviceInfo, StreamInfo};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;
use windows::core::{Interface, GUID, HSTRING, PCWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::{CloseHandle, HANDLE, S_OK, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
use windows::Win32::System::Threading::{AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW, CreateEventW, WaitForSingleObject};

const WAVE_FORMAT_PCM_TAG: u16 = 1;
const WAVE_FORMAT_IEEE_FLOAT_TAG: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE_TAG: u16 = 0xFFFE;
const SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const SUBTYPE_FLOAT: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

pub struct Wasapi;

impl Wasapi {
    pub fn new() -> Self {
        com_init();
        Self
    }
}

fn com_init() {
    // Multithreaded apartment: COM objects may be used from any of our threads. Repeated calls
    // on the same thread are harmless (S_FALSE).
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(|e| format!("audio devices unavailable: {e}"))
}

fn device_id(dev: &IMMDevice) -> Option<String> {
    unsafe {
        let p = dev.GetId().ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as _));
        s
    }
}

fn device_name(dev: &IMMDevice) -> String {
    unsafe {
        dev.OpenPropertyStore(STGM_READ)
            .and_then(|store| store.GetValue(&PKEY_Device_FriendlyName))
            .map(|v| v.to_string())
            .unwrap_or_else(|_| "Audio device".into())
    }
}

fn list(flow: EDataFlow) -> Vec<DeviceInfo> {
    com_init();
    let Ok(en) = enumerator() else { return Vec::new() };
    let mut out = Vec::new();
    unsafe {
        let Ok(col) = en.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) else { return out };
        let n = col.GetCount().unwrap_or(0);
        for i in 0..n {
            if let Ok(dev) = col.Item(i) {
                if let Some(id) = device_id(&dev) {
                    out.push(DeviceInfo { id, name: device_name(&dev) });
                }
            }
        }
    }
    out
}

fn find(flow: EDataFlow, id: &str) -> Result<IMMDevice, String> {
    let en = enumerator()?;
    unsafe {
        if id.is_empty() {
            en.GetDefaultAudioEndpoint(flow, eConsole)
                .map_err(|_| if flow == eCapture { "no input device is connected".to_string() } else { "no speakers or headphones are connected".to_string() })
        } else {
            let h = HSTRING::from(id);
            en.GetDevice(PCWSTR(h.as_ptr())).map_err(|_| "that device is no longer connected".to_string())
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    F32,
    I16,
    /// Packed 3-byte samples.
    I24,
    /// 32-bit container (24 or 32 valid bits; scaled the same either way).
    I32,
}

#[derive(Clone, Copy, Debug)]
struct Fmt {
    kind: Kind,
    channels: usize,
    rate: u32,
    align: usize,
}

/// Reads a device format. WAVEFORMATEX is packed, so fields are copied out, never borrowed.
unsafe fn parse(wf: *const WAVEFORMATEX) -> Option<Fmt> {
    let tag = { (*wf).wFormatTag };
    let bits = { (*wf).wBitsPerSample };
    let channels = { (*wf).nChannels } as usize;
    let rate = { (*wf).nSamplesPerSec };
    let align = { (*wf).nBlockAlign } as usize;
    let float = match tag {
        WAVE_FORMAT_IEEE_FLOAT_TAG => true,
        WAVE_FORMAT_PCM_TAG => false,
        WAVE_FORMAT_EXTENSIBLE_TAG => {
            let ext = wf as *const WAVEFORMATEXTENSIBLE;
            let sub = { (*ext).SubFormat };
            if sub == SUBTYPE_FLOAT {
                true
            } else if sub == SUBTYPE_PCM {
                false
            } else {
                return None;
            }
        }
        _ => return None,
    };
    let kind = match (float, bits) {
        (true, 32) => Kind::F32,
        (false, 16) => Kind::I16,
        (false, 24) => Kind::I24,
        (false, 32) => Kind::I32,
        _ => return None,
    };
    (channels > 0).then_some(Fmt { kind, channels, rate, align })
}

fn extensible(kind: Kind, valid: u16, channels: u16, rate: u32, mask: u32) -> WAVEFORMATEXTENSIBLE {
    let bits: u16 = match kind {
        Kind::F32 | Kind::I32 => 32,
        Kind::I24 => 24,
        Kind::I16 => 16,
    };
    let align = channels * bits / 8;
    WAVEFORMATEXTENSIBLE {
        Format: WAVEFORMATEX {
            wFormatTag: WAVE_FORMAT_EXTENSIBLE_TAG,
            nChannels: channels,
            nSamplesPerSec: rate,
            nAvgBytesPerSec: rate * align as u32,
            nBlockAlign: align,
            wBitsPerSample: bits,
            cbSize: (std::mem::size_of::<WAVEFORMATEXTENSIBLE>() - std::mem::size_of::<WAVEFORMATEX>()) as u16,
        },
        Samples: WAVEFORMATEXTENSIBLE_0 { wValidBitsPerSample: valid },
        dwChannelMask: mask,
        SubFormat: if kind == Kind::F32 { SUBTYPE_FLOAT } else { SUBTYPE_PCM },
    }
}

#[inline]
fn read_sample(kind: Kind, p: &[u8]) -> f32 {
    match kind {
        Kind::F32 => f32::from_le_bytes([p[0], p[1], p[2], p[3]]),
        Kind::I16 => i16::from_le_bytes([p[0], p[1]]) as f32 / 32768.0,
        Kind::I24 => (i32::from_le_bytes([0, p[0], p[1], p[2]]) >> 8) as f32 / 8_388_608.0,
        Kind::I32 => i32::from_le_bytes([p[0], p[1], p[2], p[3]]) as f32 / 2_147_483_648.0,
    }
}

#[inline]
fn write_sample(kind: Kind, v: f32, p: &mut [u8]) {
    let v = v.clamp(-1.0, 1.0);
    match kind {
        Kind::F32 => p[..4].copy_from_slice(&v.to_le_bytes()),
        Kind::I16 => p[..2].copy_from_slice(&((v * 32767.0) as i16).to_le_bytes()),
        Kind::I24 => p[..3].copy_from_slice(&((v * 8_388_607.0) as i32).to_le_bytes()[..3]),
        Kind::I32 => p[..4].copy_from_slice(&((v as f64 * 2_147_483_647.0) as i32).to_le_bytes()),
    }
}

/// Picks the guitar's channel on multi-channel inputs: many guitar cables and interfaces put the
/// instrument on one side only. Follows the clearly louder channel (by 6 dB, over ~1 s) so a
/// stereo-identical signal never flips back and forth.
struct ChannelPicker {
    energy: Vec<f32>,
    pick: usize,
}

impl ChannelPicker {
    fn new(channels: usize) -> Self {
        Self { energy: vec![0.0; channels], pick: 0 }
    }

    fn update(&mut self, data: &[u8], frames: usize, fmt: &Fmt, rate: u32) {
        if fmt.channels < 2 {
            return;
        }
        let a = (frames as f32 / rate as f32).min(1.0);
        let size = fmt.align / fmt.channels;
        for c in 0..fmt.channels {
            let mut e = 0.0;
            for f in 0..frames {
                let off = f * fmt.align + c * size;
                let v = read_sample(fmt.kind, &data[off..off + size]);
                e += v * v;
            }
            self.energy[c] += (e / frames.max(1) as f32 - self.energy[c]) * a;
        }
        let best = (0..fmt.channels).max_by(|&x, &y| self.energy[x].total_cmp(&self.energy[y])).unwrap_or(0);
        if self.energy[best] > self.energy[self.pick] * 4.0 {
            self.pick = best;
        }
    }
}

struct Opened {
    client: IAudioClient,
    fmt: Fmt,
    buffer_frames: u32,
    period_frames: u32,
    exclusive: bool,
    mode: &'static str,
}

fn hr_text(e: &windows::core::Error) -> String {
    let code = e.code();
    if code == AUDCLNT_E_DEVICE_IN_USE {
        "another app is using this device in exclusive mode".into()
    } else if code == AUDCLNT_E_DEVICE_INVALIDATED {
        "the device was disconnected or its format changed".into()
    } else if code == AUDCLNT_E_UNSUPPORTED_FORMAT {
        "the device does not support a usable format".into()
    } else if code == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED {
        "exclusive mode is turned off for this device in Windows Sound settings".into()
    } else {
        let m = e.message();
        if m.is_empty() { format!("error 0x{:08X}", code.0 as u32) } else { format!("{m} (0x{:08X})", code.0 as u32) }
    }
}

unsafe fn open_exclusive(dev: &IMMDevice) -> Result<Opened, String> {
    let client: IAudioClient = dev.Activate(CLSCTX_ALL, None).map_err(|e| hr_text(&e))?;
    let mix = client.GetMixFormat().map_err(|e| hr_text(&e))?;
    let mix_fmt = parse(mix);
    let mask = if { (*mix).wFormatTag } == WAVE_FORMAT_EXTENSIBLE_TAG { (*(mix as *const WAVEFORMATEXTENSIBLE)).dwChannelMask } else { 0 };
    let mix_ch = { (*mix).nChannels };
    let mix_rate = { (*mix).nSamplesPerSec };
    CoTaskMemFree(Some(mix as _));

    let mut rates = vec![mix_rate, 48000, 44100];
    rates.dedup();
    let mut chans = vec![mix_ch, 2, 1];
    chans.dedup();
    let kinds = [(Kind::F32, 32), (Kind::I32, 32), (Kind::I32, 24), (Kind::I24, 24), (Kind::I16, 16)];
    let mut chosen = None;
    'search: for &rate in &rates {
        for &ch in &chans {
            let m = if ch == mix_ch { mask } else if ch == 2 { 0x3 } else if ch == 1 { 0x4 } else { 0 };
            for &(kind, valid) in &kinds {
                let wf = extensible(kind, valid, ch, rate, m);
                if client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &wf.Format, None) == S_OK {
                    chosen = Some(wf);
                    break 'search;
                }
            }
        }
    }
    let wf = chosen.ok_or_else(|| format!("no exclusive format (mix format {mix_fmt:?})"))?;
    let fmt = parse(&wf.Format).ok_or("format")?;

    let mut def = 0i64;
    let mut min = 0i64;
    client.GetDevicePeriod(Some(&mut def), Some(&mut min)).map_err(|e| hr_text(&e))?;
    let flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
    let client = match client.Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, flags, min, min, &wf.Format, None) {
        Ok(()) => client,
        Err(e) if e.code() == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED => {
            // The driver wants a period that's a whole number of its own blocks: ask for exactly
            // the aligned size it reports, on a fresh client.
            let frames = client.GetBufferSize().map_err(|e| hr_text(&e))?;
            let period = (10_000_000.0 * frames as f64 / fmt.rate as f64 + 0.5) as i64;
            let c: IAudioClient = dev.Activate(CLSCTX_ALL, None).map_err(|e| hr_text(&e))?;
            c.Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, flags, period, period, &wf.Format, None).map_err(|e| hr_text(&e))?;
            c
        }
        Err(e) => return Err(hr_text(&e)),
    };
    let buffer_frames = client.GetBufferSize().map_err(|e| hr_text(&e))?;
    Ok(Opened { client, fmt, buffer_frames, period_frames: buffer_frames, exclusive: true, mode: "exclusive" })
}

unsafe fn open_shared(dev: &IMMDevice) -> Result<Opened, String> {
    let flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
    // Low-latency shared mode first.
    let low = (|| -> Result<Opened, String> {
        let c3: IAudioClient3 = dev.Activate(CLSCTX_ALL, None).map_err(|e| hr_text(&e))?;
        let mix = c3.GetMixFormat().map_err(|e| hr_text(&e))?;
        let r = (|| {
            let fmt = parse(mix).ok_or("unsupported mix format")?;
            let (mut def, mut fund, mut min, mut max) = (0u32, 0u32, 0u32, 0u32);
            c3.GetSharedModeEnginePeriod(mix, &mut def, &mut fund, &mut min, &mut max).map_err(|e| hr_text(&e))?;
            c3.InitializeSharedAudioStream(flags, min, mix, None).map_err(|e| hr_text(&e))?;
            let buffer_frames = c3.GetBufferSize().map_err(|e| hr_text(&e))?;
            log!("shared engine periods: default {def}, min {min}, fundamental {fund}, max {max} frames at {} Hz", fmt.rate);
            let mode = if min < def { "low-latency shared" } else { "shared" };
            Ok(Opened { client: c3.cast().map_err(|e| hr_text(&e))?, fmt, buffer_frames, period_frames: min, exclusive: false, mode })
        })();
        CoTaskMemFree(Some(mix as _));
        r
    })();
    match low {
        Ok(o) => return Ok(o),
        Err(e) => log!("low-latency shared mode unavailable ({e}); using regular shared mode"),
    }
    let client: IAudioClient = dev.Activate(CLSCTX_ALL, None).map_err(|e| hr_text(&e))?;
    let mix = client.GetMixFormat().map_err(|e| hr_text(&e))?;
    let r = (|| {
        let fmt = parse(mix).ok_or("unsupported mix format")?;
        client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, mix, None).map_err(|e| hr_text(&e))?;
        let mut def = 0i64;
        client.GetDevicePeriod(Some(&mut def), None).map_err(|e| hr_text(&e))?;
        let buffer_frames = client.GetBufferSize().map_err(|e| hr_text(&e))?;
        let period_frames = (def as f64 * fmt.rate as f64 / 10_000_000.0).round() as u32;
        Ok(Opened { client: client.clone(), fmt, buffer_frames, period_frames, exclusive: false, mode: "shared" })
    })();
    CoTaskMemFree(Some(mix as _));
    r
}

unsafe fn open(dev: &IMMDevice, exclusive: bool) -> Result<Opened, String> {
    if exclusive {
        match open_exclusive(dev) {
            Ok(o) => return Ok(o),
            Err(e) => log!("exclusive mode unavailable ({e}); trying shared"),
        }
    }
    open_shared(dev)
}

enum Callback {
    Capture(MakeInput),
    Render(MakeOutput),
}

struct WasapiStream {
    info: StreamInfo,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl Stream for WasapiStream {
    fn info(&self) -> &StreamInfo {
        &self.info
    }
}

impl Drop for WasapiStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

/// Opens the device on its own thread (where it will run), and returns once it is streaming.
fn spawn(flow: EDataFlow, id: &str, exclusive: bool, cb: Callback, on_error: ErrorFn) -> Result<Box<dyn Stream>, String> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<StreamInfo, String>>();
    let stop = Arc::new(AtomicBool::new(false));
    let id = id.to_string();
    let stop2 = stop.clone();
    let name = if flow == eCapture { "capture" } else { "render" };
    let join = std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            com_init();
            let setup = (|| unsafe {
                let dev = find(flow, &id)?;
                let o = open(&dev, exclusive)?;
                let latency = o.client.GetStreamLatency().unwrap_or(0) as f32 / 10_000.0;
                let period_ms = o.period_frames as f32 * 1000.0 / o.fmt.rate as f32;
                // Shared render keeps a second period queued (see run_render); count it.
                let queued_ms = if flow == eRender && !o.exclusive { render_queue(&o) as f32 * 1000.0 / o.fmt.rate as f32 - period_ms } else { 0.0 };
                let info = StreamInfo {
                    id: device_id(&dev).unwrap_or_default(),
                    name: device_name(&dev),
                    rate: o.fmt.rate,
                    period_ms,
                    device_ms: (latency - period_ms).max(0.0) + queued_ms.max(0.0),
                    mode: o.mode.into(),
                };
                log!("{name}: {} {:?}, buffer {} frames, period {} frames, stream latency {latency:.2} ms", info.mode, o.fmt, o.buffer_frames, o.period_frames);
                Ok::<_, String>((o, info))
            })();
            let (o, info) = match setup {
                Ok(v) => v,
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            let result = unsafe {
                let mut task = 0u32;
                let mmcss = AvSetMmThreadCharacteristicsW(windows::core::w!("Pro Audio"), &mut task).ok();
                let r = match cb {
                    Callback::Capture(make) => {
                        let f = make(&info);
                        run_capture(&o, f, &stop2, || {
                            let _ = ready_tx.send(Ok(info.clone()));
                        })
                    }
                    Callback::Render(make) => {
                        let f = make(&info);
                        run_render(&o, f, &stop2, || {
                            let _ = ready_tx.send(Ok(info.clone()));
                        })
                    }
                };
                if let Some(h) = mmcss {
                    let _ = AvRevertMmThreadCharacteristics(h);
                }
                r
            };
            if let Err(e) = result {
                if !stop2.load(Ordering::Relaxed) {
                    on_error(e);
                }
            }
        })
        .map_err(|e| e.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(info)) => Ok(Box::new(WasapiStream { info, stop, join: Some(join) })),
        Ok(Err(e)) => {
            let _ = join.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("the device did not start".into())
        }
    }
}

struct Event(HANDLE);
impl Drop for Event {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Waits for the device's next period; a device that stays silent for 2 s is treated as gone.
unsafe fn wait(ev: &Event, stop: &AtomicBool, misses: &mut u32) -> Result<bool, String> {
    if WaitForSingleObject(ev.0, 100) == WAIT_OBJECT_0 {
        *misses = 0;
        return Ok(true);
    }
    if stop.load(Ordering::Relaxed) {
        return Ok(false);
    }
    *misses += 1;
    if *misses >= 20 {
        return Err("the device stopped responding".into());
    }
    Ok(false)
}

unsafe fn run_capture(o: &Opened, mut f: InputFn, stop: &AtomicBool, started: impl FnOnce()) -> Result<(), String> {
    let ev = Event(CreateEventW(None, false, false, None).map_err(|e| hr_text(&e))?);
    o.client.SetEventHandle(ev.0).map_err(|e| hr_text(&e))?;
    let cap: IAudioCaptureClient = o.client.GetService().map_err(|e| hr_text(&e))?;
    o.client.Start().map_err(|e| hr_text(&e))?;
    started();
    let fmt = o.fmt;
    let size = fmt.align / fmt.channels;
    let mut picker = ChannelPicker::new(fmt.channels);
    let mut mono = vec![0.0f32; o.buffer_frames as usize * 2];
    let mut misses = 0;
    let r = (|| -> Result<(), String> {
        while !stop.load(Ordering::Relaxed) {
            if !wait(&ev, stop, &mut misses)? {
                continue;
            }
            loop {
                let n = cap.GetNextPacketSize().map_err(|e| hr_text(&e))?;
                if n == 0 {
                    break;
                }
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                cap.GetBuffer(&mut data, &mut frames, &mut flags, None, None).map_err(|e| hr_text(&e))?;
                let frames = frames as usize;
                if mono.len() < frames {
                    mono.resize(frames, 0.0);
                }
                if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                    mono[..frames].fill(0.0);
                } else {
                    let bytes = std::slice::from_raw_parts(data, frames * fmt.align);
                    picker.update(bytes, frames, &fmt, fmt.rate);
                    let off = picker.pick * size;
                    for (i, m) in mono[..frames].iter_mut().enumerate() {
                        let p = i * fmt.align + off;
                        *m = read_sample(fmt.kind, &bytes[p..p + size]);
                    }
                }
                cap.ReleaseBuffer(frames as u32).map_err(|e| hr_text(&e))?;
                f(&mono[..frames]);
            }
        }
        Ok(())
    })();
    let _ = o.client.Stop();
    r
}

/// Frames to keep queued in shared mode: two engine periods, not the whole (often 20 ms+)
/// buffer, so what we play reaches the speakers as soon as the engine can take it.
fn render_queue(o: &Opened) -> u32 {
    (o.period_frames * 2).clamp(1, o.buffer_frames)
}

unsafe fn run_render(o: &Opened, mut f: OutputFn, stop: &AtomicBool, started: impl FnOnce()) -> Result<(), String> {
    let ev = Event(CreateEventW(None, false, false, None).map_err(|e| hr_text(&e))?);
    o.client.SetEventHandle(ev.0).map_err(|e| hr_text(&e))?;
    let ren: IAudioRenderClient = o.client.GetService().map_err(|e| hr_text(&e))?;
    let fmt = o.fmt;
    let size = fmt.align / fmt.channels;
    // Start from silence so the first period doesn't play garbage.
    let pre = if o.exclusive { o.buffer_frames } else { render_queue(o) };
    ren.GetBuffer(pre).map_err(|e| hr_text(&e))?;
    ren.ReleaseBuffer(pre, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32).map_err(|e| hr_text(&e))?;
    o.client.Start().map_err(|e| hr_text(&e))?;
    started();
    let mut mono = vec![0.0f32; o.buffer_frames as usize];
    let mut misses = 0;
    let queue = render_queue(o);
    let r = (|| -> Result<(), String> {
        while !stop.load(Ordering::Relaxed) {
            if !wait(&ev, stop, &mut misses)? {
                continue;
            }
            let frames = if o.exclusive {
                o.buffer_frames
            } else {
                queue.saturating_sub(o.client.GetCurrentPadding().map_err(|e| hr_text(&e))?)
            } as usize;
            if frames == 0 {
                continue;
            }
            let data = ren.GetBuffer(frames as u32).map_err(|e| hr_text(&e))?;
            let out = std::slice::from_raw_parts_mut(data, frames * fmt.align);
            f(&mut mono[..frames]);
            for (i, &v) in mono[..frames].iter().enumerate() {
                for c in 0..fmt.channels {
                    let p = i * fmt.align + c * size;
                    write_sample(fmt.kind, v, &mut out[p..p + size]);
                }
            }
            ren.ReleaseBuffer(frames as u32, 0).map_err(|e| hr_text(&e))?;
        }
        Ok(())
    })();
    let _ = o.client.Stop();
    r
}

impl Backend for Wasapi {
    fn inputs(&mut self) -> Vec<DeviceInfo> {
        list(eCapture)
    }

    fn outputs(&mut self) -> Vec<DeviceInfo> {
        list(eRender)
    }

    fn open_input(&mut self, id: &str, exclusive: bool, make: MakeInput, on_error: ErrorFn) -> Result<Box<dyn Stream>, String> {
        spawn(eCapture, id, exclusive, Callback::Capture(make), on_error)
    }

    fn open_output(&mut self, id: &str, exclusive: bool, make: MakeOutput, on_error: ErrorFn) -> Result<Box<dyn Stream>, String> {
        spawn(eRender, id, exclusive, Callback::Render(make), on_error)
    }
}
