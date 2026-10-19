# Fretline redesign: locked design system

Rule: **Ivory where you touch, dark glass where you read, paper where you learn.** Changing information always sits on glass, a dark well or paper; never directly on an ivory face.

- Chassis: `#221c19` with cherry light top-left `rgba(212,68,44,0.30)` and teal light bottom-right `rgba(77,182,164,0.14)`.
- Header: brushed aluminum (`#dcd8cf → #b8b3a9`, 1px vertical grain), dark engraved caps, recessed black readouts `#1a1512`. Page lamps are 30×4 amber bars. Sunburst 3px stripe below (cherry → amber → teal). Cream switch caps.
- Dark panel (reading): `#2d2622`, steel screws, amber title `#e9a23b`. Holds a glass window (`radial #15110f → #070605`) or paper.
- Ivory panel (controls): `linear-gradient(180deg,#ebe0c6,#dccfae)`, bone screws (slot `#6b5636`), title `#8a5a12`, body `#2b1d10` / `#6b5636`. Wells inside: `#2d2622` + satin grain `repeating-linear-gradient(0deg, rgba(255,235,210,0.018) 0 1px, transparent 1px 2px)`, edge `#4a3f38`.
- Paper: aged manila radial `#e8d6ad → #dcc492 → #c9ad74`, vignette, ink `#2b1d10`/`#3a2a1a`, playhead `#c8431f` is the only accent on paper. Always framed by a dark panel.
- Accents: cherry `#d4442c` (live/record/danger), amber `#e9a23b` (selected/on/primary), teal `#4db6a4` (confirmed/tutor/in tune). On ivory use `#d9902a` / `#1f8c7c`.
- Knobs: `Fl Knob` black cap on dark, cream cap on ivory. Meters: `Fl Meter` teal below threshold, amber above, cherry top 6 dB. Charts: `Fl Chord Chart`. Scores: `Fl Skill Ring`.
- One base per behavior (never restyle by hand): switches `Fl Switch` (horizontal slide or vertical rocker, surface dark/ivory/alu, tone picks the lamp), indicators `Fl Lamp` (dot or page bar, tone off/live/on/ok), status `Fl Chip`, pickers `Fl Segment`, numbers `Fl Readout` (recessed black well), frames `Fl Panel` (dark/ivory, screws + title row, takes children) and `Fl Window` (glass/paper, takes children). Learn instruments: `Fl Fretboard` (marks with tone root/chord/scale/target/heard, notes/intervals/dots, onTap) and `Fl Beat Strip` (strokes + hit offsets, teal ±20 ms, amber ±50, cherry beyond).
- Learn is a module strip (TODAY, LESSON, CHANGES, RHYTHM, THEORY, FRETBOARD, EAR, BAND, SOLO, JOURNEY). Every module except LESSON sits behind a `mod*` boolean prop (Tweaks section "Learn features"); off = hidden from the strip, and the strip shows how many are hidden. New modules: add a flag, a strip entry and an `lm.<id>` block; build them from the bases above.
- Type: Yellowtail wordmark only; Big Shoulders Display 700/800 caps for titles, labels, numbers; Barlow for copy.
- Tutor strip: 46px bottom bar, teal lamp, one sentence, one action. Never a modal.
- No em dashes in UI copy (repo house rule).

Files: `Fretline App.dc.html` (all views), `Fretline Components.dc.html` (reference sheet; every `Fl *` component must appear here), `Fretline Lesson.dc.html`, `Fretline Directions.dc.html` (history; 3a/3b are the locked look), `Fretline Current.dc.html` (pre-redesign recreation).
