# Guitar tuning and capo system

_Started 2026-10-06 12:05 UTC_

---

## User

The entire app assumes standard tuning, but this isn't always the case. We need an app-wide tuning so users can quickly switch to drop-D tuning and other standard tunings but also customize their own. We also need capo support. It needs to adjust everything accordingly. The app needs to respond appropriately to transposition and tuning and stuff. And it needs to be simple, easy, and "just make sense" to non-technical users but make sense to guitar people and feel like it belongs in their world, not in the tech world.

## Assistant

_[tool: read_file]_

_[tool: copy_files]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Now the logic.

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_set_props]_

_[tool: ready_for_verification]_

Added an app-wide guitar setup, out for review.

- **Header chip** (e.g. “Drop D · Capo 2”) opens a **Your guitar** sheet: 11 common tunings with their string notes, per-string ▲▼ pegs for custom tunings (tap a note to hear it), capo Off–12. Persists across sessions.
- **Tuner** targets the tuned open strings; warns to take the capo off.
- **Chords** show the sounding chord with “G shape with capo 2 · A major”; preset chips relabel to what they actually sound like; fret numbers count from the capo like a chord chart.
- **Tabs** relabel strings, record frets relative to the capo, save the setup with each riff, and offer “Set my guitar up like this” when a riff was recorded in a different setup. Riffs always play back at their true pitch.
- Tweaks: starting tuning and capo.

Previous version kept as `Guitar App v2.dc.html`.

