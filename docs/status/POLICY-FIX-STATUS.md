# POLICY-FIX-STATUS.md — make `smart` beat `greedy`, fix stats denominator

Checkpoint file. Read this first. Updated after every task.

**Goal:** `--policy smart` must beat `greedy`'s 22.1% win rate at
`--runs 2000 --seed-start 1`. Also fix the hardcoded `/240` boss-HP denominator
in `src/surface/stats.js`.

**Scope:** `src/surface/policies.js`, `src/surface/stats.js`, tests only.
Greedy must stay byte-identical. No card/enemy/boss numbers change.

---

## Ledger

| Task | Status | Evidence |
|---|---|---|
| T1 policy: value throughput, capped block, powers | in progress | — |
| T2 stats.js `/240` -> real max HP | not started | hardcoded at stats.js boss line |
| T3 evidence (7 sub-items) | not started | — |
| T4 tests (impervious > strike; damage > block at full HP) | not started | — |

## Facts established (not re-derived)

- Boss HP is 110 (`src/kernel/rules/encounters.js`), goldens regenerated.
- Baseline: greedy win 441/2000 (22.1%), boss reached 1276 (63.8%), kill@boss 34.6%.
- smart: win 286/2000 (14.3%), boss reached 1491 (74.6%), kill@boss 19.2%.
- smart over-corrected: block points 44.1 vs 20.6, powers 0.3 vs 0.8, atk 9.3 vs 9.9.
- smart arrives with LESS HP (36.7 vs 39.1) despite double Block => kills too slowly.

## Next step

Read `src/surface/policies.js` reward + action scorer; identify the Block-only bias.
