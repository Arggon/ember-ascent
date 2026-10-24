# StS-Parity Roadmap — completing the implementation

Goal: close the visible feature gaps between Ember Ascent and Slay the Spire, in small,
independently testable vertical slices. Each slice crosses the full SDLC:
**plan → development → manual test (Playwright CLI) → code review**, with failures
looping back to development before a slice is committed as done.

Process rules (standing):

- Orchestrator plans and dispatches; ≤ 2 background subagents run at any time.
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
| S1 | Master deck viewer | snapshot exposes full deck (id, name, cost, type, tempered, count) | "Deck" button on map+combat → modal overlay, sorted, grouped by count, Esc/click closes | committed 5b11de9 — QA PASS 7/7, in review |
| S2 | Card codex | expose draft pool via public API (`draftPoolFrom` already exists) | "Cards" button → codex modal grouped by rarity with descriptions | pending |
| S3 | Gold | `player.gold`, per-tier gold rewards auto-granted on victory | HUD gold readout; reward screen shows gold line | pending |
| S4 | Shop | `shop` node type + phase; deterministic prices; buy card, remove-card service, leave | shop view (buy grid, service buttons, gold readout) | pending |
| S5 | Potions | 3 slots, post-combat drop table (seeded), quaff/discard action ids | potion belt in HUD with tooltips, quaff/discard controls | pending |
| S6 | Events | `event` node type + phase; 4 seeded events with 2–3 choices each | event view (story text, choice buttons, outcomes) | pending |
| S7 | Relics | grow relic table with real effect hooks; elite drops relic; boss offers 3 | relic display + picks in reward flow | pending |
| S8 | Content I: cards | ~70 cards incl. new verbs (multi-hit, exhaust, retain) | codex/deck views already render them | pending |
| S9 | Content II: enemies + Act 2 | new encounters + second biome/map skeleton | map/act presentation | pending |

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
    window.__dlb.controller().load(JSON.stringify(s));` — the travel `act()` shuffles and
    deals them like real cards. Enemies live at `state.combat.enemies`.
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
