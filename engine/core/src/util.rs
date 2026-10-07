//! Small DSP building blocks shared by the pedals.

use std::f32::consts::PI;

#[inline]
pub fn db(x: f32) -> f32 {
    20.0 * (x + 1e-12).log10()
}

#[inline]
pub fn lin(d: f32) -> f32 {
    10f32.powf(d / 20.0)
}

/// Gentle safety clip above ±0.8, matching the web conditioner.
#[inline]
pub fn soft_clip(y: f32) -> f32 {
    if y > 0.8 {
        0.8 + 0.2 * ((y - 0.8) / 0.2).tanh()
    } else if y < -0.8 {
        -0.8 + 0.2 * ((y + 0.8) / 0.2).tanh()
    } else {
        y
    }
}

/// RBJ biquad (direct form I), the same responses as Web Audio's BiquadFilterNode.
#[derive(Clone, Debug, Default)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    pub fn lowpass(sr: f32, f: f32, q: f32) -> Self {
        let mut b = Self::default();
        b.set_lowpass(sr, f, q);
        b
    }

    pub fn allpass(sr: f32, f: f32, q: f32) -> Self {
        let mut b = Self::default();
        b.set_allpass(sr, f, q);
        b
    }

    fn coeffs(&mut self, b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) {
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn set_lowpass(&mut self, sr: f32, f: f32, q: f32) {
        let w = 2.0 * PI * f.clamp(10.0, sr * 0.49) / sr;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        self.coeffs((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha);
    }

    pub fn set_allpass(&mut self, sr: f32, f: f32, q: f32) {
        let w = 2.0 * PI * f.clamp(10.0, sr * 0.49) / sr;
        let (s, c) = w.sin_cos();
        let alpha = s / (2.0 * q);
        self.coeffs(1.0 - alpha, -2.0 * c, 1.0 + alpha, 1.0 + alpha, -2.0 * c, 1.0 - alpha);
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        // Flush denormals: a decaying filter tail can otherwise stall the audio thread.
        self.y1 = if y.abs() < 1e-20 { 0.0 } else { y };
        self.y1
    }
}

/// Delay line with fractional (linear-interpolated) reads.
#[derive(Clone, Debug)]
pub struct DelayLine {
    buf: Vec<f32>,
    w: usize,
}

impl DelayLine {
    pub fn new(max_samples: usize) -> Self {
        Self { buf: vec![0.0; max_samples.max(2) + 2], w: 0 }
    }

    #[inline]
    pub fn write(&mut self, x: f32) {
        self.buf[self.w] = x;
        self.w = (self.w + 1) % self.buf.len();
    }

    /// Sample written `delay` samples before the most recent write (delay ≥ 1).
    #[inline]
    pub fn read(&self, delay: f32) -> f32 {
        let n = self.buf.len();
        let d = delay.clamp(1.0, (n - 2) as f32);
        let i = d.floor() as usize;
        let frac = d - i as f32;
        let a = self.buf[(self.w + n - i) % n];
        let b = self.buf[(self.w + n - i - 1) % n];
        a + (b - a) * frac
    }
}

/// Sine LFO.
#[derive(Clone, Debug, Default)]
pub struct Lfo {
    phase: f32,
}

impl Lfo {
    #[inline]
    pub fn next(&mut self, rate_hz: f32, sr: f32) -> f32 {
        let v = (2.0 * PI * self.phase).sin();
        self.phase += rate_hz / sr;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        v
    }
}

/// Linear ramp toward a target, for click-free switching.
#[derive(Clone, Debug)]
pub struct Ramp {
    pub value: f32,
    pub target: f32,
    step: f32,
}

impl Ramp {
    pub fn new(value: f32, seconds: f32, sr: f32) -> Self {
        Self { value, target: value, step: 1.0 / (seconds * sr).max(1.0) }
    }

    #[inline]
    pub fn next(&mut self) -> f32 {
        if self.value < self.target {
            self.value = (self.value + self.step).min(self.target);
        } else if self.value > self.target {
            self.value = (self.value - self.step).max(self.target);
        }
        self.value
    }

    pub fn idle(&self) -> bool {
        self.value == self.target
    }
}
