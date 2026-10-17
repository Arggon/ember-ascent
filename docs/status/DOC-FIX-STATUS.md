# DOC-FIX-STATUS — DEF-3 truth repair of stale/falsified/contradicting markdown

**Owner:** Technical Writer · **Started/finished:** 2026-10-16
**Scope honoured:** workspace-root `*.md` only. Did **not** touch `src/web/**`, `src/**`, `tests/**`,
`scripts/**`, `package.json`, `release/`, `release.zip`, `../specs/requirements-run-history-and-legible-combat.md`,
or `../specs/UX-SPEC-run-history.md`. Created no new markdown files except this one.

**STATUS: COMPLETE.** 8 documents corrected. Every edited claim is dated. Two claims could not be
re-measured and were **marked stale rather than guessed** (see §2).

---

## BLOCKER — capability gap, stated up front

**This Run had no shell / command-execution tool.** `tool_search` (empty and keyword queries)
reports **0 admitted deferred tools**; the advertised set is `read`/`grep`/`find`/`ls` plus file
editors and web fetch. Therefore I could **not** run `npm test`, `npm run gate`,
`node scripts/check-surface-art.mjs`, `rg`, or `npm run shots`.

Per this task's own rule — *"Do not claim a number changed without having run the command"* — I
**refused to substitute invented numbers**. Where a number needed re-measuring and I could not
re-measure it, I marked the claim **STALE**, stated plainly that I could not re-run the command,
and named the exact command to produce the truth. Every claim I *could* check was checked by
reading the actual file (source, content bundle, frame inventory) and is labelled `[READ]` below.

---

## 1. Files changed, claim by claim

| # | File | Exact claim corrected | How the new value was established |
|---|---|---|---|
| 1 | `PHASE5-STATUS.md` | `50 tests / 0 fail`; `scanned 22 files under src/`; the "Paste of the key evidence" block presented as current | `[READ]` + attributed: `../specs/requirements-run-history-and-legible-combat.md:144` records **93 / 26** `[MEASURED]` 2026-10-16. I could **not** run `npm test`/`npm run gate`, so I did **not** assert a new number — I marked both stale, said so, and named the commands. |
| 2 | `ART-PASS-STATUS.md` | Heading `Known-not-verified (no browser in this environment)` and its three "cannot" items | `[READ]` `scripts/dev/shoot.mjs:1-16` documents a CDP Chromium capture harness; `[READ]` `shots/` — 301 PNGs. Rewrote as **"not captured, and here is the method"**; kept the honest residual (frames cannot prove *feel* or fps). |
| 3 | `JUICE-STATUS.md` | (a) `no browser exists in this environment`; (b) "death beat is unbuilt / add `prevEnemies`"; (c) `99 emitted / 209 distinct` | (a) as above. (b) `[READ]` `src/web/app.js:625-639` (death burst), `:1240-1244` (ghost drawn), `src/web/style.css:1506` (`.enemy.is-dying`); frames at `shots/pm-verify/death/`; `[READ]` `prevEnemies` = declared `:127`, reset `:734`, assigned `:1077`, **never read**. (c) Not re-measurable by me → marked stale, cited **126 / 316** from the PM's in-run measurement, command given. |
| 4 | `../guides/ITCH-UPLOAD.md` | (a) "the one check nobody here could perform, because there is no browser"; (b) honesty-table row "renders correctly in a real browser — NOT verified — no display server here"; (c) "Screenshots — NOT producible here — owner must capture (⛔ blocker)" | `[READ]` `shots/` = 301 PNGs incl. `cover-ember-ascent.png`; `[READ]` `scripts/dev/shoot.mjs`. Blocker removed; kept "embed sizes well on itch.io" as **NOT verified** (genuinely needs a live page) and did **not** claim the page is live. |
| 5 | `../RELEASE-NOTES.md` | "No meta-progression… No unlocks, no currency, no account, no leaderboard" + "no run persistence at all, by design" | Added a **dated notice**, not a rewrite: marked both as **subject to an in-flight revision**, named exactly which claims change, stated the features are **not built**, and opened an action owned by the Technical Writer. Also replaced the card-count paragraph with a **reconciliation** (see #7). |
| 6 | `LAYOUT-STATUS.md` | *(no false claim found — see §2/§3)* Added a clarification so "UNVERIFIED" is never read as "unverifiable" | `[READ]` whole file: it contains **no** "no browser"/"no display server" sentence, contrary to the brief. Its `UNVERIFIED` items are honest "not measured yet". |
| 7 | `../specs/requirements-agent-playable-deckbuilder.md` | (a) "40 cards" (5 places); (b) "Does the GUI ship in the slice? **No** — phase 6" | (a) `[READ]` `src/kernel/content/cards.json` — **42 card definitions (20 attack / 16 skill / 6 power)**; `[READ]` `../RELEASE-NOTES.md` agrees. Added a dated header note: **40 = planning target, 42 = shipped**. **Original text left intact** — history not rewritten. (b) `[READ]` `PHASE5-STATUS.md` + `release.zip` manifest: the GUI **shipped as Phase 5**, not phase 6. (a) is a count-by-inspection, **not an executed command** — flagged as such in the file. |
| 8 | `../guides/PLAYING.md` | `40 cards` (2 places) | Same reconciliation as #7; dated note, original text preserved. |

**Measured, not asserted:** the **301 PNGs** and the **death frames** (`death-000ms` … `death-450ms`,
`death-context-300ms.png`, plus `climax-hold.png`) were counted and listed by me directly from `shots/`
via `find`/`ls` this Run. The **42** card definitions were counted by me by reading `cards.json` in
full. Both are `[READ]`, not `[MEASURED by executed command]`.

## 2. Claims I could NOT verify and therefore did NOT change

1. **The current test count** (`npm test`) — **no shell this Run.** `PHASE5-STATUS.md`'s `50` is now
   marked **STALE**; I cited **93** only as an attributed, dated measurement from the PM's document,
   explicitly **not** as my own re-measurement. **A later agent must run `npm test` and use what it sees.**
2. **The current architecture-gate file count** (`npm run gate`) — same reason. `22` marked STALE,
   `26` cited with attribution, with warning that two agents were adding kernel modules concurrently.
3. **The art-checker counts** (`node scripts/check-surface-art.mjs`, now `126 / 316`) — I recorded the
   new figures **as attributed to the in-run measurement and marked them stale-prone**, because I
   could not run the checker myself. The `OK — every emitted class has a CSS rule` *verdict* is
   unchanged and was not re-measured.
4. **`release.zip` integrity** (SHA-256 `4a662160…`, 25 entries, 123,283 B) — **not re-verified.** I
   only read the manifest/claims; I did not hash or unzip anything.
5. **`src/web/app.js:756` `difficulty` "read by no rule"** (DEF-2) — a code claim I saw referenced but did
   **not** independently trace; **not corrected**.
6. **The 7.2% greedy win rate** — not re-run; left as-is (it is already labelled with its limits).

## 3. Further stale / contradicting claims found that were NOT on the list

1. **`docs/guides/AGENT-PLAY-GUIDE.md:239` — "No renderer yet. … the visual layer is phase 6."** This is
   **false**: `src/web/` renders and `shots/` holds 301 PNGs of it. **NOT EDITED — outside my stated
   file scope** (workspace-root `*.md` only). Reported for routing. The same file's lines 4/238/240
   also carry the stale **"40 cards"**.
2. **`../specs/requirements-agent-playable-deckbuilder.md` "GUI ships? No — phase 6"** — the same falsehood in
   a root file, which **was** in scope. **Corrected** (item 7b).
3. **`JUICE-STATUS.md` claims "Verification commands and their raw output are pasted at the bottom of
   this file."** **There is no such output at the bottom** — the file ends at "EXACT NEXT STEP". The
   file **over-claims its own evidence**. Annotated in place. Its task ledger also marks **task 8
   (P3 run structure) NOT STARTED** while its prose renders task 5 DONE — the ledger was the true one.
4. **`LAYOUT-STATUS.md:4`** attributes the original bug report to **"reproduced in Firefox devtools"**
   — mildly in tension with later "no browser" claims elsewhere, but honest and consistent with a
   *browser existing*. No change needed.
5. **`DEF6-FE-STATUS.md:16`** — confirms the Frontend Engineer owns the `style.css:1685-1687`
   reduced-motion comment fix (item 4 of my brief). Consistent with my decision not to touch it.

## 4. Deliberately NOT touched, and why

- **`src/web/**`, `src/**`, `tests/**`, `scripts/**`, `package.json`** — explicitly out of scope, and two
  agents are editing `src/web/**` and `src/**` right now. I only **read** them as evidence.
- **`src/web/style.css:1685-1687`** (the reduced-motion comment that says a dying enemy "is simply gone")
  — **a real contradiction, confirmed by reading the code:** `.enemy.is-dying` at `:1506` has no base
  `opacity`, so under `animation: none !important` (`:1681`) it still paints. `src/web/app.js:1240-1241`
  documents the correct behaviour. **Owned by the Frontend Engineer** (`DEF6-FE-STATUS.md:16`);
  editing it would collide and duplicate. **Noted only.**
- **`../specs/requirements-run-history-and-legible-combat.md`, `../specs/UX-SPEC-run-history.md`** — PM-owned.
- **`release/`, `release.zip`** — not rebuilt, as instructed.
- **`PHASE5-STATUS.md` history section** — corrected and marked, **not rewritten**, as instructed.
- **Honest uncertainty anywhere** — preserved. "Cannot verify" was converted to "not captured, and
  here is how to capture it"; genuine residuals (easing *feel*, fps, screen-reader behaviour, and the
  itch.io embed's real sizing) were left standing as limitations.

---

## Reconciliation note on the card count (both numbers, one place)

**40 = planning target** (as written in `../specs/requirements-agent-playable-deckbuilder.md`, `../guides/PLAYING.md`,
`docs/guides/AGENT-PLAY-GUIDE.md`). **42 = shipped** (`src/kernel/content/cards.json` → `cards.bundle.js`,
20 attack / 16 skill / 6 power). Historical intent preserved in both planning docs; each now carries a
dated pointer to this reconciliation. `../RELEASE-NOTES.md` carries the canonical note.
