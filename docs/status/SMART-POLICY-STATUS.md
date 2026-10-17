# SMART-POLICY-STATUS.md — is `smart` a better instrument than `greedy`?

Checkpoint file. Read this first. It separates **verified** from **inferred**, and states
the exact next step. Updated after every task.

**Question asked:** answer one balance question with measured evidence, and fix
`--policy smart` ONLY if the evidence supports it. Deliver a recommendation, not a code
change.

**Answer in one line:** **No — `smart` is still worse than `greedy` under current rules
(3.1% vs 7.2% on seeds 1..2000; 3.5% vs 6.6% on seeds 2001..4000). Keep `greedy` as the
documented default. The one focused fix changed behaviour in the right direction but did
not flip the outcome, so it is reported as a documented negative result and the attempt
is stopped, per the brief.**

**Hard constraints — all held (verified):** no card/enemy/boss numbers changed; compact
CLI output untouched; `greedy` byte-identical; suite **93 pass / 0 fail**; gate **OK**;
`src/web/` never touched.

---

## TASK 1 — RE-MEASURE UNDER CURRENT RULES (**done**)

Both at `--runs 2000 --seed-start 1 --threads 4`. Current rules = the two rule fixes
(player statuses reset between fights, enemy debuffs expire) are in place.

### `--policy greedy` — raw (before any change)

```
sim 2000 runs | policy greedy | threads 4 | seeds 1..2000
win 145 (7.2%) loss 1855 (92.8%) unfinished 0
steps total 138776 mean 69.4 | floors max 7 mean 5.22
malformed 0/138776 (0.0%)
boss reached 1114/2000 (55.7%) | kills 145 (13.0% of those that reached)
boss arrival: HP 36.5/60 (61%) | deck 15.4 (atk 9.9 blk 4.8 pow 0.7) | block points in deck 20.6
boss at death: mean HP remaining 59.6/110 (54%) over 969 boss deaths
payload tokens: dump worst 105/250 PASS | action line worst 7/8 PASS (343 lines measured)
```

### `--policy smart` — raw (before any change)

```
sim 2000 runs | policy smart | threads 4 | seeds 1..2000
win 63 (3.1%) loss 1937 (96.9%) unfinished 0
steps total 127356 mean 63.7 | floors max 7 mean 5.76
malformed 0/127356 (0.0%)
boss reached 1304/2000 (65.2%) | kills 63 (4.8% of those that reached)
boss arrival: HP 34.7/60 (58%) | deck 15.3 (atk 9.3 blk 4.9 pow 1.1) | block points in deck 32.7
boss at death: mean HP remaining 63.6/110 (58%) over 1241 boss deaths
payload tokens: dump worst 105/250 PASS | action line worst 6/8 PASS (302 lines measured)
```

### VERDICT: **`smart` is STILL WORSE than `greedy`** (not equal, not better)

| metric | greedy | smart | reading |
|---|---|---|---|
| win rate | **7.2%** | **3.1%** | smart is ~2.3x worse |
| boss reached | 55.7% | 65.2% | smart survives the *approach* better |
| kill rate at boss | 13.0% | 4.8% | smart cannot close |
| arrival HP | 36.5 | 34.7 | smart arrives a little more hurt |
| block points in deck | 20.6 | 32.7 | smart still builds ~59% more Block |

The pre-existing numbers (smart 14.3% / 10.4% vs greedy 22.1%) are superseded, but the
**shape of the failure is unchanged and now confirmed on current rules**: `smart` reaches
the boss *more* often and kills it *half as fast*.

---

## Diagnosis — MEASURED, not assumed

Instrument: `scripts/dev/probe-boss-race.mjs` (reads only public kernel output; one full
run per seed, aggregates only the boss fight).

```
### GREEDY ###  runs 600 | reached boss 296 | wins 21
boss-fight plays 1840 | block-card plays 15 | attack-card plays 1359 | other 466
damage dealt to boss total 16096 | block gained total 20
per boss-fight: turns 9.13 | dmg/play 8.75 | block/play 0.01 | hpLost/turn 3.57

### SMART ###   runs 600 | reached boss 378 | wins 15
boss-fight plays 2161 | block-card plays 141 | attack-card plays 1588 | other 432
damage dealt to boss total 18601 | block gained total 1906
per boss-fight: turns 8.85 | dmg/play 8.61 | block/play 0.88 | hpLost/turn 3.88
```

**The decisive number:** `smart` gains **1906 Block inside boss fights** and *still* takes
**more** damage per turn than `greedy` (3.88 vs 3.57). The Block is bought and thrown away.
Separately, `smart` deals less damage per boss fight (18524 vs 16096 total over different
reached-counts → **49.2 vs 54.4 per fight**). Both halves of the brief's diagnosis are
confirmed: **over-valued Block that cannot be spent, and under-valued throughput that ends
the fight.**

Reward-table bias, instrumented in `scripts/dev/probe-reward-bias.mjs`:

```
starter deck: 10 cards, blockPoints 20 (2.0/card), damagePoints 38 (3.8/card)
needs: blockNeed 1.778  damageNeed 1.457  <-- block multiplier is permanently larger
impervious   cost 2  block 30  dmg 0   key 24.37  perEnergy 14.33
bludgeon     cost 3  block 0   dmg 32  key 50.36  perEnergy 20.98
```

`deckNeeds` normalises against `DECK_TARGET`, so a thin deck's block multiplier (1.778) is
always larger than its damage multiplier (1.457). `impervious` is the highest value-per-
Energy reward on offer, so the deck accretes Block it cannot convert.

---

## TASK 2 — ONE focused fix, then STOP (**done — negative result, stopped**)

### What was changed (one attempt, aimed at the diagnosed cause)

In `src/surface/policies.js` (the only production file touched):

1. **Reward throughput 0.35 → 0.45** (`W.throughput`), so concentrated damage is valued
   above Block more strongly at the reward table — the fastest lever on deck composition
   under a release freeze. Arbitrary weight, commented as such.
2. **Explicit race awareness** (new): `combatContext` now computes
   `turnsToLive = (hp + block) / incoming` and sets `raceLoss` when
   `turnsToLive <= W.raceDangerTurns` (3). When true, `scoreSmartCard` weights landed
   damage at `W.raceDamage` (1.8x) more and Block at `W.raceBlock` (0.25x) — "when the
   announced rate ends me faster than I can kill, the only damage prevention left is a
   faster kill." Gated on near-term danger so ordinary fights still block normally. All
   three constants commented as ARBITRARY. Kept: kill-first when lethal, never spend a
   turn doing nothing, deterministic choice, only legal actions (all still green below).

### Result — the fix moved behaviour but did NOT flip the outcome

```
### smart AFTER, 2000 runs, seeds 1..2000
sim 2000 runs | policy smart | threads 4 | seeds 1..2000
win 63 (3.1%) loss 1937 (96.9%) unfinished 0
steps total 122705 mean 61.4 | floors max 7 mean 5.64
boss reached 1239/2000 (62.0%) | kills 63 (5.1% of those that reached)
boss arrival: HP 34.6/60 (58%) | deck 15.3 (atk 9.5 blk 4.8 pow 1.0) | block points in deck 31.6
boss at death: mean HP remaining 63.1/110 (57%) over 1176 boss deaths
```

Boss-fight probe after the fix (same seeds as before):

```
### SMART (fixed) ###  runs 600 | reached boss 372 | wins 18
boss-fight plays 2061 | block-card plays 80 | attack-card plays 1578 | other 403
damage dealt to boss total 18524 | block gained total 1059
per boss-fight: turns 8.55 | dmg/play 8.99 | block/play 0.51 | hpLost/turn 3.97
```

**What moved:** block-card plays in boss fights 141 → **80**; block gained 1906 → **1059**
(‑44%); damage per play 8.61 → **8.99** (+4.4%); deck atk 9.3 → 9.5. **What did not:**
win rate **3.1% → 3.1%** (63 → 63). The bot now throws away less Block — it still does not
kill faster enough to matter, and `hpLost/turn` even nudged up (3.88 → 3.97).

**Hard stop observed. No third attempt.** This is the documented negative result.

### Why the fix was not enough (inference, flagged as inference)

The change acts on *valuation*; the measured gap is *magnitude*. `smart` arrives at the
boss with roughly the same attack count as greedy (9.5 vs 9.9) but converts badly. The
probe shows the cause is not which card it plays so much as **how little damage it lands
and how much it takes while landing it**. Making Block cheaper to skip does not add the
damage-per-turn the deck needs; a 3.1% → 7.2% move would need the bot to (a) hold
legitimately more attack and (b) time its damage, which is TASK 3's unmet capability list,
not a weight. This is my reading of the evidence, not a measured causal proof.

---

## TASK 3 — THE RECOMMENDATION

### 1. Which policy should be the documented default for measuring future balance changes?

**`greedy`.** It is the better instrument on the only measurement that matters (win rate
under current rules), it already is the `--policy` default, and the golden logs depend on
it byte-identically. Specifically:

- `greedy` **7.2%** (145/2000, seeds 1..2000) vs `smart` **3.1%** (63/2000).
- Independent seed block, seeds 2001..4000: `greedy` **6.6%** (131/2000) vs `smart`
  **3.5%** (69/2000). The ordering is robust, not seed noise.
- `smart` has now failed to beat `greedy` on **four** measured attempts (three prior +
  this one). Do **not** document `smart` as "the better policy" in release docs.
- Honest caveat to carry with the recommendation: `greedy` is the *less bad* instrument,
  not a good one. At 7.2% it can only resolve balance changes larger than roughly
  **±1.1 percentage points** (95% CI on 7.2% over 2000 runs), and it plays a *static,
  one-step, non-targeting* game (see below). Every future balance claim inherits those
  limits.

`--policy smart` should remain available (it is measurably better at *reaching* the boss:
62-65% vs 55.7%) but must be labelled **experimental / not the default**, and no balance
number should be quoted from it.

### 2. Current honest win rate under that policy on current rules

> **`greedy` wins 7.2% (145/2000, seeds 1..2000) under current rules.**

Supporting, quotable with it: boss reached **55.7%**; kill rate at the boss **13.0%**;
arrival HP **36.5/60**; deck at arrival 15.4 cards (9.9 attack / 4.8 block / 0.7 power),
20.6 Block points. Independent corroboration: **6.6%** on seeds 2001..4000. Quote 7.2%
as the headline and 6.6% as the seed-block cross-check.

### 3. What this bot still CANNOT evaluate (defines the ceiling on every future claim)

- **Enemy targeting — exposed but UNUSED (verified).** The action space *does* offer
  `p{slot}_{target}` (with `targetEnemyIndex`) whenever 2+ enemies are alive
  (`src/kernel/actions.js`). But neither policy reads `targetEnemyIndex`, and the id
  parser `Number(a.id.slice(1))` yields **NaN** on `p1_2`, so a targeted play degrades.
  Both policies therefore always hit the **first living enemy**. *Any claim about
  which enemy is most dangerous, or about multi-enemy fights, is unmeasured.*
- **No multi-turn combo planning.** The chooser is a one-step greedy over a static
  per-card score. It cannot sequence Strength → big attack, Vulnerable → burst, or set up
  a Power's payoff. Synergy between *different* cards is not evaluated.
- **No debuff-window timing.** Enemy Vulnerable/Weak durations are not counted down; the
  bot cannot spike damage into an active window or time a re-application. It prices
  Vulnerable/Strength as static multipliers only.
- **No draw-pile reasoning.** Draw is a static constant; it does not know what is left in
  the pile, so it cannot evaluate deck quality or a dig-for-the-answer line.
- **No boss move-set model.** It reads only the *announced* intent, not the boss's cycle,
  so it cannot bank Block for a known big turn or burst into a known weak turn.
- **No rest-vs-upgrade decision.** Only `rest_heal` is considered; card **upgrades** at a
  rest site are not evaluated at all (`greedy` verified by reading; `smart` maps rest to
  heal-or-leave).
- **No run-level reward value model.** Reward picks are static card scores with arbitrary
  deck-need multipliers — no check that the pick actually helps *against the boss*.
- **Block is valued only against THIS turn's announced threat (by construction).** It
  never values Block held for a future turn, and the measured boss probe shows the
  converse failure too (Block bought and unspent). Neither direction is well modelled.
- **Statistical resolution.** At 7.2% over 2000 runs the instrument cannot resolve a
  change smaller than ~**±1.1 pt**; the game's real difficulty is accepted and unchanged,
  so this bot is a *relative* instrument only.

---

## What was verified vs inferred

**Verified (pasted):** both 2000-run baselines; the fixed `smart` 2000-run result; the
independent seed block 2001..4000 for both; the boss-fight probes before/after; the
reward-table numbers; `greedy` re-run byte-identical to before; suite 93/0; gate OK;
targeting is exposed but unread; `Number('p1_2'.slice(1))` is NaN.
**Inferred (flagged):** *why* the fix was insufficient (valuation vs magnitude) and the
~±1.1 pt resolution figure (standard binomial CI, not a simulation).

## Files

- Production change (one attempt, kept): `src/surface/policies.js` — `W.throughput`,
  `W.raceDangerTurns`, `W.raceDamage`, `W.raceBlock`, `combatContext` race branch,
  `scoreSmartCard` race branch.
- Evidence instruments (dev-only): `scripts/dev/probe-boss-race.mjs`,
  `scripts/dev/probe-reward-bias.mjs`.
- Raw sim output: `docs/evidence/sim/before-greedy.txt`, `before-smart.txt`,
  `after-smart.txt`, `after-greedy.txt`.

## Next step

None required for release. If the team prefers `smart` frozen at its pre-attempt
behaviour, revert the two edits in `src/surface/policies.js` (set `W.throughput` back to
0.35 and remove the `raceLoss` branches). If the bot is ever to become a *good*
instrument, the capability list in TASK 3.3 is the backlog, starting with enemy targeting.
