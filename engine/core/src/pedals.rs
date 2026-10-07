//! The eight pedals, matching the web app's Web Audio versions (same parameter mapping from the
//! 0–100 level knob) so a preset sounds the same in the browser and through the engine.
//! Reverb is algorithmic (Freeverb) rather than convolution: a 2 s impulse convolved at
//! 64-sample blocks is too expensive for a low-latency thread.

use crate::util::{Biquad, DelayLine, Lfo};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PedalKind {
    Compressor,
    Overdrive,
    Distortion,
    Fuzz,
    Chorus,
    Phaser,
    Delay,
    Reverb,
}

impl PedalKind {
    pub const ALL: [PedalKind; 8] = [
        PedalKind::Compressor,
        PedalKind::Overdrive,
        PedalKind::Distortion,
        PedalKind::Fuzz,
        PedalKind::Chorus,
        PedalKind::Phaser,
        PedalKind::Delay,
        PedalKind::Reverb,
    ];

    pub fn from_name(s: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|k| k.name() == s)
    }

    pub fn name(self) -> &'static str {
        match self {
            PedalKind::Compressor => "Compressor",
            PedalKind::Overdrive => "Overdrive",
            PedalKind::Distortion => "Distortion",
            PedalKind::Fuzz => "Fuzz",
            PedalKind::Chorus => "Chorus",
            PedalKind::Phaser => "Phaser",
            PedalKind::Delay => "Delay",
            PedalKind::Reverb => "Reverb",
        }
    }
}

/// 2x oversampler with a 31-tap windowed-sinc halfband filter on each side.
pub struct Oversampler {
    taps: Vec<f32>,
    up: Vec<f32>,
    down: Vec<f32>,
    ui: usize,
    di: usize,
}

impl Oversampler {
    fn new() -> Self {
        let n = 31usize;
        let mid = (n / 2) as f32;
        let mut taps: Vec<f32> = (0..n)
            .map(|i| {
                let x = i as f32 - mid;
                let sinc = if x == 0.0 { 0.5 } else { (std::f32::consts::PI * 0.5 * x).sin() / (std::f32::consts::PI * x) };
                let w = 0.42 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos()
                    + 0.08 * (4.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos();
                sinc * w
            })
            .collect();
        let sum: f32 = taps.iter().sum();
        taps.iter_mut().for_each(|t| *t /= sum);
        Self { up: vec![0.0; n], down: vec![0.0; n], taps, ui: 0, di: 0 }
    }

    #[inline]
    fn fir(buf: &[f32], taps: &[f32], head: usize) -> f32 {
        let n = buf.len();
        let mut acc = 0.0;
        for (k, t) in taps.iter().enumerate() {
            acc += buf[(head + n - k) % n] * t;
        }
        acc
    }

    #[inline]
    fn process(&mut self, x: f32, f: impl Fn(f32) -> f32) -> f32 {
        let n = self.up.len();
        let mut out = 0.0;
        for phase in 0..2 {
            // zero-stuffing doubles the rate; ×2 restores the passband level
            self.up[self.ui] = if phase == 0 { 2.0 * x } else { 0.0 };
            let u = Self::fir(&self.up, &self.taps, self.ui);
            self.ui = (self.ui + 1) % n;
            self.down[self.di] = f(u);
            let d = Self::fir(&self.down, &self.taps, self.di);
            self.di = (self.di + 1) % n;
            if phase == 1 {
                out = d;
            }
        }
        out
    }
}

pub enum Pedal {
    Compressor { env: f32, att: f32, rel: f32 },
    Drive { kind: PedalKind, os: Oversampler, tone: Biquad, post: f32 },
    Chorus { line: DelayLine, lfo: Lfo },
    Phaser { stages: [Biquad; 4], lfo: Lfo },
    Delay { line: DelayLine, lp: Biquad, fb: f32 },
    Reverb(Freeverb),
}

impl Pedal {
    pub fn new(kind: PedalKind, sr: f32) -> Self {
        match kind {
            PedalKind::Compressor => Pedal::Compressor {
                env: 0.0,
                att: (-1.0 / (0.005 * sr)).exp(),
                rel: (-1.0 / (0.15 * sr)).exp(),
            },
            PedalKind::Overdrive | PedalKind::Distortion | PedalKind::Fuzz => Pedal::Drive {
                kind,
                os: Oversampler::new(),
                tone: Biquad::lowpass(
                    sr,
                    match kind {
                        PedalKind::Fuzz => 3000.0,
                        PedalKind::Distortion => 4500.0,
                        _ => 5500.0,
                    },
                    1.0,
                ),
                post: if kind == PedalKind::Overdrive { 0.6 } else { 0.32 },
            },
            PedalKind::Chorus => Pedal::Chorus { line: DelayLine::new((0.05 * sr) as usize), lfo: Lfo::default() },
            PedalKind::Phaser => Pedal::Phaser { stages: std::array::from_fn(|_| Biquad::allpass(sr, 700.0, 0.6)), lfo: Lfo::default() },
            PedalKind::Delay => Pedal::Delay { line: DelayLine::new((2.0 * sr) as usize), lp: Biquad::lowpass(sr, 3500.0, 1.0), fb: 0.0 },
            PedalKind::Reverb => Pedal::Reverb(Freeverb::new(sr)),
        }
    }

    /// Processes one sample at the given level (0–100). Returns the pedal's full output when on.
    #[inline]
    pub fn process(&mut self, x: f32, level: f32, sr: f32) -> f32 {
        match self {
            Pedal::Compressor { env, att, rel } => {
                let a = x.abs();
                let c = if a > *env { *att } else { *rel };
                *env = a + c * (*env - a);
                let threshold = -10.0 - level * 0.4;
                let ratio = 2.0 + level * 0.1;
                let env_db = crate::util::db(*env);
                let over = env_db - threshold;
                let gr = if over > 0.0 { over * (1.0 - 1.0 / ratio) } else { 0.0 };
                x * crate::util::lin(-gr) * (1.0 + level * 0.02)
            }
            Pedal::Drive { kind, os, tone, post } => {
                let k = if *kind == PedalKind::Overdrive { 1.0 + level * 0.12 } else { 4.0 + level * 0.6 };
                let fuzz = *kind == PedalKind::Fuzz;
                let shaped = os.process(x, |u| {
                    let v = u.clamp(-1.0, 1.0);
                    if fuzz {
                        v.signum() * (1.0 - (-v.abs() * (3.0 + level * 0.4)).exp())
                    } else {
                        (1.0 + k) * v / (1.0 + k * v.abs())
                    }
                });
                tone.process(shaped) * *post
            }
            Pedal::Chorus { line, lfo } => {
                let depth = 0.0005 + level * 0.00006;
                let d = (0.015 + depth * lfo.next(0.8, sr)) * sr;
                line.write(x);
                x + 0.5 * line.read(d)
            }
            Pedal::Phaser { stages, lfo } => {
                let f = 700.0 + (200.0 + level * 6.0) * lfo.next(0.2 + level * 0.03, sr);
                let mut y = x;
                for st in stages.iter_mut() {
                    st.set_allpass(sr, f.max(40.0), 0.6);
                    y = st.process(y);
                }
                x + 0.6 * y
            }
            Pedal::Delay { line, lp, fb } => {
                let wet = lp.process(line.read(0.32 * sr));
                *fb = 0.2 + level * 0.004;
                line.write(x + wet * *fb);
                x + wet * (level / 100.0 * 0.7)
            }
            Pedal::Reverb(r) => x + r.process(x) * (level / 100.0),
        }
    }
}

/// Mono Freeverb (Jezar's tunings, scaled to the sample rate).
pub struct Freeverb {
    combs: Vec<(Vec<f32>, usize, f32)>,
    allpasses: Vec<(Vec<f32>, usize)>,
}

impl Freeverb {
    pub fn new(sr: f32) -> Self {
        let scale = sr / 44100.0;
        let combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
            .iter()
            .map(|&n| (vec![0.0; ((n as f32 * scale) as usize).max(1)], 0, 0.0))
            .collect();
        let allpasses = [556, 441, 341, 225].iter().map(|&n| (vec![0.0; ((n as f32 * scale) as usize).max(1)], 0)).collect();
        Self { combs, allpasses }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        const FEEDBACK: f32 = 0.84;
        const DAMP: f32 = 0.2;
        let input = x * 0.015;
        let mut out = 0.0;
        for (buf, i, store) in self.combs.iter_mut() {
            let y = buf[*i];
            *store = y * (1.0 - DAMP) + *store * DAMP;
            if store.abs() < 1e-20 {
                *store = 0.0;
            }
            buf[*i] = input + *store * FEEDBACK;
            *i = (*i + 1) % buf.len();
            out += y;
        }
        for (buf, i) in self.allpasses.iter_mut() {
            let b = buf[*i];
            buf[*i] = out + b * 0.5;
            *i = (*i + 1) % buf.len();
            out = b - out;
        }
        out * 3.0
    }
}

impl serde::Serialize for PedalKind {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.name())
    }
}

impl<'de> serde::Deserialize<'de> for PedalKind {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        PedalKind::from_name(&s).ok_or_else(|| serde::de::Error::custom(format!("unknown pedal {s}")))
    }
}
