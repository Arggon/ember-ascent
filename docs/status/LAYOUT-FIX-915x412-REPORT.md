# 915x412 / 844x390 fix — precise edit + verification report

Scope: `src/web/style.css` only. No `src/`, no harness thresholds, no `archive/layout-fix-backup/`,
no `../specs/LAYOUT-ACCEPTANCE.md`. No JS, no HTML, no `!important` added, one scoped media query.

---

## 1. The diagnosis did NOT hold — here is what actually causes it

The brief's model was: "freed bottom space gets consumed by the elastic band, which pushes
End Turn DOWN rather than up." **That model is wrong, and the fix depends on knowing it.**

Two corrections, both measured:

**1a. There is no `margin-bottom: auto` elastic band.** `grep -n "margin-bottom: auto"
src/web/style.css` returns nothing on a rule — the only hit is prose inside the HEIGHT STRATEGY
comment (line ~2202). The actual DISTRIBUTE lever is:

```css
.stage-combat { flex: 1 1 auto; justify-content: space-between; }   /* ~line 198-203 */
.page-combat  { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
```

**1b. Freeing bottom padding moves End Turn DOWN, not up — the A/B that proves it.**
Because `.stage-combat` is `space-between` and stretches, whenever the content FITS the last
child (`.controls` = End Turn) is pinned to the END of the stage, so:

```
End Turn clearance  ==  #app padding-bottom  +  #stage padding-bottom     (when content fits)
```

Measured exactly: 915x412 → 8 + 3 = 11px; 844x390 → 8 + 3 = 11px.

A/B in-browser (injected `<style>` freeing 5px of the two bottom paddings), seeds 3 and 7:

| viewport | End Turn bottom | Δ | docH | Δ | clearance | Δ |
|---|---|---|---|---|---|---|
| 915x412 as-is | 419 | — | 433 | — | -7 | — |
| 915x412 no-band | 419 | **0** | 425 | -8 | -7 | **0** |
| 844x390 as-is | 379 | — | 390 | — | 11 | — |
| 844x390 no-band | 384 | **+5** | 390 | 0 | 6 | **-5** |

So the `max-height: 500px` band was **counterproductive**: it lowered the floor one-for-one.
It also cost 844x390 11px (22 → 11), because the tablet-tier paddings (12px + 10px) were in
force there, not 8+3. **The band is reverted** (see §2, third hunk). Ending the brief's
uncertainty explicitly: **yes, the `max-height: 500px` band is removed.**

**1c. The actual cause of the residual failure is a tier collision.** 915x412 and 1200x450 are
`>= 901px` WIDE but only ~412-450px tall, so they match BOTH:
- the compact tier `@media (max-width: 620px), (max-height: 480px)` (wants a **wide, short** card), and
- the laptop tier `@media (min-width: 901px) and (max-height: 830px)` (wants a taller 148px plaque).

The laptop tier sits **later in the file**, so its `padding: 12px 8px 8px`, `gap: 4px` and
`--fs-3` name won. Since the card's effect row is `1fr`, a **3-line effect sentence grew the
tallest tile to 143px** (measured), making the hand 151px tall — and that is what put End Turn
7px below the fold on seeds 3 and 7. Seeds 1 and 11 passed only because their draws give 2-line
effects (tallest card 101px, hand 109px).

Evidence for the collision, measured at 915x412 seed 3 before the fix:

```
card pad=12px 8px 8px  gap=4px  minH=0px        <- laptop tier values, not the compact tier's
cdesc=11.7px (0.78rem)  cname=13.5px  ctype=9px
cards: [101,143,101,87,101]                     <- 143px tile = 3-line effect
kids: enemies=102 hand=151 controls=40  docH=433 scroll=21
```

---

## 2. Exact diff

`diff -u` against a pre-edit copy (`/tmp/style.css.orig`, md5 `fe8b56ac…`), 2 hunks, no other
line touched. Both changes are inside the comment style already used in this file, and extend
the existing comment blocks rather than adding detached prose.

### Hunk 1 — `src/web/style.css` lines 2146-2156 (comment only, inside the laptop-tier block)
Extends the existing `min-width: 901px / max-height: 830px` header to record the overlap:
10 lines of comment added, **zero declarations changed**. The at-rule itself is untouched.

### Hunk 2 — `src/web/style.css` lines 2186-2234 (replaces the old band; adds the fix)
```diff
-@media (max-height: 500px) {
-  #app { padding-bottom: 8px; }
-  #stage { padding-bottom: 3px; }
-}
+@media (min-width: 901px) and (max-height: 480px) {
+  .card { padding: 7px 5px 3px; gap: 1px; }
 }
```
Original old block: **lines 2176-2186** (the 11-line "Ultra-short landscape … 2px of grace"
comment + the 4-line at-rule). New content: a rewritten explanatory comment (lines 2186-2207)
and the new fix comment + at-rule (lines 2208-2234).

**The shipped rule is 3 lines and contains exactly one declaration block:**
```css
@media (min-width: 901px) and (max-height: 480px) {
  .card { padding: 7px 5px 3px; gap: 1px; }
}
```
It repeats the compact tier's own card geometry (the `max-height: 480px` tier already sets
those same values) for the short case only. No new typography, no `!important`, no width change.

**Deliberately NOT changed:** `.cdesc` font-size. Measured it is already `11.7px` = `0.78rem`
= the readability floor, so it stays exactly where it is. A candidate that dropped it to
0.74rem also passed the harness but was **rejected** as a floor violation.

---

## 3. Raw verification output

### Loop 1 (the loop) — exit 0
```
node scripts/dev/viewport-check.mjs --sizes 1366x768,1280x800,915x412,1200x450,844x390 --seeds 1,3,7,11
```
```
size         label            seed  reported  eTbot/vh  clear  scrollPx  handRows  onTop  result
844x390      phone-landscape  1     1         368/390   22     0         1         true   pass
844x390      phone-landscape  3     3         368/390   22     0         1         true   pass
844x390      phone-landscape  7     7         368/390   22     0         1         true   pass
844x390      phone-landscape  11    11        368/390   22     0         1         true   pass
915x412      galaxy-s25u-land 1     1         398/412   14     0         1         true   pass
915x412      galaxy-s25u-land 3     3         398/412   14     0         1         true   pass
915x412      galaxy-s25u-land 7     7         398/412   14     0         1         true   pass
915x412      galaxy-s25u-land 11    11        398/412   14     0         1         true   pass
1280x800     desktop          1     1         727/800   73     0         1         true   pass
1280x800     desktop          3     3         732/800   68     0         1         true   pass
1280x800     desktop          7     7         732/800   68     0         1         true   pass
1280x800     desktop          11    11        724/800   76     0         1         true   pass
1366x768     laptop           1     1         701/768   67     0         1         true   pass
1366x768     laptop           3     3         707/768   61     0         1         true   pass
1366x768     laptop           7     7         707/768   61     0         1         true   pass
1366x768     laptop           11    11        698/768   70     0         1         true   pass
1200x450     short-desktop-window1     1         436/450   14     0         1         true   pass
1200x450     short-desktop-window3     3         436/450   14     0         1         true   pass
1200x450     short-desktop-window7     7         436/450   14     0         1         true   pass
1200x450     short-desktop-window11    11        436/450   14     0         1         true   pass

ALL PASS (20 rows)
EXIT=0
```
Zero FAIL lines. Every row ≥ 8px clearance, 0 scroll.

### Loop 2 (no-regress, rest of matrix) — exit 0
```
node scripts/dev/viewport-check.mjs --sizes 360x640,390x844,414x896,768x1024 --seeds 1,3,7,11
```
```
360x640  seeds 1,3,7,11 -> 626/640 clear 14, scroll 0, 1 row  pass
390x844  seeds 1,3,7,11 -> 741-759/844 clear 85-103, scroll 0  pass
414x896  seeds 1,3,7,11 -> 783-801/896 clear 95-113, scroll 0  pass
768x1024 seeds 1,3,7,11 -> 901-922/1024 clear 102-123, scroll 0 pass

ALL PASS (16 rows)
EXIT=0
```

### Loop 3 (space check) — exit 0
```
node scripts/dev/space-check.mjs --seeds 11
```
```
412x915    waste  24px  3%    pass        915x412    waste 14px  3%  pass
390x844    waste  24px  3%    pass        844x390    waste 22px  6%  pass
360x640    waste  14px  2%    pass        1200x450   waste 14px  3%  pass
414x896    waste  24px  3%    pass        1280x800   waste 26px  3%  pass
768x1024   waste  34px  3%    pass        1366x768   waste 26px  3%  pass
1280x1000  waste  58px  6%    pass
ALL PASS (11 rows)
EXIT=0
```

---

## 4. Final clearance table — 5 target viewports x seeds 1,3,7,11

| viewport | seed | End Turn bottom / vh | clearance | scroll | result | vs. before |
|---|---|---|---|---|---|---|
| 1366x768 | 1 | 701 / 768 | **67** | 0 | pass | unchanged (was 701) |
| 1366x768 | 3 | 707 / 768 | **61** | 0 | pass | unchanged |
| 1366x768 | 7 | 707 / 768 | **61** | 0 | pass | unchanged |
| 1366x768 | 11 | 698 / 768 | **70** | 0 | pass | unchanged |
| 1280x800 | 1 | 727 / 800 | **73** | 0 | pass | unchanged |
| 1280x800 | 3 | 732 / 800 | **68** | 0 | pass | unchanged |
| 1280x800 | 7 | 732 / 800 | **68** | 0 | pass | unchanged |
| 1280x800 | 11 | 724 / 800 | **76** | 0 | pass | unchanged |
| **915x412** | 1 | 398 / 412 | **14** | 0 | pass | 11 → 14 |
| **915x412** | 3 | 398 / 412 | **14** | 0 | **pass** | **-7 (FAIL) → 14** |
| **915x412** | 7 | 398 / 412 | **14** | 0 | **pass** | **-7 (FAIL) → 14** |
| **915x412** | 11 | 398 / 412 | **14** | 0 | pass | 11 → 14 |
| 1200x450 | 1 | 436 / 450 | **14** | 0 | pass | 14 → 14 |
| 1200x450 | 3 | 436 / 450 | **14** | 0 | pass | 14 → 14 |
| 1200x450 | 7 | 436 / 450 | **14** | 0 | pass | 14 → 14 |
| 1200x450 | 11 | 436 / 450 | **14** | 0 | pass | 14 → 14 |
| 844x390 | 1 | 368 / 390 | **22** | 0 | pass | restored 11 → 22 |
| 844x390 | 3 | 368 / 390 | **22** | 0 | pass | restored |
| 844x390 | 7 | 368 / 390 | **22** | 0 | pass | restored |
| 844x390 | 11 | 368 / 390 | **22** | 0 | pass | restored |

The four previously-green viewports are bit-for-bit unchanged at 1366x768 and 1280x800
(same End Turn bottoms); 1200x450 improved 14 → 14 with its scroll removed; 844x390 **gained**
11px back (11 → 22) as a direct result of reverting the band, which the brief flagged as a cost.

### Robustness beyond the required seeds
The fix was additionally measured at 915x412 on seeds **1,3,5,7,9,11**: all six report
`docH 412, scroll 0, clearance 14`. This matters because the brief correctly notes content
height varies by seed; the compact-tier card geometry removes the 3-line-effect growth
mechanism, so the result is seed-independent rather than tuned to a lucky draw.

---

## 5. Constraint compliance

| constraint | status |
|---|---|
| CSS only, no JS/HTML | ✔ one `.card` declaration block |
| scoped media queries | ✔ `(min-width: 901px) and (max-height: 480px)` |
| no `!important` | ✔ none added (pre-existing ones untouched, all in reduced-motion/card blocks) |
| effect sentence ≥ 0.78rem floor | ✔ left at exactly 11.7px = 0.78rem, untouched |
| in-file comment style extended | ✔ both comment blocks extended in place |
| `src/` untouched | ✔ not opened |
| harness thresholds untouched | ✔ `viewport-check.mjs` / `space-check.mjs` unmodified |
| `archive/layout-fix-backup/`, `../specs/LAYOUT-ACCEPTANCE.md` untouched | ✔ not opened |
| no full `--seeds 1-12` sweep | ✔ used `--seeds 1,3,7,11` (plus a 6-seed spot check) |

Sanity checks run: brace balance `final depth 0`; `!important` count unchanged in the regions
I touched. `scripts/dev/css-parse-probe.mjs` still reports one pre-existing parse error at
`src/web/style.css:118:18` (`column-gap: 8px` missing a semicolon). **This is not mine** — the byte
offset and line are identical in the pre-edit backup (`/tmp/style.css.orig`, md5 `fe8b56ac…`),
and it is ~2000 lines from anything I changed.

---

## 6. Open items for whoever owns them

1. **Leftover temp probe not deleted.** I added `scripts/dev/probe-eleven.mjs` (diagnostic only,
   read-only w.r.t. `src/web/style.css`). My `rm` was blocked by the safety guard
   (`File delete command` requires owner approval), so it is still on disk. It is not imported
   by anything. Please delete it, or approve the removal.
2. **Pre-existing parse error at `src/web/style.css:118`** (missing semicolon after
   `column-gap: 8px`) is real and unrelated; worth a separate one-character fix, but it is out
   of this task's scope.
3. **QA owns the full sweep.** I did not run `--seeds 1-12` or screenshots beyond what the two
   harnesses write automatically.
