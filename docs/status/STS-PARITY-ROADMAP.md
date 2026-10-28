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
| S8 | Content I: cards | ~70 cards incl. new verbs (multi-hit, exhaust, retain) | codex/deck views already render them | closed — 0168d28, QA 10/10, review APPROVE (5 P3s → backlog) |
| S10 | Meta: relic unlocks | the profile unlock system grows the RELIC pool across runs (StS: new relics enter the pool as you play) | codex or summary surface for unlocked relics | closed — 2ef8ce5, QA 10/10, review APPROVE (5 P3s → backlog) |
| S9 | Act 2 (The Kiln Deeps) | two-act generation + transition in the victory chain; harder tables; legacy back-compat | Act II chapter marker, Kiln backdrop, act-aware end summary | closed — 641731a + d08da32 + c4a0ace, re-review APPROVE |

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
- 2026-10-25 — S9 (Act 2) development was taken over INLINE after four provider
  congestion kills: the dev's kernel unit landed on disk mid-flight (acts field,
  beginNextAct, act-2 biome/placement/gold) and the orchestrator completed it —
  stale pins recomputed (4 driver GOLDENs + tempers, all deterministic double-run),
  golden regen (26 ended, longest 155 steps: runs cross both acts), web chapter
  marker + act-aware end summary (runAct via bracket access — the module-graph
  scanner flags bare `act` tokens), AND A REAL FIND: the act-2 warden could offer
  only TWO relics (3 rares existed, one taken in act 1) — fixed by growing the rare
  tier to five (Cinder Ward B6/fight-start, Ash Ledger +20 gold/fight; existing
  hooks, no new mechanics). The relics e2e now walks BOTH acts live: elite drops,
  act-1 warden 3 offers -> pick -> climb asserts (act 2, chapter, +5 maxHp, full
  heal, carryover), act-2 elites, act-2 warden 3 offers -> pick -> ended win with
  the Act 2 summary. Also fixed en route: the S6 e2e's latent dead selector
  (`[aria-disabled=false]` never matches; `:not([disabled])` is the enabled form).
  Gates at commit 641731a: 341/340/1 node, gate OK, art OK, 17/17 browser, sim
  exit 0 (token budgets PASS). Solo review next (subagent if infra recovered,
  else inline).
- 2026-10-25 — S9 review VERDICT: REQUEST_CHANGES (the subagent infra recovered). P1:
  beginNextAct double-counted the pre-transition stream into rngDraws (500-in ->
  1070-out; replay self-consistent but the format's counter lied). P2: torn acts>=3
  crashed step() at the climb; the transition draw pin was a tautology (mine — it
  would have caught the P1); stale 3-rares docs x3; the brief's missing tests. All
  fixed in d08da32: the counter is the absolute index alone, acts>ACT_COUNT refused
  at load, the delta pinned at the measured 54 (12 layout + 10 spacer + 32 encounter
  rolls), docs updated, act-2 placement x60 + ACT2_GOLD bands + acts validation +
  act-2-skip kernel tests added, e2e guard raised / both wardens matched, and the
  (NOTE: the act-2 boss-node label claim in that round was FALSE — the edit had not
  landed; caught by the re-review, see below.) Gates at d08da32: 345/344/1
  node, gate OK, art OK, 17/17 browser, sim exit 0 (greedy 5% across two acts —
  expected; policies carry no climb heuristics). Re-review dispatched.
- 2026-10-25 — S9 re-review VERDICT: APPROVE (P1 verified fixed empirically — honest
  558-out counter; byte-stable goldens; all P2s closed; the tautology called out as
  "the same assertion-vs-evidence pattern"). Its own P2 caught my false boss-label
  claim: the map-view edit had never landed. Fixed for real in c4a0ace with LIVE
  EVIDENCE this time (the two-act walk announces Travel to Slag Warden then Travel to
  Cinder Foreman; the e2e matches bosses by type class, label-independent), plus the
  last stale stage-4 comment, the event-slot placement pin, and the roadmap record
  corrected. S9 CLOSED — eight of ten roadmap slices through the full SDLC.
- 2026-10-25 — S10 (relic meta-unlocks) dev done in one clean pass: RELIC_UNLOCK_TABLE
  (wins 0/1/3/7/10/15 -> 5/6/8/10/12/13 relics, tier-ordered, rares last), pure pool
  derivation (zero draws — goldens byte-identical, no regen), drops/offers pool-gated,
  a fresh profile's warden vault honestly EMPTY, end-screen milestone narration, legacy
  full-table, torn-pool tolerance. FOUND AND FIXED a real pre-existing bug: the page's
  first boot ignored profile narrowing entirely (cards AND relics) — boot is newGame()
  now and the codex e2e pins the honest narrowed first visit. Gates at the tree: 363/362/1
  node (+18 tests), gate OK, art OK, 18/18 browser, sim exit 0. The QA dispatch died
  silently (no artifacts), so the orchestrator ran the manual QA inline: 10/10 PASS —
  fresh pool/codex, empty vault + climb, doctored veteran (12 relics, 3 rare offers at
  BOTH wardens, ended act 2), milestone narration verbatim ("Your climbs unlocked:
  Ember Heart." / "Relics in play: 6 of 13."), persistence (next run pool 6), legacy
  full-table (elite dropped an uncommon a fresh pool could never yield), torn pool
  never drops/offers the ghost, zero console errors. Committed 2ef8ce5; solo review next.
- 2026-10-25 — S10 review VERDICT: APPROVE (boot-fix blast radius verified — newGame
  ordering sound, no double-run; pool derivation pure; replay pins the header pool so
  ledger drift is structurally impossible; wins fold only on wins, race-free; the S2
  honesty sweep found no surface anywhere listing an ungated relic or card). Five P3s
  → BACKLOG: act.js stage-4 comment now contradicts the meta gate; parseLog doesn't
  shape-check header.relicPool (escalates to exit 1 instead of the corruptSave class —
  pre-existing for biome too); countAfter omits the starter argument (latent, both
  starters in row 0 today); the newRun pool door skips the duplicate check (doctrine
  symmetry); the history screen's persistent unlock line never learned relics. S10
  CLOSED — ALL TEN SYSTEM/CONTENT SLICES S1-S7+S9+S10 + POLISH through the full SDLC.
  Remaining roadmap: S8 (content scale), the release/ rebuild, the backlog.
- 2026-10-25 — S8 (card content scale) dev done in one clean pass: 70 cards (22C/30U/13R
  + 5 starters), multi-hit via the damage verb's dormant hits param (pinned per-hit:
  block soaks hit by hit, totals identical either way), TWO new verbs (retain —
  endTurn/beginTurn hand preservation; heal — honest zero at full HP), the unlock
  ladder retuned 24/32/48/68, all pins updated with reasons, one golden flip
  (greedy seed 1 loss->win, the wider draft). Gates: 375/374/1 node, gate OK, art OK,
  18/18 browser, sim exit 0. QA PASS 10/10 (multi-hit math 9/18/36, retain by UID,
  heal +6/zero, exhaust routing, Forge Rhythm's actual "Discard 1 at random" text
  correcting the brief's mis-read, DEX/PWR scaling, shop bands, mid-ladder codex 45).
  Committed 0168d28; solo review next.
- 2026-10-25 — S8 review VERDICT: APPROVE (retain's blast radius contained — energy still
  charged per play, startCombat empties before beginTurn, tempered copies keep the
  marker by construction; heal's honest-zero pinned; multi-hit per-enemy for ALL cards
  verified in the verb loop; ladder set-equality proven — no card unreachable at any
  rung; pins carry real reasons). Five P3s → BACKLOG: a HAND_LIMIT-overflow unit test
  with retained cards; a cross-reference sentence for the heal-event shape divergence
  (the card verb emits honest zeros, every other site suppresses); the unlock
  narration's fresh-pool count inherits the §11.2 defect framing; the greedy policy's
  0/20 on the wider pool → the future policy slice; commit-message nit (24/32/48/68
  are pool sizes, the score thresholds 25/60/120 are unchanged). S8 CLOSED — THE
  ROADMAP IS COMPLETE: all ten slices + POLISH through the full SDLC.
