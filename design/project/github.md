repo: nexarcdev/guitar
branch: main
path: src

## Last sync
date: 2026-10-08T15:29:51Z

### Updated in this project
- Added the Studio (Guitar, Input, Sound, Engine, Diagnostics) to Fretline App in the locked system
- Chord charts and presets now wrap in narrow windows
- Skill ring label color prop for ivory panels

## Sync history
- 2026-10-08T12:54:31Z: recreated current shell, Tuner, Chords, Tabs, Pedals; copied icon and screenshots

## Screen map
| Screen | Repo files |
| --- | --- |
| Fretline Current.dc.html (shell, rail, header chips) | src/features/shell/Shell.tsx, src/features/shell/Shell.module.css, src/styles/global.css, index.html, src/main.tsx |
| Fretline Current.dc.html (Tuner) | src/features/tuner/Tuner.tsx, src/features/tuner/Tuner.module.css, src/theory/music.ts |
| Fretline Current.dc.html (Chords) | src/features/chords/Chords.tsx, src/features/chords/Chords.module.css, src/theory/music.ts |
| Fretline Current.dc.html (Tabs) | src/features/tabs/Tabs.tsx, src/features/tabs/Tabs.module.css |
| Fretline Current.dc.html (Pedals, VU gauges, looper) | src/features/pedals/Pedals.tsx, src/features/pedals/Pedals.module.css, src/features/gauges/Gauges.tsx, src/features/gauges/Gauges.module.css, src/audio/pedals.ts |
| Fretline App.dc.html (shell, Tuner, Chords, Tabs, Pedals, Learn) | same files as above, redesigned |
| Fretline App.dc.html (Studio overlay) | src/features/studio/Studio.tsx, src/features/studio/Studio.module.css, src/features/studio/Section.tsx, src/features/studio/GuitarTab.tsx, src/features/studio/InputTab.tsx, src/features/studio/SoundTab.tsx, src/features/studio/EngineTab.tsx |
