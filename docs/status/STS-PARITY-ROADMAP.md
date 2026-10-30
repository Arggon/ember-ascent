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
| UX-1 | Boss-offer down-tier + uniform card faces + gem readability | offer pool fills rare→uncommon→common; fixed faces per viewport tier | honest exhausted copy | closed — 90a840e, QA 8/8, review APPROVE (P2 → UX-2) |
| UX-2 | The sequenced, named enemy turn + UX-1 review fixes | kernel untouched (goldens byte-identical) | per-attacker floats, intent highlight, ≤380 restore, sealed vault, tooltips | closed — c8ee3f7 + 7906900, QA 10/10, review APPROVE (P2 fixed in 7906900) |
| UX-3 | The socketed cost gem + the hand always fits | kernel untouched (goldens byte-identical) | gem inside the card at every tier (--gem cqi sizing), type word clears the socket, 621-1000px 6+ scroller, short-tier flush 6+ hands, viewport-check gem/hand7 matrix, e2e gem test | committed c23988d — QA PASS, review REQUEST_CHANGES (P1 band scope) -> UX-3.1 fix in the tree |
| UX-3.1 | The landscape-short desktop band (QA follow-up) | kernel untouched (goldens byte-identical) | 481-699px height tier in two width arms (761+ side-by-side dock; 621-760 stacked with a deep 481-601 sub-arm), matrix rows 800x600/640x600/760x600 + hand7 | review fix in the tree — gates green, re-review pending |
| UX-4 | The halved pace + a visible draw and play | kernel untouched (goldens byte-identical) | SLOW_FACTOR=2 in animMs + --pace on every combat one-shot CSS duration/delay; the deal re-timed to a visible stagger (90ms base step / 300ms base flight, resume-across-repaint deal clock); pose holds, card-fly, throws, kill holds, banners all routed; dock: 1× cinematic, 2× classic, » skip | in the tree — gates green, QA/review pending |
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
- 2026-10-25 — UX-1 review VERDICT: APPROVE. Verified: the legacy stream identity is
  PROVABLE (the loop's first pickAt call is textually identical and breaks before the
  later tiers whenever rares cover 3 — pinned over 80 seeds); the headroom pairs are
  arithmetically net-zero at every tier; the exhausted-case reachability is a theorem
  (act-1 offers >= 1 for every fresh profile). Its P2 catches MY second assertion-
  vs-evidence miss: the "360x780@130 artifact" dismissal was wrong — a real diff-caused
  1.3px card-name clip (the tall-portrait block's 10px side padding overriding the
  <=380 tier's engineered 6px). Also: the laptop End-Turn budget moved +14px (clears by
  87px — the earlier "byte-identical" claim was false; the corrected record stands:
  moved +14px, clears by 87px), and the tooltip claim was half-true
  (aria-label yes, no title). ALL fold into UX-2 with the pacing work.
- 2026-10-25 — UX-2 (pacing + UX-1 review fixes) dispatched. Brief from the measured
  audit: per-enemy enemy-turn sequencing (burst diffs carry per-enemy indices;
  enemy-strike hook exists), attacker-named damage floats, slam anticipation beats —
  surface-side only, kernel untouched; plus the <=380 side-padding restore + row
  re-measure, the doubly-torn vault fallback line, and the End-Turn budget record.
- 2026-10-28 — UX-2 dev done in one pass. THE ENEMY TURN, SEQUENCED AND NAMED
  (surface-only; the kernel is byte-identical, golden rebuilt + cmp'd below): the turn
  flip now reads the kernel's own `enemy_attack` events (per attacker, per hit, in
  resolution order) into ONE `enemy-turn` burst, and `act()` arms a strike-sequence
  plan (runtime.strikeSeq — beat 500ms, slam 640ms, dash arrival at 46% = 294ms, all
  through `animMs` so the speed dock divides every beat). Each attacker's slam waits
  its beat via the same positive/negative animation-delay resume the hero's pose uses;
  the attacker's intent badge lights while ITS slam plays (`.is-striking` +
  `intent-strike` keyframes on the same clock); each attack's NAMED float — "Kiln Mite
  −6", or "absorbed" when block ate it — lands over the hero at its dash arrival;
  the vignette pulses once when the last attack lands; the aggregate toast stays (the
  net fact), the aggregate float is silent (the named ones replace it) and the hurt
  flinch keeps its beat. `»` skips the choreography and paints the named floats
  statically stacked; reduced motion arms nothing (the turn collapses to the fast
  form — measured: no floats, no plan, static classes exactly as before the slice).
  Timing at 1x, two attackers (seed 22, measured): strike 1 float +359ms, strike 2
  float +839ms (gap 480ms = the beat), information complete ~1.7s; 2x halves the gap
  (232ms measured). 3-attacker turn: floats complete ~1.3s, vignette ~1.6s — inside
  the 1.2-1.8s brief. THE B FIXES: (1) the tall tier's 4-side padding override is
  restored for <=380 phones (6px sides + flush end wraps, and the fan FLATTENS in the
  tall <=380 band — the 146px face swung 7.7px about its bottom pivot, more than 6px
  of padding can hold; measured, the 360x780@130 row now fails ONLY the pre-existing
  page-wider/hero-name pair that baseline also fails, name-clip gone, no cardsOutside
  regression, full-matrix fail-set diffed identical to baseline minus that clip);
  (2) the doubly-torn vault (a VALID-ARRAY pool of zero known ids) says "The warden's
  vault is sealed to you this climb." instead of the false "You hold everything" —
  detected surface-side from the snapshot's own pool vs known-held rows, e2e-walked
  through a doctored torn pool to a real warden; (3) every card face carries its full
  effect sentence as a native `title` (the clamped tail is now hoverable); (4) the
  record correction stands in the UX-1 entry: laptop End-Turn budget moved +14px,
  clears by 87px. PLAYING.md documents the named, sequenced turn. Gates at the tree:
  377/376/0/1 node (the pre-existing poolSelection todo), gate OK, art OK, 20/20
  browser (+2: the sequence-order test and the torn-vault walk), sim 20 runs exit 0
  (token budgets PASS), golden REBUILT AND BYTE-IDENTICAL (sha256 27b5f677…, cmp
  clean — the kernel did not move), frozen viewport rows 915x412 + 1280x800 ALL PASS.
- 2026-10-25 — UX-2 dev done (10 files; sequenced named enemy turn over the kernel's own
  enemy_attack events; 500ms beat / 640ms slam / impact 46%; intent badge lights on the
  seq clock and moves down the line; vignette at last impact; aggregate float silent,
  toast keeps the net; speed dock divides; reduced motion arms nothing; the <=380 clip
  fixed with measured flush-wrap + fan-flatten extras; sealed-vault fallback line; title
  tooltips). One real bug caught in the new mechanism itself (a leaked plan re-slams
  forever — identity-checked retirement). Gates: 377/376/1 node, gate OK, art OK, 20/20
  browser (+2 sequence tests), sim exit 0, golden byte-identical (kernel untouched —
  proven). QA PASS 10/10 (order +361/+856ms, highlight windows 519ms apart, 2x halving,
  reduced-motion zero, absorbed-vs-net honesty, the 360x780@130 row = baseline minus
  the clip, sealed vault verbatim, tooltips byte-identical). Committed c8ee3f7; solo
  review next.
- 2026-10-25 — UX-2 review VERDICT: APPROVE. Verified: goldens byte-identical (kernel
  untouched); the plan lifecycle traced across every interleaving (2x mid-sequence,
  >> mid-sequence, newGame, resize, the two-plans identity check) with ONE P2 — the
  End-Turn timer only covered the sequence's own lifetime, so a player action inside
  the ~1.5s window re-slamed stale attackers (contradicting the arm block's own
  comment) — fixed in 7906900: every non-enemy-turn action retires the plan outright,
  and the run-ending flip arms nothing (unplaced floats were landing over the defeat
  panel). P3s fixed: the dead `attacking` plan field dropped; the ">>" static-form
  claims corrected in floats.js + the roadmap (it exists only when ">>" armed before
  the turn). Gates at 7906900: 377/376/1 node, gate OK, art OK, 20/20 browser, sim
  exit 0, golden byte-identical. UX ROUNDS CLOSED.
- 2026-10-29 — UX-4 dev done (the user's live-play report: "Combat animations and FXs
  still so fast. reduce it to half. Card draw and card usage animation are not there or
  they are so fast that don't allow me to see them"). ONE FACTOR, TWO EXPRESSIONS: (1)
  `SLOW_FACTOR = 2` in runtime's `animMs` — `ms × SLOW_FACTOR ÷ animSpeed` — so every
  JS-scheduled beat doubles at the new 1× (pose holds now arm `animMs(base)`; the deal
  clock, card-fly/hammer flights, hit impacts, hit-stop, the UX-2 plan, kill holds and
  the end-hold stroke estimate `animMs(650)` all route); (2) `--pace` on the document
  root (`SLOW_FACTOR ÷ animSpeed`, 0 at ») — every ONE-SHOT combat duration AND delay in
  style.css (373 declarations: all poses + sprite frames, foe slam/strike, juice beats,
  floats, shatter, shake, banners/ring/bloom/darken, every per-card fx node) is
  `calc(<base> × var(--pace, 1))`; ambient loops (breathe/wind/embers) and screen
  arrivals (fade-up, settle, travel-in, act card) stay at base and are flagged as out of
  combat scope. THE DEAL RE-TIMED: base step 0.03s → 0.09s, base flight 0.3s, flight
  distance 24px → 64px — at 1× an 8-card deal spans 7×180+600 ≈ 1.86s of cards landing
  one by one, each card's flight 600ms ≥ 400ms target; a new run-scoped deal clock
  (runtime `DEAL` + `dealClock`) holds `deal-in` for the whole span and re-derives
  `--deal-offset` per repaint so a hover RESUMES the deal instead of cutting it; the
  fan never shifts (juice-deal ends at transform:none, rotation lives on the inner
  .card — asserted in the new e2e). CARD-PLAY VISIBILITY: measured the fx-card flight at
  34vh ≈ 272px at 1280x800 — NOT near-zero; the fix is the doubled duration (CSS
  0.42s → 0.84s at 1×, node lifetime animMs(460) = 920ms), no keyframe change. ROUTING
  AUDIT FIXED: vignette/wipe/banner/boss-ring/run-bloom/run-darken/act-card/scene
  fxAdd lifetimes were RAW ms — all routed through animMs; the » gap where CSS
  animations kept playing at skip speed is closed by --pace = 0. DOCK SEMANTICS: 1× =
  cinematic (everything doubled), 2× = the classic pace (animMs(base), --pace = 1),
  » skips; documented in PLAYING.md. Reduced motion arms nothing, unchanged. TESTS
  MOVED HONESTLY: the pose-hold release probe waits out the paced window (1800ms), the
  UX-2 sequence bounds double (float/badge gap >= 700ms vs the 1000ms beat), signature/
  hammer/kill-slot probe sleeps re-measured, and a NEW e2e asserts the deal: every card
  >= 400ms flight, consecutive lands >= 150ms apart, span >= 1s, entry is a travel, fan
  layout stable. Kernel untouched: golden rebuild + cmp BYTE-IDENTICAL to 3e0d108
  (sha256 27b5f677…). LIVE MEASUREMENT at the new 1x (1280x800, seed 7): --pace=2; the
  opening deal lands 5 cards at 180ms steps with a 600ms flight each (delays
  0/178/358/538/718 observed, span 1318ms); Hammerfall's pose computes 1.12s (was
  0.56s); the played-card flight computes 0.84s (was 0.42s). THE 2x DOCK MEASURED:
  --pace=1, deal flight 300ms, pose 0.56s — the classic pace, as documented. One slice
  finding fixed en route: the OPENING hand never animated a deal at all (the deal burst
  was gated on before.phase === 'combat', so the fight's first draw painted fully
  formed) — entering combat now pushes the same deal burst. Layout matrix: the frozen
  1280x800 row is METRIC-IDENTICAL to the 3e0d108 baseline A/B (End Turn 753/800,
  clearance 47, spill -6, pass; 800x600 586/600 +14 pass); the 915x412 seed-7 row fails
  "rules text hidden: Anvil Blow" on the PRISTINE BASELINE TOO (worktree A/B —
  pre-existing, seed-dependent hand content, not this slice). The harness's fixed
  1300ms post-fight settle could now land mid-deal, so it waits the entry out for real
  (DEAL_SETTLED: no running juice-deal animation). Gates: 377 tests / 376 pass / 0
  fail / 1 pre-existing poolSelection todo, gate OK, art OK, sim 20 runs exit 0
  (token budgets PASS), browser 22/22 (21 prior + the new deal-visibility test).
- 2026-10-29 — USER RE-TEST after UX-1: (1) "the cards energy cost still not fully
  visible, all the circle must be visible" — the gem's circle CLIPPED at the card's
  corner; (2) "some side cards get are visible cropped at some resolutions". UX-3
  dispatched (surface-only; the kernel is frozen).
- 2026-10-29 — UX-3 dev done (pure CSS + test instrumentation; 3 files: style.css,
  scripts/dev/viewport-check.mjs, tests/web/e2e.browser.spec.js; + docs). THE MEASURED
  DIAGNOSIS: (1) the gem sat at negative offsets at every tier (base top:-6/left:-2,
  one tier top:-8, one top:-6/left:-4) — measured slack top -5px, left -1..-3px at
  every tier — and the combat card's own overflow:hidden SHEARED the top arc flat at
  every tier (the user's screenshot; the UX-1 headroom pairs fixed the ROW clip, the
  card-edge clip remained); (2) the "side cards cropped" reproduce: the hand row at
  short untested windows (800x600) runs past the bottom fold, and at 6+ hands on
  761-1000px widths compression realized 56-86px cards, where the fixed face broke down
  (the 5-line rules clamp outgrew its box and the -3px overlap covered rules-line ends;
  measured, 768x1024+hand7).
  THE FIX (A): the gem is socketed INSIDE the card at every tier — base 30px at 4/4
  (reward/shop), media tiers 21/18px at 3/3, and the combat hand sizes it PER CARD via
  `--gem: max(16px, 18cqi)` (container-query units on the card; combat cards compress
  continuously so fixed per-tier sizes provably overflow a 76px card — the 0.19em
  ATTACK word alone is 59px). The ctype word starts at gem+11..15px per tier (measured
  K offsets), retiring the word-under-gem "TACK" bug; the digit scales with the socket
  (max(9px, 8.5cqi)); no-illus cards (28 of 70 ship without a drawing) get the
  left-aligned head at <=620px. No negative gem offsets remain (audited all 4 rule
  sites). THE FIX (B): 5-card hands compress-to-fit at every >=621px tier (pinned, was
  already true in combat); 6-card hands take the deliberate <=620-style scroller in the
  761-1000px band (cards fixed at the proven 104px, flush — the -3px overlap covered
  rules-line ends at narrow cards; name rides the short-tier cap; rules clamp 4 tall /
  3 short), and compressed 6+ hands on the short tiers go flush (the base -6px overlap
  ran 8px past the 4px padding; measured 1200x450+hand7). <=620 keeps its scroller.
  INSTRUMENTS: viewport-check.mjs gains four thresholds (gem circle inside its card
  rect via a transform-free clone lab, gem inside the viewport, word never under the
  gem, card inside the viewport) and 15 matrix rows (360x780@100 per the brief's frozen
  matrix + 7-card hands at every size at 100%/130%); e2e +1 test (21 total) pinning the
  same at 1280x800/390x844 with 5- and 7-card hands. GATES AT THE TREE: 377/376/0/1
  node (the pre-existing poolSelection todo), gate OK, art OK, 21/21 browser, sim 20
  runs exit 0 (token budgets PASS), golden REBUILT AND BYTE-IDENTICAL (sha256
  27b5f677…, cmp clean — the kernel did not move). FULL MATRIX (35 rows, seed 11):
  every >=621px row passes with 5 AND 7 cards (1280x800, 1366x768, 1200x450, 915x412,
  844x390, 768x1024, plus their hand7 rows); the frozen rows 915x412 + 1280x800 are
  metric-identical to baseline (End Turn 394/412 and 753/800, clearance 18/47, spill
  -6, ALL PASS); the phone-width rows fail ONLY the pre-existing mobile-emulation
  artifact pair ("page wider than the screen" + hero name — same kind and row set as
  the recorded baseline, plus the same-kind hand7/@130 siblings). LAYOUT-ACCEPTANCE
  revision recorded.
- 2026-10-29 — QA PASS on the UX-3 headline fixes (gem +4px inside the border box, +3px
  inside the padding-box — the real clip boundary — at every viewport; the baseline
  stash-check reproduces the user's bug pre-UX-3 at -7px top slack; type word clears;
  hand fits 8 of 9 widths; one 30s boot-timeout browser flake passed on re-run). QA
  measured the slice's open issue as the real second complaint: 800x600 page 827px tall
  vs 600 viewport (227px scroll), .page-combat 665px, hand bottom 760px = 160px BELOW
  THE FOLD (hand7 scroller rides 136px below). UX-3.1 dispatched and done in the same
  slice: new scoped height tier `@media (min-width: 621px) and (min-height: 481px) and
  (max-height: 699px)` — hero figure min(140px,24vh) (was 42vh/250), enemy
  min(140px,22vh) (was 34vh/200), the enemy row's 6%-of-width floor pad (48px at 800
  wide) to 2%, the intent line clamped to one row, the card face clamp(124px,25vh,148px)
  with the footer chip hidden and 3-line rules (the <=480px tier's exact moves), the
  hand's gem-headroom pair 30-14 -> 18-8 (the gem is inside the card now; the 1.5deg
  swing rides in the 18px pad), hint + page-num dropped, app/stage frames tightened.
  MEASURED 800x600 BEFORE -> AFTER: docH 827 -> 600 (scroll 227 -> 0), End Turn bottom
  760 -> 586 (clearance -168 -> +14), hand bottom 760 -> 586. Band short end measured:
  800x481 docH 481 (scroll 0), End Turn 467, +14. NO frozen row or existing matrix row
  moved (the band matches no frozen size); the release matrix grows to 37 rows —
  800x600 and 800x600+hand7, both ALL PASS with every gem assertion green. GATES AT THE
  TREE: 377/376/0/1 node (the pre-existing poolSelection todo), gate OK, art OK, 21/21
  browser, sim 20 runs exit 0 (token budgets PASS), golden cmp byte-identical (sha256
  27b5f677…). LAYOUT-ACCEPTANCE revision recorded.
- 2026-10-25 — UX-3 (+3.1) committed c23988d after QA PASS with measurement: the gem
  socketed INSIDE the card at every tier (the REAL root cause was the card's own
  overflow:hidden shearing the gem's arc — UX-1's headroom fixed the row, not the card
  edge; the QA's stash-check reproduced the user's bug pre-fix at -7px and post-fix
  measures +4px inside the border box / +3px inside the clip boundary at every
  viewport), the hand compresses or deliberately scrolls at every width, AND the
  measured 481-699px-tall band (800x600: the hand rode 160px below the fold — the
  user's "some resolutions") gained its height tier (docH 827->600, End Turn
  clearance -168->+14, the band holding at 481px). Matrix grew to 37 rows, frozen rows
  metric-identical, goldens byte-identical, 21/21 browser. UX-3.1 verified by the
  orchestrator live at 800x600 and 800x481. Solo review next, then the release rebuild.
- 2026-10-29 — UX-3 review VERDICT: REQUEST_CHANGES. P1 (measured at real CDP sizes
  against the parent b86e0d3): the 481-699px band FAILED on part of its width range —
  the band sat later in source than the portrait tier's deeper compression
  (@media max-width 700px + max-height 760px: card 100px, figs 100px) and UN-DID it at
  621-700px wide (640x600: End Turn -4 -> +38 below the fold, strictly worse than the
  parent), and at <=760px wide the dock STACKS (~+80px vertical over the side-by-side
  dock the numbers were calibrated on; 760x600 +67 below, 621x550 +53). The dev had
  measured both ends of the HEIGHT axis and neither end of the WIDTH axis. FIX (per the
  review): (1) the band's combat compression rescoped to min-width 761px; (2) an
  explicit 621-760 x 481-699 arm BELOW the portrait tier keeps its deeper values (card
  100px, figs 100px, orb/pile 44px, hand pair) and adds the band's
  hint/page-num/frame/intent/enemies moves, with a DEEP sub-arm at 481-601px tall where
  the stacked dock's two extra rows + the two-row HUD cannot fit: face/figures scale
  with vh (min(100px,17vh) / min(100px,15vh)), the stage hero column drops (the HUD
  carries HP/energy/block verbatim), enemy padding 0, and the HUD runs the <=480px
  recipe WITHOUT hiding anything (hero name shown per the >=381px rule; chips/buttons
  tighten to the padding floor, the elastic spacer out) — measured: at 481px the HUD
  was 102px in two rows and the page 114px over; one row is 52px. The 6+ scroller
  extends to 621-1000px (a 7-card hand at 621-760 still lands ~84px a card), with its
  3-line clamp restated for the 100px faces; the rules echo (c-art) hides in the 100px
  faces (it inverted and spilled 3px past #stage). P3(a) fixed here: the slice-log row
  counts (35 rows after UX-3, 37 after UX-3.1 — the entries said 34/36) and the two
  slice-table rows. THE MEASURED GRID (widths 621/640/700/760/800 x heights
  481/550/600/699, seed 11, 5-card hands): End Turn bottom = vh-8 EXACTLY at every
  621-760 cell (the deep arm's budget is fully spent, clearance +8 = the contract bar)
  and vh-14 at every 761px+ cell; End Turn topmost, docH <= vh (no scroll), no hand
  card outside the viewport, every gem circle inside its card — ALL 20 CELLS FIT.
  Matrix now 41 rows (+640x600, 760x600, 640x600+hand7, 760x600+hand7 — all ALL PASS;
  18 pass, 23 fail = the pre-existing phone-emulation kinds and the 360x640@130 family,
  unchanged in kind and row set). GATES AT THE TREE: 377/376/0/1 node (the
  pre-existing poolSelection todo), gate OK, art OK, 21/21 browser, sim 20 runs exit 0
  (token budgets PASS), golden cmp byte-identical (sha256 27b5f677…). P3(b) noted:
  release/style.css staleness is expected — the rebuild lands at round close after
  re-review. P3(c) the boot-timeout flake assessment accepted (pre-existing, re-run
  policy).
- 2026-10-29 — UX-3.2 committed e09cc2d: the P1 closed per the reviewer's structure (the
  band rescoped to min-width 761px; an explicit deeper-cut arm for 621-760 x 481-699
  incl. a 481-601 deep sub-arm where the stacked dock cannot fit; the 6+ scroller
  extended to 621-1000px; four new pinned rows 640x600/760x600 +hand7). The measured
  grid (widths 621/640/700/760/800 x heights 481/550/600/699, natural 5-card hand):
  ALL 20 CELLS FIT, End Turn clearance +8/+14, no scroll, no card outside the
  viewport, gems in cards — and the orchestrator verified the reviewer's exact
  regression cells live (640x600, 760x600, 621x550, 760x481: clearance +8, 0 cards
  out, gems whole). 41 matrix rows, zero new-kind failures; doc row counts corrected.
  Gates green; goldens byte-identical. Re-review next, then the release rebuild.
- 2026-10-29 — UX-3 re-review VERDICT: APPROVE. The P1 verified fixed (the reviewer
  probed BEYOND the claimed grid: 602-690 tall, docH tracks the viewport, no hole;
  source-order audit correct; deep-arm HUD recipe verified). Remaining: P2 the deep
  sub-arm's short ends are measured green (dev grid + orchestrator live probe:
  760x481 hand bottom 467/481 +14, 800x481 586/600 +14, gems in cards, cards in
  viewport) but NOT harness-pinned - the harness's >=381px hero-name assertion
  encodes the pre-band design (the stage hero column the band intentionally drops);
  pinning needs a band-aware hero-name decision (a11y: where does the name live at
  481px tall?) -> backlog. P3 fixed in the tree: the narrow arm's type-mark hide
  scoped to .stage-combat (reward/shop tiles keep their marks); the UX-3.2 entry
  date corrected to 2026-10-29. Release rebuilt at round close.
