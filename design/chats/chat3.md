# Design implementation process

_Started 2026-10-08 18:24 UTC_

---

## User

This is great. Now, what's the process of getting the new design into the app in the repository?

## Assistant

_[tool: read_file]_

I can't commit to `nexarcdev/guitar` myself. I can only read the repo, so the change has to go through a developer or Claude Code. Here's the process:

1. **I build a handoff package.** It covers:
   - The locked design system as CSS variables: chassis, ivory, glass, paper, the three accents and the two fonts. These would go into `src/styles/global.css`.
   - A spec for each screen, mapped to its file: Shell, Tuner, Chords, Tabs, Pedals, Learn and Studio.
   - Specs for the shared parts (Knob, Meter, Chord Chart, Skill Ring) as React components, with their props and states.
   - Any assets and fonts, plus the house rules (the ivory, glass and paper rule, tutor strip behavior, no em dashes).
2. **You or Claude Code make the change in the repo.** Start with the variables and the shared components, then reskin one screen at a time by editing each `*.module.css` and its `.tsx`. Leave the audio and theory code in `src/audio` and `src/theory` alone; this is a visual redesign.
3. **Check it.** Put each screen next to its frame in `Fretline App.dc.html` and compare. One PR per screen keeps reviews small.
4. **Sync back here.** After the changes merge, hit Sync and I'll update the designs to match the new code.

Want me to build the handoff package now?

