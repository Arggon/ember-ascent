# Frozen Requirements — Run History & Legible Combat (Increment 2)

**Handoff artifact.** Owner: Product Manager. **Status: frozen — changes require a PM revision.**
**Revision 4** — records the **DEF-6 diagnosis and the split of its acceptance criteria** (§13.1), answers the UX Designer's six open questions (§13.2), and folds in two new defects found while probing, **one of them in our own verification gate** (DEF-7, DEF-8). Revision 1–3 errors remain struck explicitly rather than silently edited, per §13.
**Date:** 2026-10-15
**From:** Product Manager → **To:** Tech Lead (routes to System Architect, then engineering)
**Supersedes:** nothing. **Extends:** `requirements-agent-playable-deckbuilder.md` (Revision 3, frozen 2026-10-10), whose R1–R10 remain in force unchanged.

Evidence tiers: **[FETCHED]** page read this run · **[SNIPPET]** search result only · **[INFERRED]** reasoning on sourced facts · **[MEASURED]** counted in this workspace with the command shown.

---

## 1. Problem

**Actor.** The owner-player (dev), and any first-time player who reaches the game through the itch.io page.

**Pain.** Two distinct pains, one per half of the owner's ask.

1. *Nothing accumulates.* A finished run leaves **no trace anywhere in the browser**. `unlock`, `potion`, `shop`, `upgrade`, `removeCard`, `event`, `act2` all return **zero matches** across `src/` and `web/` **[MEASURED — `rg -rniE` over `src/ web/ bin/ tools/`]**. The only thing the browser persists is that the help panel was seen (`web/app.js:877,1058`). The headless surface already appends `runs.jsonl` (`src/surface/sim.js:315`), so the recording machinery exists but is CLI-only and player-invisible. A loss is therefore not a lesson and not a memory — it is a tab you close.

2. *The fights are asserted, not seen.* The project has 52 `animation:`/`transition:` declarations and 32 `@keyframes` in `web/style.css` **[MEASURED]**, and per-enemy intent telegraphing already renders (`web/app.js:1382-1391`). But **every visual claim in this project carried the same disclaimer**: *"I can prove the classes, keyframes and nodes are present and attached; I cannot prove the animations look right"* (`JUICE-STATUS.md`), *"asserted from source, never observed"* (`ART-PASS-STATUS.md`). Until this run nobody had ever looked at this game. **§2.1 fixes that — and the act of looking moved the scope (§2.1.1, §2.1.2).**

**Current workaround.** None. The player closes the tab; the developer reads CSS and reasons about easing.

**Target outcome.** A person who has never seen this game plays five runs and can (a) tell you **what each enemy is about to do and how much it will hurt** before they act, (b) **see** a kill happen, and (c) **find those five runs later**, with a reason each one is worth remembering.

---

## 2. What changed since the last revision — read this first

Three findings from this run's research invalidate parts of the previous status docs. They matter because they change what is *possible*, not just what is written down.

### 2.1 A real browser exists here, and has all along

**`chromium 152.0.7977.82` and `firefox` are on PATH; `tools/dev/shoot.mjs` already drives Chromium over CDP with zero dependencies** (Node 24's global `WebSocket`), and headless screen capture is **verified working this run** (`chromium --headless --screenshot` wrote a valid PNG, exit 0) **[MEASURED]**. 301 PNGs already exist under `shots/` **[MEASURED]**.

**Consequence — this is the load-bearing change.** Every "could not verify — no browser in this environment" limitation in `ART-PASS-STATUS.md`, `JUICE-STATUS.md`, `LAYOUT-STATUS.md` and `ITCH-UPLOAD.md` is **stale**. "Does it look right" is now a **falsifiable** question with photographic evidence, not a matter of source-reading. Therefore, in this increment, **no visual claim is acceptable without a captured frame attached** (§5, §6). The method of capture is the System Architect's call; the existence of the harness is an established fact.

**I then used it, because a requirement that mandates frames should not rest on an unrun harness.** A zero-dependency server was started and the existing capture tool run against the real game:

```
node tools/serve.mjs    → open http://localhost:5175/web/
node tools/dev/shoot.mjs --out ...
  OK  first-run-help   map, 0 enemies
  OK  map              map, 0 enemies
  OK  combat           combat, 2 enemies
  OK  targeting        combat, 2 enemies
  OK  reward           reward, 0 enemies
  OK  ended            ended, 0 enemies
  OK  narrow-820   /   OK  cover-630x500
  8/8 captured
```

**8 of 8 frames captured, exit 0** **[MEASURED]**. The frames are attached as evidence under `shots/pm-verify/`. The harness works, so AC-4.1, AC-4.4 and AC-5.1 are achievable as written — which was previously only an assumption.

### 2.1.1 What the frames showed: US-4 is largely built, and the real gap is elsewhere

The captured combat frame was **inspected against AC-4.1–AC-4.3**, not eyeballed:

| Criterion | Verdict read off the frame |
|---|---|
| Every enemy telegraphs simultaneously, no interaction required (AC-4.1) | **PASS** — two enemies, both telegraphed at once: a buff as an up-arrow reading *"Will power up: +2 Strength"*, and an attack as a red arrow reading *"Will attack for 6."* |
| Incoming damage stated numerically (AC-4.2) | **PARTIAL** — the number is explicit ("for 6"). Lethal-vs-non-lethal is **not** distinguishable without reading it: magnitude is carried by the glyph's *kind* (arrow orientation), not its *severity*. |
| Multi-hit notation (AC-4.3) | Not exercised in this frame — **unverified, not failed.** |
| Player HP visible | **PASS** — `60/60`, with energy `3/3` and Block `0`. |
| Cards readable | **PASS** — Strike/Defend legible with full effect text ("Deal 6 damage to the enemy", "Gain 5 Block"). |

**This re-scopes US-4, and it is the most consequential finding in this revision.** The intent layer is **not missing** — it is present, simultaneous and readable, so per L1 the genre's highest-leverage feature is **already implemented**. Rebuilding it would spend the increment's P0 budget reproducing working code. What the frames exposed as genuinely weak is different from what the brief assumed:

1. **Cryptic abbreviations survive on the cards.** The frame shows `PWR2`, `A6`, `B5`. A prior pass (`UX-FIX-STATUS.md`) reworded card *effects* into plain English, but the compact codes remain in the corner of every card and intent. A stranger cannot decode `B5`.
2. **Low-contrast secondary text.** The section labels (`THE FIGHT`, `ENEMIES`, `YOUR HAND`, `DRAW 5`, `DISCARD 0`), the bottom instruction line, and the hotkey digits above the cards are low-contrast grey on a dark field. At the smallest supported viewport this is the first thing to disappear.
3. **Competing number systems on one card** — cost, hotkey digit and the `A6`/`B5` tag are three small numerals in one visual region.
4. **Large unanchored empty regions** — the vertical gaps above and below the enemy row leave the fight area sparse, with no player presence to anchor it.

**Ruling: US-4 is NARROWED** from "build telegraphing" to **"a legibility audit of what exists, fixing the four items above and only those."** The evidence does not support rebuilding a working intent layer. This is a scope *reduction* and is recorded as one (§13).

### 2.1.2 The frames also falsified Revision 1's "structurally blocked" death beat

`JUICE-STATUS.md` states the death beat cannot be built because a dead enemy leaves the snapshot. **Revision 1 of this document repeated that as an established structural constraint. That was wrong.** The mechanism is **already implemented**:

- `web/app.js:636-639` — each departure is derived by diffing the before/after snapshots and pushed as a `{ kind: 'death', enemy, name, side, boss }` burst; the comment reads *"Each departure becomes a `death` burst, which the next paint draws as an inert ghost card that collapses."*
- `web/app.js:1244-1255` — the next paint draws `.enemy.is-dying.side-*` with a `DOWN` / `BOSS DOWN` label.
- `web/style.css:1506` — `.enemy.is-dying` exists, with a reduced-motion variant at `:1681`.
- `prevEnemies` (`web/app.js:127`) is written at `:1077` and reset at `:734` but **never read** — the fix landed by snapshot-diff instead. That variable is dead code.
- `JUICE-STATUS.md` task #5 ("P2: death fade-out") is marked **DONE**, which agrees with the code and contradicts its own "exact next step #1".

**But no death has ever been photographed.** `ls -R shots/` contains **no** death or dying frame **[MEASURED]**. Honest status: **mechanism present, behaviour unverified.**

**Ruling: US-5 / AC-5.1 changes from *build* to *prove*.** The requirement is unchanged in substance — a death must be visible in an intermediate frame — but the work is capture-and-verify, not implementation. Expected to be the cheapest acceptance criterion in the increment. Residual risk is in §9.

### 2.1.3 The end screen, read off a frame

`shots/pm-verify/ended.png` was captured and inspected, because it is the surface history must join. It shows `RUN OVER` / `DEFEAT`, *"Reached floor 3 · 53 steps · seed 229052"*, and *"The Ironclad falls. Try a different route or a better card pick."*

- **Seed: present** — so AC-8.1 is partly satisfied already; it is *shown* but never stored or re-enterable.
- **Floor and step count: present.**
- **Score: entirely absent.** No score, no breakdown, no points concept anywhere.
- **Badges: absent. History: absent.** No way to see a past run.
- **Deck, damage taken, cause of death: absent.**

**This is direct evidence for the §1 pain, and it sharpens US-7.** The end screen's only teaching is advice that names neither the mistake nor the card behind it. That is exactly the Gate B / G3 risk — yet AC-7.4 forbids papering over it with a hollow number.

### 2.1.4 The death beat: captured, working — and a defect at the climax *(new in Revision 3)*

Revision 2 said the death beat existed but had **never been photographed**, and ruled AC-5.1 as *prove it*. **It has now been photographed, and it works.**

Using the deterministic method in §12 the capture auto-froze the first death it saw: `{"label":"Red Louse DOWN","name":"juice-shatter","dur":500,"living":1}` — a real enemy, a real collapse, with another enemy still alive. Seeking that animation and measuring computed style gives a clean, monotone collapse:

| Seek | Opacity | Transform (scale/tilt) |
|---|---|---|
| 0 ms | 1.0 | `matrix(1, 0, 0, 1, 0, 0)` |
| 150 ms | 0.999 | slightly **enlarged** and tilted — `1.0396` |
| 300 ms | 0.742 | `0.988`, translating down `3.06px` |
| 450 ms | 0.219 | `0.884`, translating down `8.28px` |

**So: fade + a brief swell + tilt + downward drift, over 500 ms.** Two seeks to the same time produced **byte-identical pixels** — determinism confirmed at the screenshot level, not just asserted.

**But the run's climax is a blank screen — DEF-6.** Photographing the death beat exposed a second, worse defect at the moment the game should be most alive. On a **terminal** kill (the last enemy, including the boss), `web/app.js:1026-1038` sets `endHeld`, calls `stageEl.replaceChildren(el('div', {cls:'ended-hold'}))`, and **returns before the `switch` at `:1041`** — which is the **only** path that ever draws a ghost (`combatView`, `app.js:1244`). The result, measured by per-frame logging:

- **29 consecutive animation frames** had `.ended-hold` present with `stageKids: 1` and **`stageText: ""`** — an empty 40vh div. That is a **~480 ms blank screen** (`END_DELAY_MS`) on defeat, and **~1150 ms** (`BOSS_DEATH_MS`) on a **boss victory** — the single most dramatic moment in the game.
- The code's own comment at `:1024-1025` states the intent: *"an arriving victory waits for a boss collapse (which the ghost card is drawing below)."* **It is not drawing it.** The comment describes a mechanism the control flow prevents. The wait happens; the collapse it waits for does not.
- Confirmed by frame: `climax-hold.png` shows the end panel, no enemy, no collapse. The blank window falls *before* it.

The good news, and it narrows the defect precisely: **ordinary deaths do render** — the ghost appeared in 3 frames while another enemy was alive. The defect is **specific to the terminal kill**, where the stage is wiped and the drawer is bypassed. **This is exactly the evidenced bug §11.5 pre-authorised fixing**, and it is now the highest-value item in the increment: it is player-visible, at the climax, small, and now photographed.

### 2.1.5 Three of Revision 2's own criteria were wrong *(new in Revision 3)*

The System Architect verified three defects **in my acceptance criteria**, not in the code. All three are confirmed by my own commands.

1. **AC-4.1 was unsatisfiable.** It required *"three or more living enemies."* **The maximum is two.** All 9 encounters, read from `src/kernel/rules/encounters.js:85-93`, hold either 1 or 2 enemies; the largest is `['red_louse','acid_louse']`. Content is frozen (D2), so no engineering closes this gap. **Correction: the criterion is restated at the true bound of 2**, exactly as the earlier frame already verified PASS — there was never a 3-enemy case to fail.
2. **AC-4.7 had no threshold.** It required meeting *"the project's stated minimum contrast"* — **no such statement exists.** The only numeric accessibility standard anywhere in `web/` is WCAG 2.5.8's 44 px touch target (`style.css:1911`). A criterion with an undefined threshold can neither pass nor fail. **Correction: the threshold is frozen at WCAG AA 4.5:1 for body text and 3:1 for large text**, measured from rendered pixels.
3. **AC-4.6, as written, would have broken the headless surface.** I asked that cryptic tags not be the only description. The architect found that `A6`/`B5`/`PWR2` are `effectSummary()`'s output — labelled in the source as *"Compact form (what the CLI prints)"* (`describe.js:557`) and deliberately locked by `tests/ux/descriptions.test.js`, because the frozen R4/R5 token ceilings depend on that vocabulary. Deleting them would break the agent surface. **Correction: AC-4.6 keeps its allowed path** — the tag stays as a *secondary, labelled* affordance with plain English present (which the renderer already does at `app.js:1422`); the defect to fix is that the tags are **unexplained to a newcomer**, not that they exist.

### 2.2 The state of the build, measured rather than quoted

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | **93 pass / 0 fail**, exit 0, ~1.7 s |
| Architecture gate | `npm run gate` | `scanned 26 files under src/` · `OK — no R1/R3 violations` |
| Self-play | `npm run sim` | 200 runs, win 13 (6.5%), boss reached 116/200, exit 0 |
| Release artifact | `sha256sum release.zip` | `4a6621…d0db` — **matches** `ITCH-UPLOAD.md` exactly |
| Screenshots | `ls shots/` | 301 PNGs, incl. a 1260×1000 cover |

All **[MEASURED]**. **`PHASE5-STATUS.md` is stale** — it claims 50 tests / 22 files (actual 93 / 26). `RELEASE-NOTES.md` already flags the "40-card planning target vs 42 shipped" discrepancy in its own text; the planning docs are the wrong side of that, not the release notes.

### 2.3 Cross-run progression: the honest, exhaustive negative

Every row below was searched for and **not found**. This is negative-capable evidence, not an absence of looking.

| Feature | Verdict | Evidence |
|---|---|---|
| Meta-progression / carry-over | **ABSENT** | no match: `metaprog\|bank\|gold\|currency\|score` |
| Unlocks | **ABSENT** | `unlock` → **NO MATCH** |
| Ascension / difficulty tiers | **ABSENT · inert** | `ascension` NO MATCH; `difficulty` is plumbed (`src/kernel/index.js:86,95,151`) but **read by no rule** — echoed only in `observe.js:446`, the CLI, and a HUD badge (`web/app.js:756`) |
| Relics | **ABSENT as a system** | one hardcoded `RELIC_HEAL = 6` (`src/kernel/rules/act.js:22`); no inventory |
| Potions · Shops · Events | **ABSENT** | `potion` NO MATCH · `shop\|merchant` NO MATCH · no event node type |
| Card upgrades · Card removal | **ABSENT** | `upgrade\|smite` NO MATCH · `removeCard\|purge` NO MATCH |
| Campfire/rest — as a rest node | **PRESENT** | `map.js:15`, `REST_HEAL = 8`, heal-or-leave only; **no upgrade option** |
| Save / resume | **ABSENT** | no save path in `web/`; only `localStorage` write is `dlb.helpSeen.v1` |
| Run history (browser) | **ABSENT** | no history UI; seed shown at `app.js:792,1618`, never logged |
| Run history (headless) | **PRESENT** | `src/surface/sim.js:315` appends `runs.jsonl` (150 records: seed, policy, steps, outcome, floor, hp, deck, hash) |
| Difficulty control | **PRESENT but inert** | HUD badge renders at `web/app.js:756` (`diff ${snap.difficulty}`); the **only** `difficulty` occurrence anywhere under `src/kernel/rules/` is a comment (`encounters.js:82`) — no rule reads it |

---

## 3. Design law this increment is bound by

Three findings from the Slay the Spire research are **principles with primary-source backing**, not preferences. Engineering decisions must not contradict them.

**L1 — Intent telegraphing is the highest-leverage readability feature in the genre, and it works by *shape*, not by numbers.**
Mega Crit's founders describe revealing enemy intent as what *"finally made Slay the Spire come together."* Their first attempt — a click-to-reveal "next move" system — failed for three stated reasons: bad for streaming, too much text, and unusable in multi-enemy fights. The fix was icon-based: a sword glyph that grows more menacing (dagger → cleaver → axe → scythe) across damage bands, so **menace is legible without reading a number.** Their own words on restraint: *"We didn't want to put too many numbers on the screen to confuse players."* Damage indicators came **after** the icon system worked. **[FETCHED — arstechnica.com "War Stories: Slay the Spire", developer transcript]**

**L2 — Juice must be dosed medium-to-high. Extreme juice is measurably harmful.**
A peer-reviewed survey of game-feel research reports that a large-scale study found **medium and high juiciness beat extreme juiciness** on player experience, intrinsic motivation, playtime *and* performance, and warns explicitly that too much juice *"makes it hard to learn what aspects of interactivity have mechanical importance."* **[FETCHED — arXiv:2011.09201v1, "Designing Game Feel: A Survey"]** This is a direct constraint on §4: **effect work may never obscure the intent layer.** An effect that hides a telegraph is a defect, not a flourish.

**L3 — Cross-run progression should unlock OPTIONS, never permanent POWER.**
StS1 ships no permanent stat upgrades — unlocks are cards, relics, characters. StS2 doubled down: every published Epoch reward is a card, relic, potion, character, mode or alternate act, with unlocks gated by **score thresholds and concrete achievements**. The argued case: stat progression makes early runs *pointless* and produces a downward-sloping difficulty curve, whereas option-unlocking widens the pool while preserving the from-zero run. Hades is cited as the V-shaped compromise (strong unlocks early, difficulty modifiers later to restore challenge). **[FETCHED — GameSpot Epochs table; ResetEra thread 1509337]** **Honest gap:** this is well-supported *convention* plus convergent design choice, **not a measured optimum.** No source found measured which model players prefer. **[INFERRED]**

**L4 — A run's score must be visible, itemised, and *spendable on progression*.**
StS1 publishes the formula (floors ×5, enemies ×2, elites 10/20/30 by act, bosses 50→750, plus named skill badges) and states that score *"helps you progress the game."* StS2 makes it explicit: baseline score *"is used to unlock more cards and relics."* Run seeds became visible **on the Run History screen**, so players can re-enter a seed to explore a "what if." **[FETCHED — slay-the-spire.fandom.com/wiki/Score; slaythespire.wiki.gg StS2:Score; [SNIPPET] Weekly Patch 19 for seed re-entry]**

**L5 — Enemy behaviour must be learnable, not arbitrary.** Enemies use fixed rotations (bosses) or randomized sets with code preventing over-repetition of the same move; some react to player state. This is what makes a telegraph *informative* rather than decorative. **[FETCHED — same Ars Technica transcript]**

**Explicitly not established:** no primary source was found on StS2 *combat feel/animation* specifically. Claims that "StS2 animates hits better" are unverified and must not be cited internally. **[INFERRED]**

---

## 4. Scope

Decisions D1–D4 are the owner's, recorded verbatim in intent: **D1** = run record **plus** unlock spine · **D2** = **freeze content**, invest in feel + history · **D3** = an independent tester **is** available, so the fun gate is passable · **D4** = **feel first** if feel and history compete.

### In scope

| # | Item | Reason |
|---|---|---|
| I1 | **Frame-captured verification of combat.** Every feel claim carries a captured frame sequence from the existing headless-capture harness. | §2.1: a browser exists. This converts an untestable class of claim into a testable one, and it is the only route to the owner's stated outcome "visible fights." |
| I2 | **Enemy death beat, verified rather than built.** A dying enemy is seen dying in an intermediate frame. | §2.1.2: the mechanism already exists (`app.js:639`, `style.css:1506`) but **has never been photographed**. A fight whose deaths are unverified is not yet a demonstrated visible fight. |
| I3 | **Intent legibility audit**, per L1 and §2.1.1: lethal distinguishable without reading the number, explicit multi-hit notation, cryptic code tags decoded, contrast raised. **Narrowed by evidence — no rebuild.** | §2.1.1: telegraphing already PASSes AC-4.1. Rebuilding it would spend the P0 budget re-creating working code. |
| I4 | **Reward / rest / map travel beats.** Small motion where the game currently cuts instantly. | Cheapest remaining source of "the game is alive." Explicitly queued in `JUICE-STATUS.md` next-steps 2 and 3. |
| I5 | **Run record persistence** in the browser: every completed run is stored and viewable, survives closing the tab, with no network call and no account. | Half of D1. Today: literally nothing persists (§1, §2.3). |
| I6 | **Score + badges** on the run summary and in history, with a published itemised formula (L4). | Makes a run *legible after the fact*; the mechanism StS1 uses to give a loss a story. |
| I7 | **Seed visibility and re-entry** from history. | Reuses R3 determinism, which is already a frozen guarantee — near-free, and the source of "what if" replay. |
| I8 | **Unlock spine over existing content**: existing cards and modes unlock against score and concrete achievements; **options only**, never permanent power. | D1's second half, under L3. Content is frozen by D2, so the spine must be defined against what already exists. |
| I9 | **Two gating defects fixed** (§7). | Both block work in this increment and one of them blocks the fun gate outright. |
| I10 | **Full-pool access flag for testers.** | Without it, a first-time tester's five gate runs are played on a crippled pool, which corrupts the very measurement the gate exists to produce. |

### Out of scope

| Item | Reason |
|---|---|
| Any new card, enemy, act, or boss | **D2** froze content. More cards was explicitly *not* what "very good" meant here. |
| Relics / potions / shops / events as systems | Each is a system **plus** its content. Content is frozen, so each is a separate increment with its own gate. |
| Card upgrades and card removal | Same reason: they exist to make a large pool legible, and the pool is 42. Revisit when the pool grows. |
| Second character | New content, and it doubles every balance question. |
| Multiplayer / co-op | StS2's headline feature. Enormous, and it contradicts the headless-generic-agent surface this project is built around. |
| Multiplayer-only cards, Ancients-style mandatory per-act boons | StS2 features that require a multi-act structure we do not have. |
| Sound and music | Out of scope in the previous revision and unchanged. Also the one juice channel the game-feel survey ties most strongly to perceived weight, so it is the first thing to add *after* this increment. |
| Cloud sync, accounts, leaderboards | Needs a service to babysit; contradicts the zero-network, zero-account build. |
| Modding API, localization, mobile-native ports, paid DLC | Unchanged from Revision 3 §5. |

### Deferred (phase 2, with the trigger that promotes each)

| Item | Promoted when |
|---|---|
| **New cards / relics as unlock rewards** | The content freeze is lifted — i.e. after this increment's gate, and only if the gate says the loop is worth widening. Note: under a frozen pool, unlocks can only re-order and gate *existing* cards. That is a real limitation of this increment and is stated as such. |
| **Ascension-style difficulty ladder** | The owner chose the record+unlocks spine over the ladder (D1). Promote once the difficulty control is real and the base game's win rate is trustworthy. |
| **Recommended-card / counterplay hints** | After history exists: history is the evidence that would tell us *which* hints are worth giving. |
| **Deck inspection of draw/discard piles** | Cheap and well-evidenced (StS2 shows all three at all times, [FETCHED]) but not required by D4's ordering. The first thing to add if budget remains. |
| **Card analytics surfaced *to players*** | Needs `human`-provenance data, which needs the post-release playtests. |
| **Audio pass** | After the visual layer is verified by frames; audio is the strongest remaining perceived-weight channel (L2/§3). |

---

## 5. User stories and acceptance criteria

Story form: *As \<actor\>, I want \<capability\>, so that \<outcome\>.* Every criterion is testable and states how it is observed. **Feel** = Epic F (P0, D4). **History** = Epic H. **Defect** = Epic D.

### US-4 — A fight whose meaning survives a glance *(narrowed in Revision 2 — see §2.1.1)*

*As a player, I want to read what every enemy will do and how much it will hurt before I commit my turn, so that my turn is a decision rather than a guess.*

**Revision 2 note:** AC-4.1 and the numeric half of AC-4.2 are **already verifiably met** (frame-inspected, §2.1.1). They are retained as **regression guards**, not as work. The deficit is in AC-4.2's severity half, AC-4.3, and the new AC-4.6–AC-4.8 raised from the frames.

- **AC-4.1** Given a combat with the **maximum number of living enemies the content allows (currently 2 — see §2.1.5)**, when the combat screen renders, then **every** enemy simultaneously displays its telegraphed intent, with no interaction required. *Observed by:* a single captured frame showing all intents at once. **Revision 3: the "three or more" wording was unsatisfiable — all 9 encounters hold 1–2 enemies (`encounters.js:85-93`).** This criterion is now a **regression guard**: it was already verified PASS in §2.1.1.
- **AC-4.2** Given an enemy whose telegraphed attack is lethal to the player's current HP, when the frame is captured, then that enemy's incoming damage is **stated numerically and is visually distinguishable from a non-lethal attack without reading the number** (per L1: glyph severity or size differs). *Observed by:* captured frames of one lethal and one non-lethal telegraph, plus the number, read from the frame.
- **AC-4.3** Given an enemy that will hit more than once, when its intent renders, then the hit count **and** the per-hit damage are both present and unambiguous — a single "12" must never be shown where the truth is "3 × 4". *Observed by:* frame + the kernel's own `intent.damage` and `intent.hits` for that enemy agreeing with what the frame shows.
- **AC-4.4** Given the status-effect layer is on screen, when a telegraph renders, then per L2 **no effect, animation, or overlay obscures any enemy's intent or the player's HP**. *Observed by:* frame captures taken **mid-animation** at several timestamps through a full turn, each inspected for occlusion.
- **AC-4.5** Given a tester who has never seen the game, when shown a mid-combat frame and asked what each enemy is about to do, then they answer correctly for **all** living enemies. *Observed by:* the scripted Gate B question (§8), target ≥4 of 5 testers.
- **AC-4.6** *(raised from frame evidence in Revision 2; corrected in Revision 3)* Given any card or intent tag, when it renders, then **no compact code is the only description of its effect**: plain English is present, and the code is a secondary, labelled affordance. The codes themselves are the kernel's agent-facing vocabulary (`effectSummary()`, `describe.js:557`) and are **locked by the frozen R4/R5 token ceilings and `tests/ux/descriptions.test.js`** — they must **not** be deleted or changed. *Observed by:* frame capture plus a first-time-reader check; a player who has never seen the game must be able to state a card's effect without decoding its tag.
- **AC-4.7** *(raised from frame evidence in Revision 2; threshold added in Revision 3)* Given the smallest supported viewport, when a combat frame is captured, then every section label, instruction line and gameplay-relevant numeral meets **WCAG AA contrast — ≥ 4.5:1 for text under 18.66px (or under 24px non-bold), and ≥ 3:1 for larger text — against its own rendered background**. *Observed by:* pixel contrast measurement over a captured frame at 360×640. **Revision 3: Revision 2 said "the project's stated minimum contrast", which was never stated anywhere — the only numeric a11y standard in `web/` is the 44px touch target (`style.css:1911`). The threshold is now fixed, per §12.**
- **AC-4.8** *(new in Revision 2)* Given a card in hand, when it renders, then its **cost is the only numeral competing for attention at that size**, and hotkey or code decorations are visually subordinate to it. *Observed by:* frame capture; a reader asked for a card's cost must not be able to confuse it with a hotkey digit or a tag.

### US-5 — A fight you can see happening

*As a player, I want to watch hits land, blocks break, and killed enemies die, so that the combat I am reasoning about is the combat I am looking at.*

**Revision 3 note:** AC-5.1 is now **verified PASS for ordinary deaths** (§2.1.4 — photographed, with computed-style evidence). **AC-5.6 is new and is the increment's highest-value fix.**

**Revision 4 note — AC-5.6 did not cover what the frames actually showed on both terminal paths.** Re-deriving the terminal transition in the kernel showed the two cases differ: on a **defeat** the enemies are **still in the snapshot** (1–2 living), so the blank window wipes a **living enemy row**, not a ghost; on a **win**, `resolveVictory` sets `enemies: []` (`src/kernel/rules/act.js:317`), so it wipes a **dying ghost**. **AC-5.6 is therefore split into AC-5.6a and AC-5.6b**, because a fix restoring only the ghost would leave the defeat path blank.

- **AC-5.1** Given a living enemy whose HP reaches zero **while at least one other enemy is still alive**, when the frame sequence is captured at intervals through the following second, then the enemy is **visibly present and in the process of dying in at least one frame**, and absent in a later frame. A killed enemy must never vanish between two consecutive frames. *Observed by:* captured frame sequence, where the harness **asserts `.enemy.is-dying` presence then absence** rather than eyeballing pixels. **Revision 3 status: PASS, verified** — `Red Louse DOWN` collapsing via `juice-shatter` over 500 ms, auto-frozen by deterministic seek, with byte-identical pixels on a repeated seek (§2.1.4).
- **AC-5.6a** *(new in Revision 3 — DEF-6, the terminal kill)* Given the **last** enemy of a run dies by the player's hand (including the boss), when the frame sequence is captured **through the entire hold window**, then **that enemy's collapse is visible in at least one frame**, and the stage is **never** an empty container with no readable content for more than **250 ms**.
- **AC-5.6b** *(new in Revision 4 — the defeat case, measured)* Given the **player** dies, when the frame sequence is captured through the hold window, then the **enemy row is still visible** in at least one frame, and the stage is never an empty container for more than **250 ms**. *Rationale:* this case is strictly worse than AC-5.6a and was not in the original criterion — at the terminal paint `snap.enemies` holds **1–2 living enemies** (measured, seeds 13/14/33/49/51/58/92/7/1/2), so the blank window discards a fully readable fight. A fix that restores only the death ghost leaves this path blank. **Both cases were measured this run; the choice of fix is the architect's.**
- **AC-5.2** Given the player or an enemy takes damage, when the frame sequence is captured, then the HP change is **readable from the frames alone** and is consistent with the HP value the game itself reports. **A frame must never imply a different number than the game's own state.** *Observed by:* frames cross-checked against the reported state after the same action.
- **AC-5.3** Given a player who has absorbed damage with Block, when the effect renders, then it reads as *absorbed*, never as a `0` or a negative number. *Observed by:* frame capture of a fully-blocked hit.
- **AC-5.4** Given a player who has requested reduced motion, when any of US-4 or US-5 occurs, then the fight remains **fully legible** — every fact carried by motion is still available statically (intent, HP, block, hit count). *Observed by:* the same capture script run with the reduced-motion setting, producing frames that still satisfy AC-4.1–AC-4.3.
- **AC-5.5** Given any effect in the game, when it plays, then **no clickable element moves out from under an active pointer** *during the effect*. *Observed by:* a capture run that acts mid-animation and confirms the intended action is the action that occurred.

### US-6 — Every run leaves a record

*As a player, I want my finished runs to be remembered after I close the tab, so that a loss teaches me something and a win is mine to keep.*

- **AC-6.1** Given a completed run, when the player closes the tab and reopens the page, then that run appears in the run history with **outcome, floor reached, score, character, and seed**. *Observed by:* a scripted run → reload → read-history test.
- **AC-6.2** Given a run that reached 12 floors and lost, when it is viewed in history, then the **floor reached and the outcome are shown**, and a loss is presented as a record, not as an error or an empty row. *Observed by:* history screen capture.
- **AC-6.3** Given a run is stored, when history is inspected, then storage required **no network request and no account**. *Observed by:* zero-request assertion in the capture run, consistent with the project's standing zero-external-request gate.
- **AC-6.4** Given 200 completed runs are recorded, when history is opened, then the screen **remains usable and bounded** and the retained set is capped by a stated rule (default, §10). *Observed by:* a scripted 200-run seed-injection test plus a load-timing measurement.
- **AC-6.5** Given history exists, when the headless surface completes the same run, then the headless run is **recorded too and the two agree** on outcome, floor and seed. *Observed by:* golden-state comparison extended to the record — this is the R1 guarantee applied to the new feature, and R1 is already frozen.

### US-7 — A score and badge line that explains the run

*As a player, I want an itemised score and short earned badges for each run, so that a loss still has something in it that is mine.*

- **AC-7.1** Given a completed run, when the summary renders, then the score is shown **with its components itemised**, and the formula is visible to the player rather than hidden. *Observed by:* capture of the summary showing each contributing line.
- **AC-7.2** Given two runs with the same seed and the same action log, when both are scored, then the scores are **identical**. *Observed by:* determinism test — score must be a pure function of the run, per the frozen R3.
- **AC-7.3** Given a run that earns a badge, when it is shown in history, then the badge name and its condition are recoverable. *Observed by:* history capture + the badge's stated condition in the docs.
- **AC-7.4** Given a player who lost on floor 3 without killing an elite or a boss, when the summary renders, then it **does not** present a hollow "score" as an achievement — some honest recognition of what *did* happen is present, or a deliberate zero is shown. *Observed by:* capture of a deliberately minimal run.

### US-8 — History you can act on

*As a player, I want the seed of any past run in front of me and re-enterable, so that I can explore the "what if" — the version of that run where I played the other way.*

- **AC-8.1** Given a run in history, when it is viewed, then its **seed is visible**. *Observed by:* history capture.
- **AC-8.2** Given I choose to replay a seed from history, when the new run starts, then the first combat offers the **same cards, enemies and intents** as the original run did. *Observed by:* the existing replay-equality machinery, which R3 already guarantees.
- **AC-8.3** Given a run is replayed and completed, then it is recorded as a **separate** entry; the original is never overwritten. *Observed by:* history capture showing two entries.
- **AC-8.4** Given the game is opened with no prior runs, when history is viewed, then an **empty state explains what will appear there**, rather than showing a blank panel. *Observed by:* fresh-profile capture.

### US-9 — Failure that pays forward without handing out power

*As a player, I want my accumulated play to widen what the game offers me, so that time invested opens doors rather than buying strength.*

- **AC-9.1** Given a fresh profile, when the card pool is inspected, then it is a **documented subset** of the shipped cards, and the exact starting subset is stated in the docs. *Observed by:* comparison of fresh-pool offer rate against the documented subset.
- **AC-9.2** Given a player reaches the stated unlock threshold, then a **specifically named** new option becomes available, and the player is told what they unlocked and why. *Observed by:* scripted progression to the threshold + capture of the notification.
- **AC-9.3** Given an unlock is earned, then it **adds an option and never a permanent stat, HP, damage or resource advantage**. *Observed by:* direct assertion that no unlock path writes to max HP, base damage, energy, or draw count — a testable negative.
- **AC-9.4** Given a fresh profile, then the **entire** card pool is reachable within a **bounded, documented number of runs**, and that bound is measured, not estimated. *Observed by:* a scripted unlock-progression test reporting runs-to-full-pool.
- **AC-9.5** Given the tester flag of I10 is enabled, then the full pool is available immediately, so that gate testers never play a crippled game. *Observed by:* fresh-profile-with-flag capture showing the full pool offered.
- **AC-9.6** Given any unlock state, then **no run's outcome is decided by it** — a skilled player on a fresh profile can still win. *Observed by:* a self-play or scripted comparison of win rate at fresh-pool versus full-pool, with the result **reported rather than asserted**. If a measurable gap appears, that gap is stated in the docs rather than smoothed over.

### US-10 — Defect: adding a card must not break the test suite

*As the team, I want the card count asserted against the content bundle rather than a literal, so that content authoring is not gated behind editing a test.*

- **AC-10.1** Given `tests/cards/cards.test.js:123` and `tests/budget.test.js:49` currently assert the literal `42`, when the count is derived from the content bundle, then **adding a card no longer fails the suite on a count literal**, while the suite still fails if the bundle and the JSON disagree. *Observed by:* a temporary card added and removed, with both the pass and fail behaviour shown. **[MEASURED — both literals confirmed present this run]**

### US-11 — Defect: a control that does nothing must not be shipped

*As a player, I want no control that lies to me, so that I can trust the ones that are there.*

- **AC-11.1** Given `difficulty` is currently echoed in the HUD (`web/app.js:756`) but **read by no rule** **[MEASURED]**, when this increment ships, then either the control **changes the game** and is covered by a test proving it does, or it is **not presented to the player**. *Observed by:* grep for readers of `difficulty` in `src/kernel/rules/**` returning a real reader, or a captured frame showing the control gone.
- **AC-11.2** Given the previous revision's status docs disagree with the build (§2.2), when this increment ships, then the **contradicting claims are corrected or struck**, including the 42/40 card count, the 50/93 test count, and every "no browser in this environment" limitation that §2.1 has now falsified. *Observed by:* the stale sentences gone from the named files.

---

## 6. Success metrics

| Metric | Target | How it is observed |
|---|---|---|
| Visual claims backed by a captured frame | **100%** — zero unbacked visual claims in the increment's report | Frame count in the evidence directory vs. visual claims in the report |
| Intent legibility (Gate B) | **≥ 4 of 5** testers correctly state every living enemy's next action, unprompted | Scripted question over a captured mid-combat frame |
| Kill visibility | A death appears in **≥ 1 intermediate frame** for every enemy death sampled | Captured frame sequences over a scripted run |
| Occlusion of the intent layer | **Zero** frames in which an effect obscures an intent or the HP bar | Mid-animation capture sweep, every frame inspected |
| Runs recorded | **100%** of completed runs appear in history, and survive a reload | Scripted run → reload → read |
| Surface agreement on the record | **100%** — GUI and headless agree on outcome, floor, seed | Extended golden-state test (R1 applied to the record) |
| Score determinism | **Byte-identical** for identical seed + action log | Replay test, per frozen R3 |
| Runs-to-full-pool | **Bounded and measured**; the number is published, the bound documented | Scripted unlock-progression test |
| Unlock power-creep | **Zero** unlocks touch HP, damage, energy or draw | Direct negative assertion |
| Regression safety | Test suite **≥ 93 pass / 0 fail**; architecture gate exit 0 | `npm test`, `npm run gate` |
| Unprompted second run (Gate B B1) | **≥ 4 of 5** testers start a new run with no prompt | Gate B observation, per the frozen G1 |
| Tokens per `state` dump | Still **≤ 250**; action lines still **≤ 8** | Frozen R4/R5 measurement |

---

## 7. Standing defects this increment must clear first

| # | Defect | Evidence | Why it gates |
|---|---|---|---|
| DEF-1 | Adding a card fails the suite: `tests/cards/cards.test.js:123` asserts `ids.length === 42`; `tests/budget.test.js:49` asserts `linesMeasured >= 42` | **[MEASURED]** | Any content work, now or later, from any agent, trips this. It is a trap laid for the next person. |
| DEF-2 | `difficulty` is plumbed end-to-end and **read by nothing** | **[MEASURED]** — no reader in `src/kernel/rules/**`, only `observe.js:446`, CLI, HUD badge | A visible control that does nothing is a lie to the player, and it will be mistaken for a working feature in every future balance conversation. |
| DEF-3 | Stale status docs: `PHASE5-STATUS.md` says 50 tests / 22 files (actual **93 / 26**), and its evidence block at `PHASE5-STATUS.md:50` prints `scanned 22 files under src/`; four files carry a "no browser here" limitation that §2.1 falsifies; `JUICE-STATUS.md` states the death beat is unbuilt while `app.js:639` implements it **and its own task #5 says DONE**; the 40 vs 42 card count is unreconciled | **[MEASURED]** | Every future agent reads status docs first. This is how the project's record starts lying to it — and in this instance it very nearly cost us a working feature. |
| DEF-5 | `prevEnemies` (`web/app.js:127`) is written at `:1077` and reset at `:734` but **never read** — residue of the superseded approach | **[MEASURED]** | Not user-visible. Listed so it is removed deliberately rather than rediscovered later and mistaken for the death-beat fix. |
| **DEF-6** | **The terminal kill shows a blank stage.** `web/app.js:1026-1038` wipes the stage to a bare `.ended-hold` div and returns before the `switch`, bypassing the only drawer of enemies and ghosts (`combatView`, `:1244`, gated on `snap.enemies.length > 0`). Measured: **29 consecutive frames with an empty stage** — **~480 ms on defeat, ~1150 ms on boss victory** | **[MEASURED]** — per-frame logging + `climax-hold.png` | **The game's climax is the emptiest moment in it.** The code's own comment at `:1024-1025` says a boss collapse is being drawn; it is not. **Highest-value item in the increment. NOT FIXED as of Revision 4** — see §13.1: diagnosis complete, fix designed, no edit made. |
| **DEF-7** | **Our own art gate has a blind spot for concatenated class strings.** `tools/check-surface-art.mjs:41` extracts classes with `/\bcls:\s*(`[^`]*`|'[^']*'|"[^"]*")/g`, which **stops at the closing backtick**. So `web/app.js:1248`'s `` `enemy is-dying side-${d.side}` + (d.boss ? ' boss-down' : '') `` yields `is-dying`/`side-` but **never `boss-down`** — and `boss-down` **has no CSS rule anywhere**, while the gate reports `OK` | **[MEASURED]** — regex read + `rg -n 'boss-down'` on both `web/app.js` and `web/style.css` | Not player-visible today (the class is inert), but **the gate cannot be trusted for any class added by concatenation**, and this increment adds several. A checker that reports OK while a rule is missing is worse than none. |
| **DEF-8** | **A source comment contradicts shipped behaviour, and the code is right.** `web/style.css:1685-1687` claims that under reduced motion *"a dying enemy is simply gone, as before this pass"*. **False.** The ghost is still rendered: `.enemy.is-dying` has no base `opacity`, so with `animation: none` it paints at full opacity | **[MEASURED]** — synthetic `.enemy.is-dying` node injected into the real page under emulated `prefers-reduced-motion: reduce`: `display:block`, `opacity:1`, `260×171`, `visible:true` | `web/app.js:1240-1241`'s opposite claim (*"the ghost is STILL drawn"*) is **correct**. Low severity, high trap value: precisely the comment a future agent trusts and acts on — as happened twice already (§13). |
| DEF-4 | Import-order trap: `loadContent()` called directly from `content.js` throws on 11 cards; handler registration is a side effect of importing `index.js` first | **[MEASURED]** — `registeredEffects()` returns 0 | Documented at `tests/content/bundle-drift.test.js:17-19`, so it is *known* and not currently a defect — but it is a loaded gun for anyone touching content or the history subsystem. Verify it stays documented. |

---

## 8. The gate, restated

The previous revision (§7.1) pre-registered a falsifiable fun rule. It survives unchanged and now has a name.

**Gate A — engineering.** `npm test` all green, `npm run gate` exit 0, determinism preserved, §6's measurable targets met. Engineering can complete Gate A alone.

**Gate B — the fun gate.** Requires the two judges from the frozen §7.1: the owner (10 runs) and **one independent person who has never seen the game** (5 runs). **D3 confirms an independent tester is available, so the gate is passable.** If that person becomes unavailable, the gate reverts to **NO-GO by default** — no self-certification.

Gate B's criteria G1–G5 are unchanged and are **not** restated in full here; G1 (unprompted second run, ≥4/5) and G3 (post-loss legibility, ≥4/5) are the two this increment is most likely to move. **Per §7.1, polish, animation quality, content volume, performance and token metrics are explicitly NOT gate criteria** — they are Gate A items. Conflating the two is how a project talks itself past its own kill gate.

**Gate B testers must be given the full-pool flag (AC-9.5) and no explanation beforehand.** Both are anti-bias measures.

---

## 9. Constraints (non-functional — these are requirements, not architecture)

- **R1–R10 remain frozen and unchanged.** In particular: one core, two surfaces, with a golden-state test proving equality; headless remains a complete interface; every run is `seed + ordered action log` reproducible; **GUI and headless must agree on the run record** (AC-6.5).
- **The kernel may import no `node:*` builtin** (existing hardened gate). The history subsystem inherits this: if it lives in the core, it must be browser-safe.
- **Zero external requests at runtime; no account; no telemetry.** Standing project constraint, and AC-6.3 restates it for the new feature.
- **No build step, no new runtime dependencies.** The capture harness is dev-only and already zero-dependency.
- **Reduced motion is a first-class path**, not a later patch (AC-5.4). It must remain *legible*, not merely *still*.
- **Content is frozen at 42 cards / 1 act / 6 enemies / 9 encounters / 1 boss** (D2). This increment may change *order* and *access*, never *volume*.
- **Performance:** history must stay usable at 200+ stored runs (AC-6.4); no user-perceptible stall on load or completion.
- **Accessibility:** effects are decorative and must never be the sole carrier of a fact — every fact a floater carries is also carried statically.

---

## 10. Open questions (each with the default I will ship with)

| Question | Default I ship with |
|---|---|
| Where does history persist in the browser? | Local, in-browser, no service, no account, surviving tab close. **Mechanism is the architect's call**; the constraint (no network) is not. |
| Is history capped? | **Yes — newest 100 runs retained**, with aggregate statistics not decaying as old runs drop. Rationale: an uncapped store risks the usability target, but note StS2 caps at ~100 and **players flagged that as a limitation** — so the cap must be stated to the player, not silent. |
| Is score a currency for unlocks, or are unlocks achievement-gated? | **Both**, per L4: score thresholds for volume unlocks, concrete named achievements for specific ones. |
| What is the starting (fresh-profile) card pool? | **A documented subset**, sized so the first run still offers real choice. Exact size to be proposed by the architect and frozen by me before it ships. |
| Should the headless surface also expose history? | **Yes.** It already writes `runs.jsonl`; AC-6.5 requires the two surfaces to agree, so the record must be readable from both. |
| Does the difficulty badge get fixed or removed? | **Removed from the player-facing HUD this increment** (DEF-2 / AC-11.1). Making it real belongs with the deferred ladder, where it can be tested properly. |
| Do we publish the score formula to the player? | **Yes**, itemised in-game (L4/AC-7.1). A formula the player can't see cannot teach them anything. |
| Is the heuristic self-play data ever shown to players? | **No.** The frozen R10 provenance rule applies: `heuristic` data must never be presented as human data. Player-facing history shows the player's own runs only. |

---

## 11. PM rulings on the Tech Lead's six questions (Revision 2)

The Tech Lead returned six questions, four of which were blocking work. All six are ruled on below. **These are answers, not a renegotiation of §4/§5.** Two of the Tech Lead's three corrections (C-1, C-2) are accepted and already folded into §2.1.2 and DEF-3; the third was a cross-reference error in Revision 1, now fixed.

### 11.1 Score formula — **frozen**

The Tech Lead is right that §5 required an itemised published score and never stated it. That was a real gap in Revision 1. **Frozen as follows**, picked for L4 parity (an itemised formula a player can learn) and for determinism:

| Component | Value | Rationale |
|---|---|---|
| Floors climbed | **× 5** | Progress the player always makes, so a short run is never a zero. Direct StS1 parity. |
| Enemies killed | **× 2** | Ordinary fights matter without dominating. Direct StS1 parity. |
| Elites killed | **× 10** | A deliberate risk taken. Reward the choice, not the outcome. |
| Boss defeated | **+ 50** | The act's punctuation. StS1 scales this per act; we have one act, so one value. |
| Victory | **+ 100** | Winning is the headline. |
| Cards played | **+ 1 per card** | Rewards engaging with the deck rather than stalling. |

**Rules that bind the formula:** it is a **pure function of the completed run** (AC-7.2 determinism); it is **itemised on the summary** (AC-7.1); and it must be **listed in the docs** so a player can check our arithmetic. **Badges are a separate line and never add score** (their value is the story, not the number). This is a PM decision taken now precisely because leaving it open would block the Backend Engineer, and a formula invented by an implementer is a design decision smuggled in as code.

### 11.2 Fresh-profile pool — **24 of 42**, by a rule rather than a hand-picked list

**Frozen: 24 cards — 12 attack / 9 skill / 3 power**, chosen by a rule the architect and the Technical Writer then apply, so the selection is documented rather than arbitrary:

1. Every card that is a **starter** is in the fresh pool (the first run must not be crippled).
2. Every **card named in the How-to-play panel** is in the fresh pool (we cannot teach a card the player does not have).
3. At least **one card per effect verb** in the vocabulary is present, so no mechanic is invisible on run one.
4. Every remaining slot is filled with **common** before **uncommon**, never **rare** — so the rare tier is the visible prize of unlocking, which is what makes progress felt.

**Stated limitation, which must appear in the player-facing docs and in `RELEASE-NOTES.md`:** because content is frozen (D2), unlocking **re-orders and gates existing cards**. It does not add new ones. The copy must say that plainly rather than implying a growing pool. This is the honest version of D1 and I will not dress it up.

### 11.3 AC-9.6 "no measurable gap" — the number, and who decides

**Ruling:** report the measured win-rate delta fresh-pool vs full-pool over **200 seeded runs**, in the increment's evidence. **|Δ| ≤ 5 percentage points** is accepted as no material gap. **|Δ| > 5 points is a PM decision**, escalated with the number — never silently smoothed over, never quietly re-tuned to hide it. Rationale: the frozen R10 provenance rule already forbids unlabelled aggregates; this is the same principle applied to our own tuning. A measured gap we publish is trustworthy; a gap we tuned away is not.

### 11.4 AC-6.5 scope — agreement on the record, plus one read command

**Ruling: the Tech Lead's default is right and I am tightening it slightly.** The *requirement* is agreement on the record (AC-6.5), and that is what gates the increment. However, the headless surface already writes `runs.jsonl`, so a minimum read path (`stats --from`, which exists today) **must keep working against the new record** — if the schema moves and the existing CLI read path silently rots, we have broken a working feature while claiming to add one. A richer human-readable history command stays deferred (§4).

### 11.5 AC-5.1 intent — **prove it, do not rebuild it**

**Confirmed: capture-and-prove.** The Tech Lead is correct and my Revision 1 was wrong (§2.1.2). **Do not add `prevEnemies` as a fix** — it is already written and unread (DEF-5) and would be the wrong mechanism. The deliverable is a frame showing a death in progress; if the capture shows the ghost is dropped early in practice, *that* finding is the bug to fix, and it will be a real, evidenced one.

### 11.6 Unlock narration placement — summary and history, not a modal

**Ruling: post-run summary, plus a persistent line in the history entry.** Rationale: a modal interrupts the moment right after a loss — which is exactly the moment that decides whether the player starts another run (Gate B / G1). Narration must also satisfy AC-9.2's "what and why", so the copy states the **threshold crossed and the option opened**, not just "unlocked!"

### 11.7 Accepted corrections and one deferred question

- **C-1 accepted** (death beat already built) — folded into §2.1.2, US-5, AC-5.1, I2, DEF-3, DEF-5.
- **C-2 accepted** (`PHASE5-STATUS.md:50` also stale) — folded into DEF-3.
- **Revision 1's cross-reference error accepted and fixed** (§2.1 cited "AC-H*", which does not exist).
- **One question I am deliberately NOT answering here:** whether the capture harness proves a mid-animation frame by deterministic animation seeking or by wall-clock sleeps. That is a **technical** decision with a correctness consequence (the Tech Lead notes `shoot.mjs` sleeps 60–140 ms under headless load, which is nondeterministic), so it belongs to the System Architect, not to me. **It is recorded as an open item because it gates the credibility of every frame in §6.**

---

## 12. PM rulings on the System Architect's feasibility flags (Revision 3)

The architect confirmed the plan is feasible and raised four flags. All four are accepted, and three of them were **defects in my own criteria** (§2.1.5). These are rulings, not redesigns.

### 12.1 AC-4.1 — accepted, restated at the true bound

**Accepted as a fact about frozen content.** All 9 encounters hold 1 or 2 enemies (`encounters.js:85-93`); "three or more" is unreachable without new content, which D2 forbids. **AC-4.1 is restated at the bound of 2** and downgraded to a regression guard, since §2.1.1 already verified it PASS. **I will not add enemies to satisfy a criterion** — that inverts the reason content was frozen. Multi-enemy encounters are a *content* decision for a later increment.

### 12.2 AC-4.7 — threshold fixed at WCAG AA

**Accepted.** I wrote a criterion with an undefined threshold; that is a defect and it is mine. **Frozen: ≥ 4.5:1 for body text, ≥ 3:1 for large text, measured from rendered pixels.** WCAG AA is chosen because it is the recognised public standard, so the number is defensible to a stranger rather than invented by us — and it is a floor, not a target to tune. The architect was right not to invent it.

### 12.3 AC-4.6 — corrected; do NOT touch the compact vocabulary

**Accepted, and this is the most important correction in this revision.** The architect found that `A6`/`B5`/`PWR2` are `effectSummary()`'s output, labelled in source as *"Compact form (what the CLI prints)"* (`describe.js:557`) and pinned by `tests/ux/descriptions.test.js`, because the frozen **R4 (≤250 tokens/state) and R5 (≤8 tokens/action)** ceilings depend on that vocabulary. **Had Revision 2's AC-4.6 been implemented literally, it would have broken the agent surface this project exists for.**

**Ruling: the codes stay. The requirement is comprehension, not deletion.** In scope is ensuring plain English is present and the code is *labelled as secondary* — which the renderer already largely does (`app.js:1422`). What the frames showed is that a newcomer cannot decode `B5`; the fix is explanatory (glossary, label, ordering) and belongs to the UX Designer. **No kernel string may change for this criterion.**

### 12.4 The capture-method ruling — accepted as decisive

**Accepted in full.** Deterministic animation control (pause virtual time → advance in fixed quanta → **assert on computed state, not pixels**) is the method. My own probing reached the same conclusion from the other direction: I verified that `Animation.setPlaybackRate`, the Web Animations API's `pause()` + `currentTime` seek, and repeated seeks producing **byte-identical pixels** all work on the installed Chromium. The architect's `Emulation.setVirtualTimePolicy` is the stronger primitive — it stops `setTimeout(…,0)` from consuming `dyingThisPaint` at all, making the frame **the only state that exists** rather than a race we happen to win.

**Two consequences I adopt explicitly:**

1. **AC-5.4 cannot use this method.** Under `prefers-reduced-motion` the effect layer is `display:none` (`style.css:1690`) with `0.001ms` durations (`:1638`), so no mid-state exists by design. **AC-5.4's frames must be captured on the static path and asserted statically.** The architect found this; it would have been a silent hole in my evidence table.
2. **The harness gains a maintenance cost and a dev-only dependency on CDP domains.** Accepted — it is zero-dependency, and the alternative (wall-clock sleeps) is the method that produced every wrong visual claim in this project's history.

### 12.5 The architecture decisions — accepted, with one product consequence

I do not own these, but I record acceptance so the team is unblocked, and note where a decision touches product:

- **DR-1 — record schema + builder move to a browser-safe kernel module (`src/kernel/record.js`); repository in `src/surface/runs.js`; `sim.js` delegates.** Accepted. It makes AC-6.5 true *by construction* rather than by promise, which is the R1 spirit.
- **DR-2 — the gate gains a mechanical rule: zero `node:*` specifiers in `web/**` or `src/kernel/**`.** Accepted, and it is the right kind of control: it turns the property we depend on into a build failure instead of a review convention.
- **DR-3 — `runs.jsonl` stays backward-readable; `id` = the existing state hash; newest-100 retention with cumulative aggregates.** Accepted. `stats --from` keeps working, which was my §11.4 tightening.
- **DR-4 — unlock evaluation is a pure function in `src/kernel/unlocks.js`; no rule may read the profile.** Accepted. This makes AC-9.3 (options, never power) *structural* rather than a promise, and the "card-definition object identity" assertion is a genuinely strong form of the negative.
- **DR-5 — tester flag is `?pool=full` plus CLI `--pool full`, recorded as `profile`.** Accepted, including the honest tradeoff: it is discoverable, but it is an **anti-bias** measure, not anti-cheat, and since unlocks grant options and never power it confers no advantage.
- **DR-6 — score is a pure function of the persisted record, fed by the kernel event stream.** Accepted. **Product note:** `snapshot()` has no kill/elite counters, so `session.js` must accumulate the kernel `events` array. This is a *correctness* requirement for AC-7.2's determinism, not an optimisation.
- **DR-7 — a legacy record without a derivable score shows no score line, never a guessed number.** Accepted, and it is the rule that keeps AC-7.4 honest. It has a UX consequence the UX Designer must own: **history will visibly contain two eras of runs (scored and unscored)**, and the difference must be rendered honestly rather than back-filled. I would rather show an honest gap than a plausible fiction.

### 12.6 What I am raising back to the team

- **DEF-6 is now P0-within-P0.** It is the highest value-to-effort item in the increment: player-visible, at the climax, small, and already photographed. §11.5 pre-authorised exactly this class of evidenced fix. **The first capture attempt should be the terminal kill**, as the architect recommends.
- **The "three or more enemies" ambition is deliberately dropped, not deferred by accident.** If the game later wants 3-enemy fights, that is a content increment with its own balance work — recorded in §4's deferred list, not smuggled into this one.

---

## 13. Frontend + UX handoff results (Revision 4)

Both were dispatched in parallel. **The UX spec landed complete. The DEF-6 fix did not — the engineer reported honestly that it ran out of budget mid-investigation and made zero edits.** That is the correct behaviour (§11.5's evidence rules), and its diagnosis is worth more than a hasty patch.

### 13.1 DEF-6 — diagnosis complete, fix designed, **nothing implemented**

The engineer proved the mechanism by re-deriving it rather than trusting my report, and **falsified one of the two approaches I offered**:

> **Approach (b) — "route the terminal ghost through the `combatView` path" — cannot work as stated.** At the terminal paint `snap.enemies` is `[]` on a win, and the ghost loop at `:1244` sits **inside `combatView()`'s `if (snap.enemies.length > 0)` guard**. Routing the terminal phase into `combatView()` therefore paints the same empty stage it paints today. Making (b) work means hoisting the ghost row out of that guard — i.e. restructuring the view that currently works, which the brief forbade.

**Ruling: (a) is the approach** — it touches only what the hold paints; (b) touches the working combat view. The engineer's blast-radius argument is evidence-backed and I accept it.

**Its designed fix (not implemented):** extract the ghost-row markup into a shared builder called from both `combatView()` and the hold branch, so the ordinary path's output stays byte-identical (protecting the verified AC-5.1); paint that row **plus** the hold spacer at the climax; and — the part that matters — **tighten the hold trigger to fire only when there is something to show**, falling through to the `switch` otherwise. That last point is the engineer's own catch and it is correct: when the **player** dies there is no dying enemy, so a bare hold would still burn `END_DELAY_MS` of blank stage and still fail AC-5.6.

**Two things it flagged rather than papered over, both accepted as my call:**

1. **`juice-shatter` ends at `opacity: 0` with `both` fill**, so on a boss victory the ghost is fully transparent from **500 ms to the end of `BOSS_DEATH_MS` (1150 ms)** — roughly **650 ms of visually empty stage even after the fix**. **Ruling: the hold is clamped to the collapse's actual duration.** A tuned 1150 ms beat is not worth 650 ms of nothing, and AC-5.6's 250 ms bound is the higher authority because it is the one the player feels. If that shortens the boss beat, so be it — the beat should be the collapse, and the collapse is 500 ms.
2. **The hold's `laterPaint(() => { … dyingThisPaint = []; }, 0)` at `:1035`** may drop the ghost before the scheduled end-of-hold repaint. **Ruling: leave that release exactly as-is and prove the hold window is repaint-free by assertion.** Changing the one-paint contract is the architect's business, not this increment's.

**My own measurement adds the finding that changes the criterion.** I re-derived the terminal transition in the kernel across 10 seeds: on a **defeat** `snap.enemies` is **1–2 living enemies**, not empty, because the player died — the enemies never left. And `resolveVictory` (`src/kernel/rules/act.js:317`) sets `enemies: []` on **any** win. So **both** terminal paths blank the stage, but they blank *different things*: a **living enemy row** on defeat, a **dying ghost** on a win. **Hence the AC-5.6a/5.6b split.** A fix that restores only the ghost would leave the defeat case — the *more common* outcome, at a measured ~7% bot win rate — still blank.

**Status: DEF-6 is NOT FIXED.** No file was modified, no frame captured. Baseline is intact at 93/0 and gate exit 0. A deterministic reproduction is recorded: **seed 13** reaches a boss victory (`The Guardian` at 47 HP as the last enemy) under the `smart` policy, and `window.__dlb` (`app.js:1679`) exposes the controller for driving and asserting. The engineer's diagnosis is the handoff; the edit remains.

### 13.2 PM answers to the UX Designer's six open questions

The spec is accepted as the basis for the history surfaces. Answers below; where I agree with its default I say so, because a default that nobody confirms is just an unowned decision.

1. **Ledger entry point mid-run — adopted.** Add a `Ledger` control to the HUD beside Help and New Run. The designer's reasoning is right and it is mine to confirm: §10 requires that a player-facing control must not lie, and a control that *works* satisfies AC-11.1. Replay still confirms first, since discarding a live run silently would be worse than the problem it solves.
2. **Does the browser Ledger ever hold heuristic/headless records? — adopted, with the reason stated.** **The browser Ledger shows the player's own runs only.** This is not a UX preference; it is the frozen **R10 provenance rule**: `heuristic` data must never be presented as human data. The two-era treatment (DR-7) therefore applies to any *scoreless* record the browser does hold — and the unscored state stays fully specified for the headless surface. **The spec was right to flag this as a question rather than assume it; the resolution is that provenance outranks the tidy two-era narrative.**
3. **Cause of death / damage taken in the record? — adopted.** Omit. DR-7's principle applied to facts, not only scores: never show a number the record cannot support.
4. **Who defines the badge list? — adopted.** **Ship zero badges and no Marks block rather than a placeholder.** A placeholder mark would be exactly the hollow number AC-7.4 forbids. Badges are a later increment with their own definition.
5. **The `--faint` token change is handed to the Frontend Engineer and I accept it as in-scope** — it is a global token, so it is changed once and affected frames re-captured, not patched per component. **I verified the arithmetic myself: `#656e88` on `#0a0c12` = 3.85:1 (the designer said 3.86) and the proposed `#767f9a` = 4.91:1, both against my own computation.** A measured 3.85:1 across every section label on every screen is a real AC-4.7 failure, quantified rather than asserted. **This one finding justifies the AC-4.7 threshold I was pushed to fix in §12.2.**
6. **`RELEASE-NOTES.md` contradiction — confirmed and routed.** It currently promises *"No meta-progression… No unlocks"* and *"no run persistence at all"*. This increment falsifies both. **That is a truth defect in a shipped document, not a wording preference** — the Technical Writer updates it, and it is now a hard release condition, not a nicety. Note it **already** requires a fix regardless: `PHASE5-STATUS.md`'s stale test count is DEF-3, and the "no browser in this environment" limitation is falsified by §2.1.

### 13.3 The UX spec's two judgements — both accepted

- **The two-era treatment (per-entry `not scored`, one time-sorted list)** is accepted, including the tradeoff the designer stated rather than buried: one list carries two visual dialects, so a reader must notice one word to know why a number is missing. **Rejected alternatives were worse:** hiding legacy runs shortens the list below the player's actual play; back-filling is fabrication DR-7 forbids; two lists add a mode and make runs incomparable. *"An honest gap beats a plausible fiction."*
- **AC-4.8's real defect is a shape collision, not a hierarchy problem** — the hotkey badge and the cost gem are both gold-filled circles with a dark numeral in opposite corners of the same card. That is a genuinely better diagnosis than my "competing numerals" description, and it came from looking at frames. **Cost keeps the gold; the hotkey and the code tag are demoted.**
- **AC-4.6's defect is placement, not absence** — the help panel already contains a correct "What the shorthand means" section, but the capture shows it starting **below the visible fold**. So the fix is reachability, and **no kernel string changes** (§12.3). Accepted.
- **The spec overran its 1,800-word ceiling at ~2,500 words.** Noted and accepted: it prioritised "every AC addressed by a concrete statement" over the budget, and stated the overrun rather than hiding it. Dense and complete beats short and vague.

### 13.4 New defects found while probing (both now tracked)

- **DEF-7 — our own art gate has a blind spot.** `tools/check-surface-art.mjs:41`'s class extractor stops at the closing backtick, so concatenated classes are invisible to it. `boss-down` (`app.js:1248`) is emitted, **has no CSS rule**, and the gate reports `OK`. **This matters more than the missing rule:** the gate is the mechanism that has been keeping "every emitted class has a rule" true, and this increment adds classes. **Fix DEF-7 before or with the DEF-6 work**, since DEF-6 adds markup.
- **DEF-8 — a comment contradicts shipped behaviour.** `style.css:1685-1687` says a dying enemy is *"simply gone"* under reduced motion; I measured the opposite (ghost at full opacity, 260×171, `display:block`). `app.js:1240-1241` is correct. Low severity, **high trap value** — this is exactly the comment class that misled two revisions already, so it is corrected rather than ignored.

---

## 14. Revision log

Kept because a frozen document whose earlier errors vanish without trace is a document nobody can trust.

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-15 | Initial freeze: problem, scope, stories US-4–US-11, metrics, gate restatement, defects, open questions. |
| 2 | 2026-10-15 | Frame evidence captured and inspected for the first time (§2.1, §2.1.1, §2.1.3), which produced two scope changes and one retraction. |
| **3** | **2026-10-15** | **Death beat photographed and verified PASS; a new player-visible defect found at the climax (DEF-6); three of Revision 2's own criteria corrected; architecture and capture-method rulings recorded (§12).** |
| **4** | **2026-10-15** | **DEF-6 diagnosis recorded and its criterion split (AC-5.6a/5.6b); UX spec accepted and its six questions answered; two new defects found, one in our own gate (DEF-7, DEF-8). DEF-6 remains UNFIXED.** |

**What Revision 3 changed, and why — the four things worth reading:**

1. **VERIFIED: the death beat works.** AC-5.1 moves from *unverified* to **PASS**, with a photographed 500 ms collapse and deterministic-pixel proof (§2.1.4). Revision 2's "prove it" call was correct and is now discharged.
2. **FOUND: DEF-6, a blank screen at the climax.** Capturing the terminal kill revealed the stage is wiped to an empty div for **~480 ms on defeat and ~1150 ms on boss victory**, because the hold branch returns before the only code that draws a collapse. **The code's own comment claims it is drawing the boss collapse.** This is the increment's highest-value fix (§2.1.4, AC-5.6).
3. **CORRECTED: three of my own criteria were defective** (§2.1.5). AC-4.1 demanded enemies that cannot exist; AC-4.7 had no threshold to pass; **AC-4.6 would have broken the CLI's token contract had it been implemented literally.** All three were found by an architect told to flag infeasibility, and all three are fixed here.
4. **ADDED: AC-5.6, DEF-6, §12, and the record/capture architecture rulings.**

**What Revision 4 changed, and why — the four things worth reading:**

1. **DEF-6 split into AC-5.6a and AC-5.6b**, because my own kernel measurement showed the two terminal paths blank *different things* — a **living enemy row** on defeat (`snap.enemies` holds 1–2 enemies, since the player died), a **dying ghost** on a win (`resolveVictory` empties them). Revision 3's single criterion would have been satisfied by a fix that left the more common outcome still blank.
2. **One of my two suggested fixes was falsified by evidence.** Approach (b) cannot work at the current guard; approach (a) is adopted on blast-radius grounds. My brief offered both as equal candidates; that was a reasonable hedge, and the answer came from measuring, not from my judgement.
3. **The DEF-6 fix did not happen.** The engineer made zero edits and reported it plainly rather than claiming a pass. **I am recording the increment as *diagnosed, not fixed*** — a fix with its own evidence obeys §11.5's rules; a claim without frames does not.
4. **We found a defect in our own verification gate (DEF-7).** The art checker cannot see concatenated class strings, so it passed a class with no CSS rule. A gate that reports OK while a rule is missing is worse than no gate, because we have been trusting it.

**The pattern now spans four revisions, and §12.6's lesson has held every time:** *every* error — Revision 1's two retractions, Revision 2's three defective criteria, Revision 3's single terminal-kill criterion, and Revision 4's falsified approach (b) — was found by **looking at the thing, measuring it, or asking someone to check it**. Not once has re-reading the plan found an error. **The frames and the kernel probes have now falsified or confirmed eleven separate claims across three revisions.** That is the operational argument for I1, for DR-2, and for `--faint`: verification is the work, not the paperwork after it.

**The pattern across all three revisions, which is now the project's operating lesson:** every error — Revision 1's two retractions and Revision 2's three defective criteria — was found by **looking at the thing or asking someone to check it**, never by re-reading the plan. Revision 1 trusted a status document. Revision 2 wrote criteria without counting the encounters or checking whether a threshold existed. **The frames have now falsified or confirmed eight separate claims across two revisions.** That is the argument for I1 and for DR-2: the capability is not decoration, it is the mechanism that keeps this document honest.

**Claims that remain unchallenged across all three revisions:** the §2.2 build measurements, the §2.3 exhaustive absence table, §7's DEF-1/DEF-2 literals, and §11's frozen rulings. All were re-verified this run.

---

**Handoff:** architecture is settled (§12.5) and the capture method is ruled (§12.4). Next, in this order:

1. **DEF-7 first** (§13.4) — it is small, it is in our own gate, and DEF-6 adds markup that the gate cannot currently check.
2. **DEF-6 / AC-5.6a + AC-5.6b** (§13.1) — approach (a), hold clamped to the collapse, `ended-hold` release untouched. Deterministic repro: **seed 13, boss victory, `smart` policy**; assert on computed state, not pixels.
3. **The history surfaces** from `UX-SPEC-run-history.md`, now unblocked by §13.2, plus the `--faint` token fix and AC-4.6's explanatory treatment.
4. **DEF-8** — correct the lying comment while in the file.

**Ordering is unchanged and non-negotiable: feel work is P0 by D4.** DEF-2 must land **before any tester touches the build**. DEF-1 is trap-removal, not a precondition. **DEF-6 is not complete until a frame shows the collapse — that includes the defeat case, which is the one a naive fix misses.**

**Ordering is unchanged and non-negotiable: feel work is P0 by D4.** Path A (feel) and Path B (history) run in parallel and share only the Frontend Engineer's hands and the capture method; **Path A wins any contention.** DEF-3 belongs in **Wave 0** because it is the item that stops the next agent inheriting a falsified fact. DEF-1 is trap-removal, not a precondition. DEF-2 must land **before any tester touches the build**, since a lying control contaminates Gate B.

**I remain the reference for "is this in scope?" until release.**
