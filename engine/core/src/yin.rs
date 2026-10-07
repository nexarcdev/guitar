//! YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002) with the difference
//! function computed through FFT cross-correlation, so a 2048-sample frame costs O(N log N).

use crate::fft::Fft;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PitchResult {
    /// Hz, or -1 when unvoiced.
    pub freq: f64,
    /// 1 − aperiodicity at the chosen lag; ~1 for a clean string, low for noise.
    pub clarity: f64,
    pub rms: f64,
}

pub struct Yin {
    frame: usize,
    w: usize,
    sr: f64,
    pub threshold: f64,
    pub min_freq: f64,
    pub max_freq: f64,
    fft: Fft,
    re: Vec<f64>,
    im: Vec<f64>,
    re2: Vec<f64>,
    im2: Vec<f64>,
    d: Vec<f64>,
}

impl Yin {
    /// `frame` samples are analysed; lags up to frame/2 are searched.
    pub fn new(frame: usize, sample_rate: f64) -> Self {
        let size = frame * 2;
        Self {
            frame,
            w: frame / 2,
            sr: sample_rate,
            threshold: 0.12,
            min_freq: 45.0,
            max_freq: 1400.0,
            fft: Fft::new(size),
            re: vec![0.0; size],
            im: vec![0.0; size],
            re2: vec![0.0; size],
            im2: vec![0.0; size],
            d: vec![0.0; frame / 2],
        }
    }

    pub fn detect(&mut self, x: &[f32], gate: f64) -> PitchResult {
        let (w, frame) = (self.w, self.frame);
        let size = frame * 2;
        let mut rms = 0.0;
        for &v in &x[..frame] {
            rms += v as f64 * v as f64;
        }
        rms = (rms / frame as f64).sqrt();
        if rms < gate {
            return PitchResult { freq: -1.0, clarity: 0.0, rms };
        }
        // c(τ) = Σ_{j<w} x[j]·x[j+τ] via FFT(x) · conj(FFT(x[0..w)))
        let (re, im, re2, im2, d) = (&mut self.re, &mut self.im, &mut self.re2, &mut self.im2, &mut self.d);
        re.fill(0.0);
        im.fill(0.0);
        re2.fill(0.0);
        im2.fill(0.0);
        for i in 0..frame {
            re[i] = x[i] as f64;
        }
        for i in 0..w {
            re2[i] = x[i] as f64;
        }
        self.fft.run(re, im, false);
        self.fft.run(re2, im2, false);
        for k in 0..size {
            let (ar, ai, br, bi) = (re[k], im[k], re2[k], -im2[k]);
            re[k] = ar * br - ai * bi;
            im[k] = ar * bi + ai * br;
        }
        self.fft.run(re, im, true);

        // d(τ) = e(0) + e(τ) − 2c(τ), with e(τ) = Σ_{j<w} x[j+τ]² maintained incrementally
        let sq = |i: usize| x[i] as f64 * x[i] as f64;
        let mut e0 = 0.0;
        for j in 0..w {
            e0 += sq(j);
        }
        let mut et = e0;
        d[0] = 0.0;
        for t in 1..w {
            et += sq(t + w - 1) - sq(t - 1);
            d[t] = e0 + et - (2.0 * re[t]) / size as f64;
        }
        // cumulative mean normalised difference
        let mut sum = 0.0;
        d[0] = 1.0;
        for t in 1..w {
            sum += d[t];
            d[t] = if sum > 0.0 { d[t] * t as f64 / sum } else { 1.0 };
        }

        let t_min = 2usize.max((self.sr / self.max_freq).floor() as usize);
        let t_max = (w - 2).min((self.sr / self.min_freq).ceil() as usize);
        let mut tau: Option<usize> = None;
        let mut t = t_min;
        while t < t_max {
            if d[t] < self.threshold {
                while t + 1 < t_max && d[t + 1] < d[t] {
                    t += 1;
                }
                tau = Some(t);
                break;
            }
            t += 1;
        }
        let tau = match tau {
            Some(t) => t,
            None => {
                // No dip under threshold: take the global minimum but report low clarity.
                let mut m = f64::INFINITY;
                let mut best = None;
                for t in t_min..t_max {
                    if d[t] < m {
                        m = d[t];
                        best = Some(t);
                    }
                }
                match best {
                    Some(b) if m <= 0.35 => b,
                    _ => return PitchResult { freq: -1.0, clarity: 1.0 - m.min(1.0), rms },
                }
            }
        };
        let (a, b, c) = (d[tau - 1], d[tau], d[tau + 1]);
        let den = a + c - 2.0 * b;
        let shift = if den != 0.0 { (a - c) / (2.0 * den) } else { 0.0 };
        let t = tau as f64 + shift.clamp(-1.0, 1.0);
        PitchResult { freq: self.sr / t, clarity: 1.0 - b.min(1.0), rms }
    }
}
