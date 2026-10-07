# Fretline: notes for working in this repo

Architecture, commands and CI are in [README.md](README.md). This file holds the conventions and
the traps that have bitten before.

## House rules

- No em dashes anywhere: UI text, comments, docs, commit messages. Use a colon, a comma,
  parentheses or two sentences.
- UI colour: favour a three-colour scheme (the app uses warm red, gold and green accents on dark
  ink). Avoid monochrome screens.
- Controls never move because text changed. Status goes in a fixed one-line chip (`Section` in
  `src/features/studio/Section.tsx`); descriptions stay static. `tests/e2e/studio.mjs` checks this.

## React effects: give them a block body

Write `useEffect(() => { doThing(); }, deps)`, not `useEffect(() => doThing(), deps)`.

An expression-bodied arrow returns whatever `doThing()` returns, and React keeps any return value
as the cleanup and calls it later. If it is not a function, React throws during commit and the
whole tree unmounts. This shipped once: `el.scrollTo()` returns a Promise in current Chrome (it
returned `undefined` in older ones), so the Studio blanked on the second tab switch. The bug
depends on the browser version, so local tests can pass while CI's newer Chromium fails.

The only expression body that is fine returns the cleanup on purpose: `useEffect(() => stop, [])`.

How it shows up: `TypeError: <x> is not a function` from inside React's commit code (in a
minified build, a short function that runs `o.destroy`), and a view replaced by the "hit a
problem" card. Look for an expression-bodied effect whose call started returning a value.

## Error containment

Each main view (Shell) and each Studio tab renders inside `Contained`
(`src/features/shell/Contained.tsx`), keyed on the view. A new top-level view or tab goes inside
it too, so a failure shows a card with Try again and Reload, and the header and audio keep running.

## Per-frame UI

Gauges read `engine.levels` in a `requestAnimationFrame` loop and write to the DOM through refs.
Don't put per-frame values in React state or the store.

## Site and engine ship separately

- Site changes deploy through `pages.yml` and never rebuild the engine. Keep site-only work out of
  `engine/`.
- An engine change needs a version bump in `engine/fretline-engine/Cargo.toml`; `engine.yml`
  releases only when the `engine-v<version>` tag is new.
- The web app and the engine share `engine/core` and the protocol (`engine/core/src/protocol.rs`,
  mirrored in `src/core/protocol.ts`). A protocol change is an engine change.

## Browser tests

- Rebuild before running them. A stale `dist/` gives false passes.
- Start `vite preview` with the same `BASE_PATH` the build used (`BASE_PATH=/guitar/` for a
  `/guitar/` URL). Otherwise every asset 404s and the test reports "no app".
- CI installs the latest `playwright@1` and its Chromium, usually newer than a local one.
- On failure the tests print `::error` annotations with the step, the Playwright call log, the
  app state and page error stacks. Read those with
  `gh api repos/<owner>/<repo>/check-runs/<job id>/annotations`; that works even where log
  downloads are blocked.
- Pages from a branch other than `main` are rejected at the deploy step by environment
  protection. A green `build` job on a WIP branch is the signal it is safe to merge.
