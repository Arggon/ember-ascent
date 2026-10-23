# CARD-MOVES-STATUS — per-card hero combat movement

**Date:** 2026-10-23 · **Task:** "Improve attacks and defense animations. Character must
perform different attack or defend movements based on the played card." · **Round 2:**
"I don't see or notice any change in the card or the characters." · **Round 3:** "I was
expecting animations with movements, the character and mobs actually doing fighting
moves and hitting each others. Or some kind of armor glowing animation for defense. If
the card say something about a flying attack the Character could throw the hammer."

## Round 3 — real combat choreography (approved plan, executed)

**Constraint honored:** every character was one static sprite (no frames exist). Four
NEW hero pose frames were AI-generated from `hero.webp` as the style reference
(image-to-image), alpha-cut with a luminance flood-fill (border-connected near-black bg;
repo's `sprite-cutout.py` approach reimplemented in Node/sharp), and normalized onto the
idle 555x512 canvas with feet on the same baseline: `hero-windup/-strike/-guard/-channel.webp`
(in `src/web/assets/sprites/`). The Bellows Keeper has no frame set (documented in code).

**What plays now (live-verified in real Chromium):**
- **Frame-swap choreography** — `heroMarkup()` stacks the four frames over the idle
  sprite; each move cross-fades idle→frame→idle in phase with the body motion: HEAVY =
  windup (cocked hammer) 0-55% then strike follow-through 58-94% over a 36px over-swing;
  FLURRY = the strike frame flashing 3 jabs; GUARD = barrier stance + **glowing armor
  dome** (`fx-armor-dome`, blue-white ring, flashes with the block number); CHANNEL =
  raised-arms frame + five rising embers (`fx-channel-embers`); SWEEP = strike frame on
  the wide arc; THROW = windup → **spinning hammer projectile** (`fx-hammer`, code-drawn
  ink/ember head + haft) arcing to the aim lane, **impact burst** (`fx-hammer-hit`) at
  84% of the flight, and Returning Brand's hammer FLIES BACK (`fx-hammer-returns`) per
  its flavor "Heat you threw comes back"; Blood Hammer hurls and stays (HERO_THROWS).
- **Enemies fight** — enemy attack turns now play `foe-slam`: anticipation pull-back, a
  long dash across the stage (vw-based, capped), impact beat (the hero's hurt flinch +
  KNOCKBACK — `hero-hurt` now shoves the hero 26px with rotation; enemies get the same
  22px knockback), then return.

**Live evidence (CDP, headless Chromium):** `pose-guard` + `fx-armor-dome:true` on Quench
(frame: hero crouched behind hammer-barrier, dome visible); `pose-heavy` on Anvil Blow;
`pose-strike` on Hammerfall with fx flight frames; `ENEMY-SLAM` + `pose-hurt` observed on
enemy turns; `pose-channel` on Bellows/Stoke. Frames in `shots/card-moves/`.
Reduced motion: every new layer/pose/effect named in the kill-lists; `.spr-frame` is
`display:none` there, so a static hero always shows the idle stance.

**Bugs found & fixed during round 3:** `heroEfx()` passed an ARRAY to `heroMove()` (dome
never fired); guard left the hero INVISIBLE for the tail of the hold (idle now animates
back in instead of staying at opacity 0); duplicate top-level selectors (gate rule 3)
from the old sprite-glow rules — merged into the choreography block.

**Round-1/2 fixes remain in place** (speed default 1x, pose hold across hover repaints).

**Gates (measured):** `npm test` 207 tests · 206 pass · 0 fail · 1 pre-existing todo;
gate OK; surface-art OK (243 emitted / 372 declared, 588 distinct top-level selectors).
Release rebuilt AFTER all fixes: zip sha256 `f9e99219…`; `release/assets/sprites/`
contains the 4 new frames; `release/app.js`/`style.css` contain the choreography.
**Upload `release.zip` for itch.io to match.**

---

## Round 1-2 history (below, unchanged)

## Follow-up findings (owner could not see any change)

1. **The shipped default animation speed was 0 ("skip").** `readAnimSpeed()` fed
   `Number(localStorage.getItem(...))` straight into its 0/1/2 check; `Number(null)` is
   `0`, so a browser with no stored preference ran with every combat animation skipped —
   no card flight, no hit-stop, no movement. That state was invisible in the speed dock
   (no button highlighted on a fresh profile). Fixed: nothing stored (or blank) now
   defaults to 1; only an explicit stored 0/1/2 overrides. Pinned by a test.
2. **The pose died on the first mousemove.** `bursts` lives for exactly one paint, and
   any hover repaint rebuilt the hero without the pose, cutting the swing after a
   fraction. Fixed with `heroMoveHold`: the pose is held for the animation's own
   duration (plus the hit-stop beat), fresh plays replace the hold, mid-run repaints
   resume the keyframe with a negative `animation-delay` (no stutter/replay), and the
   window is released lazily. Two tests pin it.
3. **The movements were too small to register.** Amplified: strike 16→28px, heavy to a
   36px wind-up smash with lean and squash, flurry to 3 faster 22–26px jabs, sweep
   9→18/24px arc, guard deepens to a 10px plant with a stronger squash, channel rises
   16px; durations stretched to 0.5–0.6s so each card reads as its own move.
4. **The itch.io comparison could not show the change** — the online page runs the last
   uploaded bundle. `release/` + `release.zip` were rebuilt AFTER these fixes
   (zip sha256 `eb141bc0…`); upload that for the online build to match.

Live-browser evidence (headless Chromium, real clicks, CDP): speed dock shows **1× on by
default with empty storage**; an attack play shows the **fx-card flight for 15 frames**
and `pose-strike` on the hero figure; Quench shows `pose-guard`. Frames:
`shots/card-moves/mid-attack-strike.png`, `shots/card-moves/mid-defend-guard.png`.

## What changed (original delivery)

The hero's combat movement is now chosen by WHICH card was played, not only by its type.

- `src/web/app.js` — `act()` carries the played card's id on the `card-fly` burst
  (`id: played.cardId`, sourced from the before-snapshot hand tile, i.e. the tile that was
  actually clicked). New `HERO_MOVES` table (44 entries, one per shipped card) + `heroMove()`
  + rewritten `heroPose()`; prototype-safe lookup via `Object.hasOwn`.
- `src/web/style.css` — five new hero-only keyframes + rules:
  - `pose-heavy` (hero-heavy 0.5s): wind-up smash — bash, clothesline, wild_strike, carnage,
    uppercut, bludgeon, hemokinesis
  - `pose-flurry` (hero-flurry 0.55s): rapid multi-hit shuffle — twin_strike, pummel
  - `pose-sweep` (hero-sweep 0.45s): wide arc for all-target attacks — cleave, thunderclap,
    sword_boomerang, reaper, gust
  - `pose-guard` (hero-guard 0.38s): plant & brace for block/armor skills — defend, shrug,
    true_grit, armaments, entrench, flame_barrier, ghostly_armor, impervious
  - `pose-channel` (hero-channel 0.5s): ember-lift for buffs/powers/utility — flex, warcry,
    havoc, battle_trance, bloodletting, offering, limit_break, shockwave, combust,
    dark_embrace, feel_no_pain, inflame, metallicize, rupture, fan_flames
  - existing `pose-strike` retained for basic jabs (strike, anger, headbutt, pommel,
    dropkick, ironwave, rampage); unknown/future ids fall back to the old type behaviour
    (attack→strike, skill/power→brace). Matching `.spr` filter/scale reads per move.
  - all five new poses added to the reduced-motion kill-list.
- `scripts/check-surface-art.mjs` — pose whitelist extended to the new values, now expressed
  as `POSE_VALUES`; NEW rule 1b: every whitelisted pose must have a top-level
  `.fig.pose-*` rule carrying an `animation:` declaration whose keyframe is defined
  (a mere mention, e.g. in the reduced-motion kill-list, no longer satisfies the gate).
- `tests/kernel/hero-card-poses.test.js` (new, 6 tests) — drives real `app.js` against the
  fake DOM (same harness shape as `click-targeting.test.js`): strike vs heavy vs guard
  rendering on real card clicks; every shipped card resolves to a pose the stylesheet
  really animates (declaration + keyframe checked); HERO_MOVES keys are real card ids;
  unknown-id and Object.prototype-key fallbacks; hurt-flinch precedence over card movement.
- `archive/animation-move-backup/` — S7 rollback point (pre-change copies + MANIFEST.md +
  verifiable SHA256SUMS.txt), following the `layout-fix-backup/` convention.

## Precedence note (intentional)

`heroPose()` precedence: hurt flinch > card movement > low > idle. HP-cost cards
(bloodletting, offering, hemokinesis) read as `hurt` whenever HP was actually lost on the
action — documented in code and pinned by a dedicated test.

## Verification (all measured this session)

| Command | Before (baseline) | After |
|---|---|---|
| `npm test` | 197 tests · 196 pass · 0 fail · 1 todo | 206 tests · 205 pass · 0 fail · 1 todo |
| `npm run gate` | OK, no R1/R3 violations | OK, no R1/R3 violations |
| `node scripts/check-surface-art.mjs` | 233 emitted / 353 declared · OK | 238 emitted / 358 declared · OK (incl. new rule 1b) |
| `node --test tests/kernel/hero-card-poses.test.js` | — | 9 pass / 0 fail |
| release rebuild | zip `9678f0dd…` (pre-follow-up) | zip `eb141bc0…` (contains heroMoveHold + speed fix) |

- Pre-existing failure, unchanged by this task: `tests/history/record.test.js:384` —
  `# TODO` kernel defect "poolSelection must actually return FRESH_SIZE cards (24), got 21".
  Present in the pre-change baseline; out of scope here.
- Mutation probe: deleting `@keyframes hero-heavy` + its rule makes BOTH the new test
  (1 fail) and the surface-art gate (`FAIL pose rule(s) …: pose-heavy`) go red; restored
  byte-identical afterwards (sha256 `ffc99ff9…` before/after).
- Frozen layout contract: `scripts/dev/viewport-check.mjs --seeds 1-3` fails 20 rows both
  before AND after this change with byte-identical FAIL sets (card rules-text clipping and
  HUD hero-name truncation at @130% font phone sizes) — all pre-existing, none reference
  poses/figures/animations. New keyframes are transform/filter-only on `.fig`/`.spr`
  (max 20px displacement vs 16px for the existing hero-strike), so no layout/scroll impact.
