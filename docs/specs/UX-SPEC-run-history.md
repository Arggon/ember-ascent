# UX-SPEC — Run History & Legible Combat (Increment 2)

**Owner:** UX Designer → Tech Lead → Frontend Engineer · 2026-10-15.
**Authority:** `requirements-run-history-and-legible-combat.md` Rev 3 (frozen). No scope renegotiation; gaps → §7.
**Tags:** `[FRAME]` from `shots/pm-verify/` · `[READ]` code/CSS read this run · `[COMPUTED]` arithmetic on those values · `[INFERRED]` my reasoning.
`src/kernel/record.js`, `unlocks.js`, `src/surface/runs.js` **do not exist yet** `[READ]`. I spec against §12.5's DR-1..DR-7, **invent no field names**, and raise missing values in §7.

## 1. Problem and surfaces

A finished run leaves no trace — the only browser persistence is the help-seen flag `[READ app.js:800,1058]` — and the end panel offers one action, *Restart (r)* `[FRAME ended.png]`. A loss is a tab you close (AC-6.1, AC-6.2). US-4's separate defect: the compact codes are **unexplained**, not present-but-wrong (§12.3).

| # | Surface | Built on |
|---|---|---|
| S1 | Run summary | Extends `endView` (`app.js:1610`) in the existing `ended` phase; keeps the title **"V — The Ledger"** `[FRAME]` — the game already names its record surface the Ledger, so history inherits the name |
| S2 | The Ledger (list) | New phase; existing `.big-title` / `.section-title` / `.end-rule` |
| S3 | Entry detail | New phase; `.csum`'s monospace treatment |
| S4 | Unlock narration | Blocks on S1 + persistent line on S2/S3 — **never a modal** (§11.6) |
| S5 | Empty state | Inside S2 |
| S6 | AC-4.6 treatment | Card footer, intent banner, help panel — which already ends with **"What the shorthand means"** `[FRAME first-run-help.png; READ app.js:849-868]` |

**Not mine but binding:** S1 is *appended* to the stage, never *replaces* it mid-collapse, or it fights DEF-6's blank window (~480 ms defeat / ~1150 ms boss victory) `[READ §2.1.4]`.

## 2. Flows

**F1 first run → loss → summary → Ledger → replay.** HUD → map → combat → terminal death → *collapse completes* → **S1** → `Restart (r)` (existing ended hotkey `[READ app.js:1663]`) or `Open the Ledger (h)` → **S2** → row → **S3** → `Play this seed again` → confirm → new run, seed on HUD → completion writes a **new** entry; original untouched (AC-8.3).
**F2 win.** As F1, but headline `VICTORY` and boss +50 / victory +100 in the ledger (§11.1). The longer boss hold delays S1 ~1150 ms — acceptable under AC-5.6.
**F3 Ledger mid-run.** Replay **confirms first** (discards the run in progress).
**Error exits.** Storage refuses/full → the run still completes; S1 shows its ledger plus *"This run could not be saved — your browser refused local storage."* No blank panel, no silent loss (AC-6.3: still local). Seed won't reproduce → *"That seed no longer reproduces. Recorded runs are never altered."* Back from S3 → S2, focus on the originating row; back from S2 → wherever it was opened.

## 3. Screen specs

### S1 — Run summary
Order: **outcome → facts → score ledger → marks → narration → actions.** Outcome is the headline, **never the score**. Unchanged: `RUN OVER`, sigil, `DEFEAT`/`VICTORY`, rule, `Reached floor 3 · 53 steps · seed 229052` `[FRAME]`.

**Ledger — all six lines always, zeros explicit** (a missing line is indistinguishable from a zero; the formula must be learnable — AC-7.1, L4):

```
Floors climbed   3 × 5   15
Enemies killed   4 × 2    8
Elites killed    0 × 10   0
Boss defeated    no      +0
Cards played    12 × 1   12
                ───────────
        Total            35
```

**AC-7.4 (anti-hollow).** A run with **no elite, no boss, no victory** does **not** set its total at display size — `--fs-4`, `--dim`, line items equal weight — and this factual recognition replaces today's advice-only line:

```
This run ended on floor 3. You climbed 3 floors and killed 4 enemies.
Killing an elite (+10) or the boss (+50) is where the larger totals come from.
```

An elite, boss or victory sets the total at `--fs-5` in `--ink` as the earned headline. **No celebratory adjective on a run with none of those three** — a copy check.
**Marks:** below a rule, labelled `MARKS`, name **and condition** each (AC-7.3), plus *"Marks do not add to the total."* (§11.1). None ⇒ no block, never a placeholder.
**Narration** sits between totals and actions — visible on arrival, never below the button.
**Actions:** both ≥44×44 px.
**States:** defeat-minimal · defeat-with-elite · win · no-score legacy (§4) · unsaved.

### S2 — The Ledger
Header `YOUR RUNS — 12 OF 100 KEPT` — **the cap is stated, never silent** (§10, AC-6.4). Then `Totals across 12 scored runs: best 240 · floors 41`; the denominator says **"scored"** because unscored entries are excluded from aggregates by construction, and an unlabelled aggregate over a mixed-era list would be a lie.
**Row (AC-6.1):** outcome, `floor 3`, score line, character, seed monospace, marks. **A loss is an ordinary row** (AC-6.2): `DEFEAT` in `--loss` at the same size and weight as `VICTORY`, same anatomy — **no error styling, no warning colour, no blank row, no "no data"**. No request, no account (AC-6.3).
**States:** fresh → S5 · one run → one row, no aggregate line (n=1 says nothing) · many → newest 100 · capped → `100 OF 100 KEPT` plus, on the session's first eviction, *"Only the newest 100 runs are kept. The oldest records are dropped as new ones arrive."* · no-score legacy → row present, score reads `not scored` in `--faint`, no number (§4).
**Reachability:** from S1, and a `Ledger` button in the HUD beside Help / New Run `[FRAME HUD]` — else history is visible only just after a run ends (§7 Q1).

### S3 — Entry detail
Outcome, floor, steps · seed (monospace, selectable, copyable) · the **same arithmetic as S1**, recomputed from the stored record (AC-7.2; the §11.4 `stats --from` path must agree — AC-6.5) · marks with conditions (AC-7.3) · the persistent unlock line if that run crossed a threshold · `Play this seed again` (primary), `Back`.
Under the seed: *"The seed is everything the run was built from. Replaying it is a new run — your original record stays."* (AC-8.1, AC-8.2, AC-8.3.)

### S4 — Unlock narration
Two renderings, one rule: **state the threshold crossed and the option opened** (AC-9.2):

```
UNLOCKED — more cards can appear in your rewards
Score 40 crossed the 25-point mark.
Seven more of the 42 cards are now in play (24 → 31), rare cards among them.
Cards in play: 31 of 42.
```

Persistent line: *"Unlocked at score 40: rare cards join your reward pool."*
**Constraints (AC-9.3, §11.2):** (1) forbidden words — *stronger, power, boost, upgrade, improve, easier, new cards*; unlocks grant **options**, and the framing may never imply the game got easier. (2) Frozen-content limitation stated plainly, once: *"The card pool is the same 42 cards. Unlocking changes which of them you are offered — it does not add cards."* (D2 — the PM refused to dress it up; so do I.) (3) `Cards in play: n of 42` always shown (AC-9.1, AC-9.4). (4) **The tester flag has no UI surface** — no control, banner or note (AC-9.5, §8, §10); a tester perceives `?pool=full` only as a wider reward pool and no narration, preserving the anti-bias rule of no explanation beforehand. Drawing it in-game would be a control that lies.

### S5 — Empty state (AC-8.4)

```
No runs recorded yet.
Finish a run — win or lose — and it will appear here with its score,
the floor you reached, and its seed, so you can play that run again.
Nothing leaves this browser. There is no account.
```

Never blank. The cap is not stated here — nothing is capped yet.

### S6 — AC-4.6 explanatory treatment
Plain English is **already present and primary** (`Deal 6 damage to the enemy` under `Strike`, kernel-supplied) `[FRAME combat.png; READ app.js:1422]`. The defect is an **unexplained** code, so the fix is labelling, ordering, reachability. **No kernel string changes; the code is not deleted** (§12.3); "Code" is renderer-added.
1. **Label secondary:** footer tag → `Code A6`; intent tag → `Code A6` / `Code PWR2`. Accessible name: *"Compact code A6 — the shorthand the command-line version prints. The effect is written above in words."*
2. **Order:** footer, below the effect text, `--fs-1`, never in the name/effect block, never read *instead of* the effect.
3. **Discoverability, frame-grounded:** `first-run-help.png` shows "What the shorthand means" starting **below the visible fold** `[FRAME]`. **Move that section above the seven numbered topics**, or make the panel's first line: *"New to the corner codes? This panel explains them — 'What the shorthand means'."* Help is otherwise unchanged (`app.js:825`).
4. The combat bottom hint appends `· corner codes are explained in Help`.

### S6b — AC-4.8 numeral hierarchy
`[FRAME combat.png/narrow-820.png — the decisive finding]` The hotkey badge and the cost gem are **both gold-filled circles with a dark numeral**, top-right and top-left `[READ style.css:467-483, 637-686]` — at a glance the same object, exactly the confusion AC-4.8 forbids.

- **Cost keeps the gold** (gold is the energy colour, `[FRAME HUD energy pill]`) and the 30 px gem.
- **Hotkey demoted:** `--raised` fill, `--edge` border, `--dim` digit, ≤24 px, `aria-label` *"press 3"*; still hidden below 900 px as today `[READ style.css:1208,2007]`.
- **Code tag demoted identically:** `--fs-1`, `--dim`, no fill, never adjacent to the gem.
- Result: **cost is the only gold numeral**, and no other numeral shares its shape.

## 4. Two-era honesty treatment (DR-7)

**Decision: per-entry absence, marked `not scored`, in one list sorted by time.** A record with no derivable score renders **no score line and no number** — not a dash, not a zero, not an estimate. Rows show `not scored` in `--faint` where scored rows show a total; S3 shows no score block and one line: *"Recorded before scores existed. Scores cannot be worked out for a run that was not measured."*
**Tradeoff:** one list carries two visual dialects, so it is less uniform and a reader must notice one word to know why a number is missing. I accept that. Hiding legacy runs shortens the list below the player's actual play; back-filling a plausible number is fabrication, which DR-7 forbids; two lists add a mode and make runs incomparable. **An honest gap beats a plausible fiction** (§12.5). Aggregates cover scored runs and say so. `[INFERRED]` I do **not** assume the 150 heuristic headless records enter the browser list (§7 Q2).

## 5. Accessibility requirements

Thresholds frozen at WCAG AA (AC-4.7, §12.2).

1. **A measured failure exists today.** `[COMPUTED]` `--faint #656e88` on `--ground #0a0c12` = **3.86:1**, and `.section-title` uses it at `--fs-1` (10.6 px) `[READ]` — **every section label on every screen fails 4.5:1**, matching the low-contrast labels in the frames. **Proposed `--faint: #767f9a` = 4.91:1** `[COMPUTED]`. `--dim` (7.67:1) and `--ink` on card stock (15.4:1) already pass; card effect contrast is not the failing property.
2. Every new S1–S5 string (`not scored`, cap line, aggregate denominators, unlock blocks) ≥4.5:1 against its own rendered background at 360×640. Measure the composite: `.hand-index` uses `opacity: 0.55` when disabled and card edges are gradients `[READ]`.
3. **Effect text size:** ~11.5–12.5 px in the smallest bands `[READ style.css:1998,2084,2097]` — the ~11.7 px the brief flags. Requirement: **a 12.5 px floor for `.card .cdesc` at every viewport**, paid for from the art plate and padding, never from the words.
4. **Targets:** every S1–S5 control ≥44×44 px (WCAG 2.5.8, `style.css:1911`), including `Ledger` and row select at 360×640.
5. **Reduced motion carries every fact statically.** The effect layer is `display:none` under reduced motion `[READ style.css:1690]`, so S1–S5 are **static designs, not paused animations**: outcome, score, marks, narration and seed all present with motion off. Narration must **not** rely on the 1.6 s auto-dismiss toast `[READ app.js:385-390]`; the persistent line is the carrier. No S1 content may sit at `opacity: 0` before a keyframe — that exact bug is documented at `style.css:243-247`.
6. **Keyboard/focus.** S1: outcome → ledger → marks → narration → `Restart (r)` → `Open the Ledger (h)`. S2: cap line → rows ↑/↓ → `Back`. S3: seed → ledger → marks → `Play this seed again` → `Back`. Visible focus throughout; **focus returns to the originating row** on every back-path. `r` and `n` keep working `[READ app.js:1663-1664]`; `h` is free.
7. **Screen reader.** Scored row: *"Defeat, floor 3, scored 35, seed 229052, 2 marks."* Unscored row: *"Defeat, floor 3, not scored, seed 229052."* The ledger is a real list, not a text block, so each contributing line is individually reachable (AC-7.1). Marks announce name **and** condition (AC-7.3). The cap line belongs to the Ledger heading.
8. **No audio** — the project has none; no affordance depends on sound.

## 6. Testability, tied to ACs

- **AC-6.1/6.3** scripted run → reload → read; request-count assertion. **AC-6.2** win and loss rows captured and compared for identical styling. **AC-6.4** 200-run injection → capture + load timing. **AC-6.5** not mine (record concern, DR-1); my constraint is that no surface present a value the record cannot support.
- **AC-7.1** S1 capture, six labels asserted, ledger a real list. **AC-7.2** S1 total = S3 total = kernel. **AC-7.3** detail capture + condition string; none ⇒ no block. **AC-7.4** deliberate floor-3 / no-elite / no-boss run, captured, string-checked against the forbidden adjectives.
- **AC-8.1** S3 capture. **AC-8.2** existing replay-equality machinery. **AC-8.3** two-row capture with the original compared before/after. **AC-8.4** fresh-profile capture, non-empty assertion.
- **AC-9.1/9.4** `Cards in play: n of 42` present + the scripted runs-to-full-pool report. **AC-9.2** scripted progression to threshold, captured, both threshold and option name present. **AC-9.3** forbidden-word string check + DR-4's structural negative. **AC-9.5** full-pool capture structurally identical, no added control.
- **AC-4.6** card + intent captures showing `Code A6` under the English; help capture showing the section above the fold. **AC-4.7** pixel contrast on every label at 360×640 + computed-style size sweep at 360/390/414/620/820/1280. **AC-4.8** card capture + computed-style comparison of both badges.
- **AC-5.4 (§9)** the same captures re-run under reduced motion, S1–S5 complete.

## 7. Open questions (with defaults)

1. **Ledger entry point mid-run.** Summary-only means history is visible only just after a run ends. **Default: add a `Ledger` button to the HUD** beside Help / New Run — a new control, so your call; AC-11.1's "no control that lies" argues for adding one that works.
2. **Does the browser Ledger ever hold heuristic/headless records?** §10 and R10 say the player sees their own runs only, yet DR-7 expects two visible eras. **Default: browser list = the player's own runs; the unscored state stays fully specified (§4) for any scoreless record and for the headless surface.**
3. **Cause of death / damage taken in the record?** §2.1.3 notes both are absent and `snapshot()` has no such counter (DR-6). **Default: omit until the record carries them** — DR-7's principle applied to facts, not only scores.
4. **Who defines the badge list?** AC-7.3 needs name + condition. **Default: ship zero badges and no Marks block rather than a placeholder.**
5. **Copy/CSS outside my lane:** S6, S6b and `--faint` need `web/**` edits (the token is global, so change it once and re-capture affected frames rather than patching component by component) — handed to the Frontend Engineer; I edit nothing.
6. **`RELEASE-NOTES.md` promises "No meta-progression. Nothing carries over between runs. No unlocks"** and "no run persistence at all" `[READ]`. This spec falsifies that; I will not edit the file. **Default: Technical Writer updates the "what this demo deliberately is NOT" list and the 42-card note**, flagged now rather than at release.
7. **`--faint` is global** — raising it moves existing section labels and hints. **Default: change the token once and re-capture the affected frames** rather than patching component by component.