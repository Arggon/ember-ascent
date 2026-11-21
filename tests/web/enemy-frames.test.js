// ENEMY FRAMES (slice 3a): the mechanism that gives an enemy real pose frame layers, the
// enemy mirror of the hero's frame-swap choreography.
//
// The contract under test, per the slice's acceptance criteria:
//   AC1  enemyMarkup() emits `.spr-frame` layers ONLY for an id with an ENEMY_FRAMES
//        entry; every other id keeps the markup it has always emitted, BYTE FOR BYTE
//        (3a captured the table-empty strings on 1cba0c8; 3b recaptured the layered
//        ones with the same `node -e "import('./src/web/stage-art.js')…"` discipline).
//   AC2  each declared entry's epose name is one ENEMY_POSES actually paints, and the
//        stylesheet lights it with layer + idle-hide rules that (a) ride the SAME
//        calc(<base>s * var(--pace)) duration as that epose's own ep-* rule and (b)
//        resume from `--eframe-resume`, the SIGNED resume enemyCard writes (negative
//        mid-beat elapsed, positive holding the layer at 0% until the window opens)
//        from the same clocks beatPose reads — the slice-1 lesson (an unphased layer
//        restarts its cross-fade from 0% on every repaint).
//   AC3  the layers reuse the EXACT shared `.spr-frame` class inside `.fig`, so the
//        existing reduced-motion blocks and the hitstop freeze cover them for free;
//        combat-view never paints an epose under reduced motion.
//   AC4/C3  an entry may exist ONLY together with its asset file on disk — nothing else
//        checks local assets, so an entry without its file is a 404 on every paint.
// stage-art.js is a LEAF (it imports nothing — pinned below), so the cross-checks read
// combat-view.js / style.css as text instead of importing them back.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { enemyMarkup, ENEMY_FRAMES, SPRITES } from '../../src/web/stage-art.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(repoRoot + p, 'utf8');
const stageArtText = read('src/web/stage-art.js');
const combatViewText = read('src/web/combat-view.js');
const cssText = read('src/web/style.css');

const ENEMY_IDS = Object.keys(SPRITES).filter((id) => id !== 'hero' && id !== 'bellows_keeper');

/** The single-sprite markup every enemy without a frame entry must keep emitting. */
const FALLBACK = (key) =>
  `<span class="sh" aria-hidden="true"></span>` +
  `<img class="spr spr-${key}" src="assets/sprites/${key}.webp" alt="" draggable="false" decoding="async">`;

/** The resolved sprite key enemyMarkup paints for an id (stage-art.js's own rule). */
const spriteKeyOf = (id) => (SPRITES[id] && id !== 'hero' && id !== 'bellows_keeper' ? SPRITES[id] : SPRITES.jaw_worm);

/** One balanced-brace block of `text`, from the first `{` at or after `from`. */
function blockAfter(text, from) {
  const open = text.indexOf('{', from);
  let depth = 0;
  for (let i = open; i >= 0 && i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') { depth -= 1; if (depth === 0) return text.slice(from, i + 1); }
  }
  return '';
}

function reduceMotionBlocks() {
  const blocks = [];
  const re = /@media \(prefers-reduced-motion: reduce\)/g;
  for (let m = re.exec(cssText); m; m = re.exec(cssText)) blocks.push(blockAfter(cssText, m.index));
  return blocks;
}

/** The ENEMY_POSES row of `id`, extracted as text from combat-view.js (stage-art stays a leaf). */
function poseRowOf(id) {
  const start = combatViewText.indexOf('const ENEMY_POSES = {');
  assert.ok(start >= 0, 'combat-view.js still declares the ENEMY_POSES table');
  const table = blockAfter(combatViewText, start);
  const row = table.match(new RegExp(`${id}:\\s*\\{([^}]*)\\}`));
  return row ? row[1] : null;
}

test('AC1: an id without a frame entry keeps the exact single-sprite markup it has always emitted', () => {
  // 3b fills the table, so every ENEMY_IDS id ships layers (pinned below); the only
  // live entry-less paths left are the undefined fallback — and bellows_keeper, which
  // is a HERO id pinned to the same fallback identity further down.
  for (const id of [undefined]) {
    assert.equal(enemyMarkup(id), FALLBACK(spriteKeyOf(id)), `markup for ${id ?? 'undefined'} regressed`);
  }
});

test('AC1: every table id stacks idle first, then one .spr-frame layer per declared pose, in declaration order', () => {
  for (const [id, frames] of Object.entries(ENEMY_FRAMES)) {
    const key = spriteKeyOf(id);
    const bare = FALLBACK(key);
    const markup = enemyMarkup(id);
    assert.ok(markup.startsWith(bare), `the idle sprite still paints first for ${id}, so the figure box keeps its measured size`);
    const layers = Object.keys(frames)
      .map((p) => `<img class="spr-frame spr-frame-${p}" src="assets/sprites/${key}-${p}.webp" alt="" draggable="false" decoding="async">`)
      .join('');
    assert.equal(markup.slice(bare.length), layers, `${id} stacks exactly its declared layers, in declaration order`);
  }
});

test('AC1 pin: windup ships on all ten encounter ids; guard only on the six whose non-attack beats paint an epose', () => {
  // The C3 cut: `guard` exists only where a block/hex step actually paints — beatPose
  // serves `guard` (block), `hex` (status/tick) and `attack`; the `power` eposes are
  // never painted, so jaw_worm / cultist / red_louse / cinder_foreman are windup-only.
  const windupIds = Object.keys(ENEMY_FRAMES).filter((id) => 'windup' in ENEMY_FRAMES[id]).sort();
  const guardIds = Object.keys(ENEMY_FRAMES).filter((id) => 'guard' in ENEMY_FRAMES[id]).sort();
  assert.equal(windupIds.length, 10, 'windup ships on all ten encounter ids');
  assert.deepEqual(windupIds, ['acid_slime', 'ash_wraith', 'ash_wraith_elite', 'cinder_foreman', 'cultist', 'gremlin_nob', 'jaw_worm', 'red_louse', 'slag_crawler', 'the_guardian']);
  assert.equal(guardIds.length, 6, 'guard ships on exactly six ids');
  assert.deepEqual(guardIds, ['acid_slime', 'ash_wraith', 'ash_wraith_elite', 'gremlin_nob', 'slag_crawler', 'the_guardian'], 'guard only where a block/hex beat paints (the four windup-only ids stay windup-only)');
});

test('AC1: the captured strings are byte-for-byte (the undefined fallback, the bellows_keeper alias, cultist and the elite with their 3b layers)', () => {
  // Captured from `node -e "import('./src/web/stage-art.js')…"` on the layered code.
  assert.equal(
    enemyMarkup('cultist'),
    '<span class="sh" aria-hidden="true"></span><img class="spr spr-cultist" src="assets/sprites/cultist.webp" alt="" draggable="false" decoding="async"><img class="spr-frame spr-frame-windup" src="assets/sprites/cultist-windup.webp" alt="" draggable="false" decoding="async">',
  );
  assert.equal(
    enemyMarkup(undefined),
    '<span class="sh" aria-hidden="true"></span><img class="spr spr-jaw_worm" src="assets/sprites/jaw_worm.webp" alt="" draggable="false" decoding="async">',
  );
  // The death-ghost pin (death-ghost-art.test.js) leans on this fallback identity.
  assert.equal(enemyMarkup('bellows_keeper'), enemyMarkup(undefined));
  // ash_wraith_elite paints the ash_wraith ART (its sprite key), not its own id — the
  // layered capture pins the same resolution for its frame files.
  assert.equal(
    enemyMarkup('ash_wraith_elite'),
    '<span class="sh" aria-hidden="true"></span><img class="spr spr-ash_wraith" src="assets/sprites/ash_wraith.webp" alt="" draggable="false" decoding="async"><img class="spr-frame spr-frame-windup" src="assets/sprites/ash_wraith-windup.webp" alt="" draggable="false" decoding="async"><img class="spr-frame spr-frame-guard" src="assets/sprites/ash_wraith-guard.webp" alt="" draggable="false" decoding="async">',
  );
});

test('AC1: an entry stacks idle first, then one .spr-frame layer per pose, in declaration order (the heroMarkup pattern)', () => {
  // Since 3b the DEFAULT frames for jaw_worm are the table's own entry, so the bare-idle
  // base for these exact-pattern assertions is the explicit empty-frames call.
  const idle = enemyMarkup('jaw_worm', {});
  const one = enemyMarkup('jaw_worm', { windup: 'maw-wind' });
  assert.ok(one.startsWith(idle), 'the idle sprite still paints first, so the figure box keeps its measured size');
  assert.equal(
    one.slice(idle.length),
    '<img class="spr-frame spr-frame-windup" src="assets/sprites/jaw_worm-windup.webp" alt="" draggable="false" decoding="async">',
    'one layer, the exact attribute pattern heroMarkup emits',
  );
  const two = enemyMarkup('jaw_worm', { windup: 'maw-wind', inhale: 'maw-inhale' });
  assert.equal(
    two.slice(idle.length),
    '<img class="spr-frame spr-frame-windup" src="assets/sprites/jaw_worm-windup.webp" alt="" draggable="false" decoding="async">' +
    '<img class="spr-frame spr-frame-inhale" src="assets/sprites/jaw_worm-inhale.webp" alt="" draggable="false" decoding="async">',
    'two layers in declaration order',
  );
  // I3: the FILE path follows the resolved sprite key, not the encounter id — the elite
  // wraith can reuse its base art's files while its own eposes drive the lighting.
  const elite = enemyMarkup('ash_wraith_elite', { streak: 'wraith-streak' });
  assert.ok(elite.includes('src="assets/sprites/ash_wraith-streak.webp"'), 'the layer rides the base art key');
});

test('AC1: both production callers pass a single argument, so the ghost inherits the same markup', () => {
  // combat-view.js paints the live card, floats.js the death ghost — one function, one
  // default (the table); neither call site may grow a second argument of its own.
  const callSites = [...combatViewText.matchAll(/enemyMarkup\(([^()]*)\)/g), ...read('src/web/floats.js').matchAll(/enemyMarkup\(([^()]*)\)/g)];
  assert.ok(callSites.length >= 2, 'both call sites are still there');
  for (const [, args] of callSites) assert.ok(!args.includes(','), `enemyMarkup(${args}) must stay a single-argument call`);
});

test('table sanity: enemy ids only, bare epose names, objects as values', () => {
  const ids = new Set(Object.keys(SPRITES));
  for (const [id, frames] of Object.entries(ENEMY_FRAMES)) {
    assert.ok(ids.has(id), `${id} is a SPRITES key`);
    assert.notEqual(id, 'hero', 'the hero has HERO_FRAMES, never an enemy entry');
    assert.notEqual(id, 'bellows_keeper', 'bellows_keeper is a HERO id and has no enemy entry');
    assert.equal(typeof frames, 'object', `frames of ${id} is a pose→epose table`);
    for (const [pose, epose] of Object.entries(frames)) {
      assert.ok(/^[a-z][a-z-]*$/.test(pose), `pose ${pose} of ${id} is a bare file stem`);
      assert.equal(typeof epose, 'string', `epose of ${pose} on ${id} is a name`);
      assert.ok(!epose.startsWith('epose-'), `epose ${epose} of ${id} is bare — the paint site adds the prefix (ENEMY_POSES convention)`);
    }
  }
});

test('AC2: every declared epose is one ENEMY_POSES actually paints for that id', () => {
  for (const [id, frames] of Object.entries(ENEMY_FRAMES)) {
    const row = poseRowOf(id);
    assert.ok(row, `${id} has an ENEMY_POSES row in combat-view.js`);
    const painted = [...row.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const epose of Object.values(frames)) {
      assert.ok(painted.includes(epose), `ENEMY_POSES.${id} paints ${epose} — a frame pose no epose class lights is dead weight and a replay hazard`);
    }
  }
});

test('AC2: the stylesheet lights each entry with a layer rule and an idle-hide rule on the epose clock, both resumed from --eframe-resume', () => {
  for (const [id, frames] of Object.entries(ENEMY_FRAMES)) {
    for (const [pose, epose] of Object.entries(frames)) {
      const epRule = cssText.match(new RegExp(`\\.stage-combat \\.enemy\\.epose-${epose} \\{[^}]*\\}`));
      assert.ok(epRule, `the epose-${epose} card rule exists (ENEMY_POSES paints it)`);
      const base = epRule[0].match(/calc\(([\d.]+)s \* var\(--pace/);
      assert.ok(base, `epose-${epose} rides calc(<base>s * var(--pace))`);
      // The layer rule: a NEW compound selector (never a bare reuse of the hero's rules).
      const layerRule = cssText.match(new RegExp(`\\.stage-combat \\.enemy\\.epose-${epose} \\.fig \\.spr-frame-${pose} \\{[^}]*\\}`));
      assert.ok(layerRule, `epose-${epose} lights the ${pose} layer`);
      const layerDur = layerRule[0].match(/animation: \S+ calc\(([\d.]+)s \* var\(--pace/);
      assert.ok(layerDur, `the ${pose} layer rides calc(<base>s * var(--pace))`);
      assert.equal(layerDur[1], base[1], `the ${pose} layer lasts exactly as long as the epose-${epose} body motion`);
      assert.ok(layerRule[0].includes('animation-delay: var(--eframe-resume'), `the ${pose} layer resumes from --eframe-resume`);
      // The idle-hide rule: same duration, same resume, so the swap ends when the body motion ends.
      const idleRule = cssText.match(new RegExp(`\\.stage-combat \\.enemy\\.epose-${epose} \\.fig \\.spr \\{[^}]*\\}`));
      assert.ok(idleRule, `epose-${epose} hides the idle sprite while the layer holds`);
      const idleDur = idleRule[0].match(/animation: \S+ calc\(([\d.]+)s \* var\(--pace/);
      assert.ok(idleDur && idleDur[1] === base[1], `the idle-hide rides the same ${base[1]}s clock`);
      assert.ok(idleRule[0].includes('animation-delay: var(--eframe-resume'), 'the idle-hide resumes from --eframe-resume too');
    }
  }
});

test('AC2: no eframe CSS exists for a pose the table does not declare (CSS blocks ship WITH their entry, never before)', () => {
  const declared = new Set(Object.values(ENEMY_FRAMES).flatMap((f) => Object.values(f)));
  const litEposes = [...cssText.matchAll(/\.stage-combat \.enemy\.epose-([a-z-]+) \.fig \.(?:spr|spr-frame-)/g)].map((m) => m[1]);
  for (const epose of litEposes) {
    assert.ok(declared.has(epose), `the stylesheet lights epose-${epose} but no ENEMY_FRAMES entry declares it`);
  }
});

test('AC3: the layers wear the shared .spr-frame class, so the reduced-motion blocks and the hitstop freeze cover them', () => {
  // I1: a sibling class would lose all three coverages at once; the enemy layers reuse
  // the hero's exact class name inside `.fig`.
  const reduceBlocks = reduceMotionBlocks();
  assert.ok(reduceBlocks.length >= 2, 'the stylesheet still carries its reduced-motion blocks');
  const naming = reduceBlocks.filter((b) => b.includes('.stage-combat .fig .spr-frame'));
  assert.ok(naming.length >= 2, 'both reduce families (animation:none list and display:none) name .spr-frame');
  assert.ok(cssText.includes('.hitstop .fig .spr-frame'), 'the hitstop freeze names .spr-frame');
  // The emitted layer markup carries the class exactly as the reduce rules name it.
  const withFrames = Object.entries(ENEMY_FRAMES).flatMap(([id, frames]) => Object.keys(frames).map((p) => enemyMarkup(id, { [p]: frames[p] })));
  for (const markup of withFrames) {
    assert.ok(/class="spr-frame spr-frame-/.test(markup), 'the emitted layer carries the shared .spr-frame class');
  }
  // And the paint site: an epose class is never added under reduced motion (the guard
  // the AC3 contract rests on is combat-view's own paint gate).
  assert.ok(combatViewText.includes('const beat = reducedMotion ? null'), 'combat-view still gates the beat pose on reducedMotion');
});

test('AC4/C3: every declared entry has its asset file on disk, at most 150KB (an entry without its file is a 404 on every paint)', () => {
  for (const [id, frames] of Object.entries(ENEMY_FRAMES)) {
    const key = spriteKeyOf(id);
    for (const pose of Object.keys(frames)) {
      const file = `src/web/assets/sprites/${key}-${pose}.webp`;
      assert.ok(existsSync(repoRoot + file), `${file} exists — entry ⇔ asset`);
      assert.ok(statSync(repoRoot + file).size <= 150_000, `${file} stays within the sprite budget`);
    }
  }
});

test('I8: stage-art stays a leaf — no imports (the cross-checks above read files as text instead)', () => {
  assert.ok(!/^\s*import[\s{]/m.test(stageArtText), 'stage-art.js imports nothing');
});
