# Always-listening music app design

_Started 2026-10-06 12:21 UTC_

---

## User

"Listen" is a global state. The app should always listen by default but allow the user to pause it. That means the tuner is always active, chord identifier is active, and tablature is recording a rolling riff for the user, no "record" button necessary. And since the app is always recording, we need an output toggle too, because the app is the amp and needs passthrough with the effect pedals.

## User

Found issues — fixing…

## User

Found issues — fixing…

## Assistant

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

I fixed the error that was firing on every screen update. Because of it, knobs, footswitches and reordering weren't changing the sound, and the tab stream didn't jump to your latest notes when you paused. Both should work now; the change is being checked again.

