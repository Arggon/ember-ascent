# PM verification log — increment 2

Owner: Product Manager. Every line below is something **I ran or observed myself** this
session, with the command that produced it. Status files and agent reports are *claims*;
this file records what I independently confirmed or falsified.

---

## 1. Two defects in the project's own record, found this session

### PM-1 — The browser page was genuinely broken, and `npm test` cannot see it
`lastPlayerStatuses` was **assigned but never declared** in `web/app.js`. Because `app.js`
is an ES module it runs in **strict mode**, so every `render()` threw
`ReferenceError: lastPlayerStatuses is not defined` — the page repainted once and then
died. **A green `npm test` (93 pass / 0 fail) coexisted with a broken game**, because the
test harness evaluates `app.js` through `new Function()`, whose body is **sloppy** mode:
the same assignment silently creates a global in tests and throws in the real page.

- Fixed by the Frontend Engineer (`web/app.js:93` declaration, `:743` reset, `:1265` reader).
- **PM confirmed the page is alive after the fix:** `node tools/dev/shoot.mjs --base http://localhost:5188/web/index.html --out /tmp/verify-after` → **8/8 frames captured**, including `combat.png` with 2 enemies.
- **Consequence for the project:** the surface has no test that would catch this class of
  error. This is an open gap, recorded here rather than fixed (it is `tests/**`, and out of
  my lane as PM).

### PM-2 — My own reproduction URL was wrong
`http://localhost:5173/web/?seed=13` **does not reach seed 13**. `tools/serve.mjs` answers
that request with **301 → `/web/?seed=13/`** (it appends a slash to the whole URL including
the query), and `seedFromUrl()` then computes `Number('13/')` → `NaN`, yielding a **random**
seed.
- Measured: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:5188/web/?seed=13` → `301 http://localhost:5188/web/?seed=13/`.
- Correct form: **`/web/index.html?seed=13`** → `200`.
- I gave the wrong URL to two agents. Recorded so the next person does not repeat it.

---

## 2. DEF-6 (blank climax) — **VERIFIED FIXED**

The defect: on the terminal kill, `web/app.js` wiped the stage to a bare `.ended-hold` div
and returned before the `switch`, bypassing the only code that draws enemies or the death
ghost. Measured before the fix: **29 consecutive animation frames with the stage empty**
(~480 ms on defeat, ~1150 ms on boss victory).

**After the fix, measured by per-frame logging over two independent full runs:**

| Run | Combat actions | Frames observed | Ghost frames | Living-enemy frames | **Blank-hold frames** |
|---|---|---|---|---|---|
| `seed=11` (defeat, floor 2) | 37 | 158 | 11 | 120 | **0** |
| `seed=13` (defeat, floor 6) | 91 | 345 | 25 | 285 | **0** |
| `seed=33` via click-replay (defeat, floor 4) | 63 | 266 | 2 | — | **0** |

The assertion used is the defect's own signature: a frame in which `.ended-hold` is present,
the stage's `innerText` is empty, **and** no end panel has painted yet. **29 → 0.**

**Frame evidence:** `shots/pm-verify/death/after-ghost-1.png` shows a real collapse — a
**"Red Louse"** card greyed with a red **DOWN** label — beside a still-living Red Louse
(HP 10/10, intent "Will attack for 6"), with the player at 60/60 HP and readable cards. It
reads as an intentional downed state, not a glitch and not blank space.

**Honest limits:** the **boss-victory** hold specifically was **not** captured. My click
translation desyncs from the kernel action log partway through a long run, so I could not
drive a run to the boss through the DOM. The win path uses the same `dyingRow()` builder as
the verified ordinary-death path, and the defeat path (the common outcome, ~93% of bot
runs) is verified empirically. **AC-5.6a is therefore verified by construction and
partially by observation; AC-5.6b is verified empirically.**

---

## 3. The backend bug I had to fix myself

The Backend Engineer reported an **inverted pool branch** in `src/surface/sim.js` and said
it "may break tests". I verified it was real before fixing:

```
contentForProfile(null)          -> 21 cards   (this is the FRESH pool)
contentForProfile(fullyUnlocked) -> 39 cards   (this is the FULL pool)
sim.js:46  opts.profile === 'fresh' ? contentForProfile(fullyUnlockedProfile()) : contentForProfile(null)
```

That gave `fresh` the 39-card pool and the default the 21-card pool — **exactly inverted**.
- **Fixed** to `opts.profile === 'fresh' ? contentForProfile(null) : contentForProfile(fullyUnlockedProfile())`, and removed the now-dead `runHash` import.
- **Verified after the fix:** `playRun({seed:5})` → `profile:"full"`, score 33; `playRun({seed:5, profile:'fresh'})` → `profile:"fresh"`, score 34. The two pools now differ correctly.
- **`npm test` after the fix: 93 pass / 0 fail.** `npm run gate`: `scanned 29 files under src/`, `OK — no R1/R3 violations`.

---

## 4. DR-2 — implemented AND its bite is now proven

Both agents were told to *add* the rule that the kernel and `web/**` may import no `node:*`.
**It was already there.** I read the gate: line 85 walks `src/` **and** `web/`; line 91
defines `isSurface`; **line 116** rejects `node:*` in `web/**`; **line 131** rejects it in
`src/kernel/**`.

**I then proved it actually fails**, which nobody had done:

```
$ npm run gate                      # clean tree
check-architecture: scanned 29 files under src/     → OK — no R1/R3 violations  (exit 0)

# injected `import { readFileSync } from 'node:fs'` into src/kernel/observe.js
$ npm run gate
  FAIL  R3  src/kernel/observe.js  kernel imports node builtin "node:fs" (browser-unsafe)
1 violation(s)                                       (exit 2)

# reverted
$ npm run gate                                       → OK — no R1/R3 violations  (exit 0)
```

So the rule is not merely authored, it **bites**: a kernel file that reaches for a Node
builtin fails the gate with exit 2. `npm test` afterwards: **93 pass / 0 fail**; `observe.js`
confirmed clean. DR-2 is **complete and closed**.

---

## 5. Documentation — verified by me

`PHASE5-STATUS.md` claimed **50 tests / 0 fail** and **22 files scanned**; the real values are
**93** and **29**. The Technical Writer correctly marked these **STALE** and refused to plant
numbers it could not re-measure (its run had no shell), naming the command instead. I
confirmed the real values myself. The false *"no browser in this environment"* limitation is
**withdrawn with a dated correction** in `ART-PASS-STATUS.md`, `ITCH-UPLOAD.md`,
`JUICE-STATUS.md` and `LAYOUT-STATUS.md`. `JUICE-STATUS.md`'s claim that the death beat is
unbuilt is corrected, and `prevEnemies` is now recorded as the dead code it is.

---

## 6. Still owed before this increment can be called done

1. **AC-5.6a's boss-victory frame** — the one visual case not captured (see §2).
2. ~~**DR-2's failure direction**~~ — **DONE, see §4.** The gate fails with exit 2 on a kernel `node:*` import and passes after revert.
3. **DEF-1** — `tests/cards/cards.test.js:123` and `tests/budget.test.js:49` still hardcode `42`. Not started.
4. **All new tests** — determinism (AC-7.2), the AC-9.3 two-layer power-creep negative, AC-6.5 record agreement, backward compatibility on the 150 legacy records, retention. **Zero exist.**
5. **The history CLI** — `--pool full|fresh` and a `history` read command. `historyView()` is currently reachable only from tests.
6. **The history UI** — the Ledger, run summary, unlock narration and empty state per `UX-SPEC-run-history.md`; plus the `--faint` contrast fix (measured 3.85:1 today against a frozen 4.5:1 floor) and the AC-4.6 explanatory treatment.
7. **A strict-mode or real-browser smoke in the gate** — so PM-1's class of bug cannot pass unnoticed again.
8. **Rebuild `release/` and `release.zip`** and re-verify byte-reproducibility.
9. **The fun gate (Gate B)** — owner 10 runs + one independent tester 5 runs, with the `?pool=full` flag and no briefing. Unstarted by design; it is the last step and it is not mine to pass alone.

---

_Every number above came from a command run in this workspace on 2026-10-16. Where a claim
rests on an agent's report rather than my own observation, it says so._
