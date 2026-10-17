# POLICY-STATUS.md — deckbuilder self-play policy replacement

**Goal:** make the balance data meaningful by replacing a policy that is demonstrably
blind to Block and to synergy. Measurement infrastructure only — no card, enemy or boss
numbers change.

**Checkpoint discipline:** this file is updated after every task. Read it first; it says
what is verified, what is not, and the exact next step.

---

## 1. Investigated — the measured failure, and its mechanism (TASK 0)

Reported input (2000 runs, `--policy greedy`):

```
sim 2000 runs | policy greedy | win 33 (1.7%) loss 1967
floors max 7 mean 5.59
floor distribution f1:82 f2:150 f3:263 f4:100 f5:100 f6:29 f7:1276
card                     offered picked pickRate inWins
bludgeon                    673    673    1.000  0.242
uppercut                    782    708    0.905  0.727
impervious                  742      0    0.000  0.000
ghostly_armor               688      4    0.006  0.000
armaments                   686      2    0.003  0.000
flame_barrier               686      1    0.001  0.000
true_grit                   720      1    0.001  0.000
limit_break                 741      1    0.001  0.000
reaper                      717     58    0.081  0.000
```

### Mechanism found by reading the source (VERIFIED by reading, not yet by running)

Two independent defects in `src/surface/policies.js`, both in the *reward* path:

1. **`rewardWorth()` passes `incoming: 0`.**
   `scoreCard()` credits Block as `effectiveBlock = min(block, need)` where
   `need = max(0, incoming - player.block)`. At reward time `incoming` is 0, so `need` is 0,
   so **every Block card scores exactly 0** regardless of size. `impervious` (30 Block),
   `ghostly_armor` (10), `flame_barrier` (12), `armaments` (5), `true_grit` (7) are all
   worth zero, and the reward branch then takes the highest-scoring card, i.e. the biggest
   attack. `bludgeon` 1.000 is the direct consequence.
   The `need >= hp` "survival" bonus is also unreachable with `incoming: 0`.
2. **`rewardWorth()` is blind to the deck.** It scores a card against a fake player/enemy,
   so it cannot know the deck is short on defence or long on 3-cost attacks.
   `inWins` (presence in winning decks) is never used by any decision either.

The 2.6% boss kill rate (33 of 1276 runs that reached floor 7) is therefore a statement
about the bot. Per the brief: the policy is fixed first, the game is judged after.

### Second defect, in the reporting layer (VERIFIED by reading)

`src/surface/stats.js` computes `pickRate = offered > 0 ? picked / offered : 0` — for a
card that is **never offered** (the starting deck: `strike`, `defend`, `bash`) that
reports `0.000`, which reads as "picked 0% of the time" when the truth is "not applicable".
`presenceInWins = inWin / wins.length` uses a *wins* denominator, so a starter card present
in every winning deck reports `1.000` and carries no information. The brief's ask — 0 offers
must report `n/a`, not a ratio — is a reporting fix, not a policy fix.

---

## 2. Task ledger

| Task | Status | Evidence |
|---|---|---|
| T0 read the failure mechanism | **done** | above (source reading) |
| T1 `--policy smart` in `src/surface/policies.js` | in progress | — |
| T2 sim/stats reporting + `n/a` denominator fix | not started | — |
| T3 2000-run diagnosis of `smart` | not started | — |
| T4 tests | not started | — |

---

## 3. Verified so far

- `node bin/dlb sim --runs 30 --seed-start 1 --policy greedy --threads 4` runs clean and
  reproduces the reported shape:
  ```
  sim 30 runs | policy greedy | threads 4 | seeds 1..30
  win 0 (0.0%) loss 30 (100.0%) unfinished 0
  steps total 2479 mean 82.6 | floors max 7 mean 6.53
  malformed 0/2479 (0.0%)
  payload tokens: dump worst 116/250 PASS | action line worst 5/8 PASS (307 lines measured)
  ```
- Architecture gate (`scripts/check-architecture.mjs`) forbids `src/surface/**` from
  importing `src/kernel/rules/**`. Consequence for T1: the policy may not read `ENEMIES`
  or the custom-effect handler implementations; it may read effect data from
  `loadContent()` (as `greedy` already does) and the hostile-intent numbers from the
  rendered observation, which the harness already carries in `memory.incoming`.
- The action space has **no target parameter**: `src/kernel/index.js` always aims a
  single-target card at the first living enemy (`ctx.targetEnemyIndex = firstAlive()`).
  Brief requirement 6 ("hit the enemy that is most dangerous") is therefore **not
  expressible** as an action; the policy can only choose which card to play. This is
  reported as a finding, not worked around.

## 4. Not verified / open

- Nothing in T1–T4 is implemented at the time of this checkpoint.
- The 2000-run measurement has not been re-run in this session (only a 30-run smoke).

## 5. Next step

Implement `smartPolicy()` in `src/surface/policies.js` (pure scoring function + action
selection loop), leaving `greedy` byte-identical because `tests/golden/logs.jsonl` is
generated from it.
