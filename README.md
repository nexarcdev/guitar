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

## Low-latency engine (Windows)

Chrome on Windows can't get under about 50 ms from string to speaker (most of it is Chrome's own
output buffering, whatever the device), which is too slow to play through pedals. Fretline Engine
is a small native tray app in [`engine/`](engine/) that takes over the guitar input and the
speakers and runs the pedals and looper at a few milliseconds. The browser keeps doing all the
listening: the engine streams the raw guitar back, so the tuner, chords and tabs are unchanged.

```
guitar ─▶ WASAPI capture ─┬─ monitor ring ─▶ drift reader ─▶ conditioner ─▶ pedals ─▶ looper ─▶ WASAPI render
                          └─ analysis ring ─▶ ws://127.0.0.1:47831 ─▶ web app ─▶ pitch + ML workers
web app ─ JSON (pedals, Output, looper, noise floor, devices) ─▶ engine
```

- **Use it.** Settings → Low-latency engine → Download for Windows, run the installer (per user, no
  admin; not code-signed yet, so SmartScreen asks: More info → Run anyway), then "I've installed it,
  connect". Chrome asks once to let the site reach devices on your network; that is the engine on
  this computer. Fretline only looks for the engine after you opt in, and falls back to browser
  audio whenever it isn't running.
- **Audio paths.** Each device opens exclusive (when chosen: the device's smallest period, no
  Windows effects in the path), else low-latency shared mode (`IAudioClient3`, the smallest engine
  period the driver allows), else regular shared mode. Exclusive input is the default: it bypasses
  input "enhancements" such as Realtek AI noise reduction. Speakers default to shared so other apps
  keep playing. The two devices' clocks are bridged by a small resampling buffer that holds a
  constant backlog (`engine/dsp/src/drift.rs`) and grows only after an underrun.
- **Security.** The socket listens on 127.0.0.1 only and accepts Fretline's own origins
  (`https://nexarcdev.github.io`, `http://localhost:*`); any other page gets a 403.
- **Protocol.** `engine/fretline-engine/src/protocol.rs` (engine side) and `src/audio/native.ts`
  (web side). Binary frames carry mono f32 audio with the engine's sample index; the web app maps it
  onto its own listening clock, so pausing and switching between engine and browser never jump.
- **Build and test.** `cd engine && cargo test --release && cargo build --release`. Off Windows the
  engine runs a device-free test backend (`--test`, `--test-wav FILE`, `--record FILE`):
  `node engine/tests/smoke.mjs <binary>` checks the protocol, and `node engine/tests/e2e-web.mjs
  <binary> <app url>` drives the real web app in headless Chromium against it. `--probe` writes what
  WASAPI can see and open to `%LOCALAPPDATA%\Fretline\engine.log`.
- **Releases.** `.github/workflows/engine.yml` builds and tests on Linux and Windows, builds the Inno
  Setup installer, and on `main` publishes it as the `engine-v<version>` release, which the app links
  to as `releases/latest/download/FretlineEngineSetup.exe`.

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
- Browser audio adds latency (about 50 ms through Output on Windows in Chrome). That is fine for
  practice and looping but not for playing through pedals; use the low-latency engine for that.
- The engine's WASAPI paths are built and smoke-tested in CI on Windows, but CI runners have no sound
  card, so real-device behaviour (driver periods, exclusive formats) is verified on hardware only.
