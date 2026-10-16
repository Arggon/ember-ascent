# LAYOUT-STATUS — screen-size fit fix (final)

**Owner's report:** combat screen did not fit on some screen sizes (Galaxy S25 Ultra landscape
915×412; reproduced in Firefox devtools; follow-ups at 1200×450 and 1366×768).
**Contract:** `LAYOUT-ACCEPTANCE.md` (frozen; stories S1–S7).
**Scope:** `web/style.css` + `tools/dev/` harnesses. **No `src/` changes, no CLI output changes.**
**Status: GREEN** — full matrix, seeds 1–12, both harnesses: 0 failures, exit 0.

---

## 0. Why the previous attempt thrashed (the load-bearing finding)

The fix was not the hard part. **The instrument was.** Two defects made every verdict in the
earlier thread untrustworthy:

1. **The seed was never actually pinned.** Both harnesses loaded
   `http://localhost:5173/web/?seed=11`; `tools/serve.mjs` 301-redirects that to
   `/web/?seed=11/` — the slash lands *inside* the query — so `web/app.js` computed
   `Number("11/") → NaN`, failed `Number.isInteger`, and fell back to
   `Math.floor(Math.random() * 1000000)`. Measured across four consecutive loads:
   seeds `777695 / 413864 / 977312 / 571239`. Requesting `index.html?seed=11` directly
   returns seed 11 every time. **Every "915×412 fixed", "1200×450 fixed", "1366×768 regressed"
   verdict was measured against a different random fight** (content height varies 760–774px at
   1366×768 by seed), and the earlier "871px in a 768px window" claim was a random draw, not a
   walked seed.
2. **Both harnesses exited 0 unconditionally.** No threshold, no assertion. A fully red run and
   a fully green run were indistinguishable to any caller.

Both are now fixed: the harnesses request `index.html?seed={seed}`, **assert** the seed the page
itself reports (240/240 rows matched), and exit non-zero on any failing row.

## 1. What was actually broken (measured, pinned seeds)

| viewport | before | after |
|---|---|---|
| **1366×768** | **FAILED 12/12 seeds.** Document 857–871px in a 768px window, scrolled +89..+103px. End Turn bottom 760–774 (below fold or <8px clearance). | clearance **52–68px**, scroll 0 |
| **1280×800** | **FAILED 10/12 seeds.** Scroll +68px. | clearance **59–75px**, scroll 0 |
| **915×412** (S25 Ultra landscape) | Passed, but only **6px** clearance (fragile) | clearance **14px** |
| **1200×450** | Passed, but only **6px** clearance | clearance **14px** |
| **844×390** | Passed (22px) — then a bad intermediate step cost it 11px; reverted | clearance **22px** (recovered) |
| **360×640** | Passed (14px) | clearance **14px** (unchanged) |

Root cause at the laptops: 1366×768 and 1280×800 are ≥901px wide and ≤830px tall, so they ran
the **full desktop rhythm** (214px card plaques) in a short window — the deficit was the cards,
not the chrome. Fixed by one scoped tier, `@media (min-width: 901px) and (max-height: 830px)`,
which shortens the plaque to 148px and trims the felt. 1280×1000 is deliberately outside the
tier and keeps the untouched desktop layout.

### The tier-collision trap (worth remembering)

915×412 / 1200×450 are ≥901px wide **and** ~412px tall, so they matched **both** the compact
tier and the new laptop tier. The later block won, imposing the laptop card geometry — and
because the card's effect row is `1fr`, a **3-line effect grew the tallest tile 143px** and
pushed End Turn **7px below the fold on seeds 3 and 7**. Seeds 1/11 passed only because their
draws give 2-line effects. **A layout fix that passes on one seed and fails on another is not a
fix** — this is exactly why S6 mandates ≥12 seeds. Resolved by restoring the compact card
geometry in the overlap region:
`@media (min-width: 901px) and (max-height: 480px) { .card { padding: 7px 5px 3px; gap: 1px; } }`.

Two wrong diagnoses were killed by measurement along the way, and both are recorded because they
were plausible: (a) there is **no** `margin-bottom: auto` elastic band — that string exists only
in a comment; the real lever is `.stage-combat { flex: 1 1 auto; justify-content: space-between }`;
(b) freeing bottom padding moves End Turn **down**, not up, because when content fits,
`End Turn clearance == #app padding-bottom + #stage padding-bottom` (verified: 8 + 3 = 11px).
A `max-height: 500px` padding band built on the wrong model was reverted.

## 2. Verification (final artifact)

Artifact hashes at gate time: `web/style.css` `a494dff926dac4e25482d865e89a187f343cdd7e11c9dfbf59ec4b000ca579f9`,
`tools/dev/viewport-check.mjs` `9e83358c…`, `tools/dev/space-check.mjs` `5fed9125…`.

```
$ node tools/dev/viewport-check.mjs --seeds 1-12
ALL PASS (108 rows)   exit 0   FAIL lines: 0

$ node tools/dev/viewport-check.mjs
ALL PASS (9 rows)     exit 0

$ node tools/dev/space-check.mjs
ALL PASS (11 rows)    exit 0

$ node tools/dev/css-parse-probe.mjs
parsed OK             exit 0
```

Full default matrix, seed 11 (verbatim columns):

```
size         label            seed  reported  eTbot/vh  clear  scrollPx  handRows  stageClip  spillPx  onTop  result
360x640      phone-small      11    11        626/640   14     0         1         0          -4       true   pass
390x844      iphone-14        11    11        745/844   99     0         1         0          -4       true   pass
414x896      phone-large      11    11        783/896   113    0         1         0          -4       true   pass
844x390      phone-landscape  11    11        368/390   22     0         1         0          -10      true   pass
915x412      galaxy-s25u-land 11    11        398/412   14     0         1         0          -6       true   pass
768x1024     tablet           11    11        904/1024  120    0         1         0          -10      true   pass
1280x800     desktop          11    11        725/800   75     0         1         0          -6       true   pass
1366x768     laptop           11    11        700/768   68     0         1         0          -6       true   pass
1200x450     short-desktop-window 11 11       436/450   14     0         1         0          -6       true   pass
```

- **`reported` == requested on every row** (240/240 across the sweeps) — the seed is genuinely pinned.
- **`spillPx` negative everywhere** — nothing is hidden by `#stage`'s `overflow: hidden`.
- **Determinism:** two full runs of the failing set produced byte-identical output
  (`dc86549c02968a86866ed169982bbcc7` both runs).
- **The gate can fail:** proven by positive control (exit 1 with a named threshold message) and
  by the pre-fix CSS run through the same harness, which reproduced the baseline exactly.

## 3. Defects found and fixed as collateral (not in the original report)

1. **Touch target silently reduced.** The new laptop tier set `#stage .btn { min-height: 40px }`,
   which **overrode the 44px target at 1366×768 and 1280×800** — i.e. on the approved desktop
   layout. Measured `btn: 40` there while phones correctly showed 44. Note: simply *deleting* the
   declaration would have been worse (37px, because the 44px rule lives in a `max-height: 480px`
   tier desktops never match); restating it at 44px fixes all nine viewports. Cost: 1–2px of
   clearance, against a 53px margin. Now `btn: 44` everywhere.
2. **Two CSS truncation artifacts.** `web/style.css:118` (`#hud`) and the `.stat` rule each had a
   missing semicolon, so the parser folded the next line into one invalid declaration and dropped
   it. Pre-existing (byte-identical in the backup), not caused by this work; both repaired, parse
   now clean.
3. **An unnecessary typography shrink.** The laptop tier shrank the card name 15.75→13.5px and the
   effect sentence 13.5→11.7px *and* its line-height 1.4→1.2 on the approved desktop layouts,
   while its own comment denied doing so. Measured as unnecessary (53px clearance with the
   original fonts vs an 8px threshold), so removed — the height comes from the plaque geometry.
4. **A vacuous gate in my own contract.** The S2/S3 criterion I wrote
   ("`#stage`'s scrollHeight equals its clientHeight") is **unobservable in this layout**:
   `#stage`'s only child is `flex: 1 1 auto; min-height: 0`, so it is squeezed rather than
   overflowing, and the delta is always 0. Proven by driving 132 descendants up to 492px past the
   stage's clipped edge while the delta stayed 0. Replaced with a **descendant-spill** metric
   (`spillPx`, threshold 2px, named constant), which is signed: negative means content sits
   inside the clipped edge. Baseline is ≤0 at every viewport, so nothing is clipped today.

## 4. Honest gaps — measured vs not verified

> **Note added 2026-10-16 (Technical Writer, DEF-3).** This section's headings are accurate —
> nothing below is claimed as verified. One clarification, because a sibling document
> (`requirements-run-history-and-legible-combat.md` §2.1) lists this file among those carrying a
> *"no browser in this environment"* limitation: **this file contains no such claim**, and this
> harness **did** run against real headless Chromium (`node tools/dev/viewport-check.mjs`). "UNVERIFIED"
> in this file means **not measured yet**, never **unmeasurable**. A browser and a zero-dependency
> capture harness (`tools/dev/shoot.mjs`, CDP) are present, so any of the open items below can be
> settled with a captured frame or a `getBoundingClientRect()` read inside the CDP session.

**Verified by measurement:** every number in §1–§3; full matrix × seeds 1–12 (108 + 132 rows);
seed-pinning assertion; determinism; the gate's ability to fail; parse cleanliness; touch targets
at the five target viewports; spill baseline.

**UNVERIFIED:**
- **768×1024 (tablet) `btn` is 37px** — matches neither `#stage .btn` rule (the laptop tier
  requires ≥901px width; the 44px rule requires ≤480px height). Outside the release bar, reported
  not fixed; fixing it means widening a tier gate.
- **`.hint` is not rendered at 360×640, 844×390, 915×412 or 1200×450** (measures 0/0), so S1's
  hint criterion is vacuous at those heights. It is present and inside the fold at 1366×768
  (742 ≤ 768). Mechanism not investigated.
- **The 360×640 in-card text clip** (`span.ctype` 12px, `span.cost-gem` 6px escaping their
  clipping box) — deferred; axis still not isolated.
- **The 13 SVG-primitive clips** at 915×412 / 1200×450 — deferred; whether they are decorative
  overspill is unverified.
- **`.cdesc` at 11.1px (0.74rem) in the compact tier around 845–900px wide / 390–479px tall** —
  pre-existing, below the 0.78rem floor used elsewhere. Reported, not changed.
- **The collision repair at 915×412 works by source order** (the later block wins). Correct today,
  fragile in principle; a `min-height: 481px` bound on the laptop tier would make it explicit.
- **Harness `sleep(1300/1200/1300)` timing** makes reproducibility timing-sensitive; empirically
  stable across all sweeps here.

## 5. Rollback (no git repo — disk copies)

`layout-fix-backup/` holds all restore points. **Restore by copying the file back over its
original path.** Baselines are *cumulative*, so pick the one matching what you want to undo:

| restore point | sha256 | what restoring it undoes |
|---|---|---|
| `layout-fix-backup/style.css` | `be3db6a6…` | **everything** — state before any layout work |
| `layout-fix-backup/style.css.pre-layout-fix` | `521910b0…` | the laptop/desktop tiers (undoes the 1366×768 + 1280×800 fix) |
| `layout-fix-backup/style.css.known-good` | `620c974f…` | the touch-target, typography, parse and spill-gate work (keeps the viewport fix) |
| `layout-fix-backup/style.css.pre-touch-fix` | `8f346ee5…` | only the 44px touch-target fix |
| `view.../viewport-check.mjs`, `space-check.mjs` | see `MANIFEST.md` | the harness upgrades (seed pinning, thresholds, gates, exit codes) |

**Correcting an earlier false claim (S7):** the manifest originally recorded only
`style.css` `be3db6a6…`. That file is **not** the pre-image of the laptop-tier fix — it contains
no `min-width: 901px` rule at all, so restoring it would have produced a tree that is neither
pre-fix nor post-fix. The true intermediate baselines are now preserved and hashed above.

## 6. Leftovers needing an owner-approved deletion

The safety guard blocks headless deletion, so these temporary diagnostics remain on disk. Nothing
imports them (verified by grep); none affects the shipped page.

```
tools/dev/probe-eleven.mjs            (8497 B, diagnostic)
tools/dev/scratch-fix-probe.mjs       (8803 B, diagnostic)
tools/dev/_tmp-touch-audit.mjs        (8731 B, diagnostic)
tools/dev/_tmp-spill-control/         (scratch page used as the gate's positive control)
```

## 7. Contract status

| story | verdict | evidence |
|---|---|---|
| S1 1366×768 fits | **PASS** | 12/12 seeds, scroll 0, clearance 52–68, hint 742 ≤ 768 |
| S2 no regress (915×412, 1200×450) | **PASS** | clearance 14 on all 12 seeds, scroll 0, 1 hand row, spill −6 |
| S3 360×640 no regress | **PASS** | clearance 14, scroll 0, 1 row, topmost-at-centre `true`, 12/12 |
| S4 seed honoured | **PASS** | 240/240 rows `reported == requested`; assertion demonstrably fires |
| S5 red looks red | **PASS** | 3 failure paths exit 1 with named thresholds; positive control reproduced |
| S6 ≥12 seeds | **PASS** | 108 rows (viewport) + 132 rows (space), 0 FAIL, exit 0 |
| S7 rollback point | **PASS (after correction)** | four hashed baselines, each scoped to a change; earlier single-record claim was false and is corrected in §5 |
