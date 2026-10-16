# Phase 5 — Browser-playable deckbuilder (same kernel)

Goal: make the deckbuilder playable **in a browser with mouse clicks**, as a VIEW on the
same kernel. The headless CLI stays as-is. No forked/duplicated game logic.

> ## ⚠️ CORRECTION NOTICE — added 2026-10-16 (Technical Writer, DEF-3)
>
> **This file's headline figures are STALE.** They are superseded but deliberately left visible so
> the history stays honest. **I did not re-measure them myself** (no shell in my Run) — the current
> values are attributed to the source named in each row.
>
> | Claim in this file | Status as of 2026-10-16 | Correct value / how to re-measure |
> |---|---|---|
> | "Tests: 50 pass / 0 fail" | **STALE — the count has grown.** | The most recent in-run measurement available to me is **93 pass / 0 fail** (`requirements-run-history-and-legible-combat.md:144`, marked `[MEASURED]`, 2026-10-16). **A later agent must re-run `npm test` and use what it observes** — the suite has grown since, so read this as "≥93", not "93". |
> | "scanned 22 files under src/" | **STALE — the src/ tree has grown.** | The same source records **26 files under `src/`** as of 2026-10-16, and two agents were adding kernel modules while this notice was written. **Re-measure with `npm run gate`** and treat the printed count as authoritative. |
> | The "Paste of the key evidence" block below | **HISTORICAL PASTE, not current state.** | It records the numbers true at the time of Task 1. It is retained as the record of that checkpoint, not as a claim about today. |
>
> **Why this matters:** `requirements-run-history-and-legible-combat.md` §DEF-3 found that every
> wrong claim in this project came from trusting a status document instead of checking reality,
> and that this file's stale numbers were one of them. Do not quote the numbers below without
> re-running their commands.
>
> **Not re-measured by me:** the writer of this notice had **no shell in this Run**, so it could
> not run `npm test` or `npm run gate`. The 93/26 figures above are attributed to their measurer,
> not to this file, and the commands are given so anyone can replace them with fresh truth.

## Baseline (verified before any change)
- `node --test 'tests/**/*.test.js'` → **45 pass / 0 fail** (duration ~1.2s).
- `node tools/check-architecture.mjs` → `OK — no R1/R3 violations`, exit 0.
- Kernel Node imports (the only two, confirmed by grep):
  - `src/kernel/content.js:7` → `node:fs` (`readFileSync`)
  - `src/kernel/state.js:11` → `node:crypto` (`createHash`)
  - `src/kernel/rng.js:10` and `act.js`/`index.js` hits are **comments/identifiers**, not imports.

## Integration point
`src/surface/gui/controller.js` (DOM-free, already proven equivalent to the CLI by
`tests/golden/dual-surface.test.js`). The browser will drive exactly this.

> Critical constraint discovered: `controller.js` imports `src/surface/session.js`, which
> imports `src/kernel/index.js`. So **session.js must remain browser-safe** — it can NOT
> import `node:fs`. Content therefore lives in a generated ES module the kernel imports;
> the JSON stays the single source of truth, guarded by a drift test.

## Task board
1. [x] Remove kernel's two Node deps (fs + crypto) — **DONE**
2. [ ] Browser renderer `web/`
3. [ ] Zero-dependency server `tools/serve.mjs`
4. [ ] Evidence

### Task 1 result (DONE)
- `src/kernel/sha256.js` — new pure-JS SHA-256 (sync, TextEncoder). `state.js` now
  `import { sha256Hex }`; **no `node:crypto`**. Verified byte-identical to node:crypto:
  full-length sweep 0..200 + **40 distinct real states** (test output below).
- `src/kernel/content/cards.bundle.js` — GENERATED ES module (from `cards.json` via
  new `tools/gen-content.mjs`). `content.js` imports it; **no `node:fs`**. `loadContent()`
  now accepts a parsed object, a JSON string, or defaults to the bundle. `cards.json`
  stays the single source of truth; `tests/content/bundle-drift.test.js` deep-compares.
- **Golden logs did NOT drift**: regenerating produced byte-identical output
  (`sha256 d86af1d2…` before == after). No regeneration was strictly needed, but the
  generator was run to prove it.
- Gate hardened in `tools/check-architecture.mjs`: kernel may now import **no `node:*`**
  builtin at all, and `web/` is scanned as surface code too.
- **Tests: 50 pass / 0 fail** (was 45). `node:perf_hooks` was only ever a comment.
  **[CORRECTED 2026-10-16: 50 was true at this checkpoint and is now stale — see the correction
  notice at the top. Re-run `npm test` for the current count.]**
- New tests: `tests/kernel/sha256-parity.test.js`, `tests/content/bundle-drift.test.js`.
- View-model addition (needed for the renderer, rules stay in kernel):
  `snapshot()` in `src/kernel/observe.js`, exported via kernel index → `session.js`
  (`snapshotOf`) → `controller.snapshot()`.

Paste of the key evidence — **HISTORICAL, as of this Task 1 checkpoint; NOT current state:**
```
===GATE===  check-architecture: scanned 22 files under src/
OK — no R1/R3 violations        (exit 0)
sha256 parity: 40 distinct states matched node:crypto exactly
ℹ tests 50 / pass 50 / fail 0
regenerate golden: IDENTICAL — regeneration is a no-op, zero golden drift
```
**[CORRECTED 2026-10-16: this block is a dated record of the Task 1 checkpoint, not a statement
about the current build. `scanned 22 files` and `tests 50` are both superseded — re-measure with
`npm run gate` and `npm test` respectively. The `OK — no R1/R3 violations` verdict and the golden
no-drift result are the claims this block was written to support and were not re-measured by the
writer of this notice.]**

---
_Task 2 in progress._
