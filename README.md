# Fretline

A guitar web app: tuner, chords, tab stream and pedalboard with a looper. It listens to a real
microphone or audio interface, runs all analysis in the browser, and works offline as an installable PWA.

The visual design comes from a Claude Design handoff, kept for reference in [`design/`](design/)
(`design/project/Guitar App.dc.html` plus the chat transcripts that explain the intent).

## Run it

```sh
npm install      # also copies the basic-pitch model into public/model
npm run dev      # builds the core to WebAssembly, then http://localhost:5173
npm test         # web tests (builds the core first)
npm run build    # core + typecheck + production build with service worker
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/pages.yml` (tests, then a build with
`BASE_PATH=/<repo>/`). In the repo settings, set **Pages → Source** to **GitHub Actions** once.

The microphone needs a secure context: `https://` or `localhost`. Use headphones when Output is on,
otherwise the speakers feed back into the mic.

## How it works

Everything that hears or makes sound is one Rust core, [`engine/core`](engine/core), that runs in
two **audio channels** speaking the same protocol:

- the **web channel**: the core compiled to WebAssembly ([`engine/wasm`](engine/wasm)) inside this
  browser;
- the **engine channel**: the core compiled natively into Fretline Engine, a small Windows tray app
  that owns the guitar input and speakers at a few milliseconds of latency.

```
            ControlMsg (set, listen, recalibrate, loop, play, stop)
  app ─────────────────────────────────────────────────────────────▶ channel
      ◀───────────────────────────────────────────────────────────── 
            ChannelMsg (state, status, analysis, notes, ml, meters)

  channel = Session (shared state)  +  AudioSide (conditioner → pedals → looper, + synth)
          + Capture (listening clock) → TrackerSide (YIN, chroma, onsets, noise floor)
                                      → MlSide (basic-pitch windows + note decoding)
```

| Part | Web channel | Engine channel |
| --- | --- | --- |
| Session (state, persistence) | WASM, main thread; saved in IndexedDB | native; `%LOCALAPPDATA%\Fretline\session.json` |
| AudioSide + Capture | WASM in an AudioWorklet | WASAPI render / analysis threads |
| TrackerSide | WASM in the pitch worker | analysis thread |
| basic-pitch network | TensorFlow.js (WebGL → WASM → CPU) | tract, model embedded |
| Devices | getUserMedia / setSinkId | WASAPI (exclusive or low-latency shared) |

The protocol is defined once in [`engine/core/src/protocol.rs`](engine/core/src/protocol.rs)
(mirrored in [`src/core/protocol.ts`](src/core/protocol.ts)); the app ([`src/audio/engine.ts`](src/audio/engine.ts))
never needs to know which channel it is talking to.

- **Shared state.** Pedals, Output, gate, noise floor, chord detection and devices live in the
  channel's Session and are broadcast whole, with a revision and edit time, on every change. Any
  number of controllers can follow it (a tablet controlling a PC's engine is the planned next
  step). When the app moves between channels, the most recently edited board, Output, gate and
  detection settings win, so nothing set on either side is lost.
- **Listening clock.** Capture counts samples only while someone listens and stamps every chunk.
  Every note, chord and riff timestamp uses that clock; the app maps each channel's clock onto
  one timeline, so pausing and switching channels never make timestamps jump.
- **Noise floor and threshold.** One estimate per channel drives the tuner's gate, the auto
  level and gate on Output, and silence skipping for basic-pitch. It follows the noise (the 20th
  percentile of recent levels: fast to learn, slow to rise while a struck note still sounds; frames
  of digital silence never enter it, so a stream's silent head cannot leave it far below the
  room) or stays fixed. In the Studio's Input
  tab a live gauge shows the input level, the measured floor and a draggable "plays above here"
  threshold (following the noise, the threshold keeps its distance above the floor). A guided
  calibration measures 3 s of muted strings and then one played note, and puts the threshold
  between them. Settings are remembered per input device.
- **Gauges.** Input and output levels are drawn every animation frame from the analysis stream
  and meters (no React state per frame): a compact pair in the header, amp-style VU gauges on the
  Pedals page, full-size bars in the Studio.
- **Tuner.** YIN through an FFT difference function (`engine/core/src/yin.rs`).
- **Chords.** Two spectral bands (`engine/core/src/chroma.rs`): a 171 ms frame from 70 Hz up
  and a 683 ms frame for B0 to B2, so drop C and bass registers resolve to the semitone. Every
  peak is calibrated to absolute dBFS, the 2nd to 16th partials are attributed to the notes
  below them, and the frame reports its fundamentals plus an octave-exact salience array. The
  tracker counts pick attacks; the app judges each strum once, in a window 150 to 600 ms after
  the attack, voting notes that clear the noise floor and were struck rather than left ringing
  (`src/state/strum.ts`, thresholds in `src/theory/levels.ts`). Following, the fretboard snaps
  to the voicing played; locked, the strum is judged against the board by the pitches it
  sounded, with the fix named per string ("Fret the B string"). Alternates come from a voicing
  enumerator with a hand model (`src/theory/voicings.ts`, `alternates.ts`). A phone recording
  of real chords and open strings (`engine/core/tests/fixtures/strums.wav`) is the calibration
  record: `engine/core/tests/strums.rs` and `tests/strums.test.ts` replay it through both
  channels' code.
- **Tab stream (hybrid).** Single notes from the tracker appear immediately as provisional;
  basic-pitch runs on 2 s windows with a 1 s hop, trusts only onsets in the middle second, and its
  results replace the provisional notes in their range (`src/theory/merge.ts`). A fingering
  solver places notes on strings and frets.
- **Looper.** Four synced slots in the AudioSide: the first recording sets the length, later
  slots record one cycle, a playing slot overdubs, and overdubs are written behind the playhead by
  the measured round-trip latency.
- **Sounds.** Strums, string previews, reference tones and riff playback are the core's synth,
  played by whichever channel is active (so they also go through the engine).
- **Storage.** IndexedDB holds riffs, the deleted bin, the web channel's session and app
  preferences. Riffs export and import as JSON.

Parity with the code it replaced is tested: the Rust tracker matches the previous TypeScript
tracker exactly on a mixed signal, and the basic-pitch decoder reproduces basic-pitch's own
JavaScript output exactly on real model output (`engine/core/tests`).

## Low-latency engine (Windows)

Chrome on Windows can't get under about 50 ms from string to speaker (most of it is Chrome's own
output buffering, whatever the device), which is too slow to play through pedals. Fretline Engine
runs the engine channel natively.

- **Use it.** Studio → Engine → Download for Windows, run the installer (per user, no
  admin; not code-signed yet, so SmartScreen asks: More info → Run anyway), then "I've installed it,
  connect". Chrome asks once to let the site reach devices on your network; that is the engine on
  this computer. Fretline only looks for the engine after you opt in, and falls back to the web
  channel whenever it isn't running.
- **Audio paths.** Each device opens exclusive (when chosen: the device's smallest period, no
  Windows effects in the path), else low-latency shared mode (`IAudioClient3`), else regular
  shared mode. Exclusive input is the default: it bypasses input "enhancements" such as Realtek AI
  noise reduction. Speakers default to shared so other apps keep playing. The two devices' clocks
  are bridged by a small resampling buffer that holds a constant backlog
  (`engine/core/src/drift.rs`) and grows only after an underrun.
- **Security.** The socket listens on 127.0.0.1 only and accepts Fretline's own origins
  (`https://nexarcdev.github.io`, `http://localhost:*`); any other page gets a 403.

## Build and test

```sh
npm run wasm     # core → src/core/fretline.wasm (needs Rust + the wasm32-unknown-unknown target)
npm test         # web tests, including the core's WASM realms and real basic-pitch inference
cd engine && cargo test --release     # core (DSP, detection, decoder parity, session) and engine
```

Off Windows the engine runs a device-free test backend (`--test`, `--test-wav FILE`, `--record
FILE`, `--state FILE`). `node engine/tests/smoke.mjs <binary>` checks the engine over its socket;
`node tests/e2e/channels.mjs <binary> <app url>` drives the real web app in headless Chromium on
both channels, switching between them, and `node tests/e2e/studio.mjs <app url>` checks the Studio
(guided calibration, gauges, layout stability) on the web channel. `--probe` writes what WASAPI can see and open to
`%LOCALAPPDATA%\Fretline\engine.log`.

CI keeps the site and the engine independent:

- `pages.yml` deploys the site: unit tests, the core built to WebAssembly, the Studio browser
  test, then GitHub Pages. It never builds the native engine.
- `engine.yml` runs only for engine changes: Linux and Windows builds and tests, the Inno Setup
  installer, and on `main` a new `engine-v<version>` release when the version in
  `engine/fretline-engine/Cargo.toml` is new (bump it to ship an engine change). The app links
  to `releases/latest/download/FretlineEngineSetup.exe`.
- `channels.yml` runs the two-channel browser test alongside; it never blocks a deploy.

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
- Building the app needs Rust with the `wasm32-unknown-unknown` target (`rustup target add
  wasm32-unknown-unknown`), since the web channel is the core compiled to WebAssembly.
