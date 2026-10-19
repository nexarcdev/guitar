# Learn system feature expansion

_Started 2026-10-09 14:41 UTC_

---

## User

I want to expand the Learn system with some cool, useful features. Each one needs to be able to be toggled off internally, so until they're implemented, we don't have to show them. But for the purpose of the prototype, mock them all out please. I want to see what all these features could look like in a final product before we build them out.

Make sure you keep everything DRY. It's critical that every new component is made to be reusable and makes it into the `design` sheet so we stay consistent across modules and screens. And staying DRY means that we have one working base that other things are built upon, not multiple ways to turn a knob or display indicators or flip switches. And maintaining reusable behaviors and consistent visual language results in a better user experience, which is crucial here.

## Assistant

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: list_files]_

_[tool: grep]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

_[tool: grep]_

_[tool: update_todos]_

_[tool: dc_write]_

_[tool: dc_write]_

_[tool: dc_write]_

_[tool: dc_write]_

_[tool: dc_write]_

_[tool: dc_write]_

_[tool: dc_write]_

_[tool: dc_write]_

_[tool: dc_write]_

_[tool: show_html]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_set_props]_

_[tool: dc_js_str_replace]_

_[tool: show_html]_

_[tool: get_webview_logs]_

Now the component reference sheet.

_[tool: run_script]_

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: ready_for_verification]_

Learn now opens on a module strip with ten modules (Today, Lesson, Changes, Rhythm, Theory, Fretboard, Ear, Band, Solo, Journey). Each one except Lesson is behind a `mod*` flag in Tweaks → "Learn features"; off hides it from the strip, which reports how many are hidden.

DRY work:
- New bases: `Fl Switch`, `Fl Lamp`, `Fl Chip`, `Fl Segment`, `Fl Readout`, `Fl Panel`, `Fl Window` (the last two wrap children), plus `Fl Fretboard` and `Fl Beat Strip` for Learn. All are on the Components sheet with props documented, and CLAUDE.md now lists them as the only way to flip, indicate, pick, read out, and frame.
- Existing inline switches, segments, and status chips across the header, Tuner, Chords, and Tabs were swapped for the bases, so there is one switch and one segment implementation app-wide.

Caveat: the Tuner/Chords/Tabs/Pedals panels still carry their original inline panel chrome (visually identical to `Fl Panel`). Migrating them is mechanical if you want it next. Out for verification now.

## User

Found issues — fixing…

## Assistant

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Fixed both: numeric props are now coerced in Fretboard, Beat Strip, Lamp and Window (so fretted marks render), and the Journey heatmap is capped to 14px cells. Back out for verification.

