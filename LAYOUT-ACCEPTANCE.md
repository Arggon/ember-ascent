# LAYOUT-ACCEPTANCE — viewport fit contract (frozen)

**Owner:** Product Manager. **Status:** frozen — changes require a PM revision.
**Date:** 2026-10-14. **Supersedes:** the informal goal in `LAYOUT-STATUS.md` §2–§4.
**Scope boundary:** `web/` and `tools/dev/` only. No `src/`, no balance, no CLI output changes.

This exists because the previous attempt had no acceptance contract and no failing gate, so it
chased its own tail: a fix for one viewport produced a regression at another, and the
instrument that was supposed to say "pass" could not say "fail".

---

## 1. Problem

**Actor.** A player who opens the combat screen. Three real cases are in play, all measured this
run with the page's seed genuinely pinned (`/web/index.html?seed=11`, Chromium
`Chrome/152.0.7977.82`, dpr 1, `--hide-scrollbars`):

| viewport | End Turn rect (top→bottom) | page scroll | hand rows | `#stage` clipped |
|---|---|---|---|---|
| 915×412 (S25 Ultra landscape) | 362→406, inside 412, **+6px** clearance | none (0px) | 1 | 0px |
| 1200×450 (short desktop window) | 400→444, inside 450, **+6px** clearance | none (0px) | 1 | 0px |
| **1366×768 (common laptop)** | 733→**770**, viewport is 768 → **2px below the fold** | **scrolls 100px** | 1 | 0px; the *stage itself* runs 72px past the viewport |
| 360×640 (small phone) | 582→626, inside 640, **+14px** clearance | none (0px) | 1 | 0px, but in-card text is clipped |

**Pain.** On a 1366×768 laptop the combat screen does not fit the window: the document is ~868px
tall in a 768px window, so the player must scroll to see the whole board, and the End Turn
control's bottom edge sits 2px past the fold. It *is* still clickable — its centre is 5px above
the fold and a real CDP click at (683,752) advanced the game — but "the last action of the turn
is partly below the bottom edge of my screen" is a defect regardless of the click succeeding.

**Current workaround.** The owner reported it, someone edited a media-query gate, someone else
measured, the measurement disagreed, and the thread died mid-edit. As of today the gate on disk
is `@media (max-width: 620px), (max-height: 480px)` and the five media blocks a cut-off run left
unclosed have since been closed — so the file is syntactically sound and the phone case is real.

**Root cause of the thrash (this is the load-bearing finding).** The instrument was lying. Both
harnesses navigate to `http://localhost:5173/web/?seed=11`; `tools/serve.mjs` 301-redirects that
to `/web/?seed=11/`, appending the slash to the **query**, so `web/app.js` does
`Number("11/") → NaN`, fails `Number.isInteger`, and falls back to
`Math.floor(Math.random() * 1000000)`. Measured: four consecutive loads reported seeds
777695 / 413864 / 977312 / 571239; pointed at `index.html?seed=11` they all reported seed 11.
Consequence: every "915×412 now fits exactly", "1200×450 fixed", "1366×768 regressed" result in
the prior thread was measured against a **different random fight each run** (content height
varies 760–774px at 1366×768 by seed). On top of that, both harnesses end in an unconditional
`process.exit(0)` with no threshold, so a red run and a green run are identical to any caller.

**Target outcome (observable).** At every viewport in the release matrix, with a pinned seed,
the whole combat screen — HUD, enemies, hand, End Turn and the hint line — is inside the window
at load, with no page scroll, at every seed in the tested range. Measured by a harness that
**exits non-zero** when that is not true.

---

## 2. Scope

**In**
- The 1366×768 vertical budget: End Turn and the hint line inside the window, no page scroll.
  *Reason: the one measured hard failure for a common laptop, and the reported class of bug.*
- Regression protection for 360×640, 915×412, 1200×450 — the three cases the thread claims to
  have already fixed. *Reason: two of them have only 6px of clearance; any fix for the laptop
  can convert them into new failures, and that is exactly what happened last time.*
- Measurement determinism: a pinned seed is honoured, and each harness exits non-zero when its
  acceptance condition fails. *Reason: without this, "fixed" is unfalsifiable and the same
  argument repeats. This is the acceptance instrument for everything else in this list.*
- A recorded rollback point for every file changed (there is no git repo here; the workspace
  practice is a copy on disk, as in `ux-fix-backup/`). *Reason: the last attempt was abandoned
  mid-edit with no way back.*

**Out**
- Visual redesign, card art, colour, typography, animation. *Reason: not the reported problem;
  the owner's complaint is fit, not look.*
- Any change under `src/` or to CLI output (`effectSummary`, the state dump, action lines).
  *Reason: the engine and the compact CLI output are frozen by `requirements-agent-playable-deckbuilder.md`;
  a layout fix must not move them.*
- Balance, card content, difficulty. *Reason: out of the report's scope.*
- Supporting viewports beyond the existing matrix (ultra-wide, 4K, foldables). *Reason: no
  evidence a player hits them here; adding them expands the matrix without evidence.*

**Deferred** (each with why)
- The 360×640 in-card text clip (`span.ctype` 12px, `span.cost-gem` 6px escaping their clipping
  box). *Reason: real, but it is a content-fit defect inside a card, not the reported screen-size
  fit; and the axis (horizontal vs vertical) is still UNVERIFIED. Fixing it blind risks the
  tightest viewport for no reported benefit.*
- The 13 SVG-primitive clips at 915×412 / 1200×450 (`path`/`circle` inside `svg{overflow:hidden}`).
  *Reason: probably decorative glyph overspill, but whether it is visible is UNVERIFIED, so it
  cannot be scoped as a must-fix.*
- The 6px clearance at 915×412 and 1200×450. *Reason: passes today; raising the clearance is a
  hardening target for the next pass, not a defect.*
- Consolidating the five single-rule `@media (max-width: 620px), (max-height: 480px)` blocks into
  one. *Reason: verbose, not wrong; cosmetic.*
- Making `seedFromUrl()` tolerant of a trailing slash (`"11/"`). *Reason: the harness can bypass
  the redirect by requesting `index.html` directly, which fixes the measurement without touching
  product code. Defensive app-side hardening is the better long-term answer and should be decided
  explicitly.*
- Adding a real-browser (non-headless) or physical-device pass. *Reason: no evidence headless
  Chromium misreports these box metrics, and the owner already reproduced in Firefox devtools.*

---

## 3. User stories

**S1 — Laptop combat screen fits. (must)**
As a player on a 1366×768 laptop, I want the whole combat screen to fit the window at load, so
that End Turn is fully visible and I never have to scroll to finish my turn.
- *Given* a 1366×768 viewport, *When* the combat screen is loaded at a pinned seed, *Then* the
  document's `scrollHeight` ≤ `innerHeight` (the page does not scroll).
- *Given* a 1366×768 viewport at any seed in the tested range, *When* the combat screen loads,
  *Then* the End Turn control's `getBoundingClientRect().bottom` ≤ `innerHeight − 8` (fully
  visible with 8px of clearance, not a 2px squeak).
- *Given* the same, *When* the screen loads, *Then* the `.hint` line's bottom is also ≤
  `innerHeight` (the hint is the lowest block; it must not be the thing that gets pushed out).

**S2 — The already-fixed phone cases stay fixed. (must)**
As a player on a 915×412 phone in landscape (or in a 1200×450 window), I want the combat screen
to keep fitting exactly as it does today, so that the laptop fix does not cost me my layout.
- *Given* 915×412 or 1200×450, *When* the combat screen loads at a pinned seed, *Then* the End
  Turn bottom ≤ `innerHeight` and the page does not scroll.
- *Given* the same viewports, *When* the screen loads, *Then* the hand renders on exactly one row
  and **no descendant of `.page-combat` extends below `#stage`'s bottom edge** (nothing is clipped
  by `overflow: hidden`).
  > **PM revision, 2026-10-15 — criterion corrected.** As first written this said "`#stage`'s
  > `scrollHeight` equals its `clientHeight`". That is **unobservable in this layout**: `#stage`'s
  > only child is `flex: 1 1 auto; min-height: 0`, so it is squeezed to fit rather than
  > overflowing, and the delta is 0 even when content is genuinely clipped. Proven by driving 132
  > descendants up to 492px past the stage's clipped edge while the delta stayed 0. Replaced with
  > a signed descendant-spill metric (`spillPx`, harness threshold 2px): negative means content
  > sits inside the clipped edge. Baseline is ≤0 at every matrix viewport.
- *Given* the same, *When* the screen loads, *Then* End Turn's clearance is ≥ 8px — the contract
  bar, which the fix now meets with 14px (was 6px).

**S3 — The tightest phone does not regress. (must)**
As a player on a 360×640 phone, I want End Turn fully visible and the hand on one row, so the
laptop fix does not break the smallest screen.
- *Given* a 360×640 viewport at a pinned seed, *When* the combat screen loads, *Then* the End
  Turn bottom ≤ `innerHeight − 8`, the hand is one row, and `#stage` clips nothing.
- *Given* the same, *When* the screen loads, *Then* End Turn remains the topmost element at its
  centre point (clickable, not covered) — the check that caught the "visible but dead" case.

**S4 — Pinned seed is actually honoured. (must)**
As the release engineer, I want a pinned seed to reach the app, so that a failure I see is
reproducible.
- *Given* a harness run with a seed argument, *When* the page loads, *Then* the seed the page
  itself reports equals the seed requested, for every viewport in the matrix.
- *Given* two consecutive runs at the same pinned seed and viewport, *When* both complete,
  *Then* the reported `scrollHeight`, End Turn bottom and row count are identical.

**S5 — A red run looks red. (must)**
As the release engineer, I want the viewport check to fail loudly, so a regression cannot ship
silently behind an `exit 0`.
- *Given* a viewport that violates S1–S3, *When* the harness runs, *Then* it exits non-zero and
  names the failing viewport and the measured value against the threshold.
- *Given* every viewport passing, *When* the harness runs, *Then* it exits zero.
- *Given* the harness is run twice at the same pinned seed, *When* both runs complete, *Then*
  the exit code is identical (no `false, false, true` across identical invocations).

**S6 — The seed range, not one happy seed. (must)**
As the release engineer, I want the budget verified across many seeds, so the fix is not tuned to
one draw.
- *Given* the target viewports and a pinned set of at least 12 seeds, *When* the harness runs,
  *Then* every seed/viewport combination satisfies S1–S3.
- *Reason this is a criterion and not a nicety:* at 1366×768, End Turn's bottom measured
  760/763/770/774 across seeds — a ~14px spread. A fix that fits one seed and not another is the
  exact failure mode this contract exists to prevent.

**S7 — There is a way back. (must)**
As the maintainer, I want a recorded rollback point for each changed file, so an abandoned edit
cannot leave the tree in an unknown state.
- *Given* a pre-change copy of every file to be edited, *When* the change is complete, *Then*
  each copy exists with its pre-change `sha256` recorded beside it. *(Unverifiable by test on its
  own; verified by the hash values being present and non-empty in the status doc.)*

---

## 4. Priorities

**Ranking rule:** every must-have is an *observed* defect or an *observed* measurement hazard
that has already caused a wrong decision in this project; should/could items are improvements
that no measurement currently supports as urgent. Ties break toward the item that protects the
others.

1. **S4 — pinned seed honoured. (must)** Protects every other measurement; already produced one
   false conclusion and a wasted fix cycle.
2. **S5 — non-zero exit on failure. (must)** Without it, S1–S3 are unfalsifiable.
3. **S1 — 1366×768 fits. (must)** The only measured hard failure.
4. **S3 — 360×640 no regress. (must)** Tightest device; the fix's most likely collateral.
5. **S2 — phone/landscape no regress. (must)** Two of three cases have only 6px of clearance.
6. **S6 — seed range. (must)** Cheap once S4 lands; prevents tuning to one draw.
7. **S7 — rollback point. (must)** The last attempt failed without one.
8. **Should:** raise the 915×412 / 1200×450 clearance above 6px.
9. **Could:** consolidate the five duplicate `@media` blocks; make `seedFromUrl()` tolerate a
   trailing slash.

Ordering note: the *engineering* order is S4 → S5 → S6 baseline → S1 fix → S2/S3 re-verify. The
priority ranks protectiveness, which is the same order here by coincidence, not by rule.

---

## 5. Success metrics

| Metric | Target | How observed |
|---|---|---|
| Hard-failing viewports in the release matrix, pinned seed, ≥12 seeds | **0** (today: 1 — 1366×768) | harness exit code, run per viewport per seed |
| End Turn clearance at 1366×768 | ≥ 8px, for all tested seeds (today: −2px at seed 11) | `rect.bottom` vs `innerHeight`, printed per run |
| Page scroll at any matrix viewport | 0px `scrollHeight − innerHeight` (today: +100px at 1366×768) | same run |
| Seed pinning | requested seed == seed the page reports, 100% of runs (today: 0%) | harness assertion per pass |
| Reproducibility | identical measured values across 2 consecutive pinned runs, 0px spread (today: 0px spread achieved only when manually pinned; as-documented URL was random) | diff of two runs' output |
| Harness signal | exit 1 on any failing viewport; exit 0 on all-pass; identical across repeat runs | two runs, exit codes compared |

---

## 6. Open questions

Each with the default I would ship without an answer.

1. **Does the fix belong in a height-gated media query, or in the base layout?** The prior attempt
   moved the gate from width to height and regressed a laptop; the lesson is that the signal is
   "short height", not "narrow width". *Default: the shortest-height-safe change that passes all
   four viewports plus the seed range — engineer's call, not mine. I only fix the observable.*
2. **Harness-only seed fix, or also harden `seedFromUrl()`?** *Default: harness requests
   `web/index.html?seed=…` directly (test-only, no product code touched) and the app-side
   tolerance is deferred.*
3. **Should the 360×640 in-card clip block this release?** *Default: no — deferred, since its
   axis is still unverified and it is a different defect class.*
4. **Is a 2px-below-fold End Turn `# released anyway` territory if it stays clickable?**
   *Default: no. The criterion is "fully visible", not "clickable"; the owner's complaint is
   visual, and the page also scrolls 100px, which is unambiguous.*
5. **What is the exact seed set for S6?** *Default: the seeds already used ad hoc in this project
   (1–12), pinned, recorded in the status doc.*

---

## Revision log

- **2026-10-16 — v2/1 scene illustrations (owner-approved layout change).** Reward and rest
  screens gain a header illustration (`.scene-illus`). The combat contract above is unchanged
  and `tools/dev/viewport-check.mjs` still reports ALL PASS (9 rows). New, non-gated expectation
  for those two screens: at 1440×900 and 915×412 with a pinned seed, the whole reward and rest
  panel fits the window with no page scroll. At `max-height: 480px` the illustration is a
  64px banner, the rest screen's ember ring and section title are dropped, and its spacing is
  compacted (this also fixes a pre-existing 51px overflow of the rest screen at 915×412).

- **2026-10-16 — v2/4 ember quests (owner-approved layout change).** A quests run's map page
  gains a strip of three quest chips above the map (name, progress or "done", and the reward;
  a thin progress bar). At `max-height: 480px` the chips are a single 17px line, and the map
  gives up the height: the node gap drops from 4px to 3px, nodes shrink from 30px to 26px and
  the node icon from 24px to 21px. All 8 floors still fit 915×412 with no page scroll
  (scrollHeight = 412). Runs without quests keep the old map sizes, because the rules are
  scoped with `.page-map:has(.quests)`. At 1440×900 the strip adds 42px to the map page, which
  already scrolled before this change (1351px → 1393px).

- **2026-10-16 — v2/5 Bellows Keeper (owner-approved layout change).** The Kindling screen
  (the first screen of a browser run) gains a hero-select row above the boons, but only at
  step 0. It holds two portrait buttons: Ashwright, and the Bellows Keeper with a cyan
  selected state. At `max-height: 480px` the portraits are 34×38px and the text is compacted.
  The screen still fits 1440×900 and 915×412 with no page scroll (scrollHeight = window
  height). In combat the Keeper uses the same hero slot and sizing rules as the Ashwright,
  with a cyan name and glow.
