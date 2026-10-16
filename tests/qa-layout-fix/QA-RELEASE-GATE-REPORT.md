# QA release-gate report — LAYOUT-ACCEPTANCE.md (frozen contract)

**Verifier:** QA Engineer (release gate). **Date:** 2026-10-15.
**Subject:** `web/style.css` layout fix + `tools/dev/viewport-check.mjs` / `space-check.mjs` instrumentation.
**Contract:** `LAYOUT-ACCEPTANCE.md` (frozen, S1–S7, §5).
**Environment:** Chromium 152.0.7977.82 (Arch Linux), `node v24.20.0`, dpr 1, `--headless=new --disable-gpu --no-sandbox --hide-scrollbars`, static server `tools/serve.mjs` on `127.0.0.1:5173`.

## Verdict per story

| Story | Verdict | Deciding evidence |
|---|---|---|
| S1 1366×768 fits | **PASS** | 12/12 seeds: scrollPx 0, handRows 1, End Turn bottom 698–707 / 768 → clearance 61–70; `.hint` bottom 742 ≤ 768; `#stage` scrollHeight 684 == clientHeight 684 |
| S2 915×412 / 1200×450 / 844×390 no regress | **PASS** | 915×412 clearance 14 on all 12 seeds (≥ 6 required), scroll 0, hand 1 row, `#stage` 334==334; 1200×450 clearance 14 all 12, `#stage` 372==372; 844×390 clearance 22 all 12 |
| S3 360×640 no regress | **PASS** | clearance 14, scroll 0, hand 1 row, `#stage` 564==564, End Turn topmost at centre `true` on 12/12 seeds |
| S4 pinned seed honoured | **PASS** | 240/240 rows across both harnesses printed `reported == requested`; code-read assertion at `tools/dev/viewport-check.mjs:266-270`; determinism byte-identical (below) |
| S5 a red run looks red | **PASS** | 3 independent failure paths all exit 1 with a named threshold (below) |
| S6 ≥12 seeds | **PASS** | viewport-check `--seeds 1-12`: **exit 0, `ALL PASS (108 rows)`, 0 FAIL**; space-check `--seeds 1-12`: **exit 0, `ALL PASS (132 rows)`, 0 FAIL** |
| S7 rollback point | **FAIL** | Harness backups are true pre-change copies; `layout-fix-backup/style.css` is **not** the pre-change state of the CSS this change edits (evidence below) |

**Release verdict: GO for the layout fix (S1–S6 all PASS). NO-GO on S7 alone** — the rollback record for `web/style.css` does not identify the state this change was made from.

## The full seed sweep (S6)

Raw files: `tests/qa-layout-fix/10-sweep-viewport-seeds1-12.txt`, `tests/qa-layout-fix/11-sweep-space-seeds1-12.txt`.

```
node tools/dev/viewport-check.mjs --seeds 1-12     -> exit 0
ALL PASS (108 rows)                                -> FAIL rows: 0
node tools/dev/space-check.mjs    --seeds 1-12     -> exit 0
ALL PASS (132 rows)                                -> FAIL rows: 0
```

Per-viewport distinct values across all 12 seeds (parsed from raw output):

```
360x640    n=12  clearance{14} scroll{0} handRows{1} onTop{true} seed[ok] result{pass}
390x844    n=12  clearance{82,85,86,99,102,103} scroll{0} handRows{1} onTop{true} seed[ok] result{pass}
414x896    n=12  clearance{93,95,96,113} scroll{0} handRows{1} onTop{true} seed[ok] result{pass}
844x390    n=12  clearance{22} scroll{0} handRows{1} onTop{true} seed[ok] result{pass}
915x412    n=12  clearance{14} scroll{0} handRows{1} onTop{true} seed[ok] result{pass}
768x1024   n=12  clearance{102,109,116,120,123} scroll{0} handRows{1} onTop{true} seed[ok] result{pass}
1280x800   n=12  clearance{68,70,71,73,76} scroll{0} handRows{1} onTop{true} seed[ok] result{pass}
1366x768   n=12  clearance{61,64,65,67,70} scroll{0} handRows{1} onTop{true} seed[ok] result{pass}
1200x450   n=12  clearance{14} scroll{0} handRows{1} onTop{true} seed[ok] result{pass}
```

Per-seed 1366×768 clearance, verbatim: `67 65 61 65 64 64 61 64 67 65 70 64` — minimum **61** (seeds 3 and 7), against the frozen threshold `innerHeight − 8 = 760` bottom, i.e. `clearance ≥ 8`. Worst observed clearance is 61, so the tightest seed still has 53px of margin over the threshold.

space-check, 132 rows, every seed assertion `ok`: `412x915 waste 24px / 390x844 24px / 360x640 14px / 414x896 24px / 768x1024 34px / 1280x800 26px / 1366x768 26px / 1280x1000 58px / 915x412 14px / 844x390 22px / 1200x450 14px`, all `scrollH == viewport height`, all `pass`.

**Matrix coverage claim — TRUE.** Union of the two default matrices is 11 viewports: viewport-check has 9 (`360x640, 390x844, 414x896, 844x390, 915x412, 768x1024, 1280x800, 1366x768, 1200x450`), space-check has 11 and adds `412x915` and `1280x1000`. Both named viewports are present.

## Criteria the harnesses do NOT assert — independently measured

`viewport-check.mjs` collects `.hint` height (`line 227`) and `#stage` bottom (`line 183`) but **asserts neither**, and it does not compare `#stage` `scrollHeight` to `clientHeight` at all. To close S1's third criterion and S2/S3's `#stage` criterion I wrote my own probe (`tests/qa-layout-fix/qa-fit-probe.mjs`, own Chromium, no source edits): **exit 0, `ALL PASS (36 rows)`** (9 viewports × seeds 1,3,7,11):

```
1366x768  seed 1/3/7/11: 701/707/707/698 of 768 | clear 67/61/61/70 | scrollH 768 | handRows 1
                          etTopmost true | hint 742/768 | stage ok (684==684)
915x412   all 4 seeds:   398/412 clear 14 | scrollH 412 | handRows 1 | etTopmost true | stage ok (334==334)
1200x450  all 4 seeds:   436/450 clear 14 | scrollH 450 | handRows 1 | etTopmost true | stage ok (372==372)
360x640   all 4 seeds:   626/640 clear 14 | scrollH 640 | handRows 1 | etTopmost true | stage ok (564==564)
```

Every row reported `overflow-y: hidden` on `#stage` with `scrollHeight == clientHeight` (e.g. 684==684, 334==334, 313==313, 372==372), so **`#stage` clips nothing** at any tested viewport.

**Observation (not a contract failure, but worth a line):** at 360×640, 844×390, 915×412 and 1200×450 the probe measures `.hint` at `scrollHeight 0 / clientHeight 0` — the hint line is not rendered at those heights, so S1's "the hint line's bottom is also ≤ innerHeight" is vacuous there, and the target outcome's "HUD, enemies, hand, End Turn and the hint line" is not literally met on the short tiers. It is met where it matters (1366×768: 742/768; 1280×800: 774/800). I did not read the rule that hides it — **UNVERIFIED** as to mechanism and intent.

## S4 determinism — byte-identical, reproduced

```
node tools/dev/viewport-check.mjs --sizes 915x412 --seeds 3   -> exit 0   (run A)
node tools/dev/viewport-check.mjs --sizes 915x412 --seeds 3   -> exit 0   (run B)
cmp tests/qa-layout-fix/03-det-vp-a.txt tests/qa-layout-fix/03-det-vp-b.txt  -> identical
md5: 38902a000ed6f6e274fbbcbffa351151  (both files)
row: 915x412 galaxy-s25u-land 3 3 398/412 14 0 1 true pass
```

The harness **does assert the reported seed** (code-read evidence, `tools/dev/viewport-check.mjs`):

```js
} else if (m.seedReported !== m.requestedSeed) {
  fails.push(`INVALID SEED: page reported ${m.seedReported}, requested ${m.requestedSeed}`);
}
```
and `space-check.mjs`:
```js
} else if (m.seedReported !== m.requestedSeed) {
  fails.push(`INVALID SEED: page reported ${m.seedReported}, requested ${m.requestedSeed}`);
}
```

**The assertion demonstrably fires** (not just code-read): pointed at the buggy pre-fix URL, both harnesses fail on seed mismatch with `exit 1`:

```
node tools/dev/viewport-check.mjs --sizes 1366x768 --seeds 11 --base 'http://localhost:5173/web/?seed={seed}'   EXITCODE=1
1366x768  laptop  11  119756  707/768  61  0  1  true  FAIL
  FAIL 1366x768 seed 11: INVALID SEED: page reported 119756, requested 11

node tools/dev/space-check.mjs --sizes 1366x768 --seeds 11 --base 'http://localhost:5173/web/?seed={seed}'      EXITCODE=1
1366x768  laptop  11  499065  [1366,768]  26px  3%  768  71%  FAIL
  FAIL 1366x768 seed 11: INVALID SEED: page reported 499065, requested 11
```

And with a bogus seed (`--seeds 999999999999`, outside the app's `0..1000000` accept range) → `EXITCODE=1`, `INVALID SEED: page reported no seed (New Run button not found), requested 999999999999`.

The redirect bug itself is real and reproduced by header inspection, not taken on trust:
```
curl -D - 'http://localhost:5173/web/index.html?seed=11'  -> HTTP/1.1 200 OK
curl -D - 'http://localhost:5173/web/?seed=11'            -> HTTP/1.1 301 Moved Permanently
                                                             Location: /web/?seed=11/
```
`web/app.js:86-91` `seedFromUrl()` does `Number("11/")` → `NaN` → `Math.floor(Math.random()*1000000)`.

## S5 negative control — the harness can fail

Failure path exercised three ways, each exiting 1 with a named measured-vs-threshold message. The first is the most valuable: **the pre-fix CSS reproducing the contract's own §1 numbers.**

```
NC1  node tools/dev/viewport-check.mjs --sizes 1366x768,915x412,1200x450,844x390 --seeds 3,11 \
       --base 'http://localhost:5173/tests/qa-layout-fix/sandbox-prefix/index.html?seed={seed}'
     EXITCODE=1
     1366x768  laptop  3  3  774/768   -5  103  1  true  FAIL
        FAIL 1366x768 seed 3: End Turn below fold: bottom=774 > innerHeight=768 (by 6px)
        FAIL 1366x768 seed 3: page scrolls: scrollHeight=871 > innerHeight=768 (by 103px)
     1366x768  laptop  11 11 770/768   -2  100  1  true  FAIL
        FAIL 1366x768 seed 11: End Turn below fold: bottom=770 > innerHeight=768 (by 2px)
        FAIL 1366x768 seed 11: page scrolls: scrollHeight=868 > innerHeight=768 (by 100px)
     915x412   ...  406/412  6  ...  FAIL   -> "End Turn clearance 6px < 8px: bottom=406 vs threshold bottom<=404"
     1200x450  ...  444/450  6  ...  FAIL   -> "End Turn clearance 6px < 8px: bottom=444 vs threshold bottom<=442"
     844x390   ...  368/390  22  ...  pass

NC2  node tools/dev/space-check.mjs --sizes 1366x768,1280x800,844x390,915x412,1200x450 --seeds 11 \
       --base 'http://localhost:5173/tests/qa-layout-fix/sandbox-prefix/index.html?seed={seed}'
     EXITCODE=1
       FAIL 1280x800 seed 11: negative wastePx: wastePx=-10px < 0px (contentBottom=810 vs innerHeight=800, scrollHeight=868)
       FAIL 1366x768 seed 11: negative wastePx: wastePx=-42px < 0px (contentBottom=810 vs innerHeight=768, scrollHeight=868)

NC3  (the two INVALID SEED runs quoted under S4)
```

NC1 at seed 11 reproduces the contract's §1 baseline **exactly**: 770 bottom vs 768 viewport, 100px scroll. That both validates the instrument and closes the causal loop — pre-fix CSS → red, post-fix CSS → green.

Negative-control mechanics, stated plainly: the harnesses take `--base`, so **no CSS edit was needed** to test the failure path. I never touched `web/style.css`. The pre-fix CSS came from the backup dir; I copied it into `tests/qa-layout-fix/sandbox-prefix/` (md5 `c3e1b4379ccc401dcad4c986d15c8e81`, identical to `layout-fix-backup/style.css`) with a copy of `index.html` and symlinks to the product `app.js`/`tokens.js`/`src`.

Also code-read, confirming the "before this work it always exited 0" claim: the pre-change copies in the backup end with a hardcoded
```
layout-fix-backup/viewport-check.mjs:205:  ws.close(); child.kill('SIGTERM'); process.exit(0);
layout-fix-backup/space-check.mjs:125:      ws.close(); child.kill('SIGTERM'); process.exit(0);
```
versus the live `process.exit(failedRows.length ? 1 : 0);` in both.

## Claim check — the specified clearance grid, verbatim

| viewport | claimed | measured (seeds 1,3,7,11) | verdict |
|---|---|---|---|
| 1366×768 | ~61–70 | 67, 61, 61, 70 | **TRUE, exact** |
| 1280×800 | ~68–76 | 73, 68, 68, 76 | **TRUE, exact** |
| 915×412 | 14 (was −7 on seeds 3/7) | 14, 14, 14, 14; pre-fix run gave `-5` at seed 3 and `-2` at seed 11 on 1366×768-scale | **TRUE** (‑7 at 915×412 on seeds 3/7 is consistent with the fix report's own 143px-card analysis; I reproduced **failure** there only at 6px clearance pre-fix, not −7 — see UNVERIFIED) |
| 1200×450 | 14 | 14, 14, 14, 14 (pre-fix: 6) | **TRUE** |
| 844×390 | 22 (recovered) | 22, 22, 22, 22 | **TRUE** |

## Other claims

- **`web/style.css` diff is exactly the two claimed blocks — TRUE.** `diff -u layout-fix-backup/style.css web/style.css` → one hunk, `@@ -2133,6 +2133,106 @@`, **+100 / −0 lines**, no other line touched. Live line 2161 `@media (min-width: 901px) and (max-height: 830px)`, live line 2232 onward `@media (min-width: 901px) and (max-height: 480px) { .card { padding: 7px 5px 3px; gap: 1px; } }` — both present, as claimed.
- **The `@media (max-height: 500px)` band is genuinely absent as a rule — TRUE.** `grep -nE '@media[^{]*max-height:[[:space:]]*500px[^{]*\{' web/style.css` → **no match** (exit 1). The only occurrence is prose at line 2187: ``A `@media (max-height: 500px)` band used to live here…``. Live file has 23 `@media` at-rules; none is the 500px band.
  - **Nuance the claim omits:** the band is also absent from `layout-fix-backup/style.css`. It exists only in `/tmp/style.css.orig` (line 2184, `#app { padding-bottom: 8px; } #stage { padding-bottom: 3px; }`), which the fix report names as its diff base. So "reverted" is true **relative to that base**, not relative to the recorded backup.
- **Pre-existing defect at `web/style.css:118` — TRUE.** `sed -n '118p'` gives `  column-gap: 8px` in **both** files (md5 of the line `f2f11e80670b178f39986035a3e429c0` for each); my postcss probe reports `PARSE ERROR: <path>:118:18: Missed semicolon` for **both** live and backup, with an identical ±2-line context dump; and lines 1–2132 of the two files are byte-identical (`md5 445e9f2d63b60ea53c742ace3ddb5dfd`). Unrelated to this change and pre-existing — **confirmed**.

## S7 rollback rehearsal — FAIL (the one false claim)

I did **not** overwrite `web/style.css`; this is hash comparison only.

Backup files vs their recorded `sha256` in `layout-fix-backup/MANIFEST.md` — **3/3 match exactly**:
```
be3db6a601012afae180b9a6d592aeb1d670e51c157e56c9858ecf355ea853c8  layout-fix-backup/style.css
300597437f279fcb88ceab8ee15d8ad303866c2fefa5c2a547dca8f160f5468d  layout-fix-backup/viewport-check.mjs
f5ee0cd51074d4b824b9acfc73042e3a22cf9b4333c71225453842e9e0df58db  layout-fix-backup/space-check.mjs
```
Live files differ from the backup, as expected for the two edited harnesses — and for the CSS, whose pre-change state is not the backup:
```
620c974f5c2be4bc6accd181cab32c86dd32e641baca8d1635664bc8ee5684c8  web/style.css           (99761 bytes)
be3db6a601012afae180b9a6d592aeb1d670e51c157e56c9858ecf355ea853c8  backup style.css        (93092 bytes)
```

**"Restoring `layout-fix-backup/style.css` over `web/style.css` would reproduce the pre-change state" — FALSE.** `layout-fix-backup/style.css` is 2323 lines / 93092 bytes and contains **no** `@media (min-width: 901px)` at all; the state the fix was actually made from is `/tmp/style.css.orig` (2376 lines / 96264 bytes, `sha256 521910b01b9f4cfb465c863e2536b903061bcac8011c531c10bff58303dede5d`, md5 `fe8b56ac591d39af90205cf9ab0bf987`, matching the md5 the fix report quotes). Between the recorded backup and that pre-edit state, 54 lines were added and 1 removed, including:
```
layout-fix-backup -> /tmp/style.css.orig:  @@ -2133,6 +2133,59 @@
+ @media (min-width: 901px) and (max-height: 830px) { ... }     <- the laptop tier
+ @media (max-height: 500px) { ... }                            <- the band later reverted
```
Restoring the backup would therefore throw away the entire `min-width: 901px / max-height: 830px` laptop tier — the mechanism S1 depends on — and reinstate no band, leaving the tree in a state that is neither pre-fix nor post-fix. The two harness backups, by contrast, **are** true pre-change copies (they still request `http://localhost:5173/web/?seed=11` and hardcode `process.exit(0)`).

S7's own wording — "Given a pre-change copy of every file to be edited" — is not satisfied for `web/style.css`. The manifest is honest that "no CSS file was touched by this task", which is precisely the gap: the CSS *was* edited by a sibling task 84 minutes later, and no rollback point was recorded for the state it was edited from.

## Contention caveat (honest disclosure)

While I ran the default matrices and negative controls (≈07:39–07:52) a **concurrent agent was running the same harnesses** — `ps` showed a second `node tools/dev/viewport-check.mjs` using the same `--remote-debugging-port=9341` and the same `--user-data-dir=/tmp/dlb-viewport`, writing `/tmp/rev-laptop.log`/`rev-small.log` rather than `tests/qa-layout-fix/`, and one `probe-eleven.mjs`. The harnesses are not concurrency-safe (fixed port + fixed profile + fixed screenshot dir). The 12-seed sweep ran after that contention and agreed with my own separate probe run and with the engineer's independent 8-seed run, and all three instruments agree to the pixel on the decisive rows (1366×768: 67/61/61/70; 915×412: 14; 844×390: 22). I therefore treat the readings as valid, but the pre-sweep runs carry this caveat.

## Nothing was edited

`web/` and `tools/dev/` were not modified. `sha256sum` before my first run and after my last run are identical:
```
620c974f5c2be4bc6accd181cab32c86dd32e641baca8d1635664bc8ee5684c8  web/style.css
7aedcb0f26a80f3dcf8698aa37b9eacee63b17fca6116ca66150dc0042bffcf2  tools/dev/viewport-check.mjs
5fed9125f5874059430d7d3c62c09d36068de46d2d524415bdebb7c367503bf6  tools/dev/space-check.mjs
```
Everything I wrote lives under `tests/qa-layout-fix/`.

## UNVERIFIED (and why)

1. **Pre-fix 915×412 was `-7`px on seeds 3/7.** My pre-fix reproduction at 915×412 gave **6px clearance (a clearance failure, not a below-fold failure)** on seeds 3 and 11 via the harness, and 1366×768 gave −5 at seed 3 / −2 at seed 11. I did not reproduce a −7 clearance at 915×412 because the harness's `endTurnClearance` is only printed for passing rows; the fix report's −7 and its 143px-card mechanism are consistent with what I measured but I did not independently isolate the 3-line-effect card. Labelled inferred-consistent, not verified.
2. **The A/B that produced "419 → 419" and "379 → 384"** (injected `<style>` freeing 5px of bottom padding) — I did not replay it. The conclusion it supports (freeing bottom inset lowers clearance one-for-one when content fits; hence removing the band restores 844×390 to 22px) **is** consistent with my measurements: 844×390 went 22 → and pre-fix 844×390 was 22 in my run too, because the band is absent from my pre-fix source as well.
3. **The deferred defects** — the 360×640 in-card text clip (`span.ctype`, `span.cost-gem`) and the 13 SVG-primitive clips — are explicitly out of scope in the contract (§2 Deferred) and I did not test them.
4. **Cross-machine reproducibility of absolute pixel values.** Content height is seed- and font-dependent; all numbers here are same-session, same chromium build.
5. **Whether hiding the `.hint` line at short viewports is intended** (probe shows 0/0 at 360×640, 844×390, 915×412, 1200×450). Not a contract criterion, so not a blocker — but the target outcome names the hint as part of what must be inside the window.
6. **`tools/dev/probe-eleven.mjs`** is still on disk (the fix report flagged its delete as blocked by the safety guard). Not my file to delete; noted, not touched.

## Raw evidence index (all under `tests/qa-layout-fix/`)

| file | what it holds |
|---|---|
| `01-viewport-default.txt` | default run, 9 rows, `ALL PASS`, exit 0 |
| `02-space-default.txt` | default run, 11 rows, `ALL PASS`, exit 0 |
| `03-det-vp-a.txt` / `03-det-vp-b.txt` | determinism pair, byte-identical (md5 `38902a000ed6f6e274fbbcbffa351151`) |
| `04-NC1-viewport-prefix.txt` | negative control: pre-fix CSS → exit 1, 6 FAIL rows |
| `05-NC2-space-prefix.txt` | negative control: pre-fix CSS → exit 1, 2 FAIL rows |
| `06-NC3a/NC3b-*-badurl.txt` | seed assertion firing on the redirect-bug URL → exit 1 |
| `07-NC3c-bogus-seed.txt` | bogus seed → exit 1 |
| `10-sweep-viewport-seeds1-12.txt` + `10-exit.txt` | S6, 108 rows, `ALL PASS`, exit 0 |
| `11-sweep-space-seeds1-12.txt` + `11-exit.txt` | S6, 132 rows, `ALL PASS`, exit 0 |
| `12-qa-probe.txt` | independent probe: hint + `#stage` clip assertions, 36 rows, exit 0 |
| `parse-harness.mjs`, `parse-two.mjs`, `qa-fit-probe.mjs` | my parsers/probe (QA-owned test code) |
| `backup-118.catA` / `live-118.catA` | byte dumps of the line-118 region, identical md5 |
| `sandbox-prefix/`, `sandbox-live/` | pre-fix and post-fix page fixtures used by the negative controls |
