# Frozen Requirements — Agent-Playable Deckbuilder

**Handoff artifact.** Owner: Product Manager. Status: **frozen** — changes require a PM revision. **Revision 2** (adds §8, pre-registered kill gate).
**Date:** 2026-10-10
**From:** Product Manager → **To:** Tech Lead (routes to System Architect, then engineering)

Evidence tiers: **[FETCHED]** page read this run · **[SNIPPET]** search result only · **[INFERRED]** reasoning on sourced numbers.

> ### 📌 CARD COUNT — RECONCILED 2026-10-16 (Technical Writer, DEF-3). **This document says "40 cards" in several places. 40 was the PLANNING TARGET; the SHIPPED count is 42.**
>
> The "40 cards" figures below are **left exactly as written** — they are the historical intent, and
> rewriting them would erase the record of what was planned. **Read every "40 cards" in this file
> as "40 planned / 42 shipped."**
>
> **How 42 was verified:** counted the shipped definitions in `src/kernel/content/cards.json`
> directly — **42 card entries (20 attack / 16 skill / 6 power)**. The browser bundle derives from
> that JSON via `tools/gen-content.mjs` under `tests/content/bundle-drift.test.js`, so the JSON is the
> source of truth. **Caveat on method:** the verifying agent had no shell this Run, so this is a
> count by inspection of the file read in full, **not an executed command**; `grep -c '"id"'
> src/kernel/content/cards.json` should return 42 and is the check to run. Full reconciliation note:
> `RELEASE-NOTES.md` → "A note on the card count".
>
> **What this does not change:** every acceptance criterion here is about the *loop* (R1–R10), not the
> count. The planning target remains the correct planning target; only the shipped number differs.

---

## 1. Why these requirements exist

The product requirement is *"agents can easily play it at local development, consuming fewer tokens."* Research turned that from a nice-to-have into the risk-reduction strategy for the whole project.

**The risk it removes:** a 120–150 card deckbuilder's difficulty is **balance tuning**, the least agent-producible part of the work. Three measured findings resolve it:

1. **Text beats vision for agent players.** BALROG (arXiv:2411.13543) measured models performing **worse** when given images of the environment than text-only descriptions. A headless text board is cheaper **and more accurate** than screenshots. [FETCHED]
2. **Payload shape dominates cost, not model choice.** Anthropic measured **150,000 → 2,000 tokens (98.7% saving)** purely by changing how tool definitions and results cross the context boundary; a 100-turn evaluation cut tokens **84%** by clearing stale tool results. Separately, arXiv:2408.02442 measured **declining reasoning under stricter format restrictions** — so constrain the *action space*, not the *state vocabulary*. [FETCHED]
3. **Balance volume should cost zero tokens.** Deterministic self-play is CPU-bound: *sts_lightspeed* runs **1M playouts in 5 s on 16 threads** (MIT, dormant 2024-08); *sts2-rl-agent* reports **~1,200 combats/sec** with a seeded CLI. [FETCHED]

**Design consequence:** the headless text interface is the *primary* interface, not a debug mode. The GUI is a second view onto the same core.

---

## 2. Requirements (R1–R10)

### R1 — One core, two surfaces
The GUI and the headless interface must drive **the same engine code path**. No duplicated game logic, no GUI-only rules.
- **Acceptance:** a golden-state test runs an identical seed + action log through both surfaces and asserts equal state hashes after every action.
- **Rationale:** every prior-art project in this space bolted headless access on as a mod or a drifting reimplementation; the divergence is the known failure mode. [FETCHED]

### R2 — Headless is the primary interface
A full run (start → combat → rewards → map → boss → end) must be completable with the GUI never running.
- **Acceptance:** the entire flow is reachable via CLI subcommands alone, in a non-interactive script, on a machine with no display server.

### R3 — Determinism
Every run is `seed + ordered action log` reproducible. No wall-clock time, no unseeded RNG, no map/dict iteration-order dependence in game logic.
- **Acceptance:** replaying a saved action log reproduces byte-identical final state, every time, across processes.
- **Rationale:** required for regression tests *and* for cheap batch balance runs. Determinism is the precondition for zero-token simulation.

### R4 — Compact text observations
A `state` dump must target **≤ 250 tokens**. Report the measured count, not an assumption.

**Prescribed shape** (a legible table, one header, short token names):

```
T3 | HP 42/60 | EN 3/3 | BLK 0 | draw5 disc3 | PWR2 VULN1
HAND
 1 Hammerfall  A6
 2 Hammerfall  A6
 3 Quench       B5
 4 Anvil Blow   A8+V2 EN2
 5 Stoke        PWR+2 EN1
ENEMY
 Cinder Maw  HP 44/44  A12
 > _
```

Rationale: compact key-value/tabular text over JSON. Measured on a 244-question suite, a compact tabular encoding used **2,474 tokens vs 2,892 for compact JSON and 4,308 for pretty JSON** [FETCHED]. [INFERRED] Card text in the hand is the whole observation — a player needs nothing else, so the dump carries no redundant state.

### R5 — Enumerated action IDs
Actions are **short IDs**, not JSON objects. Target **≤ 8 tokens** per action line.
- **Acceptance:** `actions` prints one action per line as `<id> <verb>`; `play <id>` accepts the ID. An agent can act by emitting a single token.

### R6 — Degrade to a legal fallback, never retry
An illegal, unknown, or unparseable action resolves to a legal **no-op**, returns a structured error, and is **counted in a malformed-action statistic**.
- **Rationale:** this is BALROG's published protocol — invalid actions get a default fallback and are logged for trajectory statistics, so error rates stay measurable instead of costing a retry cycle. [FETCHED]
- **Acceptance:** `--malformed-rate` is reported in the end-of-run summary.

### R7 — No hangs, no silent truncation
- Non-interactive mode must **never read stdin**. Redirect stdin from `/dev/null`; refuse rather than prompt when `!isatty`.
- Every command has an explicit, settable timeout.
- Output is bounded, and **truncation is signalled** with a declared count — never silent. (Agent harnesses middle-truncate around 30k chars without warning.) [FETCHED]
- **Acceptance:** the full suite runs to completion with stdin closed and no TTY; no command can block indefinitely.

### R8 — Agent-operable CLI hygiene
- **Stable numeric exit codes** mapped to failure modes (0 success; distinct non-zero per class: illegal action, invalid seed, corrupt save, internal error).
- **stdout = machine output; stderr = diagnostics.** Never mixed.
- `--help` on **every** subcommand, self-documenting.
- Explicit `--seed`, `--timeout`, `--brief/--verbose`.
- **Acceptance:** an agent with only `--help` can discover and execute a full run without reading source.

### R9 — Token budget is measurable
The harness reports **input tokens, output tokens, and tokens per completed game**. The ≤250 and ≤8 targets are validated against measurements, not documented as intentions.

### R10 — Balance metrics mirror the shipped genre standard
Mega Crit ran a metrics server from Slay the Spire's first prototype; the two metrics they named as most important are **how often a card is picked when offered** and **how often it appears in winning decks**. [FETCHED]
- **Acceptance:** `stats` reports, per card: **pick rate when offered**, **presence in winning decks**, **average damage taken per act**, **win rate by act**, **run length distribution** — filterable.

---

## 3. Reference CLI contract

Commands and flags the architect may refine, but the **capability set is frozen**:

| Command | Purpose | Key flags |
|---|---|---|
| `new` | Start a run | `--seed`, `--character`, `--difficulty` |
| `state` | Current observation (R4) | `--brief`, `--verbose` |
| `actions` | Legal actions as IDs (R5) | |
| `play <id>` | Apply one action | `--json` |
| `save` / `load` | Persist/restore exact state | path |
| `replay` | Re-run an action log; assert equality (R3) | `--assert` |
| `sim` | Batch self-play, **zero tokens** | `--runs`, `--seed-start`, `--policy`, `--threads` |
| `stats` | Balance report (R10) | `--by-card`, `--format` |

**Non-negotiable:** `sim` must run thousands of games without any API call. LLM tokens are for exploration only.

---

## 4. Success metrics

| Metric | Target | Observed via |
|---|---|---|
| Full run completable headless | Yes, no GUI | Scripted `new`→…→end |
| Replay fidelity | Byte-identical state, 100% | `replay --assert` in CI |
| Tokens per `state` dump | **≤ 250** | Measured count in run summary |
| Tokens per action line | **≤ 8** | Measured count |
| Tokens per completed game | **Reported and under budget** | `sim`/run summary |
| Self-play cost | **Zero API tokens** | `sim --runs 10000` CPU-only |
| Malformed-action rate | Reported, trending down | `--malformed-rate` |
| GUI/headless divergence | Zero | Golden-state test |
| Card metrics available | Pick rate + win-deck presence per card | `stats` |

**Planning placeholder, not a measurement:** [INFERRED] on secondary figures, a 300-decision game at ~1–3k tokens/decision implies roughly **0.3–1M cumulative input tokens** for a naive full-state-per-turn loop. The 84% context-clearing result and the ≤250-token dump target exist to drive that number down by an order of magnitude. **This estimate is to be replaced by our own measurement in phase 3.**

---

## 5. Out of scope

Multiplayer/netcode, modding API, localization, console/mobile ports, paid DLC, live-service cadence, Steam fee spend (deferred to the traction gate: itch.io first, $100 only after paid traction).

---

## 6. Open questions (defaults I will ship with)

| Question | Default |
|---|---|
| Where do runs persist? | Local files under the project; no service to babysit |
| Is `sim` required in CI, or manual? | **In CI** — determinism and speed are regression risks |
| How is `--policy` supplied for self-play? | Built-in heuristics first; LLM policy is opt-in and never default |
| Does the GUI ship in the slice? | **No** — phase 6, after the kill gate at 40 cards |

> **CORRECTED 2026-10-16 (Technical Writer, DEF-3) — this answer is superseded by events.** The
> GUI **has shipped**, and earlier than this table planned: it landed as **Phase 5**
> (`PHASE5-STATUS.md` — "Phase 5 — Browser-playable deckbuilder (same kernel)") rather than phase 6,
> and it is in the delivered artifact (`release.zip`, 25 files, `index.html` at the root,
> `sha256 4a6621…d0db`). `shots/` holds **301 rendered PNGs** of it. The original text is kept above
> because it records the plan; **do not read "No" as current state.** The R1 single-core/two-surfaces
> constraint this row was protecting was honoured — the browser drives the same `controller.js` the
> CLI does, guarded by `tests/golden/dual-surface.test.js`.
| Is an MCP server needed at all? | **Not initially** — a `--json` CLI pays ~zero baseline context, while MCP tool definitions pay an upfront context tax on every turn. Revisit only if a real client needs it. |

---

## 7. PM answers — Revision 2

The Tech Lead correctly blocked phase 2 on three PM decisions. All three are answered and **frozen** below. In particular, the kill gate now has a **pre-registered, falsifiable rule** — deciding "is it fun" after phase 3 would be unfalsifiable, and agents cannot judge fun.

### 7.1 Kill gate — pre-registered fun rule (decided before phase 3)

**Scope of the gate:** phase 3 builds **40 cards, one act including a boss**. Not three acts. [INFERRED] Three acts at gate stage multiplies content cost before the loop is validated, which inverts the whole point of a kill gate. Confirmed as the Tech Lead's default.

**Judges.** Agents cannot assess fun, and the builder is biased about their own loop. Therefore:
- **Judge A — the owner (dev):** 10 complete runs.
- **Judge B — one independent person who has never seen the game:** 5 complete runs, played in silence with no explanation beforehand.
- Judge B is **required**, not optional. If no independent person is available, the gate is **not passable** and phase 3 cannot be signed off — a NO-GO by default rather than a self-certified GO.

**GO requires all five to be true:**

| # | Test | Threshold | Why this test |
|---|---|---|---|
| G1 | **Starts a second run unprompted** | ≥ 4 of 5 independent testers begin a new run with no prompt or instruction | The single most robust fun proxy in a roguelike. Costs nothing to observe and is hard to fake. |
| G2 | Median run length | ≥ 15 minutes for a first completion attempt | Shorter means the loop is trivial, not taut |
| G3 | Post-loss legibility | ≥ 4 of 5 can explain in their own words **why** they lost | Confirms the player is modelling the systems, which is the core engagement |
| G4 | Synergy emergence | ≥ 1 tester spontaneously describes a card combination they discovered | Confirms US-3 (emergent interactions produce shareable moments) is real rather than intended |
| G5 | Builder attrition test | After the formal test ends, the owner voluntarily plays ≥ 3 more runs | The cheapest honesty check available against builder bias |

**NO-GO behaviour.** If any of G1–G5 fails, we do **not** build 150 cards. We hold scope at 40 and allow a maximum of **two** iteration cycles on the core loop. If G1 is still below **3 of 5** after two cycles, the project stops at a new owner decision — no automatic continuation, no content scale-up, no GUI, no itch build.

**Explicitly not gate criteria:** polish, art quality, content volume, performance, and any token metric. Those are engineering pass/fail (phase 3 mechanical items), not the fun gate. Conflating them is how a project talks itself past a kill gate.

### 7.2 R4 / R5 numeric targets — confirmed frozen

**≤ 250 tokens per `state` dump and ≤ 8 tokens per action line remain frozen as requirements.** The System Architect proposes the *measurement method*; the targets themselves are not renegotiated in phase 2.

Renegotiation is permitted **only** on evidence, and only through this route: the architect returns measurements from phase 3, the Tech Lead routes them to me, and I issue a PM revision. Until then the targets stand. Advisory guidance to the architect: do not design a state dump that is merely *under* 250 tokens by accident — design it to be *bounded and legible*, so the ceiling holds as content grows to 150 cards. R4's ≤250 target is a ceiling that must survive content scale-up, not a snapshot of the slice.

### 7.3 Slice scope — confirmed

**40 cards, one act including a boss, one character.** Confirmed as written in §3 of the plan. Rationale: the gate tests whether the *loop* is fun, and one act with a boss is the smallest artifact that can falsify that.

---

## 8. PM answers — Revision 3

The System Architect returned six ADRs and three feasibility flags that change *interpretation* rather than capability. Those are mine to rule on. All three are **accepted as the architect proposed**, with the reasoning recorded below.

### 8.1 R9 scope — payload tokens in-game, LLM totals from a dev tool

**Accepted.** The shipped game makes no network calls and holds no API keys, so it *cannot* observe an LLM session's input/output tokens. R9 is therefore split:

- **R9a (shipped, mandatory):** every run summary and every `sim` reports the game's own **payload tokens** (state dump, action list, observation stream). This is the number that is actually controlled by the interface design, which is what R9 was for.
- **R9b (dev-only, manual):** total LLM session tokens come from `tools/eval-llm.mjs`, run by a developer, never shipped.

**Rationale:** R9 exists to prove that *interface shape* controls cost — not to audit an API bill. [INFERRED] The 98.7% and 84% savings findings are both about what crosses the context boundary, which is exactly R9a. A network call for token accounting would violate the no-keys constraint for no decision-making benefit.

### 8.2 R10 provenance labelling — accepted, and it is not optional

**Accepted, and strengthened.** The architect is right that `sim` metrics measure **the heuristic policy, not humans**. Shipping an unlabelled "card win rate" would be a fabricated claim about player behaviour, which is the exact failure mode this team is supposed to avoid.

**Binding rule:** `stats` must label provenance on every number (`heuristic` / `llm` / `human`) and report per class separately. Unlabelled aggregates are a defect, not a style preference. Thresholds are set and read **per class**.

**Consequence for phase 7:** balance decisions are driven by `heuristic` data, and validated against `human` data only once real human runs exist (the kill gate and later playtests). [INFERRED] The two classes can disagree, and when they do, human data wins.

### 8.3 R1 interpretation — CLI plus a DOM-free GUI controller from phase 3

**Accepted.** "Two surfaces" is interpreted as:

- **Phase 3:** kernel + CLI + **DOM-free GUI controller** (the module the future renderer will drive). Both adapters are exercised by the golden-state test from day one.
- **Phase 6:** the browser renderer, on top of that controller. No new game logic.

**Rationale:** the R1 guarantee is only credible if the second adapter exists at the moment the first one does. Adding the GUI later and hoping it does not diverge is precisely the prior-art failure mode (mods bolted on, or reimplementations that drift). Starting with a controller that cannot render is cheap; a divergence discovered in phase 6 is not.

### 8.4 Additional acceptances

- **Determinism-tests move before the self-play harness** (Tech Lead's swap) — **approved**; sim output is meaningless until replay equality is proven.
- **The import-gate and golden-state test are built in phase 3**, not deferred — **approved**; they are the mechanism that makes R1 and R3 real rather than aspirational.
- **R4 measurement:** `js-tiktoken` (MIT, dev dependency only) with `o200k_base`, CI gate on the **worst of** `o200k_base` and `cl100k_base` across all golden dumps plus a synthetic worst-case 5-card hand. dev-dependency status keeps the runtime zero-dependency.
- **Provisional NFR:** `sim --runs 10000` completes in ≤10 minutes on the dev box with `--threads`. [INFERRED estimate] De-risked by a phase-3 spike. A native accelerator is **rejected** — a second engine would violate R1, and 1M-playout C++ throughput is not needed to answer "is this card overpowered".
- **Stack:** single ESM package, **zero runtime dependencies**, plain `.mjs` + JSDoc, `node:test`. Chosen for agent-authorability (no bundler, no build step, fewest failure modes) and because it makes R1 structurally cheap.

### 8.5 Token ceiling takes precedence over my own example — PM ruling

**The measurement gate caught the spec author's error.** The executor measured the action line from my own brief — `3 bash A8+V2 EN2` — at **9 tokens**, breaching the frozen **≤8** ceiling in both `o200k_base` and `cl100k_base`. Required shape `3 bash A8+V2` measures **7**. This is precisely why R9a is "measured, never asserted": an asserted ceiling would have shipped a violation.

**Ruling — the ceiling is the requirement; the example was illustrative.**

1. **≤8 tokens per action line stays frozen.** Do not move it. R5's purpose is to constrain the *action space* so an agent's choice is cheap and unambiguous (arXiv:2408.02442: constrain the action token space, do not constrain the state vocabulary).
2. **Cost is omitted from the action line.** Accepted as implemented: `p1 bash A8+V2`. Rationale: cost is decision-relevant information the agent **already holds** from the R4 state dump. Duplicating it on every action line spends tokens to repeat information already in context. Legality is still gated by cost inside the kernel.
3. **No information is lost.** The HAND section of R4 shows cost; the action line carries id + name + effect magnitude. An agent reads cost once from state and selects by ID.
4. **The brief's example is superseded.** Where this document's §3 example conflicts with the measured ceiling, the ceiling wins.

Rejected alternative: raising the ceiling to fit cost (~10 tokens/line). Rejected because it costs an agent ~25% more tokens per decision across every turn of every run, to convey information already in context. If a future need for cost-on-action-line is demonstrated with evidence, it returns as a PM revision — not as a silent ceiling move.

### 8.6 Unchanged

R1–R10 capability set, the CLI capability set, the ≤250 / ≤8 token ceilings, the kill gate from §7.1, and the zero-cash rule. **Nothing was dropped by the architect.**

---

## 9. PM decisions — Revision 4

### 9.1 The boss was unwinnable; now it is tuned (FIXED, measured)

The bot data caught a game-breaking defect that no amount of unit testing would have surfaced:

| Boss HP | Bot win rate | Boss kill rate (of runs that reached it) | Boss HP left at player death |
|---|---|---|---|
| **240** (original) | 1.6% | 2.1% | **74% — it never died** |
| 170 | 3.0% | 4.0% | 64% |
| 140 | 5.3% | 7.1% | 58% |
| **110** (chosen) | **13.4%** | **17.9%** | 53% |

The arithmetic: the starting deck holds **38 total damage**, so a 240 HP boss was **6.3 full deck cycles of pure offence** for a 60-max-HP player with no card upgrades. It was borrowed from *Slay the Spire*, where 240 HP is survivable because the player has upgrades, relics and a ~25-card deck. **Boss HP lowered to 110.** Control: `boss reached` held at 74.7% across all four values, confirming only the boss fight changed.

### 9.2 The `smart` self-play policy is a documented NEGATIVE RESULT (stopped)

Three attempts, all measured at 2000 seeds against the same control:

| Policy | Win rate | Reaches boss | Boss kill rate |
|---|---|---|---|
| `greedy` (original, crude) | **22.1%** | 63.8% | 34.6% |
| `smart` (over-defensive) | 14.3% | 74.6% | 19.2% |
| `smart` (partial correction) | 10.4% | 68.5% | 15.3% |

**Decision: stop. `smart` stays in the tree but is not the default, and is documented as an experiment that measurably loses to the baseline.** The engineering effort was not wasted — it produced the R10 evidence that card values are sound, and the bug it fixed (`impervious` picked 0 times in 742 offers, because the reward scorer passed `incoming: 0` so every Block card scored exactly 0) was a real defect.

**The lesson to carry forward:** a heuristic that is *conceptually* better loses to a crude one when the crude one optimises the only thing that decides the fight — ending it. `greedy` races; `smart` builds a 44-block-point deck that survives longer and kills less, arriving at the boss with **less** HP (36.7 vs 39.1) despite twice the Block.

## 11. PM decisions — Revision 5: enemy targeting added

### 11.1 The gap

**Reported by the owner:** *"the player is not able to select to which enemy he want to attack when fighting multiples enemies. Is that a game style mechanism?"*

**It was not a style mechanism — it was an unspecified feature.** Investigation confirmed:

- **16 cards declare `target: "enemy"`** — they are designed to be aimed. Content also distinguishes `all` (4), `random_enemy` (1) and `self` (20), so the taxonomy already exists.
- `src/kernel/index.js` hardcoded `targetEnemyIndex: firstAlive(next)`, so every single-target card always hit the first living enemy.
- `actions()` emitted `{id: 'p<N>', kind: 'play', cardId, cost}` — **no target in the action space at all.**
- The word "target" appears nowhere in this document as a scoped decision. It was silently never specified.
- An executor status note had flagged it ("the action space has no target parameter… not expressible") and I failed to act on it. **PM error, recorded rather than explained away.**

**Why it matters:** 4 of 7 encounters are multi-enemy (`weak_3`, `strong_1`, `strong_2`, `strong_3`). Without targeting the player cannot finish off a nearly-dead enemy to prevent its damage, cannot prioritise a buffing Cultist, and has no meaningful choice in a multi-enemy fight.

### 11.2 The revision (frozen)

**R5 is amended: a single-target card action may carry an explicit enemy target.**

| | Before | After |
|---|---|---|
| Action id | `p<N>` | `p<N>` (unchanged when there is one enemy) |
| With a target | — | `p<N> <index>` where index is 1-based among **living** enemies |
| Measured cost | 5 tokens worst | **~7 tokens worst** — still under the frozen **8** ceiling |
| CLI | `dlb play p2` | `dlb play p2 1` (two positional args) |
| Browser | click card | click card, **then** click enemy |

**Deliberate design choices:**
1. **Two-step flow, not `p2@1`.** A single command is tidier, but a two-step flow is how a human naturally plays (pick the card, then pick the victim) and gives the UI a place to show what is being aimed at. This satisfies the non-negotiable in our own research: *constrain the action token space, do not constrain the state vocabulary.*
2. **Omitting the target stays legal.** With exactly one living enemy there is no choice to make, so `p<N>` remains valid and the bot's existing logs stay readable. This also keeps single-enemy fights one action shorter for agents.
3. **Index is 1-based and counts only living enemies**, matching the order the state dump already prints. It must not count corpses.
4. **`target: all` and `target: self` cards take no target.** Only the 16 `target: "enemy"` cards gain one.

**Targets that must update together:** `actions()` (emit targets), `playCard` (honour the chosen index, reject an illegal one via the R6 no-op path), the browser renderer (target-selection state + highlight), `bin/dlb` (second positional arg + `--help`), the agent play guide, and the `sim` policies.

### 11.3 Bot policy

**Both policies learn to target**, and the killing blow takes priority: if a card can kill an enemy outright, aim at the enemy it can kill, because a dead enemy deals no damage next turn. Otherwise aim at the highest-announced-damage threat. This is the one place targeting should measurably help the sim, and it gives us a clean before/after number.

**Acceptance:** the greedy-policy win rate is re-measured against the 22.1% baseline. A *higher* rate is expected; a lower one means the targeting heuristic is wrong, not that targeting was a mistake.

## 13. PM decisions — Revision 6: combat statuses no longer persist across fights

### 13.1 The defect (owner-reported, confirmed)

**Owner report:** *"The cards that gave you strength are too powerful because they accumulate to the entire game. if you get one of it after the first fights you can start staking it and each attack deal tons of dmg."* — reported with a victory screenshot showing **Strength 34** and 3 wins in 3 games.

**Root cause.** `startCombat()` reset the player's `block` and `energy` but carried `statuses` forward, while every enemy's statuses were (correctly) reset per spawn:

```js
player: { ...state.player, block: 0, energy: BASE_ENERGY }   // statuses carried over
```

So one early `Inflame` compounded for the whole run. Measured before the fix: Strength **4 at floor 3 → 6 at floor 5 → 8, 10, 12 by floor 7**, ending the run at 12 (and 34 for a human who plays it better).

**This contradicted the game's own documentation.** `describe.js` prints Strength as *"Lasts the whole fight. Added to every attack you play."* The card text was a lie. [FETCHED: the glossary line and the `startCombat` assignment, both read directly]

### 13.2 The fix

Combat-only statuses (Strength, Dexterity, Weak, Vulnerable, Metallicize) are now cleared in **two** places:

1. **`startCombat()`** — the player's statuses reset when a fight begins.
2. **`resolveVictory()`** — they clear the moment a fight is won, so nothing lingers on the reward or map screens.

**`beginTurn()` deliberately does NOT reset them** — a buff must survive the turns *within* one fight. Getting this wrong in either direction is a bug; a test pins both.

### 13.3 Balance impact (measured, 2000 runs, greedy policy)

| | Before | After |
|---|---|---|
| Win rate | 22.1% | **14.2%** |
| Reaches boss | 63.8% | 61.3% |
| Boss kill rate | 34.6% | **23.2%** |
| Peak Strength in a run with one early Inflame | unbounded (12–34) | **4** |

**The game is now materially harder and the 22.1% baseline is superseded.** [INFERRED] The prior figure was inflated by the same defect — a player who found an early Strength card effectively could not lose, which is consistent with the owner winning 3 of 3. **14.2% is the first honest machine baseline for this slice**, and it is a reasonable target to tune against rather than a number to restore.

### 13.4 What this says about the process

This is the **fifth** defect the owner found that the automated suite did not, and the third that was a *game rule* rather than plumbing. [INFERRED] A pattern worth acting on: the suite verifies mechanisms (determinism, token ceilings, replay equality, no divergence) but had no assertion about **what the game's own text promises**. Rules described in prose to the player need a test that reads that prose.

## 15. PM decisions — Revision 7: enemy debuffs did not expire, and balance is settled

### 15.1 Enemy debuffs never ticked down (owner-reported, confirmed)

**Owner report:** *"when i attack that number at vulnerable do not decrease and stays for all the fight."* Followed by a correct challenge to my own explanation: *"this is not only a glossary problem."*

The owner was right and my first answer was wrong. The number after Vulnerable/Weak is the **remaining duration**, and I claimed it ticks down. It did — **for the player only.** `endTurn` decayed `next.player`, and `enemyTurn` reset each enemy's *block* but never its *statuses*:

```
BEFORE:  Bash applies Vulnerable 2  ->  2, 2, 2, 2 ... for the whole fight
AFTER:   Bash applies Vulnerable 2  ->  2, 1, 0, 0 ... expires correctly
```

**Why this was more than a display bug:** because the number *is* the duration, a never-decaying debuff was strictly stronger than the card text implied, and **Shockwave's entire premise — a longer debuff — was meaningless**, since Vulnerable 1 and Vulnerable 3 both persisted forever. Enemy Weak had the same defect.

**Fix:** enemies decay at the **end of their own turn**, symmetric with the player decaying at the end of theirs, so the stacks displayed during the player's turn are the ones that will apply to their attacks.

### 15.2 Also fixed: the enemy status tooltip (owner's chosen option)

The owner chose **option 2** — surface the meaning where the player actually looks — over rewriting the glossary. The enemy status tooltips now state that the number is *turns remaining* and that the magnitude does not change with it.

### 15.3 Balance is SETTLED — do not tune further without owner input

**Owner verdict after both fixes:** *"looks good. Hard as fuck now, but seems like the game style."*

| | Baseline quoted earlier | Final, both fixes in |
|---|---|---|
| Bot win rate | 22.1% | **7.2%** |
| Reaches boss | 63.8% | **55.7%** |
| Boss kill rate | 34.6% | **13.0%** |

**Decision: difficulty is accepted as the game's style. No further tuning.** Treat **7.2% as a floor, not the true difficulty** — [INFERRED] the machine policies do not time debuff windows, so a human who exploits a 3-turn Vulnerable will do considerably better. `Inflame` (2 Strength, one fight only) is the most likely candidate to be underpowered and is parked here as a known watch item rather than a change.

### 15.4 Process note: the win-rate figure was revised three times

22.1% → 14.2% → 7.2% as successive rule bugs surfaced. **The lesson: that number should have been labelled unverified from the start**, because the suite measuring it was blind to the rules it depended on. Each of the owner's reports moved it. Automated metrics are only as trustworthy as the rules they assume.

## 17. PM decisions — Revision 8: the token badge is removed from the shipped build

### 17.1 The decision

The on-screen token badge — a R9a feature whose purpose was to let a player SEE the agent-facing cost claim — **read "tokens n/a" in every real browser session**. It never once displayed a number.

**Cause:** exact measurement needs `js-tiktoken`, and the encoder ranks are **~11 MB of JS** against a **306 KiB** game. The badge therefore degraded by design rather than fabricating a count (correct behaviour, useless feature).

The owner chose to **remove the badge from the shipped build**. Rationale: (a) an exact count needs a 36× payload increase for one number, which is a bad trade for a free demo; (b) the claim is already verifiable where it is actually measured — `tests/budget.test.js` enforces the ceilings on every run and `dlb sim` reports them.

### 17.2 Rejected alternative, and why it was rejected

**A precomputed lookup table** was considered and **rejected on evidence, not taste.** The hypothesis was that the count of a line equals the sum of the counts of its whitespace-separated parts. Measured against the real encoders:

| line | whole | sum of parts |
|---|---|---|
| `T1 \| HP 60/60 \| EN 3/3 \| BLK 0 \| draw5 disc0` | 24 | 33 |
| ` 1 Strike       A6` | 6 | 7 |
| ` Jaw Worm  HP 40/40  A7 B5` | 13 | 18 |

**They do not match**, so the table would have produced a confidently wrong number on screen. Recording this because "close enough" here would have been a fabricated metric in a project whose whole discipline is that numbers carry evidence.

### 17.3 What is removed, and what stays

Removed: the badge element, its CSS, its lazy `import()` of the measurement path, and the per-paint measurement timer in the browser surface.

**Kept, unchanged:** `src/surface/tokens.js` (the dev-only measurement), the frozen R9a ceilings, `tests/budget.test.js`, and `dlb sim`'s payload-token reporting. **R9a is not weakened** — the measurement still exists and is still enforced; it is simply no longer surfaced in a UI that could not honestly display it.

## 18. Handoff note

Delivered to **Tech Lead** for routing: **System Architect** owns engine boundaries, card/save data model, the concrete CLI schema, and the determinism strategy. Findings from the Architect route back to me only if they change capability (the R1–R10 set) rather than implementation. I remain the reference for "is this in scope?" until release.

**Kill gate to respect:** if the loop is not fun at 40 cards, we do not build 150.

*(Dated correction 2026-10-16: the shipped slice contains **42** card definitions, not 40 — see the
reconciliation note at the top of this file. "40" here is the planning target and the gate is
unchanged in intent.)*
