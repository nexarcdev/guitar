# Tab switching freeze issue

_Started 2026-10-06 12:39 UTC_

---

## User

There's a freeze when switching tabs sometimes. Like from Pedalboard to Tablature stream.

## Assistant

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: show_html]_

_[tool: multi_screenshot]_

_[tool: show_html]_

_[tool: multi_screenshot]_

_[tool: multi_screenshot]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: read_file]_

_[tool: grep]_

_[tool: run_script]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: ready_for_verification]_

I fixed the freeze. In my tests, switching from Pedals to Tabs used to stall the screen for up to 3.2 seconds. It now stays under about 50ms.

The main cause was the frosted-glass blur on panels and cards. Every time a tab opened, the browser had to set up a separate blur layer for each panel and card. With the 8 pedals and the saved riff cards, that was a lot of work. Those panels don't sit over anything that moves, so the blur wasn't visible anyway. I removed it from them and kept it on the two places where it actually shows: the setup popup and the mobile bottom bar.

Two smaller fixes:
- **Stream width:** the app no longer re-measures the tab stream's width 20 times a second. It only checks when the width actually changes.
- **Saved riff cards:** the cards are now only rebuilt when you save, delete or open a riff, not on every update while listening.

Pausing listening still causes a short hitch, about 0.36 seconds in my tests. I couldn't test with a live microphone, so tell me if you still see the freeze with real guitar input.

## User

GuitarTuna has a much nicer tuner design. It shows a streaming vertical spectrogram-style tuning bar, shows the actual next of a guitar (needs both layouts though, split or same side), and a cleaner, less card heavy layout. I feel like you can do so much better.

## User

GuitarTuna has a much nicer tuner design. It shows a streaming vertical spectrogram-style tuning bar, shows the actual next of a guitar (needs both layouts though, split or same side), and a cleaner, less card heavy layout. I feel like you can do so much better.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Fixed — status text no longer wraps; the hint wraps instead.

## User

Get rid of this message everywhere it appears. I know it's a demo, because "Listening * demo" is at the top.

## Assistant

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

_[tool: dc_js_str_replace]_

Removed the demo-guitar messages from the tuner hint.

