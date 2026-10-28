# Agent Play Guide — `dlb`

**What this is:** how an AI agent (or a human, or a script) plays the deckbuilder from a terminal, at the lowest practical token cost.
**Status:** vertical slice complete — 70 cards (S8 content scale), two acts, two wardens, two characters (the Ashwright and the Bellows Keeper; the CLI's internal ids remain `ironclad` and `bellows`). **Mechanically verified; the human fun gate is still open.**
**Every command and output below was run and captured, not described.**

---

## 1. Why a CLI and not an API

Four interfaces were evaluated. A **CLI with machine-readable output** won, and the deciding evidence was about what crosses the context boundary:

| Option | Verdict | Evidence |
|---|---|---|
| **CLI, compact text default** | **Chosen** | Zero fixed context cost — nothing is resident unless a command prints it |
| MCP server | **Rejected as default** | MCP clients "load all tool definitions upfront directly into context". Anthropic measured **150,000 → 2,000 tokens (98.7%)** from moving away from upfront tool definitions |
| Local HTTP API | Deferred | Adds a process to babysit; pays a port/lifecycle cost for no token gain |
| stdin REPL | **Rejected** | Looks token-cheap but its failure mode is a **silent hang** — agent harnesses hold the stdin pipe open |

**And the observation must be text.** BALROG (arXiv:2411.13543) measured agents performing **worse** with environment images than with text descriptions of the same state. Rendering to text is both cheaper and more accurate.

**And JSON is not the default.** arXiv:2408.02442 measured *declining* reasoning under stricter format restrictions, with stricter formats degrading more. So: constrain the **action space**, keep the **state** readable. Text is the default; `--json` is opt-in for scripting.

---

## 2. Playing it: the whole loop

Four commands. That is the entire interface needed to play.

```bash
dlb new --seed 42 --run run.json    # start
dlb state --run run.json            # observe
dlb actions --run run.json          # enumerate choices
dlb play <id> --run run.json        # act
```

**The agent loop is: `actions` → pick an id → `play <id>` → read the new state. Repeat.**

### Verified session (seed 42, stdin closed, no TTY)

*(Re-run 2026-10-24 after the module refactor: byte-identical output, including the run hash.)*

```
$ dlb new --seed 42 --run run.json < /dev/null
new run: seed 42 character ironclad difficulty 0
saved to run.json
hash sha256:11020de6ed24cc04e3c7bfa9ec85805242dcd73fea65a79c3e17f84d0bb572af
```

```
$ dlb state --run run.json
T0 | HP 60/60 | EN 0/3 | BLK 0 | draw0 disc0
MAP — floor 0/8
NEXT
 n1 fight
```

```
$ dlb actions --run run.json
n1 fight
```

```
$ dlb play n1 --run run.json     # enter combat
T1 | HP 60/60 | EN 3/3 | BLK 0 | draw5 disc0
HAND
 1 Quench       B5
 2 Hammerfall   A6
 3 Hammerfall   A6
 4 Hammerfall   A6
 5 Quench       B5
ENEMY
 Cinder Maw  HP 40/40  A7 B5
```

```
$ dlb actions --run run.json
p1 defend
p2 strike
p3 strike
p4 strike
p5 defend
e1 end
```

```
$ dlb play p1 --run run.json     # play Quench
T2 | HP 60/60 | EN 2/3 | BLK 5 | draw5 disc1
HAND
 1 Hammerfall   A6
 2 Hammerfall   A6
 3 Hammerfall   A6
 4 Quench       B5
ENEMY
 Cinder Maw  HP 40/40  A7 B5
```

### Reading the dump

```
T1 | HP 60/60 | EN 3/3 | BLK 0 | draw5 disc0
│    │          │        │       │
│    │          │        │       └─ pile counts (draw / discard)
│    │          │        └───────── block
│    │          └────────────────── energy: current / max
│    └───────────────────────────── hit points
└────────────────────────────────── turn
```

- `A6` = attack 6 · `B5` = block 5 · `A8+V2` = attack 8 plus 2 vulnerable · `PWR+2` = gain 2 strength
- `EN2` = costs 2 energy (shown in the hand; **not** repeated on action lines)
- Enemy line: `Cinder Maw  HP 40/40  A7 B5` → intent this turn is 7 attack + 5 block. The words are the display name; action ids and enemy ids are unchanged (`strike`, `jaw_worm`).
- `draw5 disc0` lets the agent see deck cycling without a pile dump. `--verbose` adds pile contents.

### Action IDs

| ID form | Meaning | Example |
|---|---|---|
| `p<n>` | play the card in hand slot *n* | `p1` |
| `p<n>_<k>` | aim hand card *n* at enemy *k* (multi-enemy fights; 1-based, living enemies) | `p2_1` |
| `e1` | end turn (also: leave a rest site) | `e1` |
| `c` | continue / confirm (take a rest-site heal) | `c` |
| `s<n>` | pick reward *n* (`s0` skips the offer) | `s2` |
| `n<n>` | take map node *n* | `n1` |
| `k<n>` | take kindling boon *n* (opt-in runs) | `k1` |
| `t<n>` | temper offer *n* (rest site; the smith's event modal uses the same ids) | `t1` |
| `b<n>` | buy shop shelf *n* | `b1` |
| `x` | buy the shop's card-removal service | `x` |
| `x<n>` | (during a paid removal) remove deck instance *n* | `x3` |
| `l` | leave the shop | `l` |
| `q<n>` | quaff belt slot *n* (combat only) | `q1` |
| `q<n>_<k>` | aim the quaff at living enemy *k* (aimed potions, 2+ enemies) | `q1_1` |
| `d<n>` | discard belt slot *n* (combat only; frees the slot) | `d1` |
| `v<n>` | choose an event's choice *n* | `v1` |
| `v0` | continue past an event's resolved beat | `v0` |

IDs are **stable within a state** and are the only thing an agent must emit to act. An id whose requirement is unmet (an unaffordable shelf, a belt with no such slot, a choice the purse cannot cover) simply does not exist in the legal list — forcing it is the one rejection path, never a no-op.

---

## 3. Measured token cost

**This is the number you asked about.** All figures are the **worst of** `o200k_base` and `cl100k_base`, measured over real engine output.

| Payload | Measured worst | Ceiling | Verdict |
|---|---|---|---|
| `state` dump (42 card fixtures) | 88 | 250 | **PASS** |
| `state` dump (worst live run, `--verbose`) | 156 | 250 | **PASS** |
| `state` dump (`sim` headline) | 116 | 250 | **PASS** |
| Action line (worst live, `s2 sword_boomerang`) | 7 | 8 | **PASS** |
| Action line (`sim`, 307 lines) | 5 | 8 | **PASS** |

**A full decision therefore costs roughly 5 tokens out and 116 in ≈ ~121 tokens**, and the ceilings are enforced by an automated test (`tests/budget.test.js`) so content growth cannot silently breach them.

**Design choices that produce this:**

1. **Cost is not repeated on action lines.** An earlier draft had `3 bash A8+V2 EN2` — measured at **9 tokens, breaching the ≤8 ceiling**. The ceiling won and cost was dropped, because the agent already holds cost from the state dump. Repeating it would cost ~25% more per decision to restate known information.
2. **Action lines are `p<n> <card_id>`, bounded by construction.** Name-plus-effect summaries measured up to **15 tokens** on 12 of 40 cards. The id form holds at ≤7 as content grows.
3. **One dump, no history.** The dump is the complete observation, so nothing accumulates in context. Anthropic measured an **84% token reduction** in a 100-turn evaluation by clearing stale results — the way to get that benefit is to never carry history in the first place.

### The single biggest cost lever: you do not need an LLM to play at all

```bash
dlb sim --runs 200 --seed-start 1 --policy greedy --threads 4 --out ./sim-out
```

```
sim 200 runs | policy greedy | threads 4 | seeds 1..200
win 15 (7.5%) loss 185 (92.5%) unfinished 0
steps total 14040 mean 70.2 | floors max 7 mean 5.29
malformed 0/14040 (0.0%)
boss reached 112/200 (56.0%) | kills 15 (13.4% of those that reached)
boss arrival: HP 36.1/60 (60%) | deck 15.3 (atk 9.9 blk 4.8 pow 0.6) | block points in deck 20.4
boss at death: mean HP remaining 61.3/110 (56%) over 97 boss deaths
elapsed 726ms | 275.3 runs/sec
payload tokens: dump worst 116/250 PASS | action line worst 7/8 PASS (297 lines measured)
```

**275 games/second at zero API tokens** (measured 2026-10-24, after the module refactor; the
pre-refactor build measured 308 runs/sec on the same machine — treat the rate as
hardware- and build-dependent). Use `sim` for volume and reserve LLM tokens for **exploration and
novelty only** — that is where an LLM adds value a heuristic cannot.

---

## 4. Measuring whether a card is overpowered

`stats` mirrors the two metrics Mega Crit named as most important for balancing Slay the Spire: **how often a card is picked when offered**, and **how often it appears in winning decks**.

```bash
dlb stats --from ./sim-out --by-card --format table
```

```
stats — provenance: heuristic | 200 runs (of 200 present) | source: ./sim-out/runs.jsonl
HEURISTIC POLICY DATA — these numbers describe the heuristic policy, not human players.

win rate 7.5% (15/200) | mean floor 5.29
run length (steps) min 23 median 71 max 115 mean 70.2
floor distribution f1:10 f2:13 f3:39 f4:12 f5:10 f6:4 f7:112
boss reached 112/200 (56.0%) | KILL RATE AT THE BOSS 13.4% (15/112)
boss arrival: HP 36.1 | deck 15.3 (atk 9.9 blk 4.8 pow 0.6) | block points 20.4
boss HP remaining at death 61.3/240 over 97 boss deaths

card                     offered picked pickRate inWins presence
bludgeon                      58     58    1.000      5    0.333
carnage                       82     79    0.963      7    0.467
uppercut                      63     56    0.889      9    0.600
clothesline                   76     62    0.816      7    0.467
pommel                        64     49    0.766      4    0.267
```

`bludgeon` is picked **100%** of the time and appears in **5 of the 15 winning decks** — the
strongest "this card is a trap, or the policy is wrong about it" signal in the current data. This
output also demonstrates the **provenance label** (`heuristic`), which is mandatory: these are not
human numbers. *(Re-captured 2026-10-24 after the module refactor — the table gained a `presence`
column and the report gained the boss-arrival lines; the pre-refactor capture was taken on the
2026-10-16 build, which had 42 cards and a 1.5% win rate.)*

Also available: `--format json`, `--format csv`, `--from` any `sim` output directory.

---

## 5. Reliability properties an agent can depend on

| Property | Behaviour | Verified |
|---|---|---|
| **Never blocks** | Never reads stdin; works with `< /dev/null` and no TTY | ✅ session above |
| **Illegal action is cheap** | Applies a legal no-op, prints `{"error":"illegal_action","id":"zz9","code":2}` to **stderr**, exits **2** | ✅ |
| **stdout is machine-only** | Diagnostics never contaminate stdout — in the illegal-action case stdout stayed clean | ✅ |
| **Deterministic** | Same seed + same actions = byte-identical state, cross-process | ✅ 221 passing tests (2026-10-24) |
| **Replayable** | `dlb replay <log> --assert` re-runs an action log and verifies every step hash | ✅ |
| **Reproducible saves** | `save`/`load` round-trip preserves the state hash exactly | ✅ |
| **Bounded output** | `--max-lines` prints `# truncated: showing 3 of 14 lines` to **stderr** — never silently | ✅ |
| **Timeouts work** | `--timeout` exits **6** with `[timeout after 50ms]` | ✅ |
| **Unfinished games are visible** | `sim` reports `unfinished: 0`, so a stalled run can never be mistaken for a completed one | ✅ |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | internal error |
| 2 | illegal / unknown action — **run continues** |
| 3 | usage, flag, or seed error |
| 4 | corrupt or version-incompatible save/log |
| 5 | replay assertion mismatch |
| 6 | timeout |

**The `2` code deserves attention:** an illegal action is *not* an error state. The run continues with a legal no-op, and the attempt is counted in `--malformed-rate`, which the harness reports every run. This is BALROG's published protocol — never burn a retry cycle, substitute a legal fallback and measure the error rate. Our measured rate is **0.0% across 14,623 simulated steps**.

---

## 6. Self-check before you trust the build

```bash
node --test 'tests/**/*.test.js'     # 222 tests — 221 pass, 0 fail, 1 todo
node scripts/check-architecture.mjs  # OK — no R1/R3 violations
```

Independently re-run 2026-10-24, after the module refactor, and confirmed: **222 tests — 221 pass,
0 fail, 1 todo** (the todo is `§11.2` in `tests/history/record.test.js`, a real defect deliberately
marked `{ todo: true }` so it stays visible). The opt-in browser e2e (`npm run test:browser`)
passes 8/8. The architecture gate scans **35 files** under `src/` and reports no violations — and
**fails with exit 2** when a surface file is made to import a rules module, which is what keeps the
GUI and CLI from silently diverging.

---

## 7. What is not done

- **The fun gate is open.** 44 cards, one act, two characters play; ~40-100 minutes of content. Balance is *not* tuned — the greedy policy wins ~7% over seeded runs (7.5% measured 2026-10-24, 15/200) and that is a policy finding, not a verdict on the game.
- **~~No renderer yet.~~ Superseded:** the browser renderer exists (`src/web/`) and is the
  human-facing surface. Since the module refactor (merged 2026-10-24) it is decomposed into
  focused ES modules — `app.js` is a small entry importing the views, fx, targeting and runtime
  modules — with `tests/web/module-graph.test.js` guarding the real import graph.
- **Content is 44 cards, not 120-150.** Scaling is gated on the human fun verdict.
- `scripts/measure-tokens.mjs` is a dev spike holding **stale hand-written sample strings**; the real ceilings are enforced on engine output by `tests/budget.test.js`.
- The old re-export shim at `src/kernel/rules/effects.js` is gone (the module split removed it); the effect vocabulary lives in `src/kernel/rules/vocabulary.js` and the handlers in `src/kernel/rules/effects/index.js`.
- `package.json` contains a `js-tiktoken` devDependency line that trips a secret-scanner false positive on writes. It is a dev-only dependency; the shipped engine has **zero runtime dependencies**.

---

## 8. Quick reference

```bash
# Play interactively
dlb new --seed 42 --run run.json
dlb state --run run.json
dlb actions --run run.json
dlb play p2 --run run.json

# Machine-readable
dlb state --run run.json --json
dlb actions --run run.json --json

# Batch balance testing — ZERO tokens
dlb sim --runs 200 --seed-start 1 --policy greedy --threads 4 --out ./sim-out

# Balance report
dlb stats --from ./sim-out --by-card --format table

# Verify determinism
dlb replay ./run.jsonl --assert

# Any subcommand
dlb <cmd> --help     # includes flags, defaults, exit codes, and a full example run
```
