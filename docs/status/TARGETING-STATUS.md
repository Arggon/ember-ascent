# TARGETING-STATUS.md — enemy targeting (PM Document revision 5)

Live checkpoint. Updated after each task. No claim without pasted output.

## Capability probe (verified)

```
node --version                  -> v24.20.0
printf > .cap-probe.txt; cat    -> capability probe
node -e "console.log(4)"        -> 4
```
Permissions `[rw,web,exec]` confirmed working: writes land, commands run.

## Baseline (verified, before any change)

```
$ node --test 'tests/**/*.test.js'
ℹ tests 75   ℹ pass 75   ℹ fail 0   ℹ duration_ms 1415.78
```
Green starting point: 75 tests, 0 failures.

## Load-bearing finding #1 — the literal wire form fits, the literal action LINE does not

The frozen change asks for `p2 1` on the wire and claims ≤ 8 tokens. Measured with the
repo's own `countWorst` (worst of o200k_base / cl100k_base), over the full 42-card census:

```
  5 PASS "dlb play p1"                  wire form, BEFORE  (matches "5 tokens worst")
  7 PASS "dlb play p2 1"                wire form, AFTER   (<= 8)  <-- contract holds
  4 PASS "p2 1"                         action id alone     (<= 8)  <-- contract holds
  9 FAIL "p2 1 sword_boomerang"         action id + card id breaches the frozen ceiling
```
Evidence: `scripts/dev/measure-action-shapes.mjs`. Every possible separator was tried
(`''`, `' '`, `'_'`, `'-'`, `'.'`, `':'`, `'/'`, `'#'`, `'@'`, ... 31 candidates): only the
empty separator keeps the line inside the ceiling, and the empty separator is
indistinguishable from the hand `p10` form, so it is unsafe.

Consequence: `observeActions` renders the multi-enemy line as **`p<N> <k>`**, exactly as the
frozen spec literally prints it, and omits the trailing card id *only in that case*. The
card is not hidden: the HAND dump already prints `<slot> <name> <summary>` for the same slot.
This is what keeps the action line bounded by construction as content grows.

## Status

| Task | State |
|---|---|
| 0. Capability probe | done, verified |
| 1. Engine (actions/index/observe/bin) | in progress |
| 2. Both policies | not started |
| 3. Tests | not started |
| 4. Bot measurement (2000 runs, greedy) | not started |

## Constraints being honoured

- No card numbers / effects / enemy or boss stats touched. Boss HP 110 untouched.
- `src/web/` untouched (`grep` over `src/web/` for action ids / targeting: no matches).
- `src/kernel/rules/effects.js` untouched (re-export shim).
- Ceilings 250 (dump) / 8 (action line) frozen; `tests/budget.test.js` must stay green.
- Zero runtime deps, offline, $0.
