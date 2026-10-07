//! basic-pitch processing. The fixtures are real model outputs (nmp.onnx) for plucked strings,
//! with the notes basic-pitch's own JavaScript decoder produced for them.

use fretline_core::ml::{notes_poly, MlStream, ML_WINDOW, N_FRAMES, N_PITCH};

fn read_f32(path: &str) -> Vec<f32> {
    std::fs::read(path).unwrap().chunks(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect()
}

#[test]
fn decoder_matches_basic_pitch_js_exactly() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
    for name in ["chord", "riff"] {
        let frames = read_f32(&format!("{dir}/{name}.frames.f32"));
        let onsets = read_f32(&format!("{dir}/{name}.onsets.f32"));
        assert_eq!(frames.len(), N_FRAMES * N_PITCH);
        let expected: Vec<(usize, usize, i32, f64)> = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/{name}.notes.json")).unwrap()).unwrap();
        let got = notes_poly(&frames, &onsets);
        assert_eq!(got.len(), expected.len(), "{name}: {got:?}");
        for (g, e) in got.iter().zip(&expected) {
            assert_eq!((g.start_frame, g.duration_frames, g.pitch_midi), (e.0, e.1, e.2), "{name}");
            assert!((g.amplitude as f64 - e.3).abs() < 1e-4, "{name}: amp {} vs {}", g.amplitude, e.3);
        }
    }
}

/// Windowing, silence skipping and the clock mapping, with a stand-in model that reports one
/// note at a known frame.
#[test]
fn stream_tiles_windows_skips_silence_and_maps_to_the_listening_clock() {
    let sr = 48000.0;
    let mut ml = MlStream::new(sr);
    ml.set_floor(-70.0, 12.0);
    let mut windows = 0;
    let mut covered = Vec::new();
    let mut seen = Vec::new();
    // 3 s of near silence, then 5 s of a loud tone, listening clock starting at 10 s.
    let t0 = (10.0 * sr) as u64;
    let total = (8.0 * sr) as usize;
    let mut t = 0usize;
    while t < total {
        let chunk: Vec<f32> = (t..t + 1024)
            .map(|i| if i < 3 * sr as usize { 1e-5 } else { 0.2 * (2.0 * std::f64::consts::PI * 220.0 * i as f64 / sr).sin() as f32 })
            .collect();
        ml.push(t0 + t as u64, &chunk);
        t += 1024;
        while let Some(w) = ml.next_window() {
            assert_eq!(w.audio.len(), ML_WINDOW);
            let peak = w.audio.iter().fold(0.0f32, |a, v| a.max(v.abs()));
            assert!((peak - 0.5).abs() < 0.01, "normalised to 0.5: {peak}");
            windows += 1;
            // Fake model: a note on pitch index 36 (A3) starting at frame 100, i.e. ~1.16 s in.
            let mut frames = vec![0.0f32; N_FRAMES * N_PITCH];
            let mut onsets = vec![0.0f32; N_FRAMES * N_PITCH];
            for r in 100..140 {
                frames[r * N_PITCH + 36] = 0.9;
            }
            onsets[100 * N_PITCH + 36] = 0.9;
            let r = ml.decode(&w, &frames, &onsets);
            covered.push((r.from, r.to));
            seen.extend(r.notes.iter().map(|n| (n.midi, n.t)));
        }
    }
    assert!(windows >= 4, "{windows}");
    // Windows tile without gaps or overlap, on the listening clock (which starts at 10 s).
    for w in covered.windows(2) {
        assert!((w[1].0 - w[0].1).abs() < 1e-9, "{covered:?}");
    }
    // Windows 0 and 1 (spanning up to 12.5 s) hold only the quiet start and are skipped.
    assert!((covered[0].0 - 12.0).abs() < 1e-9, "{covered:?}");
    // Every reported note is inside its window's trusted second.
    for (i, &(midi, t)) in seen.iter().enumerate() {
        assert_eq!(midi, 57);
        assert!(t >= covered[i].0 && t < covered[i].1, "{t} not in {:?}", covered[i]);
    }
}
