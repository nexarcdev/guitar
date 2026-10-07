//! Streaming windowed-sinc resampler. Feeds basic-pitch, which expects 22.05 kHz mono.

const PHASES: usize = 256;

pub struct Resampler {
    ratio: f64,
    half: usize,
    hist: Vec<f32>,
    /// Kernel precomputed at PHASES fractional offsets: no trig per output sample.
    table: Vec<f32>,
    /// Fractional read position into `hist` for the next output sample.
    pos: f64,
    buf: Vec<f32>,
}

impl Resampler {
    pub fn new(in_rate: f64, out_rate: f64) -> Self {
        let half = 16;
        let cutoff = (out_rate / in_rate).min(1.0) * 0.92;
        let kernel = |x: f64| {
            if x == 0.0 {
                return cutoff;
            }
            let pi = std::f64::consts::PI;
            let w = 0.42 + 0.5 * (pi * x / (half as f64 + 1.0)).cos() + 0.08 * (2.0 * pi * x / (half as f64 + 1.0)).cos();
            (pi * cutoff * x).sin() / (pi * x) * w
        };
        let taps = half * 2;
        let mut table = vec![0.0f32; (PHASES + 1) * taps];
        for ph in 0..=PHASES {
            let frac = ph as f64 / PHASES as f64;
            for k in -(half as i64) + 1..=half as i64 {
                table[ph * taps + (k + half as i64 - 1) as usize] = kernel(k as f64 - frac) as f32;
            }
        }
        Self { ratio: in_rate / out_rate, half, hist: vec![0.0; taps], table, pos: half as f64, buf: Vec::new() }
    }

    /// Resamples `input`, appending to `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.buf.clear();
        self.buf.extend_from_slice(&self.hist);
        self.buf.extend_from_slice(input);
        let h = self.half;
        let taps = h * 2;
        let mut p = self.pos;
        while p + (h as f64) < self.buf.len() as f64 {
            let c = p.floor() as usize;
            let row = ((p - c as f64) * PHASES as f64).round() as usize * taps;
            let base = c + 1 - h;
            let mut acc = 0.0f64;
            for k in 0..taps {
                acc += self.buf[base + k] as f64 * self.table[row + k] as f64;
            }
            out.push(acc as f32);
            p += self.ratio;
        }
        let keep = p.floor() as usize - h;
        self.hist.clear();
        self.hist.extend_from_slice(&self.buf[keep..]);
        self.pos = p - keep as f64;
    }
}
