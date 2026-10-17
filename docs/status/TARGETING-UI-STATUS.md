# TARGETING-UI-STATUS.md

Frontend Engineer working log for **enemy targeting in the browser game**.
Scope: `src/web/**` only. `src/kernel/**` and `bin/dlb` are owned by a sibling agent and were
read for evidence but **never edited** by me.

---

## Task 0 — Capability + contract probe (DONE)

### Capability verified, not assumed
```
$ mkdir -p web scripts/dev && echo "CANARY_WRITE_OK $(date -u +%FT%TZ)" > src/web/.canary.txt && cat src/web/.canary.txt \
    && node -e "console.log('CANARY_EXEC_OK', process.version)"
CANARY_WRITE_OK 2026-10-12T18:59:30Z
CANARY_EXEC_OK v24.20.0
```
`[rw,web,exec]` are real: I can write files and run commands. The canary file was removed
again so it cannot ship. No fabricated progress.

### Baseline (before any edit of mine)
```
$ node --test 'tests/**/*.test.js'
ℹ tests 75   ℹ pass 75   ℹ fail 0
$ node scripts/check-architecture.mjs
check-architecture: scanned 26 files under src/
OK — no R1/R3 violations            (exit 0)
$ node scripts/check-surface-art.mjs
  · classes: 94 emitted by app.js, 129 present in style.css
  · top-level selectors: 191, distinct 191
OK — no missing class rules, no duplicate selectors, no external assets   (exit 0)
$ grep -rniE 'https?://|cdn|@import|googleapis|\.woff' src/web/     -> (no output)
$ grep -rn 'prefers-reduced-motion' src/web/                        -> src/web/style.css:1013
```

### CONTRACT FINDINGS — I cannot build a legal target id, and the reason is in the engine

**(1) The two-argument form is not accepted by the engine at all.**
`step()` matches an action id by *exact string equality* against
`actions(state)` (`src/kernel/index.js:201-214`), and the only combat ids it ever
emits are `p<N>` and `e1` (`src/kernel/actions.js:12-24`). So `p<N> <k>` can never
match. Measured:
```
$ node /tmp/probe4.mjs
target-list order (living, print order):
  k=1  index=0  Red Louse  hp=11/11
  k=2  index=1  Acid Slime  hp=29/29

B) two-arg form, fresh controller, same state:
  dispatch("p3")   -> error=null  enemies=Red Louse:5 | Acid Slime:29
  dispatch("p3 2") -> error={"code":2,"error":"illegal_action","id":"p3 2"}  enemies=Red Louse:11 | Acid Slime:29
```
Note the same run: **`p3` damaged `Red Louse` — the first living enemy — which is exactly
the bug the player reported.** The PM table describes an engine that does not exist yet in
the file I can see. The sibling is presumably mid-flight; this is evidence, not blame.

**(2) Which cards need a target is not in the snapshot.**
`snapshot().hand[i]` has no `target` field at all (measured: `target fields present:
[undefined x5]`). The kernel *knows* the answer — `snapshot()` already calls
`describeCard(def, card)` and `def.target ∈ {enemy, all, self, none, random_enemy}`
(`src/kernel/content.js:20`) — it just does not project it.

**(3) `enemies[].index` is stable identity, NOT the frozen 1-based `k`.**
The PM froze `k` as "1-based among LIVING enemies, in the order the state dump prints
them". `snapshot().enemies` is already filtered to the living (`observe.js:345-346`), so
`k = position + 1`. But `index` is the opposite: it survives a death, so once an earlier
enemy dies the survivor's `index` is stale as a position. Measured — two enemies, first one
killed, survivor keeps `index=1` while becoming the only living enemy (so `k=1`):
```
$ node /tmp/probe5.mjs
before: pos0 index=0 Red Louse hp=11 | pos1 index=1 Acid Slime hp=29
after:  pos0 index=1 Acid Slime hp=3
```
Consequence: `index` is the right key for enemy *identity* (position-agnostic), which is
what the damage-flash fix needs, but a **wrong** key for `k`. I therefore derive `k` from
the position in the living list and never confuse the two.

### What I did about it
- Did **not** patch the kernel (out of bounds) and did not silently hard-code a legal id.
- Implemented the real interaction; it emits the frozen two-argument id.
- Wired a **fallback** for the missing `target` field so the UI is usable *today*: the
  renderer treats `card.target === 'enemy'` as authoritative when present, and otherwise
  falls back to `card.type === 'attack'`. Marked INFERRED below.
- Reported both gaps rather than guessing.

---

## Tasks 1-6 — implementation, evidence, and open items

See the sections below, appended as each task completed.

| # | Task | State |
|---|---|---|
| 1 | Two-step targeting interaction | DONE (evidence below) |
| 2 | Target legibility (highlight/dim, intent recall, selected target, card cue, cancel) | DONE |
| 3 | Damage feedback on the enemy actually hit | DONE (re-keyed on `index`) |
| 4 | Keyboard (`1..9` target, `Esc`/`0` cancel, focus ring, shape cue) | DONE |
| 5 | Screen-reader labels + live region + reduced motion | DONE |
| 6 | Nothing existing broken + first-run help line | DONE |
