# DEF6-FE-STATUS — browser-surface fixes (Frontend Engineer)

Items 1–4 DONE. Item 5 (deterministic capture) in progress.

Workspace: `/home/arggon/.config/AutoClaw-oversea-official/accounts/94e66e684ead817e330e9c30239face9889db0c1f9f662f8f569582a5b6e3380/projects/Default`

## Task list
- [x] Item 1 — DEF-7: widen `tools/check-surface-art.mjs` class extractor; resolve emitted-but-unstyled classes.
- [x] Item 2 — DEF-6: shared `dyingRow()`; hold paints it; hold tightened + clamped to 500 ms.
- [x] Item 3 — DEF-2: inert `diff N` badge removed (plumbing kept); orphan `.diff` rules dropped.
- [x] Item 4 — DEF-8: false reduced-motion comment corrected.
- [ ] Item 5 — Evidence: deterministic CDP capture under `shots/pm-verify/death/`; win AND defeat.

## What changed (file:line)
- `tools/check-surface-art.mjs:39-72` new `clsValue()` scanner; `:74-104` `classesFromOptions()` now
  reads the WHOLE `cls:` value and every quoted fragment of it (was: first quoted literal only).
- `web/app.js:940-957` `BOSS_DEATH_MS` (1150) replaced by `COLLAPSE_MS` (500); `END_DELAY_MS` kept.
- `web/app.js:1024-1073` hold branch rewritten: holds ONLY when there is something to show, paints
  `dyingRow()` (or `combatView()` when the player died on a live row) + the `.ended-hold` spacer,
  and waits `min(END_DELAY_MS, COLLAPSE_MS)`. The release at the end of the branch is unchanged.
- `web/app.js:1230-1264` new `dyingRow(dying, row?)`; `:1266-1280` `combineView()` calls it.
- `web/app.js:757` `diff N` badge removed; `difficulty` plumbing untouched.
- `web/style.css` added rules for `sc-targeting`, `boss-down`, `reveal`; removed the two orphan
  `.hud-char .diff` rules; corrected the false reduced-motion comment (`~:1695`).

## Item 1 — resolution decision (asked for)
`boss-down` was EMITTED BUT UNSTYLED. Chose **add a real `.boss-down` rule**, not remove the class:
the class is built from a live branch (`d.boss`), the words ("BOSS DOWN") already ship in the ghost's
`.ehp` line, and the frame colour makes the run's biggest death distinguishable without relying on
that text alone. Removing it would have deleted a real signal rather than styling it.
Widening the extractor surfaced **two more** emitted-but-unstyled classes the blind regex never saw:
`sc-targeting` (added a minimisation-neutral heading-colour rule) and `reveal` (gave the spoils head
the same arrival beat its tiles already have).

## Baselines (measured after all edits)
- `npm test` = **93 pass / 0 fail** (exact baseline).
- `npm run gate` exit 0 — "scanned 29 files under src/", OK.
- `node tools/check-surface-art.mjs` exit 0 — 137 emitted / 195 declared, no dupes, no external.

## Progress log
- Item 1 extractor widened: gate went 126 → 138 classes and FAILED with
  `boss-down, reveal, sc-targeting` (exit 2) — the blind spot, made visible.
- Items 2–4 edited; gate then OK (137 emitted / 195 declared).
- REGRESSION FOUND AND FIXED (mine): first cut of the shared builder used `dyingRow(x).children`,
  which the fake-DOM harness in `tests/kernel/click-targeting.test.js` +
  `tests/kernel/reward-click.test.js` does not implement (`kids`, no `children`) — 2 test files
  crashed. Rebuilt the builder to append into a passed row (no `.children` read); back to 93/0.
- Deliberate-failure demo still to run (Item 1 proof, direction ii) and capture (Item 5).
