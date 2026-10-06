# Fretline

A guitar web app: tuner, chord identifier, tab stream and pedalboard with a looper. It listens to a real
microphone or audio interface, runs all analysis in the browser, and works offline as an installable PWA.

The visual design comes from a Claude Design handoff, kept for reference in [`design/`](design/)
(`design/project/Guitar App.dc.html` plus the chat transcripts that explain the intent).

## Run it

```sh
npm install      # also copies the basic-pitch model into public/model
npm run dev      # http://localhost:5173 (localhost counts as secure, so the mic works)
npm test         # unit tests, including a real basic-pitch inference smoke test
npm run build    # typecheck + production build with service worker
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/pages.yml` (tests, then a build with
`BASE_PATH=/<repo>/`). In the repo settings, set **Pages → Source** to **GitHub Actions** once.

The microphone needs a secure context: `https://` or `localhost`. Use headphones when Output is on,
otherwise the speakers feed back into the mic.

## How it works

```
input ─┬─ capture worklet ──MessagePorts──▶ pitch worker (YIN, chroma, fast onsets)
       │                                └─▶ ML worker (basic-pitch, polyphonic)
       └─ inBus ─▶ pedal chain ─▶ chainOut ─┬───────────────▶ master (Output toggle) ─▶ speakers
                                            └─ looper worklet ─▶ master
```

- **Listening clock.** The capture worklet counts samples only while listening and stamps every chunk.
  Every note, chord and riff timestamp uses that clock, so pausing collapses cleanly. Audio goes from
  the worklet straight to the workers; the main thread never touches raw samples.
- **Baseline.** Every stage measures the input's noise floor (calibrated in the first 0.4 s, then
  tracked: it drops instantly to any quieter moment and rises slowly). Gates open 12 dB above it and
  close 6 dB above it, so a quiet guitar cable works as well as a hot interface and noise never reads
  as pitch. The monitored signal gets an automatic level (up to +24 dB) behind a noise gate.
- **Tuner.** YIN with an FFT-based difference function (`src/dsp/yin.ts`), about 94 readings/s. Its
  pitch trail is drawn on a canvas, not through React.
- **Chords.** Chroma uses interpolated spectral peaks with overtone suppression up to the 6th harmonic
  (`src/dsp/chroma.ts`). Naming is cosine template matching (`chordFromChroma`). When YIN hears a clean
  single pitch, the view names the note instead of reading its overtones as a chord.
- **Tab stream (hybrid).** Single notes from the pitch worker appear immediately as provisional
  (slightly dimmed). basic-pitch then runs on 2 s windows with a 1 s hop and trusts only onsets in the
  middle second, so windows tile the timeline. Each result replaces the provisional notes in its range
  (`src/theory/merge.ts`). The ML pass also refines the chord name for the same strum, bass included,
  but never overrides a newer chord. A fingering solver (`src/theory/fingering.ts`) places notes on
  strings and frets, keeping the hand compact and close to where it just was.
- **ML backends.** WebGL, then WASM (SIMD), then CPU. If inference can't keep up with real time it
  switches itself off and the stream says it is showing single notes only.
- **Looper.** Four synced slots in an AudioWorklet (`src/audio/looperCore.ts`). The first recording sets
  the loop length, and later slots record exactly one cycle. Tapping a playing slot overdubs, and
  overdubs are written behind the playhead by the measured round-trip latency so they line up with what
  you heard.
- **Storage.** IndexedDB (`src/state/db.ts`) holds riffs, the deleted bin, guitar setup, pedalboard,
  rhythm settings, input device and headstock style. Riffs export and import as JSON. On first run it
  imports anything the prototype left in localStorage, except the prototype's two sample riffs.

## Changes from the prototype

- The demo guitar is gone. Without a mic the app explains what's missing (permission blocked, no device,
  insecure origin, or audio waiting for a tap) and offers the fix.
- The looper records and plays real audio. A ■ button stops or plays a slot, and the header shows the
  loop length.
- The prototype's design-time props now live in the app. Time signature and rest threshold are in the
  ⚙ popover on the tab stream. The app reopens on the last tab you used.
- The "Your guitar" sheet adds input device selection with a level meter, and a headstock style
  (3 + 3 or 6 in line), which the tuner chat asked for but the final design file only drew one way.
- The pedals are keyboard accessible: arrow keys turn knobs, and the grip reorders.

## Windows audio ducking

Windows turns other audio down (by 80% by default) when it thinks a call has started, and that can
include Fretline's own sound. Fretline opens your input by its real device id rather than the
virtual "default" device to avoid triggering this. If it still happens: press Win + R, run
`mmsys.cpl`, open the Communications tab and choose "Do nothing". The same steps are in the app
under Your guitar → Sound check.

## Known limits

- Chord and tab accuracy has been verified end to end in headless Chromium with a fake microphone
  playing synthesized plucked strings (tuner within 1 cent, G–Em–C–D identified). It has not yet been
  tuned against recordings of real guitars, where pick noise and string resonance will differ.
- basic-pitch output arrives 1 to 2 s after you play. Provisional single notes cover that gap, but
  chords appear only once the ML window lands.
- Browser audio input adds latency (often 10 to 40 ms round trip). That is fine for practice and
  looping, but it is not a hardware amp.
