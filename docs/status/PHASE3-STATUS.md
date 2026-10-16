# PHASE 3 STATUS — agent-playable deckbuilder

Updated as each numbered item completes. Raw evidence pasted inline.

## TASK 1 — unverified kernel fix — VERIFIED

### Command (exact)
`node bin/dlb sim --runs 60 --seed-start 1 --policy greedy --threads 4 --out ./sim-out`

### Raw output
```
sim 60 runs | policy greedy | threads 4 | seeds 1..60
win 2 (3.3%) loss 58 (96.7%) unfinished 0
steps total 4686 mean 78.1 | floors max 7 mean 6.07
malformed 0/4686 (0.0%)
elapsed 630ms | 95.2 runs/sec
payload tokens: dump worst 116/250 PASS | action line worst 5/8 PASS (307 lines measured)
payloadTokens: worst 116 tokens (o200k 115, cl100k 116)
actionLine: worst 5 tokens (o200k 5, cl100k 4)
EXIT=0
```
`unfinished 0` — the seed-60 stall is gone.

### Command (larger sweep)
`node bin/dlb sim --runs 500 --seed-start 1 --policy greedy --threads 4`

### Raw output
```
sim 500 runs | policy greedy | threads 4 | seeds 1..500
win 10 (2.0%) loss 490 (98.0%) unfinished 0
steps total 35980 mean 72.0 | floors max 7 mean 5.52
malformed 0/35980 (0.0%)
elapsed 800ms | 625.0 runs/sec
payload tokens: dump worst 116/250 PASS | action line worst 5/8 PASS (307 lines measured)
payloadTokens: worst 116 tokens (o200k 115, cl100k 116)
actionLine: worst 5 tokens (o200k 5, cl100k 4)
EXIT=0
```
500 runs, 0 unfinished — no run hit the step cap. **Fix VERIFIED.** Win rate 3.3% → 2.0% is the known balance finding, out of scope.

## Two ADDITIONAL kernel defects found while probing card behaviour (both fixed)

Test construction probed all 42 cards through `step()`. Two real defects unrelated to
Task 1 surfaced, both of which the tests now lock down:

1. **Card filed twice in the exhaust pile.** `src/kernel/index.js` — the `exhaust`
   *verb* pushed the card, then the post-play block pushed it again, so `pummel` /
   `impervious` produced `exhaust.length === 2` and `Pummel, Pummel` in the verbose dump
   (the brief's own `--verbose` fixture shows `exhaust: -`). Fixed: the second push is
   guarded by `!alreadyExhausted`. Observed 2 → 1, and the discard branch stays correct.
2. **`rampage` never grew.** `src/kernel/rules/effects/index.js` — the handler scanned
   hand/draw/discard/exhaust, but a played card has already left the hand, so the growth
   branch never ran: `perPlay` stayed 0 and the "permanently gains +5" card was a plain
   8-damage attack. Fixed by including `state.deck` (the run's canonical instance list)
   in the presence check. Observed `perPlay` [0] → [5].

Both are minimal, one-line changes at the site of the mistake; no behaviour outside the
bug is touched.

Also found (NOT yet fixed — see Task 3, evidence item 7): `node --test tests/` in the
`npm test` script exits 1 on Node 24 because a trailing-slash path is treated as a glob
matching the directory itself. `node --test 'tests/**/*.test.js'` works.

## TASK 2 — test suite — IN PROGRESS

All suites below were run immediately after being written; output pasted where it matters.

| file | tests | result |
|---|---|---|
| `tests/cards/cards.test.js` | 20 | pass (42 card ids incl. all 11 exotic handlers) |
| `tests/kernel/kernel.test.js` | 9 | pass |
| `tests/budget.test.js` | 4 | pass |
| `tests/replay.test.js` | 7 | pass |

Shared fixtures in `tests/helpers/harness.mjs` (absolute-URL loaders so CWD never matters).
Per-card rows are OBSERVED outputs of the pinned fixture, not hand-derived numbers.
Example (`node --test 'tests/cards/**/*.test.js'`): `pass 20 / fail 0`.
