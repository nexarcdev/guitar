use fretline_core::conditioner::Conditioner;
use fretline_core::drift::DriftReader;
use fretline_core::looper::{Looper, SlotState};
use fretline_core::{Chain, Command, PedalKind, PedalSetting};

const SR: f32 = 48000.0;

fn tone(f: f32, n: usize, amp: f32) -> Vec<f32> {
    (0..n)
        .map(|i| (1..=6).map(|h| amp * 0.3 / h as f32 * (2.0 * std::f32::consts::PI * f * h as f32 * i as f32 / SR).sin()).sum())
        .collect()
}
fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}
fn noise(n: usize, a: f32, seed: &mut u64) -> Vec<f32> {
    (0..n)
        .map(|_| {
            *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((*seed >> 33) as f32 / (1u64 << 31) as f32 * 2.0 - 1.0) * a
        })
        .collect()
}

#[test]
fn conditioner_boosts_quiet_guitar_and_gates_hiss() {
    let mut c = Conditioner::new(SR);
    let mut seed = 1;
    let mut hiss = noise(SR as usize, 0.0003, &mut seed);
    c.process(&mut hiss);
    assert!(rms(&hiss[hiss.len() - 4800..]) < 1e-5, "hiss should be gated");
    let quiet: Vec<f32> = tone(110.0, SR as usize * 4, 0.02);
    let mut out = quiet.clone();
    c.process(&mut out);
    assert!(c.view().gain_db > 20.0, "gain {}", c.view().gain_db);
    assert!(rms(&out[out.len() - 4800..]) > rms(&quiet[..4800]) * 8.0);
}

#[test]
fn looper_first_take_sets_length_then_syncs_and_overdubs() {
    let mut l = Looper::new(1000.0, 60.0);
    l.tap(0);
    for _ in 0..512 {
        l.process(1.0);
    }
    l.tap(0);
    assert_eq!(l.view().len, 512);
    assert!((0..512).all(|_| l.process(0.0) == 1.0));
    l.tap(1);
    for _ in 0..512 {
        l.process(0.5);
    }
    assert_eq!(l.view().slots[1].0, SlotState::Playing);
    assert!((0..512).all(|_| l.process(0.0) == 1.5));
    l.stop(0);
    l.stop(1);
    assert!((0..512).all(|_| l.process(0.0) == 0.0));
    l.clear(0);
    l.clear(1);
    assert_eq!(l.view().len, 0);
}

#[test]
fn looper_writes_overdubs_behind_the_playhead_by_the_latency() {
    let mut l = Looper::new(1000.0, 60.0);
    l.tap(0);
    for _ in 0..256 {
        l.process(0.0);
    }
    l.tap(0);
    l.latency = 10;
    l.tap(1);
    for i in 0..256 {
        l.process(if i == 20 { 1.0 } else { 0.0 });
    }
    let played: Vec<f32> = (0..256).map(|_| l.process(0.0)).collect();
    assert_eq!(played.iter().position(|&v| v == 1.0), Some(10));
}

#[test]
fn drift_reader_holds_latency_across_mismatched_clocks() {
    // Input runs 300 ppm fast relative to the output, in 480-sample bursts; output pulls 128.
    for ppm in [300.0f64, -300.0] {
        let mut r = DriftReader::new(600);
        let mut phase = 0.0f64;
        let mut produced = 0.0f64;
        let mut out = vec![0.0; 128];
        let mut backlogs = Vec::new();
        for block in 0..30_000 {
            // 30k × 128 ≈ 80 s of output
            produced += 128.0 * (1.0 + ppm * 1e-6);
            while produced >= 480.0 {
                produced -= 480.0;
                r.push((0..480).map(|_| {
                    phase += 1.0;
                    (phase * 0.01).sin() as f32
                }));
            }
            r.read(&mut out);
            if block > 5000 {
                backlogs.push(r.backlog());
            }
        }
        let max = *backlogs.iter().max().unwrap();
        let min = *backlogs.iter().min().unwrap();
        assert!(max < 1400, "backlog grew to {max} at {ppm} ppm");
        assert!(min > 0, "backlog drained at {ppm} ppm");
        assert_eq!(r.underruns, 0, "underruns at {ppm} ppm");
    }
}

#[test]
fn drift_reader_converts_44k1_input_to_48k_output_without_drifting() {
    // A 44.1 kHz guitar cable into 48 kHz speakers, input 100 ppm slow on top of that.
    let (rin, rout) = (44100.0f64, 48000.0f64);
    let mut r = DriftReader::with_rates(600, rin / rout);
    let mut produced = 0.0f64;
    let mut phase = 0u64;
    let mut out = vec![0.0; 128];
    let mut last = Vec::new();
    for block in 0..20_000 {
        produced += 128.0 * rin / rout * (1.0 - 100e-6);
        while produced >= 441.0 {
            produced -= 441.0;
            r.push((0..441).map(|_| {
                phase += 1;
                (2.0 * std::f64::consts::PI * 441.0 * phase as f64 / rin).sin() as f32
            }));
        }
        r.read(&mut out);
        if block > 5000 {
            assert!(r.backlog() < 1500, "backlog {} at block {block}", r.backlog());
        }
        if block == 19_999 {
            last = out.clone();
        }
    }
    assert_eq!(r.underruns, 0);
    // 441 Hz at 48 kHz: one period = 108.84 samples. The output must still be that tone.
    let crossings = last.windows(2).filter(|w| w[0] < 0.0 && w[1] >= 0.0).count();
    assert!((1..=2).contains(&crossings), "crossings {crossings}");
}

#[test]
fn drift_reader_grows_its_target_after_an_underrun() {
    let mut r = DriftReader::new(200);
    r.allow_growth(800);
    let mut out = vec![0.0; 128];
    r.push(std::iter::repeat(0.5).take(256));
    r.read(&mut out);
    r.read(&mut out);
    r.read(&mut out);
    assert_eq!(r.underruns, 1);
    assert_eq!(r.target(), 250);
}

#[test]
fn every_pedal_is_stable_and_bounded_at_extremes() {
    for kind in PedalKind::ALL {
        for level in [0.0f32, 50.0, 100.0] {
            let mut c = Chain::new(SR);
            c.apply(Command::Pedals(vec![PedalSetting { kind, on: true, level }]));
            c.apply(Command::Output(true));
            let mut seed = 7;
            let mut buf = noise(SR as usize * 3, 0.5, &mut seed);
            buf.extend(std::iter::repeat(0.0).take(SR as usize * 3));
            for chunk in buf.chunks_mut(64) {
                c.process(chunk);
            }
            assert!(buf.iter().all(|v| v.is_finite() && v.abs() <= 1.0), "{kind:?} at {level} went unstable");
            let tail = rms(&buf[buf.len() - 4800..]);
            assert!(tail < 1e-3, "{kind:?} at {level} keeps ringing ({tail})");
        }
    }
}

#[test]
fn output_off_is_silent_and_bypassed_board_is_transparent() {
    let mut c = Chain::new(SR);
    // A real session starts with a moment of cable noise before the first note.
    let mut seed = 3;
    let mut src = noise(SR as usize / 2, 0.0005, &mut seed);
    src.extend(tone(196.0, SR as usize * 2, 0.3));
    let mut a = src.clone();
    for ch in a.chunks_mut(128) {
        c.process(ch);
    }
    assert!(a.iter().all(|&v| v == 0.0), "output off must be silent");
    c.apply(Command::Output(true));
    let mut b = src.clone();
    for ch in b.chunks_mut(128) {
        c.process(ch);
    }
    assert!(rms(&b[b.len() - 9600..]) > 0.05, "dry signal should pass with Output on");
}

#[test]
fn full_board_fits_easily_in_real_time() {
    let mut c = Chain::new(SR);
    c.apply(Command::Pedals(PedalKind::ALL.iter().map(|&kind| PedalSetting { kind, on: true, level: 70.0 }).collect()));
    c.apply(Command::Output(true));
    let mut buf = tone(110.0, SR as usize * 10, 0.3);
    let t = std::time::Instant::now();
    for ch in buf.chunks_mut(64) {
        c.process(ch);
    }
    let pct = t.elapsed().as_secs_f64() / 10.0 * 100.0;
    println!("all 8 pedals: {pct:.2}% of one core");
    assert!(pct < 25.0, "chain too slow: {pct:.1}% of real time");
}
