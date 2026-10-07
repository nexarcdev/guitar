//! basic-pitch inference with tract (pure Rust, nothing to install). The model is embedded in
//! the executable; everything around it (windowing, decoding) is the shared core's MlSide.

use fretline_core::ml::{ML_WINDOW, N_FRAMES, N_PITCH};
use tract_onnx::prelude::*;

const MODEL: &[u8] = include_bytes!("../assets/nmp.onnx");

type Plan = std::sync::Arc<TypedRunnableModel>;

pub struct Model {
    plan: Plan,
    /// Output indices of the note-frame and onset activations.
    frames: usize,
    onsets: usize,
}

impl Model {
    pub fn load() -> Result<Self, String> {
        let model = tract_onnx::onnx()
            .model_for_read(&mut std::io::Cursor::new(MODEL))
            .and_then(|m| m.with_input_fact(0, f32::fact([1, ML_WINDOW, 1]).into()))
            .map_err(|e| format!("model: {e}"))?;
        // basic-pitch names its outputs after TensorFlow's: :1 = note frames, :2 = onsets.
        let names: Vec<String> = model.output_outlets().map_err(|e| e.to_string())?.iter().map(|o| model.node(o.node).name.clone()).collect();
        let find = |suffix: &str| names.iter().position(|n| n.ends_with(suffix)).ok_or_else(|| format!("model output {suffix} missing in {names:?}"));
        let (frames, onsets) = (find(":1")?, find(":2")?);
        let plan = model.into_optimized().and_then(|m| m.into_runnable()).map_err(|e| format!("model: {e}"))?;
        Ok(Self { plan, frames, onsets })
    }

    /// Runs one window; fills `frames` and `onsets` (N_FRAMES × N_PITCH each).
    pub fn run(&self, audio: &[f32], frames: &mut Vec<f32>, onsets: &mut Vec<f32>) -> Result<(), String> {
        let input: Tensor = tract_ndarray::Array3::from_shape_vec((1, ML_WINDOW, 1), audio.to_vec()).map_err(|e| e.to_string())?.into();
        let out = self.plan.run(tvec!(input.into())).map_err(|e| e.to_string())?;
        for (idx, dst) in [(self.frames, frames), (self.onsets, onsets)] {
            let v = out[idx].to_plain_array_view::<f32>().map_err(|e| e.to_string())?;
            dst.clear();
            dst.extend(v.iter().copied());
            if dst.len() != N_FRAMES * N_PITCH {
                return Err(format!("unexpected model output size {}", dst.len()));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fretline_core::ml::notes_poly;

    /// The embedded model, through tract, transcribes a plucked C major chord and a later G.
    #[test]
    fn transcribes_a_chord_and_a_note() {
        let m = Model::load().unwrap();
        let sr = 22050.0;
        let mut x = vec![0.0f32; ML_WINDOW];
        let mut seed = 1u64;
        let mut rnd = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((seed >> 33) as f32 / (1u64 << 31) as f32) * 2.0 - 1.0
        };
        let mut pluck = |midi: i32, at: f64, amp: f32| {
            let f = 440.0 * 2f64.powf((midi - 69) as f64 / 12.0);
            let p = (sr / f).round() as usize;
            let mut buf: Vec<f32> = (0..p).map(|_| rnd()).collect();
            let s0 = (at * sr) as usize;
            for i in 0..ML_WINDOW - s0 {
                let k = i % p;
                let v = buf[k];
                buf[k] = 0.996 * 0.5 * (buf[k] + buf[(k + 1) % p]);
                x[s0 + i] += v * amp;
            }
        };
        for (i, m) in [48, 52, 55, 60, 64].into_iter().enumerate() {
            pluck(m, 0.3 + i as f64 * 0.015, 0.25);
        }
        pluck(67, 1.3, 0.3);
        let (mut f, mut o) = (Vec::new(), Vec::new());
        let t = std::time::Instant::now();
        m.run(&x, &mut f, &mut o).unwrap();
        eprintln!("inference {:?}", t.elapsed());
        let notes = notes_poly(&f, &o);
        let frame_sec = 256.0 / sr;
        let chord: std::collections::HashSet<i32> = notes.iter().filter(|n| (n.start_frame as f64 * frame_sec) < 0.6).map(|n| n.pitch_midi % 12).collect();
        assert!([0, 4, 7].iter().all(|pc| chord.contains(pc)), "{notes:?}");
        assert!(notes.iter().any(|n| n.pitch_midi == 67 && (n.start_frame as f64 * frame_sec - 1.3).abs() < 0.1), "{notes:?}");
    }
}
