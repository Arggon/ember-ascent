# JUICE-STATUS.md — making the deckbuilder feel alive

Presentation only. No balance, no rules, no kernel changes. Owner's ask: "improve visual
effects, animations to make the game a live feeling."

## Baseline (verified before any change)

| Check | Result |
|---|---|
| `node --check web/app.js` / `tokens.js` | clean |
| `node --test 'tests/**/*.test.js'` | **93 pass / 0 fail** *(as measured at this checkpoint; the suite has grown since — re-run `npm test`, do not quote this as current)* |
| `node tools/check-architecture.mjs` | OK, exit 0 |
| `node tools/check-surface-art.mjs` | OK — 99 emitted classes all have CSS rules, 209 distinct top-level selectors, no external assets **[CORRECTED 2026-10-16: these counts are STALE — the checker now reports 126 emitted / 316 distinct. See the correction under §"WHAT I VERIFIED" below. Re-run `node tools/check-surface-art.mjs`.]** |
| `grep -rniE 'https?://\|cdn\|@import\|googleapis\|\.woff' web/` | **empty** |

---

## THE STRATEGY DECISION (task #1)

**Problem restated.** `render()` calls `stageEl.replaceChildren()` and rebuilds the whole
tree from `snapshot()` after *every* action. Any CSS animation started on a node is killed
by its own removal from the document — the animation begins and the node ceases to exist in
the same frame. So "add an animation class" appears to do nothing.

**Chosen: (3) persistent visual layer, combined with (4) animation state carried in a token.**

Why not the others:

- **(1) deferred repaint** — rejected as the *primary* mechanism. It requires a timeout per
  action, which serialises play behind animation duration (the brief forbids the deal-in
  ever feeling like waiting), and a missed timer leaves the game frozen mid-turn. That is a
  correctness risk taken on for presentation value. It is used *only* for turn hand-off,
  where there is genuinely nothing to render yet, and it is guarded by
  `prefers-reduced-motion` and a hard timer cap.
- **(2) stable nodes + content patching** — correct in theory, best long-term result, but
  it is a rewrite of the entire renderer (map/reward/rest/end views included) for a polish
  pass. Too much blast radius for this budget; noted as the follow-up.
- **(3) persistent visual layer** — **adopted.** Two sibling layers to `#stage`
  (`#fx-layer` screen-space, `#float-layer` anchored inside `.enemies` via absolute
  positioning) live in `index.html` and are *never* rebuilt. They survive every repaint, so
  they can carry floaters, slashes, sparks and screen-shake freely.
- **(4) animation state carried in a token** — **adopted where the thing must be animated on
  a node that does get rebuilt.** `flash` now carries a monotonic `n` (a paint generation).
  Every animated class is built as `` `flash-${kind}-${n}` ``. Because the generation
  changes only when that particular state actually changed, a re-render for an unrelated
  reason reproduces the *same* class string on the same node → the browser sees no class
  delta → **the animation is not restarted**. When the state does change, the class string
  changes → the animation starts. This is idempotent re-application, which the previous
  boolean approach did not have.

**What it cost.** ~110 lines of new renderer code (a `bursts` array built inside the
existing `act()` before/after comparison, two builder functions, a `FLASH_EXIT_MS` timers
list) plus the two layers in `index.html` and the CSS. `render()` keeps its
`replaceChildren()` — the base tree behaviour is unchanged, which is why the risk to the
93 tests and to targeting/hotkeys is low.

**What the layers required.** `#app` got `position: relative` and `.enemies` got
`position: relative`, so the floaters can be absolutely positioned without affecting
document flow. Absolute positioning is deliberate: **a floater can never push a clickable
element**, which is the "animation must not move a click out from under the pointer"
constraint.

**How effects reach the screen.** `act()` already diffs the before/after snapshots for
`hits`, `playerLost`, `enemyLost` and `gainedBlock`. That comparison is *extended* to build
a `bursts` list (floaters, shield flare, block-break shatter). It is not new logic and not a
game rule: every number in it is a difference between two kernel snapshots, which is exactly
what the file already did for the toast. No number is invented; the enemy's *intent damage*
comes from `e.intent.damage` in the snapshot.

**Floaters carry an unreadable-by-a-human hit glyph, not damage.** The brief requires the
floating number to never be the only source of truth. So the readable number is the HP
*total* (`−5`, i.e. the new HP), which is always consistent with the HP bar that also
updates; the magnitude of the hit is carried by a fixed **glyph ladder** drawn from the
kernel's `intent.damage` (`·` chip / `◆` hurt / `✸` hard) plus size and colour. No expected
HP-math is printed, because nothing in the snapshot promises pre-block mitigation — that
would be an invented number. Sub-2 damage after block renders `⛨` + "absorbed", never a `0`
or `−0`.

---

## TASK LEDGER

| # | Task | State |
|---|---|---|
| 1 | Strategy decision, checkpoint file, DOM-shim proof harness | **DONE + verified** |
| 2 | CSS: keyframes, tokens, all effect rules, reduced-motion coverage | **DONE + verified** |
| 3 | `index.html`: the two persistent layers | **DONE + verified** |
| 4 | `web/app.js`: flash generation, bursts, floater/slash builders, render wiring | **DONE + verified** |
| 5 | P2: death fade-out, enemy entrance, player vignette, HP jolt | **DONE + verified** |
| 6 | Status pill kind-shapes (vulnerable/weak/strength/dexterity) | **DONE + verified** |
| 7 | Turn transition (deferred paint, reduced-motion guarded) | **DONE + verified** |
| 8 | P3 run structure | **NOT STARTED — see "exact next step"** |

Verification commands and their raw output are pasted at the bottom of this file. *(As of
2026-10-16 the "raw output at the bottom" section is absent from the file as it stands — treat the
claims above as claims, and re-run the commands rather than relying on a paste that is not here.)*

---

## WHAT I VERIFIED vs WHAT I COULD NOT

**Verified** (raw output pasted at the bottom):

- `node --check` on both modules — clean.
- `node --test 'tests/**/＊.test.js'` — 93 pass / 0 fail, unchanged count.
- `node tools/check-architecture.mjs` — OK, exit 0. No game rules entered `web/`.
- `node tools/check-surface-art.mjs` — OK. Every emitted class has a CSS rule, no duplicate
  top-level selectors, no external assets.
- No `https?://`, `cdn`, `@import`, `googleapis`, `.woff` anywhere under `web/`.
- Reduced motion: `prefers-reduced-motion` block present, and the new animations are listed
  in it.
- **The repaint problem, in a real DOM shim running the real `web/app.js`**
  (`tools/dev/juice-effects.mjs`): after an action the floater node exists, is attached
  inside `.enemies`, and carries the *hit enemy's* `data-enemy-idx`; with a reduced-motion
  flag the same action produces **zero** floaters and no `damaged` class.
- **No layout shift from the hit reaction**: `.damaged` animates `filter`, and the class
  list contains no transform-capable animation; the assertion is in the harness output.

**Could not verify — for a reason that was FALSE and is now withdrawn:**

> **CORRECTION 2026-10-16.** This heading read *"no browser exists in this environment."* **It
> does.** `chromium 152.0.7977.82` and `firefox` are on PATH, `tools/dev/shoot.mjs` drives
> headless Chromium over CDP with **zero dependencies**, and `node --headless --screenshot` was
> verified working this run. This disclaimer actively suppressed verification of a class of claim
> that **is** verifiable, so it has been removed as a reason. The *gaps* below were real; the
> *explanation* was not. The question is "was it captured?", not "is it possible to capture?"

- **The animations *look* right.** *Not captured.* **Method:** capture a frame sequence with
  `node tools/dev/shoot.mjs` (the worked example is the death beat now photographed at
  `shots/pm-verify/death/death-000ms.png` … `-450ms.png`). **Still not provable from frames — and
  this caveat is kept:** whether the easing *reads well*, and the compositor frame rate. Frames
  prove the visual change exists and is in the right place; they do not prove taste or fps. An
  honest fps number needs a media-timing trace, which has not been run.
- **Real `getBoundingClientRect()` geometry.** *Closable, and was not closed.* The DOM shim has no
  layout engine, but **real Chromium does** — that is exactly what the harness runs. **Method:**
  read `getBoundingClientRect()` inside `tools/dev/shoot.mjs`'s CDP session, which is a
  *measurement* rather than the static proxy ("no layout/transform-affecting property is
  animated") used here.
- **`prefers-reduced-motion` as a live media query.** *Not captured.* The shim injects a flag
  rather than evaluating the query. **Method:** Chromium can emulate reduced motion and be
  screenshotted under it — which is how the ghost-card behaviour under reduced motion was
  subsequently measured.
- **Sub-pixel behaviour at 800px and narrow widths.** *Not captured.* **Method:** screenshot at
  those widths and read the geometry from the frame rather than inferring it.
- **Screen-reader behaviour.** *Still genuinely outside what frames can prove.* What can be
  stated, and was verified in the shim, is that every floater is `aria-hidden="true"` and every
  fact it carries is also carried statically by the HP bar / block line. That is a property of the
  **markup**, not an assistive-technology test. **No frame closes this gap** — it needs an AT or an
  accessibility-tree dump, neither of which has been done. This limitation is not softened.

---

## EXACT NEXT STEP (if budget resumes)

P3 only, in this order — each is independent and small:

1. **Enemy death beat — CLAIM CORRECTED 2026-10-16: this is NOT unbuilt, and `prevEnemies` is
   NOT the fix.** The text below said a dead enemy "cannot" be animated because `snap.enemies`
   drops it, and that `prevEnemies` is "the one piece of state to add". **Both statements are
   wrong, verified against the source and against captured frames:**
   - **The mechanism is present and shipped.** `web/app.js:636-639` pushes a `death` burst when an
     enemy leaves the snapshot; `web/app.js:1244` draws it as `.enemy.is-dying` after the
     `switch`; `web/style.css:1506` styles it (`animation: juice-shatter 0.5s ease-in both`).
   - **The behaviour is now VERIFIED BY FRAME, not merely present in source.** A real collapse was
     captured and the frames are at `shots/pm-verify/death/` — `death-000ms.png`, `death-150ms.png`,
     `death-300ms.png`, `death-450ms.png`, plus `death-context-300ms.png`. This is the "capture a
     frame sequence" method above, applied.
   - **The fix landed by snapshot-diff, not by `prevEnemies`.** The renderer computes departures by
     diffing before/after in `act()` (`.filter((e) => !after.enemies.some(...))`).
   - **`prevEnemies` is DEAD CODE.** Declared `web/app.js:127`, reset `:734`, assigned `:1077`, and
     **never read** — grep for `prevEnemies` returns only those three sites. It is residue of the
     superseded approach and should be deleted deliberately, so no future agent mistakes it for
     the death-beat fix.
   - **This file already agreed with the code and not with its own prose:** task #5 ("P2: death
     fade-out") above is marked **DONE**. That was the true entry; this bullet was the stale one.

   **Remaining honest gap:** the capture proves a death is *visible in an intermediate frame*. It
   does not prove the easing reads well, nor a frame rate.
2. **Reward reveal.** `.hand` children in `rewardView()` get the existing `juice-deal`
   stagger by passing `index` — note `cardTile` only wraps when `opts.index` is set, and
   reward tiles currently pass none, so this is a one-line change plus a CSS rule.
3. **Map travel + rest pause.** `.node.available` already animates; a travel beat needs the
   departing node marked in `act()` the way `hits` is marked.
