//! The monitor bridge under realistic timing: two devices with their own block sizes, clocks
//! a few hundred ppm apart, Windows-style jitter and scheduler stalls.

use fretline_core::drift::DriftReader;

struct Timing {
    rate_in: f64,
    rate_out: f64,
    block_in: usize,
    block_out: usize,
    /// Input clock error, ppm.
    ppm: f64,
    /// Uniform random lateness of each callback, seconds.
    jitter_in: f64,
    jitter_out: f64,
    /// (every, length) seconds: the input thread stalls periodically, then delivers what piled up.
    stall: Option<(f64, f64)>,
    seconds: f64,
    start_target: usize,
}

impl Default for Timing {
    fn default() -> Self {
        Self { rate_in: 48000.0, rate_out: 48000.0, block_in: 144, block_out: 48, ppm: 300.0, jitter_in: 0.0, jitter_out: 0.0, stall: None, seconds: 60.0, start_target: 400 }
    }
}

struct Run {
    reader: DriftReader,
    /// (seconds, underruns so far, target) once a second.
    trace: Vec<(f64, u64, usize)>,
    out: Vec<f32>,
}

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Plays a steady tone through the bridge with this timing, event by event.
fn run(t: &Timing) -> Run {
    let mut rng = Lcg(12345);
    let mut events: Vec<(f64, bool)> = Vec::new();
    let pin = t.block_in as f64 / (t.rate_in * (1.0 + t.ppm * 1e-6));
    let mut k = 0.0;
    loop {
        let mut at = k * pin + rng.next() * t.jitter_in;
        if let Some((every, len)) = t.stall {
            let s0 = (at / every).floor() * every + every * 0.5;
            if at >= s0 && at < s0 + len {
                at = s0 + len;
            }
        }
        if at > t.seconds {
            break;
        }
        events.push((at, true));
        k += 1.0;
    }
    let pout = t.block_out as f64 / t.rate_out;
    let mut m = 1.0;
    while m * pout < t.seconds {
        events.push((m * pout + rng.next() * t.jitter_out, false));
        m += 1.0;
    }
    events.sort_by(|a, b| a.0.total_cmp(&b.0));

    let mut reader = DriftReader::with_rates(t.start_target, t.rate_in / t.rate_out);
    reader.set_input_rate(t.rate_in);
    reader.allow_growth((t.rate_in * 0.04) as usize);
    let mut phase = 0u64;
    let mut block = vec![0.0f32; t.block_out];
    let mut out = Vec::new();
    let mut trace = Vec::new();
    let mut next_trace = 1.0;
    for (at, input) in events {
        if input {
            reader.push((0..t.block_in).map(|_| {
                phase += 1;
                (2.0 * std::f64::consts::PI * 220.0 * phase as f64 / t.rate_in).sin() as f32 * 0.5
            }));
        } else {
            reader.read(&mut block);
            out.extend_from_slice(&block);
        }
        if at >= next_trace {
            trace.push((at, reader.underruns, reader.target()));
            next_trace += 1.0;
        }
    }
    Run { reader, trace, out }
}

fn ms(samples: usize, rate: f64) -> f64 {
    samples as f64 * 1000.0 / rate
}

#[test]
fn steady_devices_settle_to_the_smallest_safe_backlog() {
    // A generous 100 ms starting guess on 3 ms input and 1 ms output blocks.
    let r = run(&Timing { start_target: 4800, ..Default::default() });
    let s = r.reader.stats();
    assert_eq!(s.underruns, 0);
    // What the blocks imply (48 + 1 + 96 samples) plus the 0.5 ms margin.
    assert!(s.target <= 48 + 1 + 96 + 24 + 2, "target {} ({:.2} ms)", s.target, ms(s.target, 48000.0));
    assert!(r.trace.iter().find(|x| x.0 >= 50.0).unwrap().2 == s.target, "still moving after 50 s");
}

#[test]
fn a_stall_sizes_the_buffer_to_what_it_needed_and_then_holds() {
    // The input thread stalls 8 ms every 7 s (a Windows DPC spike, say).
    let r = run(&Timing { stall: Some((7.0, 0.008)), seconds: 90.0, ..Default::default() });
    let s = r.reader.stats();
    // At most the first stall may catch it out; the dozen after it must not.
    assert!(s.underruns <= 1, "trace {:?}", r.trace);
    // The stall leaves the output 8 ms plus up to one input block (3 ms) without new input, less
    // what the last block before it left over: the need is that, the target that plus a margin.
    let t = ms(s.target, 48000.0);
    let need = ms(s.needed, 48000.0);
    assert!(need >= 6.0 && need < 12.0, "needed {need:.2} ms");
    assert!(t >= need && t <= need + 1.5, "target {t:.2} ms for a need of {need:.2} ms");
    assert!(!s.limited);
}

#[test]
fn jittery_windows_timing_stops_running_dry_once_learned() {
    // 10 ms shared-mode input into 3 ms exclusive output at 44.1 kHz, both late by up to 2 ms.
    let r = run(&Timing {
        rate_out: 44100.0,
        block_in: 480,
        block_out: 132,
        jitter_in: 0.002,
        jitter_out: 0.002,
        ppm: -250.0,
        seconds: 120.0,
        ..Default::default()
    });
    let s = r.reader.stats();
    let at30 = r.trace.iter().find(|x| x.0 >= 30.0).unwrap().1;
    assert!(s.underruns <= 3, "underruns {}", s.underruns);
    assert_eq!(s.underruns, at30, "still running dry after 30 s: {:?}", r.trace);
    assert!(ms(s.target, 48000.0) < 20.0, "target {:.2} ms", ms(s.target, 48000.0));
    assert!(s.drift_ppm.abs() < 1500.0, "drift {} ppm", s.drift_ppm);
}

#[test]
fn shrinks_again_once_the_stalls_stop() {
    let mut r = DriftReader::new(100);
    r.allow_growth(4000);
    let mut out = vec![0.0f32; 48];
    let mut fed = 0usize;
    let mut tick = |r: &mut DriftReader, starve: bool, out: &mut Vec<f32>| {
        if !starve {
            r.push(std::iter::repeat(0.25).take(48));
            fed += 48;
        }
        r.read(out);
    };
    // Steady, then one 20-read starvation, then 4 minutes steady.
    for _ in 0..5000 {
        tick(&mut r, false, &mut out);
    }
    for _ in 0..20 {
        tick(&mut r, true, &mut out);
    }
    let high = r.target();
    assert!(r.underruns >= 1 && high > 900, "target {high}");
    for _ in 0..240_000 {
        tick(&mut r, false, &mut out);
    }
    assert!(r.target() < 200, "target {} after the stalls stopped (was {high})", r.target());
}

#[test]
fn running_dry_fades_out_and_back_in() {
    let mut r = DriftReader::new(64);
    let mut out = vec![0.0f32; 48];
    let mut all = Vec::new();
    for i in 0..400 {
        if i % 50 != 49 {
            r.push(std::iter::repeat(0.8).take(48));
        }
        r.read(&mut out);
        all.extend_from_slice(&out);
    }
    assert!(r.underruns >= 1);
    let jump = all.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
    assert!(jump < 0.1, "a step of {jump} between samples");
}
