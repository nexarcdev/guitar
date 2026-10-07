//! Detection tests, ported from the web app's TypeScript suite when the tracker moved into the core.

use fretline_core::chroma::{Chroma, FRAME_N};
use fretline_core::floor::FloorMode;
use fretline_core::resample::Resampler;
use fretline_core::synth::{NoteSpec, Synth, VoiceKind};
use fretline_core::tracker::{Tracker, TrackerOutput};
use fretline_core::yin::Yin;

const SR: f64 = 48000.0;

/// Harmonic-rich tone: sawtooth-like partials.
fn tone(freqs: &[f64], n: usize, sr: f64) -> Vec<f32> {
    let mut x = vec![0.0f32; n];
    for &f in freqs {
        for h in 1..=6 {
            for (i, v) in x.iter_mut().enumerate() {
                *v += (0.3 / h as f64 / freqs.len() as f64 * (2.0 * std::f64::consts::PI * f * h as f64 * i as f64 / sr).sin()) as f32;
            }
        }
    }
    x
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) as f32 / (1u64 << 31) as f32) * 2.0 - 1.0
    }
    fn noise(&mut self, n: usize, a: f32) -> Vec<f32> {
        (0..n).map(|_| self.next() * a).collect()
    }
}

fn feed(tr: &mut Tracker, x: &[f32]) -> Vec<TrackerOutput> {
    x.chunks_exact(1024).enumerate().map(|(i, c)| tr.push(i as u64 * 1024, c)).collect()
}

#[test]
fn yin_detects_guitar_range_within_3_cents() {
    let mut yin = Yin::new(2048, SR);
    for f in [55.0, 82.41, 110.0, 146.83, 196.0, 246.94, 329.63, 880.0] {
        let r = yin.detect(&tone(&[f], 2048, SR), 0.008);
        let cents = (1200.0 * (r.freq / f).log2()).abs();
        assert!(cents < 3.0 && r.clarity > 0.8, "{f} Hz: {} Hz, clarity {}", r.freq, r.clarity);
    }
}

#[test]
fn yin_rejects_silence_and_noise() {
    let mut yin = Yin::new(2048, SR);
    assert_eq!(yin.detect(&vec![0.0; 2048], 0.008).freq, -1.0);
    let noise = Rng(3).noise(2048, 0.3);
    assert!(yin.detect(&noise, 0.008).clarity < 0.8);
}

#[test]
fn chroma_finds_a_c_major_triad_octave_exact() {
    let f = Chroma::new(SR).compute(&tone(&[130.81, 164.81, 196.0], FRAME_N, SR), 1e-12).unwrap();
    assert!(f.pitch[48] > -20.0 && f.pitch[52] > -20.0, "C3 {} E3 {}", f.pitch[48], f.pitch[52]);
    assert!(f.pitch[40] < -60.0, "open low E must not appear: {}", f.pitch[40]);
    let mut idx: Vec<usize> = (0..12).collect();
    idx.sort_by(|&a, &b| f.chroma[b].total_cmp(&f.chroma[a]));
    let mut top = idx[..3].to_vec();
    top.sort();
    assert_eq!(top, vec![0, 4, 7]);
    // Harmonics attributed: three strings, three fundamentals, and the levels are absolute.
    let mut m: Vec<u8> = f.fundamentals.iter().map(|x| x.midi).collect();
    m.sort();
    assert_eq!(m, vec![48, 52, 55], "{:?}", f.fundamentals);
    // Each partial has amplitude 0.3 / 3 = 0.1, RMS -23 dBFS.
    assert!((f.top_db + 23.0).abs() < 1.0, "top_db {}", f.top_db);
}

#[test]
fn a_single_low_e_is_one_fundamental_not_five() {
    let f = Chroma::new(SR).compute(&tone(&[82.41], FRAME_N, SR), 1e-12).unwrap();
    let m: Vec<u8> = f.fundamentals.iter().map(|x| x.midi).collect();
    assert_eq!(m, vec![40], "{:?}", f.fundamentals);
    // The salience array still shows the partials, octave exact.
    assert!(f.pitch[52] > -12.0 && f.pitch[59] > -20.0, "E3 {} B3 {}", f.pitch[52], f.pitch[59]);
}

#[test]
fn six_string_e_chord_keeps_the_notes_that_are_not_harmonics() {
    // E2 B2 E3 G#3 B3 E4: E3, B3 and E4 coincide with partials of E2 and B2, so by level alone they
    // are claimed as harmonics; G#3 is nobody's partial. The salience array still shows all six.
    let f = Chroma::new(SR).compute(&tone(&[82.41, 123.47, 164.81, 207.65, 246.94, 329.63], FRAME_N, SR), 1e-12).unwrap();
    let mut m: Vec<u8> = f.fundamentals.iter().map(|x| x.midi).collect();
    m.sort();
    assert_eq!(m, vec![40, 47, 56], "{:?}", f.fundamentals);
    for midi in [40, 47, 52, 56, 59, 64] {
        assert!(f.pitch[midi] > -20.0, "midi {midi}: {}", f.pitch[midi]);
    }
    assert!(f.fundamentals.len() <= 6);
}

#[test]
fn tracker_counts_attacks() {
    let mut tr = Tracker::new(SR);
    let n = (3.0 * SR) as usize;
    let mut x = vec![0.0f32; n];
    for (k, start) in [0.5, 1.6].iter().map(|s| (s * SR) as usize).enumerate() {
        let _ = k;
        for i in 0..(0.9 * SR) as usize {
            let env = (-(i as f64) / (0.4 * SR)).exp();
            x[start + i] += (0.3 * env * (2.0 * std::f64::consts::PI * 110.0 * i as f64 / SR).sin()) as f32;
        }
    }
    let out = feed(&mut tr, &x);
    let last = out.last().unwrap();
    assert_eq!(last.levels.attacks, 2, "since_attack {}", last.levels.since_attack);
    assert!(last.levels.attack_db > -20.0, "attack_db {}", last.levels.attack_db);
}

#[test]
fn resampler_keeps_a_440_hz_tone_from_48k_to_22k05_in_chunks() {
    let mut r = Resampler::new(48000.0, 22050.0);
    let src = tone(&[440.0], 48000, SR);
    let mut out = Vec::new();
    for c in src.chunks(128) {
        r.process(c, &mut out);
    }
    assert!((out.len() as i64 - 22050).abs() < 40, "{}", out.len());
    let y = Yin::new(2048, 22050.0).detect(&out[5000..7048], 0.008);
    assert!((1200.0 * (y.freq / 440.0).log2()).abs() < 3.0, "{}", y.freq);
}

#[test]
fn tracker_learns_the_floor_fast_and_never_reads_noise_as_pitch() {
    for a in [0.0005f32, 0.005, 0.03] {
        let mut tr = Tracker::new(SR);
        let outs = feed(&mut tr, &Rng(11).noise(SR as usize * 3, a));
        let floor = outs[(0.5 * SR / 1024.0).round() as usize].levels.floor_db;
        let expect = 20.0 * (a / 3f32.sqrt()).log10();
        assert!((floor - expect).abs() < 6.0, "amp {a}: floor {floor} vs {expect}");
        assert_eq!(outs.iter().flat_map(|o| &o.frames).filter(|f| f.stable).count(), 0);
        assert_eq!(outs.iter().map(|o| o.notes.len()).sum::<usize>(), 0);
    }
}

#[test]
fn tracker_finds_the_same_note_at_minus_6_and_minus_40_db() {
    for g in [0.5f32, 0.01] {
        let mut tr = Tracker::new(SR);
        let mut x = Rng(5).noise(SR as usize * 2, 0.0002);
        let t = tone(&[110.0], SR as usize, SR);
        for (i, v) in t.iter().enumerate() {
            x[SR as usize + i] += v * g * (-(i as f32) / SR as f32).exp();
        }
        let notes: Vec<i32> = feed(&mut tr, &x).iter().flat_map(|o| o.notes.iter().map(|n| n.midi)).collect();
        assert_eq!(notes, vec![45], "gain {g}");
    }
}

#[test]
fn three_minutes_of_drifting_hiss_hum_and_clicks_never_open_analysis() {
    let mut tr = Tracker::new(SR);
    let mut rng = Rng(7);
    let n = 1024;
    let (mut opens, mut chroma, mut notes, mut stable, mut was_open) = (0, 0, 0, 0, false);
    let mut attacks = 0;
    let mut t = 0u64;
    for c in 0..(180.0 * SR) as usize / n {
        let mut x = vec![0.0f32; n];
        for v in x.iter_mut() {
            let tt = t as f64;
            let drift = 10f64.powf(3.0 * (2.0 * std::f64::consts::PI * tt / (SR * 37.0)).sin() / 20.0);
            *v = (drift
                * (0.0006 * rng.next() as f64
                    + 0.0004 * (2.0 * std::f64::consts::PI * 60.0 * tt / SR).sin()
                    + 0.0002 * (2.0 * std::f64::consts::PI * 180.0 * tt / SR).sin())) as f32;
            t += 1;
        }
        if rng.next() > 0.99 {
            let i = (((rng.next() + 1.0) / 2.0) * (n - 1) as f32) as usize;
            x[i] += 0.02 * rng.next();
        }
        let o = tr.push((c * n) as u64, &x);
        if o.levels.gate && !was_open {
            opens += 1;
        }
        was_open = o.levels.gate;
        if matches!(o.chroma, Some(Some(_))) {
            chroma += 1;
        }
        notes += o.notes.len();
        stable += o.frames.iter().filter(|f| f.stable).count();
        attacks = o.levels.attacks;
    }
    assert_eq!((opens, chroma, notes, stable, attacks), (0, 0, 0, 0, 0));
}

/// A string still ringing when the app starts: auto mode calibrates onto it and can't hear the
/// next notes; Recalibrate (strings muted) fixes it within 1.5 s.
#[test]
fn recalibrate_recovers_from_a_floor_learned_on_a_ringing_string() {
    let mut tr = Tracker::new(SR);
    let mut rng = Rng(9);
    // 1 s of a sustained string at start-up.
    let ring = tone(&[110.0], SR as usize, SR).iter().map(|v| v * 0.3).collect::<Vec<_>>();
    let mut t = 0u64;
    let mut push = |tr: &mut Tracker, x: &[f32]| {
        let mut outs = Vec::new();
        for c in x.chunks_exact(1024) {
            outs.push(tr.push(t, c));
            t += 1024;
        }
        outs
    };
    let outs = push(&mut tr, &ring);
    let high = outs.last().unwrap().levels.floor_db;
    assert!(high > -30.0, "auto floor sits on the ringing string: {high}");
    tr.recalibrate(true);
    let outs = push(&mut tr, &rng.noise(SR as usize / 2, 0.0003));
    let mid = outs.last().unwrap().levels.clone();
    assert!(mid.measuring.is_some_and(|p| p > 0.2 && p < 0.5), "{:?}", mid.measuring);
    let outs = push(&mut tr, &rng.noise(SR as usize * 2, 0.0003));
    let l = &outs.last().unwrap().levels;
    assert!(l.measuring.is_none());
    assert!(l.floor_db < -70.0, "recalibrated floor {}", l.floor_db);
    // And the next pick is heard.
    let pick: Vec<f32> = tone(&[146.83], SR as usize, SR).iter().enumerate().map(|(i, v)| v * 0.2 * (-(i as f32) / SR as f32).exp()).collect();
    let notes: Vec<i32> = push(&mut tr, &pick).iter().flat_map(|o| o.notes.iter().map(|n| n.midi)).collect();
    assert_eq!(notes, vec![50]);
}

#[test]
fn manual_floor_overrides_the_estimate_but_keeps_measuring() {
    let mut tr = Tracker::new(SR);
    tr.floor.mode = FloorMode::Manual;
    tr.floor.manual_db = -40.0;
    let outs = feed(&mut tr, &Rng(4).noise(SR as usize * 2, 0.001));
    let l = &outs.last().unwrap().levels;
    assert_eq!(l.floor_db, -40.0);
    assert!(l.measured_db < -60.0, "estimate still runs: {}", l.measured_db);
    // A note 30 dB under the manual floor's gate stays silent; above it is heard.
    let mut quiet = Tracker::new(SR);
    quiet.floor.mode = FloorMode::Manual;
    quiet.floor.manual_db = -40.0;
    let x: Vec<f32> = tone(&[110.0], SR as usize, SR).iter().map(|v| v * 0.003).collect();
    assert_eq!(feed(&mut quiet, &x).iter().map(|o| o.notes.len()).sum::<usize>(), 0);
}

#[test]
fn synth_plucks_ring_at_pitch_decay_and_stop_on_demand() {
    let mut s = Synth::new(SR);
    s.play(1, &[NoteSpec { at: 0.0, hz: 110.0, dur: 1.0, voice: VoiceKind::Pluck }], 0.0);
    let mut out = vec![0.0f32; SR as usize * 2];
    for c in out.chunks_mut(128) {
        s.render(c);
    }
    let r = Yin::new(2048, SR).detect(&out[4800..6848], 0.0);
    assert!((1200.0 * (r.freq / 110.0).log2()).abs() < 5.0, "{}", r.freq);
    let peak = out.iter().fold(0.0f32, |a, v| a.max(v.abs()));
    assert!(peak > 0.05 && peak < 0.5, "{peak}");
    assert!(out[SR as usize + 10_000..].iter().all(|v| *v == 0.0), "voice ends after dur");
    assert!(!s.active());

    // A riff: notes start on time; stopping it silences within ~20 ms and drops the rest.
    let notes: Vec<NoteSpec> = (0..8).map(|i| NoteSpec { at: i as f64 * 0.25, hz: 220.0, dur: 0.7, voice: VoiceKind::Pluck }).collect();
    s.play(2, &notes, 0.05);
    let mut out = vec![0.0f32; SR as usize];
    for c in out.chunks_mut(128) {
        s.render(c);
    }
    let first = out.iter().position(|v| v.abs() > 1e-6).unwrap();
    assert!((first as f64 / SR - 0.05).abs() < 0.003, "starts at {}", first as f64 / SR);
    s.stop(Some(2));
    let mut tail = vec![0.0f32; SR as usize * 3];
    for c in tail.chunks_mut(128) {
        s.render(c);
    }
    assert!(tail[(0.03 * SR) as usize..].iter().all(|v| v.abs() < 1e-4));
    assert!(!s.active());
}

#[test]
fn reference_tone_is_a_steady_sine() {
    let mut s = Synth::new(SR);
    s.play(1, &[NoteSpec { at: 0.0, hz: 440.0, dur: 1.8, voice: VoiceKind::Reference }], 0.0);
    let mut out = vec![0.0f32; SR as usize];
    for c in out.chunks_mut(128) {
        s.render(c);
    }
    let r = Yin::new(2048, SR).detect(&out[24000..26048], 0.0);
    assert!((1200.0 * (r.freq / 440.0).log2()).abs() < 1.0 && r.clarity > 0.95);
    let peak = out[24000..26048].iter().fold(0.0f32, |a, v| a.max(v.abs()));
    assert!((peak - 0.2).abs() < 0.01, "{peak}");
}
