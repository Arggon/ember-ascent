# UX-9 — Enemy Action FX: Every Enemy Turn Speaks

**Owner:** UX Designer → Frontend Engineer · 2026-11-01.
**Authority:** salvaged designer findings from this session's pass on ember-ascent. Every claim is tagged: `[READ]` = re-verified in source this run (10-call budget, spent); `[FINDINGS]` = verified by the prior designer pass, not re-read here; `[INFERRED]` = this spec's design decision. Format follows `UX-SPEC-run-history.md` (tagged claims, numbered sections, checkable ACs). No open design decisions remain.
**Sibling specs:** `UX-SPEC-run-history.md`, `NAMES.md` (name/proper-noun contract).

---

## 1. Context

Enemy turns are the half of combat the player watches, not plays — and today they are mostly mute. The hero's cards fly, pose and land named floats; the enemy side only plays its attack strikes. A Cantor that chants, an Ooze that licks you weak, a Maw that hardens behind 5 block: none of it produces a plan, a pose, a gate or a float. This spec gives all ten act-1 enemy types a per-move-kind presentation, fixes three defects found on the way (boss banner literal, `enemyLook()` roster gap, enemy chip juice keyed to the wrong statuses), and adds **zero new user-visible strings** and **zero runtime dependencies**.

## 2. Current mechanism (real names)

The one dispatch path and the FX pipeline it feeds `[READ]`:

1. **`act(actionId, targetK)`** in `src/web/actions.js` dispatches through the kernel controller, takes `before`/`after` snapshots, and diffs them. Kernel events for the step arrive as `res.events`.
2. **Enemy turn build (the gap's exact location):** on a turn flip, `act()` loops `res.events` and reads **only `ev.t === 'enemy_attack'`**, grouping per attacker into `turnStrikes`. Only then does it push `{ kind: 'enemy-turn', attacks: turnStrikes, playerLost }` as a burst. No attack events ⇒ **no burst at all** `[READ]`.
3. **Beat clock:** the `enemy-turn` burst arms `STRIKE_SEQ` from `src/web/runtime.js` — `{ beat: 500, slam: 640, impactAt: 0.46 }` `[FINDINGS]` — so per-attacker strikes play as a sequence before paint releases input.
4. **Paint:** `combatView()` paints `.fig.pose-*` on the hero and per-enemy `.efx` boxes `[FINDINGS]`.
5. **Dispatch:** `dispatchFx()` (`src/web/fx.js:190`) plays the armed bursts by scheduling nodes on `#fx-layer` via `fxAdd()` (from `./fx-add.js`) `[READ]`. Its first line is the reduced-motion gate:

   ```js
   if (reducedMotion || list.length === 0) return;   // fx.js:190–193 [READ]
   ```

6. **The one table-plus-knob system:** hero FX are data — `HERO_MOVES` / `HERO_SIGNATURES` / `SIG_FX` (`./fx-signatures.js`), iterated as `for (const [knob, play] of Object.entries(SIG_FX)) { if (sig[knob]) play(fire, lane, b, sigMs, gen) }` (`fx.js:313–317`) `[READ]`. Durations scale through `animMs()` / `animSpeed()` `[READ, imports]`.
7. **Kernel events available but unread by the web layer** `[FINDINGS]`: `enemy_block {enemy, amount}` and `enemy_status {enemy, status, stacks}`. `player_status` carries no enemy index.
8. **Boss welcome banner:** `fx.js:330` hardcodes `fxBanner('SLAG WARDEN', 'boss', '', animMs(1350))` inside the `welcome` block `[READ]` — every boss fight, including Cinder Foreman, announces the Warden.

## 3. Gap analysis

| Gap | Consequence |
|---|---|
| `act()` builds the enemy turn from `enemy_attack` only `[READ]` | Block / buff / debuff turns: no plan, no pose, no input gate, no floats — silent turns |
| `enemy_block`, `enemy_status` never read `[FINDINGS]` | The kernel already reports exactly what the presentation needs; the data is on the wire |
| `enemyLook()` (`src/web/glyphs.js:159`) knows 6 of 10 ids `[READ]` | `cinder_foreman`, `ash_wraith_elite` render with no boss/elite framing (no border, no boss name font) |
| `fx.js:330` literal `'SLAG WARDEN'` `[READ]` | Wrong boss name in both languages for the Foreman fight |
| `enemyCard()` calls `freshStatusKeys(e.statuses)` but the helper diffs against `lastPlayerStatuses` `[FINDINGS]` | Enemy chip juice-in keys off the *player's* statuses |

Dead end, do not build on it: `.eh-0..-4` are intentionally empty — type hue is a dead class `[FINDINGS]`.

## 4. The enemy-turn pipeline (shared spec — one system, no second one)

### 4.1 Events → beats (`actions.js`)

Replace the attack-only grouping with a full per-turn plan, in kernel resolution order, merged per enemy:

| Kernel event | Beat kind | Notes |
|---|---|---|
| `enemy_attack` | `strike` | unchanged content: attacker index, dealt, blocked, per-hit `[READ]` |
| `enemy_block {enemy, amount}` | `guard` | `[FINDINGS]` event shape |
| `enemy_status {enemy, status, stacks}` | `hex` if `status` is player-afflicting (`weak`, `vulnerable`), else `power` (e.g. `strength`) `[INFERRED mapping]` | `[FINDINGS]` event shape |
| `player_status` | — | carries no enemy index `[FINDINGS]`; not read |

- Burst shape (extension, not replacement): `{ kind: 'enemy-turn', beats: [{ enemy, kind, dealt?, blocked?, hits?, status?, stacks? }…], attacks, playerLost }` — `attacks` kept as today for the existing sequenced-float code.
- Compounds need **no special casing**: `thrash` (A7 B5) resolves as `strike` then `guard`; `bellow` (PWR3 B6) as `power` then `guard`; `skull_bash` (A6 VULN2) as `strike` then `hex`; `drift` (PWR1 B6) as `power` then `guard` — order = event order `[INFERRED]`.
- **A turn with any `enemy_*` event produces the burst** — this is the silent-turn fix. The gate arms for the whole sequence, attack or not `[INFERRED]`.
- Turn with zero `enemy_*` events (should not occur in combat): no burst, as today.

### 4.2 Beats → pose + FX (`combatView` / `fx.js`)

- **Pose table** `ENEMY_POSES` (kind → pose class + duration), painted as classes on the enemy card root (the node `combatView()` renders per living enemy — the same node existing `float` / `block-eat` / `absorbed` bursts attach to):

  | kind | class | duration (through `animMs()`) |
  |---|---|---|
  | strike | `epose-windup` → `epose-slam` | STRIKE_SEQ clock (`beat 500 / slam 640 / impactAt 0.46`) `[FINDINGS]` |
  | guard | `epose-guard` | 480 ms |
  | power | `epose-power` | 560 ms |
  | hex | `epose-hex` | 640 ms |

- **Per-type knob table** `ENEMY_SIG_FX` in `src/web/fx-signatures.js` (same file as `SIG_FX`), keyed by enemy id, values `{ attack, guard, power, hex }`; `dispatchFx()` iterates knobs exactly like the hero loop (`fx.js:315–317` shape) `[READ pattern]`. A knob that plays the default does nothing.
- All new nodes: children of `#fx-layer` via `fxAdd()`, positioned by existing lane classes (`side-*`), `aria-hidden="true"`, no text content, transform/opacity/filter-only animation.
- **Reduced motion:** inherited, not re-implemented — everything new is scheduled inside `dispatchFx()`, behind the existing single gate (`fx.js:190–193`) `[READ]`. Persistent paint-time states (`is-enraged`, `row-dim`) check the same `reducedMotion` view from `runtime.js` before adding transition-bearing classes; the state change itself remains visible through existing chips/floats.
- **Architecture:** all new code in `src/web/*`; gate is `npm run gate` (`scripts/check-architecture.mjs`) `[FINDINGS]`.

## 5. Per-type spec

Ten types (`src/kernel/rules/encounters.js` — **actual path**, not `src/kernel/encounters.js`) `[READ]`. Each entry: the move kinds its roster actually contains; FX beyond the §4 defaults. Art class names marked (N) are new glyphs.

### 5.1 Cinder Maw — `jaw_worm` (moves: chomp A11 `strike`; thrash A7 B5 `strike+guard`; bellow PWR3 B6 `power+guard`) `[READ]`
- **strike:** winds back too far (`epose-windup` overshoot, translateX −14 px over 60 % of the beat) then snaps. `.efx-maw-bite` arc wedge on the hero lane, `maw-bite-arc` 320 ms, impact on the slam clock. Shell plate shard `.efx-maw-plate` falls **mid-bite**, `maw-plate-fall` 240 ms.
- **strike+guard (thrash):** as above, then shared guard shimmer; the plate lands *between* the two beats.
- **power+guard (bellow):** `maw-inhale` 560 ms (scale 1 → 0.94 → 1.02) + guard; no bite.

### 5.2 Ash Cantor — `cultist` (scripted: incantation PWR3 `power`, then dark_strike A6 `strike`) `[READ]`
- **power (incantation):** rite column `.efx-rite-col` rises beside her, `rite-col-rise` 560 ms. She never moves toward the hero.
- **strike (dark_strike):** **no body lunge** — the column pulses and an ash cone `.efx-ash-cone` falls across the whole stage, `ash-cone-fall` 640 ms (scaleY from top, then dissolve); the hero float lands at the cone's ground touch.

### 5.3 Kiln Mite — `red_louse` (bite A6 `strike`; grow PWR2 `power`) `[READ]`
- **strike:** 460 ms dart — `mite-dart` (toward hero, back), one twitch keyframe (rotate 6°) at 85 %; impact dot on hero.
- **power (grow):** tightening, not enlarging — `mite-tighten` 560 ms (scale 1.04 → 0.97 → 1.0, inner glow intensifies). Hard cap: no keyframe exceeds scale 1.04.

### 5.4 Slag Ooze — `acid_slime` (tackle A10 `strike`; lick WK1 `hex`) `[READ]`
- **strike:** `ooze-compress` 300 ms (scaleY 0.8) then `ooze-lunge` 340 ms, squash-return.
- **hex (lick):** acid arc `.efx-acid-arc` from the ooze to the **hero's feet**, `acid-arc-drip` 640 ms (stroke draw, then droplet) — the arc is what tells you who hexed you; the weak tint itself arrives via existing status paint.

### 5.5 Cinder Brute — `gremlin_nob`, elite (rush A14 `strike`; skull_bash A6 VULN2 `strike+hex`; enrage PWR3 `power`) `[READ]`
- **strike (rush):** 900 ms charge — hold back, slam on the tail of the strike clock — plus stage shake `stage-shake` 240 ms (transform-only).
- **strike+hex (skull_bash):** shorter 640 ms charge + hex beat (vulnerable ring `vuln-ring` 480 ms on the hero chip).
- **power (enrage):** seams glow — `.efx-brute-seams` overlay, `brute-seams-glow` 720 ms double pulse; persistent `is-enraged` class (from snapshot statuses, paint-time) holds seams at 40 %.

### 5.6 Slag Warden — `the_guardian`, boss (charging_up B20 `guard`; fierce_bash A32 `strike`; whirlwind A5x3 `strike×3`; vent_steam VULN2 WK2 `hex`; scripted opener `charging_up`) `[READ]`
Defense is the flourish:
- **guard (B20):** three-plate wall `.efx-warden-wall` (3 `.plate` children), `warden-plate-rise` 3 × 160 ms staggered (480 ms), hold, absorb into body.
- **strike (fierce_bash):** heavy single slam + `warden-piston` (translateY forward 10 px).
- **strike ×3 (whirlwind):** triple-pocket impact — three `.efx-pocket` rings on the hero lane at 0 / beat / 2×beat, `pocket-ring` 240 ms each.
- **hex (vent_steam):** steam wash `.efx-steam` across the hero row, `steam-wash` 640 ms; no travel.

### 5.7 Slag Crawler — `slag_crawler` (harden B9 `guard`; pincers A4x2 `strike×2`; ram A10 `strike`) `[READ]`
- **guard (harden):** hexagonal shell geometry — `.efx-crawler-hex` hex outline draws around the body, `hex-draw` 480 ms; body dims.
- **strike ×2 (pincers):** two mirrored claw darts `.efx-claw-l` / `.efx-claw-r`, `claw-dart` 320 ms each, second offset 200 ms, converging on the hero.
- **strike (ram):** shared strike clock, `crawler-ram` low push (translateY 6 px).

### 5.8 Ash Wraith — `ash_wraith` (wail WK2 `hex`; drain A8 `strike`; drift PWR1 B6 `power+guard`) `[READ]`
Zero travel, ever:
- **hex (wail):** `wraith-thin` 480 ms (opacity 0.5, blur 1 px) in place + wail rings `.efx-wail-ring` expanding at the hero, `wail-ring` 480 ms.
- **strike (drain):** thins (opacity 0 at 30 %), crosses as a streak `.efx-wraith-streak`, thickens at the hero lane — `wraith-streak` 460 ms; impact dot.
- **power+guard (drift):** `wraith-drift` 560 ms vertical bob ±4 px + shared guard shimmer; no horizontal motion.

### 5.9 Ash Matriarch — `ash_wraith_elite`, elite `[FINDINGS]`
Same phase language as the Wraith, **area instead of distance**: the hero row dims (`row-dim`, opacity 0.6, 480 ms) while she holds full opacity. Her `strike` is an area veil `.efx-matriarch-veil` sweeping the whole hero row (`veil-sweep` 640 ms); `hex`/`power`/`guard` reuse the wraith phases. Binding is by beat kind (§4), so her exact move list needs no per-move entries.

### 5.10 Cinder Foreman — `cinder_foreman`, boss `[FINDINGS]`
- **strike:** marks the ground first — gold survey circle `.efx-survey-circle` on the hero lane, `survey-circle` 480 ms draw + one-beat hold — **then** the ceiling drops: `.efx-ceiling-slab` from the stage top, `ceiling-drop` 320 ms, impact on the slam clock, dust `.efx-dust` 240 ms.
- Other kinds: shared §4 beats with boss framing; the survey circle is attack-only.

## 6. Defects in scope

**D1 — Boss banner literal.** `fx.js:330` `fxBanner('SLAG WARDEN', 'boss', '', animMs(1350))` `[READ]`. Fix: the fight-enter welcome burst is built in `actions.js`, where the entering enemies are known; it carries `bossName` = the boss's `name` from the snapshot (already localized — the kernel re-derives snapshot sentences in the persisted language, I18N-1 `[READ]`). `fx.js` renders `fxBanner(welcome.bossName, …)`. Slag Warden and Cinder Foreman then both announce correctly in EN and ES. No boss in the fight ⇒ unchanged behavior.

**D2 — `enemyLook()` roster.** `src/web/glyphs.js:159` — extend the table to all ten ids `[READ current six]`:

```js
slag_crawler:     { art: 'e-crawler',    hue: 3 },
ash_wraith:       { art: 'e-wraith',     hue: 0 },
ash_wraith_elite: { art: 'e-matriarch',  elite: true, hue: 4 },
cinder_foreman:   { art: 'e-foreman',    boss: true,  hue: 2 },
```

The `boss`/`elite` flags drive the existing framing (border, boss name font) — the six verified ids prove the shape `[READ/FINDINGS]`. Four new silhouette glyph classes (N) in the enemy-glyph stylesheet. Hues stay assigned for table completeness but `.eh-0..-4` are intentionally empty — **do not build on them** `[FINDINGS]`. Note: the parameter is `id` (the JSDoc's `@param {string} name` is stale; fix the doc line while there).

**D3 — Enemy chip juice.** `enemyCard()` calls `freshStatusKeys(e.statuses)`, but the helper compares against `lastPlayerStatuses` — the enemy chip juices in when the *player's* statuses change `[FINDINGS]`. Fix: track per-enemy status keys in `runtime.js` (`lastEnemyStatuses`, setter `setLastEnemyStatuses`, cleared in `newGame()` alongside `setLastPlayerStatuses` — the run-scoped-reset home `[READ]`), and diff the enemy's statuses against its own previous keys.

## 7. i18n & accessibility statement

- **Zero new user-visible strings.** Every new node is `aria-hidden="true"` decoration with no text content. No i18n dictionary keys are added; the `t()`-key wiring tests stay untouched.
- **One English literal is removed:** the hardcoded `'SLAG WARDEN'` banner (D1) — replaced by the snapshot name, which is a proper noun the kernel already localizes (`name` / `name_es` per enemy, `NAMES.md` contract) `[READ]`.
- Announcements for enemy turns continue to come from the existing toast/announce path; this spec adds none.

## 8. Acceptance criteria (checkable)

- **AC-1 Silent turns:** on a pinned seed, a turn containing only `enemy_block` and/or `enemy_status` produces an `enemy-turn` burst with pose classes applied, input locked for the sequence, and a guard/power/hex float or status cue — verified from a full-fight capture.
- **AC-2 Per-type FX:** for each of the ten types, a full-fight capture on a pinned seed shows the §5 behaviors for every move kind in its roster (compounds play as ordered beats).
- **AC-3 Framing:** all ten ids render through `enemyLook()`; `cinder_foreman` gets boss framing, `ash_wraith_elite` elite framing; the fallback `e-rune` branch is unreachable for roster ids.
- **AC-4 Banner:** both boss fights announce the acting boss's name in EN and ES; `grep 'SLAG WARDEN' src/web/fx.js` returns no hit.
- **AC-5 Chip juice:** an enemy gaining a status juices that enemy's chip only; a player status gain juices only the player's; stacking updates re-juice.
- **AC-6 No geometry:** the diff adds **no `width` or `height` declarations anywhere** — phone-portrait viewport rows are already red for pre-existing reasons; this spec must not add to them. All motion is transform/opacity/filter.
- **AC-7 Architecture:** `npm run gate` passes; every new module lives under `src/web/`.
- **AC-8 i18n:** `git diff` on the i18n dictionaries is empty; no new `aria`-visible text.
- **AC-9 Deps:** `package.json` unchanged.
- **AC-10 No test-only kernel hooks:** kernel sources and kernel test fixtures untouched.
- **AC-11 Reduced motion:** with reduced motion on, `dispatchFx()` returns before scheduling any new node; no transition-bearing paint class is added; turns still resolve through existing floats/toasts.
- **AC-12 Compound ordering:** thrash/bellow/skull_bash/drift captures show beat order matching kernel event order.

## 9. Verification approach

Pinned seed (`?seed=`, via the existing `seedFromUrl` `[READ]`) + full-fight capture per enemy type; acceptance judged from the captures, per AC-1/2/12. Four rosters are scripted (`cultist`, `the_guardian`, and the two wraiths `[FINDINGS]`) and reproduce turn-for-turn. The rest choose intents through `chooseIntent` (RNG) `[FINDINGS]`: pin a seed on which the target move occurs — **no test-only kernel hooks** (AC-10). Repeat per move kind.

## 10. Out of scope (suggestions only)

- `NODE_WORDS.boss = 'Slag Warden'` (`glyphs.js`) — the *map node* label hardcodes the Warden's name for the boss node type; same defect class as D1 but map chrome, separate change.
- New kernel events, player-side FX, `.eh-*` revival, and the pre-existing viewport red rows.
- `enemyLook()`'s stale JSDoc is fixed in passing (D2); no other glyph-table refactors.
