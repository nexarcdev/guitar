# Riff save system redesign

_Started 2026-10-06 13:11 UTC_

---

## User

"Remember riff" shouldn't be a button, and naming the riff is completely unnecessary. Maybe rename them after saving. The whole system is wrong, it's garbage and abrasive. So let's skip that shit entirely and go with some quick save buttons. Use the rolling riff with some save buttons over it that shows what will be saved with a bracket, lines, or something. When the user stops playing for a few beats, it should pause the stream and insert a divider. It's not really about time, it's more about how many bars we want to save.

## Assistant

_[tool: grep]_

_[tool: read_file]_

Now the logic for the stream/save.

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

Now the edits — template first, then logic.

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Remove the saving panel and make riff names editable in place.

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

Now the logic: tempo estimate, gap dividers, bar-based saves.

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

Now the return vals, state, constants, and tick toast expiry.

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

Now props for time signature and rest threshold.

_[tool: dc_set_props]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Reworked the save flow in the Tablature stream:

- Naming/“Remember riff” panel gone. A small **SAVE · 2 bars · 4 bars · 8 bars · Phrase** strip sits over the stream; one tap saves instantly as “Riff N”, with a brief toast.
- Hovering a button draws a gold bracket on the stream showing exactly which bars/notes it'll keep.
- Bars come from an auto-estimated tempo (shown as ~BPM under the stream); time signature and the rest threshold (in beats) are tweakable.
- Stop playing for a few beats → the stream pauses and a dashed divider is inserted. Saves never cross a divider, so “4 bars” means the last 4 bars of the phrase you just played.
- Rename by clicking a riff's name in the Saved riffs card.

Note: the demo guitar now rests after each 4-chord cycle so you can see the pause/divider behavior.

## User

Found issues — fixing…

## Assistant

_[tool: grep]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Fixed: singular/plural in toast and card meta, title shortened to "Tab stream" with no-wrap, and notes now sit above the bracket fill.

## User

1. The save bar overlaps the stream. Move it next to "Live" or something.
2. Save/delete should be like tabs or something, that layout is total shit.
3. There's periodical freezing of the web page as it's live streaming, performance is truly terrible.

## Assistant

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

Now let me see the saved/deleted riffs section template to redo it as tabs.

_[tool: read_file]_

_[tool: read_file]_

Rewriting the stream header, viewport, and the saved/deleted section in one pass.

_[tool: read_file]_

I'll do the template rewrite of lines 185–283 via one script, then the logic.

_[tool: run_script]_

Now the logic: decouple stream motion from React state (rAF transform), rewrite the stream/riffs section.

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: grep]_

Now apply all logic edits in one script.

_[tool: run_script]_

_[tool: grep]_

Only false-positive matches (`this.lt()`, `this.playT`). One concern: `takeTitle` used `paused` — it's still defined. Let me check load.

_[tool: ready_for_verification]_

- Save strip moved out of the stream, into the header row beside the LIVE chip; the bracket still previews on hover.
- Saved / Deleted are now tabs over a single compact row list (play · name · meta · mini-tab · ✕; deleted rows get Restore / ✕). "Empty deleted" appears only on the Deleted tab.
- Performance: the stream no longer re-renders 20×/sec. Motion is a single rAF transform on the track; React only updates when a note arrives, a rest starts/ends, or you interact. Note-hit flash is a CSS animation; riff playback time updates the chip directly.

## User

Found issues — fixing…

## Assistant

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

Now the chord-related logic so I rebuild the chords tab against the real data shape.

_[tool: read_file]_

_[tool: read_file]_

Rebuilding the chords tab (left: live "hearing" panel + history; right: fretboard, name, presets) and restoring the Tab-stream wrapper.

_[tool: run_script]_

_[tool: ready_for_verification]_

Restored the chord identifier tab (my earlier edit had spliced over it) and the Tab stream wrapper; also fixed the truncated page title. Out for review.

## User

Found issues — fixing…

## Assistant

_[tool: read_file]_

_[tool: run_script]_

_[tool: ready_for_verification]_

Fixed the title truncation, the wrapping "Back to live" button, and the tempo estimate doubling on the demo guitar.

