//! A real guitar through the tracker: `fixtures/strums.wav` is a phone recording of a G strum, an
//! Em strum, a G strum, the open strings e B G D A E one at a time, then an open strum, with
//! silence between. This is the calibration record for the level thresholds in the core and the
//! app (`src/theory/levels.ts` mirrors the constants below). Run with `--nocapture` for the timeline.

use fretline_core::tracker::Tracker;
use std::collections::BTreeMap;
use std::path::PathBuf;

const CHUNK: usize = 1024;

// Mirrored in src/theory/levels.ts.
/// A strum is judged on the chroma frames this long after its (last) attack.
const WINDOW_START: f64 = 0.15;
const WINDOW_END: f64 = 0.6;
/// Attacks closer than this are one strum being swept.
const STRUM_MERGE: f64 = 0.15;
/// The window's loudest peak must clear the floor by this much, else nothing was played.
const STRUM_MIN_ABOVE_FLOOR: f32 = 20.0;
/// A fundamental counts when it clears the floor by this much...
const NOTE_MIN_ABOVE_FLOOR: f32 = 12.0;
/// ...and sits within this much of the loudest note.
const NOTE_MAX_BELOW_TOP: f32 = 30.0;
/// ...in at least this fraction of the window's frames.
const NOTE_MIN_FRAMES: f64 = 1.0 / 3.0;
/// A note already sounding in the last frame before the attack belongs to this strum only if the
/// attack raised it by this much: a ringing string keeps decaying, a re-struck one comes back up.
/// (A string left ringing from the previous chord is not part of the new one.)
const RESTRIKE_DB: f32 = 2.0;
/// The last frame ending at least this long before the attack is "before".
const PRE_END: f64 = 0.03;

fn load() -> (Vec<f32>, f64) {
    let p: PathBuf = [env!("CARGO_MANIFEST_DIR"), "tests", "fixtures", "strums.wav"].iter().collect();
    let mut r = hound::WavReader::open(&p).expect("fixture");
    let spec = r.spec();
    assert_eq!(spec.channels, 1);
    let x: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let s = 1.0 / (1u32 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().map(|v| v.unwrap() as f32 * s).collect()
        }
        hound::SampleFormat::Float => r.samples::<f32>().map(|v| v.unwrap()).collect(),
    };
    (x, spec.sample_rate as f64)
}

/// One chroma frame as the app would see it.
#[derive(Debug, Clone)]
struct Frame {
    t: f64,
    floor: f32,
    top: f32,
    notes: Vec<(u8, f32)>,
}

struct Run {
    frames: Vec<Frame>,
    /// Clock seconds of every attack the tracker reported.
    attacks: Vec<f64>,
}

fn run() -> Run {
    let (x, sr) = load();
    let mut tr = Tracker::new(sr);
    let mut frames = Vec::new();
    let mut attacks = Vec::new();
    let mut count = 0;
    for (i, c) in x.chunks_exact(CHUNK).enumerate() {
        let t0 = (i * CHUNK) as u64;
        let o = tr.push(t0, c);
        let clock = (t0 + CHUNK as u64) as f64 / sr;
        if o.levels.attacks > count {
            count = o.levels.attacks;
            attacks.push(clock - o.levels.since_attack);
        }
        if let Some(Some(cf)) = o.chroma {
            frames.push(Frame {
                t: clock,
                floor: o.levels.floor_db,
                top: cf.top_db,
                notes: cf.fundamentals.iter().map(|f| (f.midi, f.db)).collect(),
            });
        }
    }
    Run { frames, attacks }
}

/// Attacks merged into strums (the last attack of a sweep anchors the window).
fn strums(attacks: &[f64]) -> Vec<f64> {
    let mut out: Vec<f64> = Vec::new();
    for &a in attacks {
        match out.last_mut() {
            Some(last) if a - *last < STRUM_MERGE => *last = a,
            _ => out.push(a),
        }
    }
    out
}

/// The notes a strum is judged on: voted across the window's frames and judged against the floor.
fn judge(frames: &[Frame], t_attack: f64) -> Option<Vec<u8>> {
    let w: Vec<&Frame> = frames.iter().filter(|f| f.t >= t_attack + WINDOW_START && f.t <= t_attack + WINDOW_END).collect();
    if w.is_empty() {
        return None;
    }
    let top = w.iter().map(|f| f.top).fold(f32::NEG_INFINITY, f32::max);
    let floor = w.last().unwrap().floor;
    if top < floor + STRUM_MIN_ABOVE_FLOOR {
        return None;
    }
    let mut votes: BTreeMap<u8, (usize, f32)> = BTreeMap::new();
    for f in &w {
        for &(m, d) in &f.notes {
            let e = votes.entry(m).or_insert((0, f32::NEG_INFINITY));
            e.0 += 1;
            e.1 = e.1.max(d);
        }
    }
    let mut pre: BTreeMap<u8, f32> = BTreeMap::new();
    if let Some(f) = frames.iter().rev().find(|f| f.t <= t_attack - PRE_END) {
        for &(m, d) in &f.notes {
            pre.insert(m, d);
        }
    }
    let min_frames = (w.len() as f64 * NOTE_MIN_FRAMES).ceil() as usize;
    let mut notes: Vec<(u8, f32)> = votes
        .into_iter()
        .filter(|(m, (n, d))| {
            *n >= min_frames
                && *d >= floor + NOTE_MIN_ABOVE_FLOOR
                && *d >= top - NOTE_MAX_BELOW_TOP
                && pre.get(m).map_or(true, |p| *d >= p + RESTRIKE_DB)
        })
        .map(|(m, (_, d))| (m, d))
        .collect();
    notes.sort_by(|a, b| b.1.total_cmp(&a.1));
    notes.truncate(6);
    let mut m: Vec<u8> = notes.into_iter().map(|(m, _)| m).collect();
    m.sort();
    Some(m)
}

#[test]
fn timeline() {
    let r = run();
    println!("attacks {:?}", r.attacks);
    for f in &r.frames {
        let notes: Vec<String> = f.notes.iter().map(|(m, d)| format!("{m}:{d:.0}")).collect();
        println!("{:6.2} floor {:6.1} top {:6.1}  {}", f.t, f.floor, f.top, notes.join(" "));
    }
    assert!(!r.frames.is_empty());
}

#[test]
fn the_floor_settles_on_the_room_not_on_the_silent_head() {
    // The file starts with 100 ms of digital silence; the room sits near -80 dBFS.
    let r = run();
    let during_g = r.frames.iter().find(|f| f.t > 6.2).unwrap();
    assert!(during_g.floor > -86.0 && during_g.floor < -74.0, "floor {}", during_g.floor);
}

#[test]
fn silences_close_the_gate() {
    let r = run();
    for (a, b) in [(12.0, 13.1), (24.2, 25.0)] {
        let loud: Vec<&Frame> = r.frames.iter().filter(|f| f.t > a && f.t < b && f.top >= f.floor + STRUM_MIN_ABOVE_FLOOR).collect();
        assert!(loud.is_empty(), "frames judged playable during silence {a}-{b}: {:?}", loud.iter().map(|f| f.t).collect::<Vec<_>>());
    }
}

#[test]
fn every_event_is_heard_once_with_its_strings() {
    let r = run();
    // Everything after the file's silent head (the first non-silent frame opens the gate once). A
    // click at 3.9 s opens the gate too but is 40 dB under any strum: judged as nothing played.
    let all: Vec<(f64, Option<Vec<u8>>)> = strums(&r.attacks).into_iter().filter(|&t| t > 1.0).map(|t| (t, judge(&r.frames, t))).collect();
    let quiet: Vec<f64> = all.iter().filter(|(_, j)| j.is_none()).map(|(t, _)| *t).collect();
    assert_eq!(quiet.len(), 1, "quiet attacks at {quiet:?}");
    assert!((quiet[0] - 3.9).abs() < 0.2, "quiet attack at {}", quiet[0]);
    let played: Vec<(f64, Vec<u8>)> = all.into_iter().filter_map(|(t, j)| j.map(|j| (t, j))).collect();
    let expected: &[(&str, &[u8])] = &[
        // Strums keep the notes that are not partials of a lower string; B3 and E4 in the open
        // strum are claimed by E2 and recovered by the app from the salience array.
        ("G", &[43, 47, 50]),
        ("Em", &[40, 47, 55]),
        ("G", &[43, 47, 50]),
        ("e", &[64]),
        ("B", &[59]),
        ("G string", &[55]),
        ("D", &[50]),
        ("A", &[45]),
        ("E", &[40]),
        ("open strum", &[40, 45, 50, 55]),
    ];
    assert_eq!(played.len(), expected.len(), "strums at {:?}", played.iter().map(|p| p.0).collect::<Vec<_>>());
    for ((t, got), (name, want)) in played.iter().zip(expected) {
        assert_eq!(&got[..], *want, "{name} at {t:.2}");
    }
}
