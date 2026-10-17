# HISTORY-CORE-BE-STATUS

Task: finish the run-record / history core (DR-1..DR-7), wire it in, remove DEF-1, add the tests.
Predecessor created `src/kernel/record.js` + `src/kernel/unlocks.js` and died before any wiring.
**This file is re-written from scratch at each milestone. Read it first if work is resumed.**

## Status: IN PROGRESS — recon done, implementation starting

## Baseline (re-verified by me, not inherited)
- `npm test` → **93 pass / 0 fail** (`duration_ms 1715`).
- `npm run gate` → `check-architecture: scanned 28 files under src/` + `OK — no R1/R3 violations`, exit 0.
- Legacy `sim-out/runs.jsonl` → **150 lines**. `stats --from sim-out` works.
- **NEW FINDING (the big one):** `src/kernel/record.js` and `src/kernel/unlocks.js` are imported by
  **NOTHING**. `grep -rn "buildRunRecord\|kernel/record" src bin tests` → only the two files themselves.
  So the predecessor wrote two working modules and wired neither: no record goes through them, no pool
  flag exists, no test touches them. The whole job really is the wiring.
- `state.draftPool` (set in `newRun`, consumed by `beginCombat`→`rollReward`→`pickAt`) is the real seam
  for DR-5's `--pool full`: rewards are drawn from `state.draftPool`, so a pool flag must change it.
- `stats.js` already derives `bossArrival`-based metrics from records — untouched, must keep working.
- No git repo. Deliberate-failure demos are reverted manually; every mutated file is backed up first.

## Completed items
1. [x] Recon or re-verified every load-bearing fact (baseline, legacy file, gate rules, kernel events,
       session/cli/sim/stats shape, harness, controller, `parsePlayId`, `draftPool` seam).

## Remaining items (my whole job, in order)
2. [ ] `src/surface/runs.js` — repository: load (backward-readable) / append / prune-to-100 with the
       dropped runs folded into a cumulative `agg` **before** they leave the file.
3. [ ] Re-export `record.js` + `unlocks.js` symbols through `src/kernel/index.js` (package.json frozen —
       do NOT add entries there).
4. [ ] `src/surface/sim.js` — build the record with `buildRunRecord(...)`; keep worker/disk concerns.
5. [ ] `src/surface/session.js` — accumulate the kernel `events` array (DR-6). Without it every new
       record scores zero kills.
6. [ ] `src/surface/cli.js` — `sim --pool full|fresh`; every flagged run records `profile`.
7. [ ] DEF-1 — derive the card count in `tests/cards/cards.test.js:123` and `tests/budget.test.js:49`.
8. [ ] Tests — determinism (AC-7.2), AC-9.3 both layers, AC-6.5 extension, backward compat, retention.
9. [ ] Deliberate-failure demos: DR-2 (gate catches a `node:*` in the kernel), DEF-1 (drift test fires).
10. [ ] Final `npm test` + `npm run gate`, then the required report.

## Scope guard
Allowed: `src/kernel/**`, `src/surface/**`, `tests/**`. Forbidden: `src/web/**`, `scripts/dev/**`, `*.md`
(other than this status file), `scripts/check-architecture.mjs`, `release/`, `release.zip`.
