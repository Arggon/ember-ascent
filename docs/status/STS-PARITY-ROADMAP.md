# StS-Parity Roadmap — completing the implementation

Goal: close the visible feature gaps between Ember Ascent and Slay the Spire, in small,
independently testable vertical slices. Each slice crosses the full SDLC:
**plan → development → manual test (Playwright CLI) → code review**, with failures
looping back to development before a slice is committed as done.

Process rules (standing):

- Orchestrator plans and dispatches; ≤ 2 background subagents run at any time.
- **A code review never overlaps with development or fixing.** The loop is strictly:
  dev → manual test → fix-loop (until QA passes) → commit → review of the diff since the
  last APPROVE point at a fixed HEAD, with NO agent editing the repo while the review
  runs. REQUEST_CHANGES loops back to development; the fix lands and the new diff is
  re-reviewed before the next slice's development starts.
- A slice is DONE only when: unit tests green, `npm run gate` green, surface-art check
  green, Playwright manual verification PASS (with evidence), code review findings fixed.
- Evidence over assertion: every verdict quotes the actual command output.
- Determinism is sacred: no runtime RNG outside the seeded kernel; viewer/codex UIs are
  read-only and never widen the action-id space (R5/R6 stay frozen).

## Current state (v0.3.x baseline)

- Kernel: frozen-state, deterministic (`newRun/actions/step/observe/hash`); phases
  `combat | map | reward | rest | kindling | ended`; map = 1 act, 8 rows, node types
  `combat_weak | combat_strong | elite | rest | boss`; card reward = pick 1 of 3 or skip;
  rest = heal **or** temper (upgrade) one card; kindling boons (opt-in); quests; small
  relic table; 2 characters (ironclad, bellows); 44 cards; 5 statuses; run history.
- Web: combat / map / reward / rest / kindling / end views; HUD; pile viewers
  (draw/discard/exhaust, names only); help modal; targeting; FX; e2e suite
  (`tests/web/e2e.browser.spec.js`, opt-in `npm run test:browser`).

## Gap table vs Slay the Spire

| StS feature | Ember Ascent today | Slice |
|---|---|---|
| Master-deck viewer during play | absent (only draw/discard pile names in combat) | S1 |
| Card pool visibility ("what can be added") | absent | S2 |
| Gold economy (combat gold rewards, HUD) | absent | S3 |
| Shop (buy cards, card removal) | absent | S4 |
| Potions (slots, drops, quaff/discard) | absent | S5 |
| Events (choice nodes) | absent | S6 |
| Relics with real hooks + elite/boss relic rewards | 3 relic skins, no drops | S7 |
| Content scale (~75 cards/class, more enemies, Act 2) | 44 cards, 6 enemies + 1 boss, 1 act | S8+ |

## Slices

| # | Slice | Scope kernel | Scope web | Status |
|---|---|---|---|---|
| S1 | Master deck viewer | snapshot exposes full deck (id, name, cost, type, tempered, count) | "Deck" button on map+combat → modal overlay, sorted, grouped by count, Esc/click closes | closed — 5b11de9 + fixes 7992e84, QA 7/7, review APPROVE |
| S2 | Card codex | expose draft pool via public API (`draftPoolFrom` already exists) | "Cards" button → codex modal grouped by rarity with descriptions | closed — 01466a3 + fixes 2ab6834 (per-run truthful codex + tolerance + keyguard), QA 8/8+loop, re-review APPROVE |
| S3 | Gold | `player.gold`, per-tier gold rewards auto-granted on victory | HUD gold readout; reward screen shows gold line | closed — 67084ec, QA 10/10, review APPROVE |
| S4 | Shop | `shop` node type + phase; deterministic prices; buy card, remove-card service, leave | shop view (buy grid, service buttons, gold readout) | closed — 58aefe6 + fixes af50324, QA 11/11, review APPROVE |
| S5 | Potions | 3 slots, post-combat drop table (seeded), quaff/discard action ids | potion belt in HUD with tooltips, quaff/discard controls | closed — c83a2d0, QA 11/11, review APPROVE |
| S6 | Events | `event` node type + phase; 4 seeded events with 2–3 choices each | event view (story text, choice buttons, outcomes) | closed — 69b05eb + fixes d7441b6, QA 11/11, review APPROVE |
| S7 | Relics | grow relic table with real effect hooks; elite drops relic; boss offers 3 | relic display + picks in reward flow | closed — 190a3e8, QA 11/11, review APPROVE (inline) |
| S8 | Content I: cards | ~70 cards incl. new verbs (multi-hit, exhaust, retain) | codex/deck views already render them | pending (feeds the unlock meta) |
| S10 | Meta: relic unlocks | the profile unlock system grows the RELIC pool across runs (StS: new relics enter the pool as you play) | codex or summary surface for unlocked relics | pending — direct answer to "relics reset after winning" |
| S9 | Content II: enemies + Act 2 | new encounters + second biome/map skeleton | map/act presentation | **in progress** — REPRIORITIZED per user feedback: relics (and gold/deck) only make sense if the climb is long enough to build around |

## Verification recipes (subagents: use these verbatim)

- Unit + gate: `npm test` (Node ≥ 24), `npm run gate`, `node scripts/check-surface-art.mjs`.
- Browser e2e suite: `npm run test:browser` (opt-in, ~90 s).
- Manual live verification (Playwright CLI, user-preferred path — NOT the IAB browser):
  - Serve: `npm run serve` (http://localhost:5173/src/web/index.html).
  - Run scripts with
    `NODE_PATH=~/.local/share/mise/installs/npm-playwright/1.64.1/node_modules node script.cjs`
    (Chromium headless-shell already in ~/.cache/ms-playwright).
  - Fresh browser context per scenario (localStorage persists and can resume an old run).
  - State injection lever (frozen kernel): at MAP phase,
    `const s = JSON.parse(window.__dlb.controller().save()); s.deck.push({uid:'x1', cardId:'…'});
    window.__dlb.controller().load(s);` — `load` takes the PARSED OBJECT (a string fails
    with "save: not a JSON object"); the travel `act()` shuffles and
    deals them like real cards (a bare `load` leaves the painted surface stale until the
    next `act()`; `window.__dlb.snapshot()` reads engine truth immediately).
    Enemies live at `state.combat.enemies`.
  - Fixed seed ⇒ fixed deal (`?seed=N`); hand entries are objects `{cardId, cost}`;
    card buttons: `button[data-slot][aria-label^="Face name"][aria-disabled="false"]`;
    face names differ from cardIds (e.g. `strike` renders as "Hammerfall").
  - Permanent regression coverage goes in `tests/web/e2e.browser.spec.js`, not /tmp scripts.

## Slice log (append-only evidence trail)

- 2026-10-24 — roadmap created; S1 (master deck viewer) dispatched to development.
- 2026-10-24 — S1 dev done (npm test 233 pass/1 pre-existing todo, gate OK, surface-art OK,
  test:browser 10/10 incl. new deck-sheet e2e); manual QA PASS 7/7 via Playwright CLI
  (evidence: /tmp/s1-qa/ — 4 scripts, 4 screenshots; tempered propagation verified through
  the save/load lever); committed 5b11de9. Review + S2 dev dispatched in parallel.
- 2026-10-24 — S1 review APPROVE (independent gate re-run at the commit). Findings queued as
  S1.1 (run after S2 dev lands to avoid concurrent edits): P2 snapshotDeck throws on unknown
  cardId (defOf) — tolerate like snapshotReward does, snapshot() now reads the deck in every
  phase and a stale save or lever typo bricks the page; P3 aria-label lacks the text's
  fallback; P3 dead re-derived temper fallback in hud.js; P3 two-distinct-tempers split
  untested; P3 tempered row missing from e2e; P3 stale "exactly like Help" comment; P3 CSS
  stamp-geometry duplication; P3 (later slice) shared modal focus helper.
- 2026-10-24 — S2 QA PASS 8/8 (evidence /tmp/s2-qa/); S2 committed 01466a3. S2 review was dispatched in parallel with the S1.1 fixer and STOPPED unfinished per the user's directive: reviews never overlap with active changes. New sequence: S1.1 lands and commits → S2+S1.1 review (diff since 1c16fac) runs solo → verdict loops or S3 dev starts.
- 2026-10-24 — S1.1 committed 7992e84 (gates re-verified by orchestrator). Solo review of
  1c16fac..HEAD → REQUEST_CHANGES: P1 the codex listed all 39 cards while rewards draw from
  the run's narrowed state.draftPool (fresh profile: only 18 offerable); P2 tolerance holes
  in reward/rest/piles + comment citing the wrong precedent; P3 unknown-rarity rows counted
  but unrendered; P3 hue literals duplicated. Fix round S2.1 (S2 dev): snapshot publishes
  draftPool, codex filters per run, defOrNull() tolerance sweep, catch-all group, shared
  hues. Manual QA passed the truth fix but FAILED E8b (d leaked through the codex overlay
  — pre-existing guard-order bug in app.js) → looped back → fixed + e2e-pinned.
  Orchestrator independently re-ran the E8b probe (PASS). Committed 2ab6834. Re-review
  (7992e84..HEAD, solo): VERDICT APPROVE; backlog items recorded below.
- BACKLOG (from the S2.1 re-review, non-blocking P3s — fold into a future fix round):
  (a) Help sheet is a third overlay with NO keyboard guard — d/k stack sheets on it and
  `n` discards a run behind it (E8b class, pre-existing; guard it or close sheets in
  newGame); (b) restBody still throws on an unknown temper key, so snapshotRest's new
  `?.` fallbacks are unreachable through snapshot() — tolerate in restBody or revert the
  `?.`; (c) "degrade everywhere" overclaims: snapshotHand/combatBody/snapshotEnemies/
  snapshotMap/kindlingBody still throw on corrupt persisted ids (baseline; either extend
  defOrNull-style tolerance or narrow the claim); (d) nit: cardIdOf duplicates defOf's
  inline id extraction.
- 2026-10-24 — S3 (gold economy) development dispatched.
- 2026-10-24 — S3 dev done (255 tests/254 pass/1 pre-existing todo, gate OK, art OK,
  test:browser 12/12, sim 20-run win-rate inside stored baselines; 21 files incl.
  regenerated golden fixtures — gold is hash input — and 3 test-only deviations from
  shifted RNG streams). Manual QA PASS 10/10 (evidence /tmp/s3-qa/): 99 boot purse,
  +16/+12 in-range grants, 99+16+12 purse math, one-grant-per-kill, same-seed
  determinism, save/reload, legacy-save defaults to 0, end-screen total, deck/codex
  regressions clean, zero console errors. Committed 67084ec; solo review dispatched.
  Roadmap lever recipe corrected: ctl.load takes the parsed object.
- 2026-10-24 — S3 review (solo, relaunched after a provider usage-limit kill):
  VERDICT APPROVE. Reviewer verified byte-identical golden regeneration, legacy-save
  hash stability, once-only grant structure, RNG accounting, and all three test
  deviations (policy sources untouched at the commit). Two P3s recorded: negative/
  unbounded gold accepted by validateSave (folded into S4 — spending makes it real),
  and legacy-log replay drift is silent (doc-grade: note in replay-drift error/docs
  that engine draw-consumption changes from S3 onward retire old log hashes).
- 2026-10-25 — S4 (shop) dev hit a provider network error mid-run (~89 min in) and was
  RESUMED with context intact — all 26 files completed, gates green (271 tests/270 pass/
  1 todo, gate OK, art OK, test:browser 13/13, sim clean on all three policies). Manual
  QA PASS 11/11 (evidence /tmp/s4-qa/, resumed once more after a second network error):
  placement at r5n1, price bands, R6 afford-filter proven at kernel level (exactly the
  affordable ids emitted; inert tiles name gold), buy/sold/deck-mid-shop, uid-precise
  removal (19-instance modal), leave-is-final, byte-identical offers across boots,
  negative-gold rejection with exact problems message, legacy/deleted shop-field
  tolerance, zero console errors. Committed 58aefe6; solo review dispatched.
- 2026-10-25 — S4 review VERDICT: APPROVE (in-memory golden rebuild byte-identical, all
  economy invariants verified). Fix round S4.1: P2 NaN purse via a validate-accepted
  no-gold shop save (both spend sites floor at 0, pinned); P3 R6 inversion (torn shop
  offered a no-op x — enumeration mirrors the handler guard, pinned); P3 surface-art
  page-* detection was DEAD CODE (fixer proved the prescribed edit inert, made the
  family live; strip/restore experiment quoted); P3 shop.js roll-order comment. All
  gates re-verified by the orchestrator at af50324 (273 tests/272 pass/1 todo, gate OK,
  art OK, test:browser 13/13). Committed af50324 — S4 CLOSED.
- 2026-10-25 — S5 (potions) dev was network-killed THREE times (each resume preserved its
  work); after the third the orchestrator took over the final verification: full battery
  green (296 tests/295 pass/1 pre-existing todo, gate OK, art OK, test:browser 14/14 incl.
  the new belt e2e, sim exit 0, token budgets PASS). Six-potion roster composed from the
  existing vocabulary; fixed victory roll order (relic heal -> gold -> potion drop ->
  reward roll); tier bands 40/40/60, boss never, full-belt suppression at 0 draws,
  combat-only q/d ids, S4.1 tolerance ruling applied. Manual QA PASS 11/11 (evidence
  /tmp/s5-qa/, 26 screenshots; real drop sampling 37.5% vs 40% band; exact effect math;
  zero-draw discard proven via rngDraws 67->67). Committed c83a2d0; solo review dispatched.
- 2026-10-25 — S5 review (resumed once after a network kill): VERDICT APPROVE — golden
  rebuild byte-identical, 2 outcome flips both loss->win (potions strictly beneficial),
  lifecycles verified against the shared vocabulary, no interruption seams. Four P3s →
  backlog: beltBody text dump hints quaff ids the kernel refuses (S4.1 inversion at the
  text surface); POTION_DEBUFFS hardcoded, not derived from the statuses table (a future
  frail would silently survive Purge Flask); beltPanel missing-row guard calls a state
  setter mid-render (latent); policy stance + AGENT-PLAY-GUIDE action table lack
  q/d and (pre-existing) b/x/l rows. A dedicated POLISH round clears the whole backlog
  after S6 closes, before S7.
- 2026-10-25 — S6 (events) dev done in ONE clean pass (24 files; 314 tests/313 pass/1 todo,
  gate OK, art OK, test:browser 15/15 incl. event e2e, sim exit 0; golden regen
  byte-identical, four offsetting flips). The S6 QA agent was network-killed TWICE with
  zero evidence collected, so the ORCHESTRATOR ran the manual QA inline: 11/11 PASS
  (placement r2n1/r6n1; peddler story screen; afford-filter dimmed-with-reason + exact
  kernel ids; bottle −40 gold with beat+continue; determinism across fresh boots
  (Bellows Fuel twice); smith temper modal on seed 1 with deck-stamp proof; sell reason
  surfaced; belt inert on map; torn saves degrade to 'the wayside' + self-heal via R6;
  15/15 + 314/313/1 re-run at the tree). Harness lesson recorded: ctl.submit() alias
  does NOT advance the session (only dispatch does) — orchestrator backlog candidate.
  Committed 69b05eb; solo review dispatched. NOTE: release/ is stale since daba4b4 —
  rebuild due before the next itch ship (ship-time concern, not per-slice).
- 2026-10-25 — S6 review VERDICT: APPROVE (delivered on its third resume after provider
  kills). All load-bearing checks verified clean (draw accounting, composition, R6
  symmetry incl. resolved/torn paths, policies, golden byte-identical with four
  offsetting flips, zero event visits in goldens). P2: four validateSave-accepted torn
  shapes threw in snapshot/observe (S4.1 class) — fixed in S6.1 (d7441b6): both
  renderings gate lines + coalesce offers through the kernel's own temperOfferOpen
  guard; all four shapes live-probed by the orchestrator (survive snapshot AND render,
  ids exactly [v0]). P3s fixed: rightmost comment, '(+0 HP)' -> 'already whole', e2e
  line-merge. ctl.submit alias confirmed pre-existing/unused -> POLISH backlog.
  Committed d7441b6 — S6 CLOSED. Six of nine roadmap slices through the full SDLC.
- 2026-10-25 — POLISH round committed 4f493ca: the entire review backlog cleared in one
  pass (submit alias deleted + one-dispatch-path pin; Help-sheet keyguard incl. the
  first-run paint, e2e-pinned + orchestrator-probed live; belt dump quaff hints from the
  legal list; POTION_DEBUFFS derived from STATUS_KINDS with an invariant pin; beltPanel
  mid-render toggle removed; restBody temper tolerance; guide action table through S6 +
  policy stance notes; cardIdOf/defOf shared extractor; replay_mismatch drift note; Help
  button title honest). Gates at commit: 318/317/1 node, gate OK, art OK, 16/16 browser.
- 2026-10-25 — POLISH review VERDICT: APPROVE (keydown chain walked in all states, alias
  pin sound, belt dump consistent by construction, STATUS_KINDS matches engine behavior,
  guide table typo-free, no format changes). Four P3s -> BACKLOG: (a) first-run Help
  dismissal paths disagree (Escape sets the flag permanently, backdrop click doesn't —
  pre-existing wart, divergence frozen by this diff); (b) decayStatuses still hardcodes
  [vulnerable,weak] — correctly NOT swapped (decay is a different axis than buff/debuff)
  but needs a cross-reference comment naming the second list; (c) temperOffers elements
  are never validated — a torn save temperOffers:[null] throws out of BOTH renderings at
  a rest site (S6.1 class, pre-existing); (d) hud.js stacked JSDoc dedup nit.
- 2026-10-25 — S7 (relics) development dispatched. Backlog now rides into a future round
  or S8's fix capacity; the pipeline's next gates are S7's loop, then content scale.
- 2026-10-25 — S7 (relics) dev was network-killed three times; the orchestrator took over
  the finish: the new relics e2e had three TEST bugs (no event branch — the seed-7
  wayside trapped the walk; a dead `[aria-disabled="false"]` selector — affordable event
  buttons simply lack `disabled`, the S6 e2e's fallback was the same latent bug; a
  hardcoded chip count where the elite-preferring path yields 4). Fixed in the spec,
  probed live, suites green (341/340/1 node, 17/17 browser). The S7 QA agent then hit a
  provider quota kill with zero artifacts, so the orchestrator ran the manual QA inline:
  11/11 PASS — chip+starter (Kindled Heart), two elite drops from the common pool with
  kernel-verbatim tooltips (Cyan Lantern, Forge Iron), exactly 3 rare boss offers
  (Deep Well/Slag Crown/Ash Crown), pick -> ended win with HUD/summary agreeing (4
  relics), hooks live (Lantern energy 4 turn 1, Forge Iron block 4, Hearth Ash rest
  delta 16 = 8+8), torn relic ids degrade (raw id shown, chip counts known only),
  Walk away -> victory keeping drops. Committed 190a3e8; solo review dispatched.
- 2026-10-25 — S7 review ran INLINE (the subagent provider saturated: three consecutive
  congestion kills while the orchestrator session stayed healthy). VERDICT: APPROVE.
  Verified at HEAD: the victory-chain doc matches the code stage-for-stage (boss
  early-return skips potion/reward; exactly 3 offer draws; elite +2); Kindled Heart
  clamps per-relic in acquisition order; Deep Well reconciles — the hook widens
  HAND_SIZE and the NORMAL accounted draw step spends the draws (no relic hook draws
  outside startCombat); Gold Vein in-chain with gold events; Flask Grip after the
  potion resolves; dropPool filters held (starter included); bossOfferOpen re-checks
  at pick; state.js refuses non-array/duplicate relics, tolerates unknown ids;
  relicRows emits known:false raw-id rows; golden rebuild byte-identical at HEAD;
  spec fixes present. P3 (backlog): relicRows' starting flag is positional (relics[0]
  of a torn save mislabels); nit: single-tier-exhaust drop path costs 1 draw
  (documented in-code, unreachable through play). Committed state clean — S7 CLOSED.
  Seven of nine roadmap slices through the full SDLC.
- 2026-10-25 — USER FEEDBACK: "relics has no sense if the game gets reset after winning it."
  Accepted — the structural answer is (a) a LONGER CLIMB: relics/deck/gold accumulate
  across acts within a run (S9 reprioritized ahead of S8; Act 2 makes build-around real),
  and (b) META-PROGRESSION: the existing profile unlock system (which already narrows the
  card pool by lifetime play) extends to relics (new S10) so winning runs permanently
  grows what future runs can hold. Dispatching S9 now.
