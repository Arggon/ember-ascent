# UX-9 Dev Notes — Every Enemy Turn Speaks (2026-11-01)

Built in three passes after two investigation-only passes established the map (their tool budgets died reading; nothing was lost — the map below is theirs, verified twice against source). Spec: `docs/specs/UX-9-enemy-action-fx-spec.md`. QA evidence: `2026-11-01-ux9-qa.md`.

## 9a — the three defect fixes (D1–D3)

- **D1 boss banner** (`render.js:167-178`, `fx.js:207-213,332-338`): the fight-enter paint now carries `arriving.bossName` (already-computed `bossWelcomed` names) and `dispatchFx`'s welcome block derives the banner from it. The hardcoded `'SLAG WARDEN'` literal is gone — the Cinder Foreman announces itself, in both languages, with zero new strings.
- **D2 enemyLook 10/10** (`glyphs.js:159-176`): the four missing ids (`cinder_foreman`, `ash_wraith_elite` + two more) added with `boss`/`elite` framing flags, reusing the existing `.e-boss`/`.e-elite` rules (none added). Stale `@param {string} name` JSDoc fixed to `id`. The dead `art` field left untouched per ruling (sprites resolve by `e.id`, `stage-art.js:20`).
- **D3 enemy chip juice** (`runtime.js:336-345,435-441`, `render.js:132-140,257,321`, `floats.js:146-167`, `combat-view.js:38,470`): `lastEnemyStatuses`/`setLastEnemyStatuses` — a per-index map — published alongside the player snapshot at both publish sites, cleared in `newGame()` (`actions.js:455`); new `freshEnemyStatusKeys(index, list)` diffs against the ENEMY's own previous keys; the player path stays byte-identical.

## 9b — the pipeline: non-attack turns present

- `actions.js:140-215`: the enemy turn is now grouped from `enemy_attack` + `enemy_block` + `enemy_status` (kernel events that always existed) into per-attacker `plans` and flat `beats`; `player_status` rides as a hero-targeted step attributed to the enemy that spoke (the kernel's `debuff` runner emits no enemy index — this is the only signal). The burst `{kind:'enemy-turn', attacks, plans, beats, playerLost}` exists with zero attacks: a block/buff/debuff turn now produces a plan, a gate, floats.
- `runtime.js:135`: `TURN_STEP = { ms: 560 }` (STRIKE_SEQ untouched); arming adds `tail`/`stepMs`/`tailAt` (`actions.js:400-425`).
- `fx.js:250`: tail beats play one slot each after the last slam, reusing `throwLane`/`heroLane`; `guardFloatNode`/`statusFloatNode` (floats.js) print glyph + kernel number only — no new strings.
- Dedupe (`actions.js:249`): the snapshot-diff block float is skipped for enemies the beats path covers (`guardedIdx`), so `enemy_block` prints `+N` exactly once; silently-moved block still falls through; the player-side float is untouched.
- CSS (`style.css`, beside the `.efloat` block, ~60 lines): `.fx-beat`, `.fx-beat-guard`, `.fx-beat-status`, `.fx-beat-status.is-hex`, `.fx-beat-float`, `.efloat-status` (+`.is-up`/`.is-down`), `@keyframes fx-beat-guard`/`fx-beat-status` — absolute on `#fx-layer`, pointer-events none, transform/opacity only, no width/height.

## 9c — the per-type presentations

- `fx-signatures.js`: 24 per-type effect fns + `ENEMY_SIG_FX` (the SIG_FX five-handle convention), keyed by roster id; the Cantor's rite and the Foreman's survey key on the scripted move id, the rest on kind. Wired into the enemy-turn dispatch (`fx.js`) with the same for-knob iteration; the generic 9b beats stay the fallback for types without an entry.
- `combat-view.js`: `ENEMY_POSES[id][attack|guard|power|hex] → 'name'` painted as `epose-<name>` on the enemy card (the `epose-` prefix keeps `check-surface-art.mjs`'s POSE_VALUES gate untouched); `null` falls through to the legacy `enemyPose()`; `is-enraged` from statuses (Brute's seams persist while the buff stands).
- Per type: Maw overshoot-wind + snap with mid-bite plate; Cantor rite column + ash cone (zero lunge); Mite 460ms dart + tighten ≤1.04; Ooze compress→lunge + acid arc to the hero's feet; Brute 900ms charge + stage shake + seam glow; Warden three-plate wall / piston / triple-pocket A5x3 / steam; Crawler hex draw + mirrored claws + low ram; Wraith thin + wail rings / streak / bob; Matriarch veil over the hero row; Foreman survey circle then ceiling slab + dust.
- `style.css`: ~35 keyframes + node/epose rules — transform/opacity/filter only, aria-hidden decoration, zero layout properties.

## Documented deviations

1. Multi-hit vs single attack is read from the move label (`xN`) — the wire carries no hit count on the new steps.
2. Per-type poses are positional for single-attacker turns only; multi-foe turns keep the shared slam (a wrong pose is worse than a generic one).
3. Tail beats defer to `plan.stepMs` (560ms) rather than §4.2's per-kind 480/560/640 — per-kind re-slotting is a plan-clock change, not a presentation one; left out deliberately.
4. AC-3 is delivered as the boss/elite FRAMING (flags on the four missing ids), not the spec's dead-field `art` extension; AC-5 is delivered as player-path parity (key-membership diff), not the spec's "stacking re-juices" wording. Both rulings recorded in the QA file.

## Module-graph catch

9c's first `npm test` failed `tests/web/module-graph.test.js`: `combat-view.js` read `strikeSeq` without importing it. Fixed by the coordinator (one import line); suite re-run green.
