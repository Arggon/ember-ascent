// src/web/hero-moves.js — the hero's per-card movement and signature-effect tables.
//
// MAINTENANCE CONTRACT: HERO_MOVES is a hand-maintained mirror of
// src/kernel/content/cards.json. Adding or renaming a card id means updating that table
// (or accepting the type fallback) — tests/kernel/hero-card-poses.test.js fails on a
// table key that is not a real card id, and scripts/check-surface-art.mjs fails on a
// movement whose keyframe vanished. Pure data plus two lookups: no DOM, no state.

/**
 * Per-card hero movement. The pose is chosen by WHICH card was played, not only by its
 * type: a maul lands differently from a jab, and raising a barrier plants the hero where
 * channelling ember-lift raises them. Ids must match `src/kernel/content/cards.json`; a
 * card missing from the table (or an id-less burst) falls back to the old type-based
 * pose, so unknown or future content still animates.
 */
export const HERO_MOVES = {
  // Attacks — how the blow lands. (strike and anger left this row for their own
  // signature poses below: Hammerfall drops, Spark snaps.)
  headbutt: 'strike', pommel: 'strike', dropkick: 'strike', ironwave: 'strike', rampage: 'strike',
  bash: 'heavy', clothesline: 'heavy', wild_strike: 'heavy',
  // LOTE 1 — the starter deck and the basic attacks, each with its own movement:
  // Hammerfall (strike): the hammer rises, PAUSES at the apex, and drops straight down —
  // a dust cloud and a small crack open in the lane it lands on.
  strike: 'hammerfall',
  // Quench (defend): a pouring gesture — no dome, a veil of blue-white steam climbs the hero.
  defend: 'quench',
  // Bellows Gust (gust): a two-armed PUSH — a cone of wind sweeps the whole row back.
  gust: 'bellowspush',
  // Spark (anger): a finger-snap cast — an ember dart flies out, a mote returns to the deck.
  anger: 'snapcast',
  // Fan the Flames (fan_flames): the furnace is fanned — three flame tongues and a spark to the orb.
  fan_flames: 'fanflames',
  // Per-card signature moves (one commit per card): bludgeon — Maul, "One stroke. The
  // argument ends." — is the 32-damage rare: its own COLOSSAL pose, not shared heavy.
  bludgeon: 'colossal',
  // Twin Hammers: the card is the name — TWO hammers, two hits (5×2). Its own throw
  // pose with a salvo of two projectiles and two impacts.
  twin_strike: 'twinthrow',
  // Sunder (carnage, 20 dmg): a RENDING vertical stroke — the hammer cleaves straight
  // down and the air itself splits with a burning seam over the target.
  carnage: 'rend',
  // Rising Blow (uppercut): the name is an uppercut — the hammer swings UP and the
  // target is LIFTED off its stance by the impact.
  uppercut: 'uppercut',
  // Per-card signature moves (one commit per card): bludgeon — Maul, "One stroke. The
  // argument ends." — is the 32-damage rare: its own COLOSSAL pose, not shared heavy.
  bludgeon: 'colossal',
  pummel: 'flurry',
  cleave: 'sweep', thunderclap: 'sweep', reaper: 'sweep',
  // THROW cards: the flavor text says the weapon flies and (for the Brand) comes back,
  // so the move is a real throw — the hero winds up, a spinning hammer flies to the
  // target and bursts. `HERO_THROWS` below holds the per-card choreography knobs.
  sword_boomerang: 'throw', hemokinesis: 'throw',
  // Skills and powers — how the hero plants or draws power.
  // HP-cost cards (bloodletting, offering) read as their movement only when
  // no HP was actually lost; the hurt flinch outranks the card flourish (see heroPose).
  // (defend left this row for its own quench pose above; fan_flames left channel below.)
  shrug: 'guard', true_grit: 'guard', armaments: 'guard',
  entrench: 'guard', flame_barrier: 'guard', ghostly_armor: 'guard', impervious: 'guard',
  flex: 'channel', warcry: 'channel', havoc: 'channel', battle_trance: 'channel',
  bloodletting: 'channel', offering: 'channel', limit_break: 'channel', shockwave: 'channel',
  combust: 'channel', dark_embrace: 'channel', feel_no_pain: 'channel',
  inflame: 'channel', metallicize: 'channel', rupture: 'channel',
  // LOTE 2 — ataques comunes I: each common attack reads as its own stroke.
  // Arc Cut (cleave): ONE wide horizontal swing that crosses the whole row.
  cleave: 'arccut',
  // Collar Check (clothesline): a lateral arm-bar driven at neck height.
  clothesline: 'collarline',
  // Brow Strike (headbutt): a headfirst drive that bounces off in recoil.
  headbutt: 'headbutt',
  // Slag Surge (ironwave): a heavy grounded roll that shoves a molten wave.
  ironwave: 'surge',
  // Haft Jab (pommel): a quick backhand jab with the hammer's pommel.
  pommel: 'haftjab',
  // LOTE 3 — ataques comunes II: each common attack draws its own stroke.
  // Forgeclap (thunderclap): BOTH hammers rise and clash OVERHEAD — a clap, not a swing.
  thunderclap: 'forgeclap',
  // Untempered (wild_strike): a double untempered flail — off balance, no form, no temple.
  wild_strike: 'wildflail',
  // Bellows (flex): the chest swells like the forge bellows — a flex, not a channel.
  flex: 'bellowsflex',
  // Heel Drop (dropkick): a feet-first airborne launch that lands heels-down.
  dropkick: 'dropkick',
  // Blood Hammer (hemokinesis): the hammer condenses from the hero's chest, THEN flies
  // (the flight itself stays the throw choreography — see HERO_THROWS.delayMs below).
  hemokinesis: 'bloodhammer',
  // LOTE 4 — skills comunes: each common skill moves its own way.
  // Cast Aside (shrug): a dismissive SHRUG — shoulders lift, the blow slides off, and a
  // spare plate sails over the back of the shoulder (fx-platefly below).
  shrug: 'castaside',
  // True Temper (true_grit): a ROOTED tempering hold — the hammer raised steady in the
  // heat while it hisses, no lunge, no swing (fx-temperhiss below).
  true_grit: 'truetemper',
  // Fit the Plate (armaments): the body squares up and LOCKS as the plate sets on the
  // shoulder — a settle, never a swing (fx-plateclank below).
  armaments: 'fitplate',
  // Kiln Cry (warcry): an inhale swell, then a forward SHOUT rock — the cry made visible
  // (fx-crycone below).
  warcry: 'kilncry',
  // Vent (havoc): a twist and recoil as pressure vents from the BACK — no arm swing at
  // all (fx-ventjets below).
  havoc: 'vent',
  // LOTE 5 — ataques uncommon: each uncommon card reads as its own stroke.
  // Heat Trance (battle_trance): arms cross and open — three GHOST CARDS fan out
  // glowing and flow into the hand (fx-cardfan below).
  battle_trance: 'heattrance',
  // Hail of Blows (pummel): a BURST of four alternate blows — four small staggered
  // flashes, deliberately nothing like Twin Hammers' two-hammer salvo (fx-hailticks).
  pummel: 'hailblows',
  // Climbing Heat (rampage): a DIAGONAL UPWARD slash — ember rungs climb the lane like
  // a ladder of heat under the rising stroke (fx-heatladder).
  rampage: 'climbcut',
  // Vein Tap (bloodletting): taps a vein on the forearm — ember drops fall and bead
  // into one glowing bead of energy (fx-veindrip; the hurt flinch still outranks this
  // movement whenever HP was actually lost, see heroPose).
  bloodletting: 'veintap',
  // Ash Harvest (reaper): a scythe of ash sweeps the ENTIRE row — ash motes drain from
  // the enemies back toward the hero (fx-ashscythe).
  reaper: 'reapsweep',
  // LOTE 6 — skills uncommon: each uncommon skill moves its own way.
  // Heat Wash (shockwave): a LOW ARM SWEEP — the hero drags a thermal wave across the
  // whole row, left to right, and the row wilts under it (fx-heatwash).
  shockwave: 'heatwash',
  // Brace (entrench): the stance SINKS into the ground and locks — a settle, never a
  // swing; the rings of plate lock over it (fx-lockrings).
  entrench: 'bracelock',
  // Flame Ward (flame_barrier): the hero raises a hand and a CURTAIN of flame climbs
  // in front of them (fx-flamecurtain).
  flame_barrier: 'flameward',
  // Cinder Shroud (ghostly_armor): the hero turns in place while a cocoon of cinders
  // swirls UP AROUND them and settles as a shell (fx-ashswirl).
  ghostly_armor: 'cindershroud',
  // LOTE 7 — poderes uncommon: each uncommon power moves its own way.
  // Stoke (inflame): a bellows PULL — the chest draws in and swells as the furnace of
  // the breast is fed (fx-stokedraft below).
  inflame: 'stoke',
  // Scale Up (metallicize): a slow STRAIGHTEN — the body stands taller as the plate
  // waves climb it, no swing, no step (fx-scaleripple below).
  metallicize: 'scaleup',
  // Banked Coal (combust): a hand TIPS out over the row and drops its coals — they fall
  // and pile glowing under the enemies (fx-bankedglow below).
  combust: 'bankcoal',
  // Ash Embrace (dark_embrace): the hero hunches and draws IN as the ash tendrils
  // arrive from behind and wrap them (fx-ashtendrils below).
  dark_embrace: 'ashembrace',
  // Cinder Skin (feel_no_pain): the hero STIFFENS in place — a rigid hardening while
  // the crust sets, the stillest movement in the deck (fx-cindercrust below).
  feel_no_pain: 'cinderskin',
  // ==== LOTE 8 — cartas raras: each rare card moves its own way. ====
  // Unbroken (impervious): the body SQUARES UP and LOCKS as the plates stack onto it —
  // four small compressive beats, then a rigid clench (fx-platestack below).
  impervious: 'lockdown',
  // Overtemper (limit_break): the chest ARCHES BACK and UP as the forge heart
  // overpressures — an overshoot with a shudder at its peak (fx-heartbloom below).
  limit_break: 'overtemper',
  // Blood Tithe (offering): the hero DROPS TO ONE KNEE — the payment made deliberate,
  // a kneel, not a flinch (fx-tithe below; plays when no HP was actually lost, the
  // kernel's loseHp floor makes a 1-HP tithe free — see heroPose).
  offering: 'tithe',
  // Split Seam (rupture): a sharp TWIST as the seam splits open on the hero's OWN
  // front — a wrench of recoil, no swing at all (fx-selfseam below).
  rupture: 'splitseam',
};
// Type fallback for cards with no row above, kept identical to the pre-move behaviour.
export const MOVE_DEFAULTS = { attack: 'strike', skill: 'brace', power: 'brace' };
/**
 * The moves that CLOSE DISTANCE: a stroke that is not a thrown weapon or a cast walks the
 * hero into the enemy lane for the pose's middle third (`.hero.is-approach`, styled in
 * style.css; the real gap is measured at dispatch in fx.js). The five RANGED attack moves
 * stay home — `throw`/`twinthrow`/`bloodhammer` fly the hammer itself, `snapcast` is an
 * ember dart, `bellowspush` is a wind cone — and so does every skill and power stance
 * (guard/channel/quench and friends), because planting is the point of those cards.
 * `strike` is the MOVE_DEFAULTS fallback for an unknown attack: a plain stroke closes.
 * New moves must be added here or the hero will strike from where it stands.
 */
export const MELEE_APPROACH_MOVES = new Set([
  'arccut', 'climbcut', 'collarline', 'colossal', 'dropkick', 'forgeclap', 'haftjab',
  'hailblows', 'hammerfall', 'headbutt', 'heavy', 'reapsweep', 'rend', 'strike', 'surge',
  'uppercut', 'wildflail',
]);
/** True when a move should carry the hero into the enemy lane. */
export function isMeleeMove(move) {
  return MELEE_APPROACH_MOVES.has(move);
}
/**
 * Throw choreography per card id, keyed off what each card's own text says:
 * sword_boomerang — Returning Brand, "Heat you threw comes back": the hammer flies AND
 * returns; hemokinesis — Blood Hammer, the hammer first CONDENSES at the hero's chest
 * (the bloodcondense fx, below) and only then is hurled, staying in the target.
 */
export const HERO_THROWS = {
  // Returning Brand: the hammer comes BACK — the CSS round trip is 1.25s, and the lane
  // moment (where the impact flash belongs) is the outward apex, not the 84% landing of
  // a one-way throw. A plain throw's CSS flight is 0.9s, landing at 84%.
  sword_boomerang: { returns: true, ms: 1250, hitAt: 0.55 },
  // Blood Hammer: the clot closes over ~320ms before the flight is released, and the
  // flying hammer wears the ember-BLOOD tint (fx-hammer-blood) instead of forge iron.
  hemokinesis: { returns: false, ms: 900, hitAt: 0.84, delayMs: 320, blood: true },
};
/** Total wall-clock of a ONE-WAY hammer flight, in ms at 1x (the twin salvo rides this). */
export const THROW_MS = 900;
/** Per-card signature moves: extra knobs keyed by card id (pose handled via HERO_MOVES). */
export const HERO_SIGNATURES = {
  // Maul: longer windup, screen shake and an ember shockwave on impact.
  bludgeon: { poseMs: 1150, shake: true, shockwave: true },
  // Anvil Blow: "The anvil answers louder than the hammer." A spectral anvil drops
  // from above onto the target the moment the hammer lands.
  bash: { anvil: true },
  // Twin Hammers: two hammers in the air, staggered, with two impact flashes.
  twin_strike: { twin: true },
  // Sunder: the rending seam flashes down the target lane as the stroke lands.
  carnage: { rend: true },
  // Rising Blow: the aimed enemy is launched upward at the impact beat.
  uppercut: { launch: true },
  // LOTE 1 — the starter deck and the basic attacks:
  // Hammerfall: the drop cracks the lane — dust puffs and a small crack open under the target.
  strike: { dustcrack: true },
  // Quench: a steam veil climbs the HERO — a veil, never a dome.
  defend: { quenchveil: true },
  // Bellows Gust: a wind cone sweeps the WHOLE enemy row, and the row leans back under it.
  gust: { gustcone: true },
  // Spark: an ember dart flies out to the target; a mote returns toward the draw pile.
  anger: { sparkdart: true },
  // Fan the Flames: three flame tongues fan out by the hero; one spark flies to the energy orb.
  fan_flames: { flarefan: true },
  // LOTE 2 — ataques comunes I:
  // Arc Cut: a single luminous arc sweeps the WHOLE enemy row, side to side.
  cleave: { arcspan: true },
  // Collar Check: a taut line flashes over the lane at neck height; weak marks sag in.
  clothesline: { collarline: true },
  // Brow Strike: an impact star bursts at the contact point of the headfirst drive.
  headbutt: { impactstar: true },
  // Slag Surge: a molten plate glows on the hero while slag rolls along the ground.
  ironwave: { slagwave: true },
  // Haft Jab: the pommel lands, and a card is PULLED from the enemy toward the hand.
  pommel: { jabpull: true },
  // LOTE 3 — ataques comunes II:
  // Forgeclap: two hammers MEET overhead; the clash rolls a shock ring and vulnerable
  // cracks across the WHOLE row (the card hits every enemy).
  thunderclap: { forgering: true },
  // Untempered: white-hot cracks flare around the aimed lane on both wild beats.
  wild_strike: { wildcracks: true },
  // Bellows: ONE ember pulse blooms at the hero's chest — a pulse, never a column.
  flex: { chestpulse: true },
  // Heel Drop: embers burst where the heels land; a spark rides into the energy orb.
  dropkick: { heelburst: true },
  // Blood Hammer: the ember-blood clot condenses at the chest before the throw leaves.
  hemokinesis: { bloodcondense: true },
  // LOTE 4 — skills comunes:
  // Cast Aside: a spare plate sails OVER the shoulder (behind the hero) and the drawn
  // card slides into the hand.
  shrug: { platefly: true },
  // True Temper: steam hisses OFF the hero's raised hammer while the temper line flares.
  true_grit: { temperhiss: true },
  // Fit the Plate: a shoulder plate drops, locks with a clank ring, and rivets spark.
  armaments: { plateclank: true },
  // Kiln Cry: hot air cones from the mouth; the discarded card catches fire in the air.
  warcry: { crycone: true },
  // Vent: steam jets blast from the hero's BACK; the energy orb flares in the HUD.
  havoc: { ventjets: true },
  // LOTE 5 — ataques uncommon:
  // Heat Trance: three ghost cards fan open glowing by the chest and flow into the hand.
  battle_trance: { cardfan: true },
  // Hail of Blows: four SMALL flashes land in alternation along the lane, staggered —
  // a hail, never the twin salvo, never the hammer-hit flash.
  pummel: { hailticks: true },
  // Climbing Heat: ember rungs light up the lane bottom-to-top under the rising slash.
  rampage: { heatladder: true },
  // Vein Tap: ember drops fall from the hero's tapped forearm and bead into one glint.
  bloodletting: { veindrip: true },
  // Ash Harvest: a scythe of ash sweeps the WHOLE row and ash motes drain to the hero.
  reaper: { ashscythe: true },
  // LOTE 6 — skills uncommon:
  // Heat Wash: the low sweep drags a THERMAL WAVE across the whole row, left to right
  // (sized to the row's measured span, like the ash scythe) — each enemy wilts as it passes.
  shockwave: { heatwashwave: true },
  // Brace: the sink locks the stance — TWO concentric rings of plates fit together
  // around the hero with a double clank (inner first, outer a beat later).
  entrench: { lockrings: true },
  // Flame Ward: a vertical CURTAIN of flame rises in front of the hero.
  flame_barrier: { flamecurtain: true },
  // Cinder Shroud: a cocoon of ash swirls UP AROUND the hero and settles as a shell.
  ghostly_armor: { ashswirl: true },
  // LOTE 7 — poderes uncommon:
  // Stoke: a COLUMN of embers drafts up over the hero's furnace while the chest swells.
  inflame: { stokedraft: true },
  // Scale Up: WAVES of metallic scales climb the body bottom-to-top.
  metallicize: { scaleripple: true },
  // Banked Coal: coals fall THROUGH the enemy row and pile GLOWING under it.
  combust: { bankedglow: true },
  // Ash Embrace: tendrils of ash rise from behind and WRAP the hero.
  dark_embrace: { ashtendrils: true },
  // Cinder Skin: a crust of cinder hardens progressively OVER the hero's skin.
  feel_no_pain: { cindercrust: true },
  // ==== LOTE 8 — cartas raras: each rare card makes its own mark. ====
  // Unbroken: FOUR steel plates stack onto the hero ONE BY ONE (top-down drops) and a
  // white seal closes the set — a build, never the single plate's clank.
  impervious: { platestack: true },
  // Overtemper: the forge heart BLOOMS — white-gold petals open outward from the chest
  // and lift away, a flowering that carries NO expanding ring (that is the shockwave's
  // silhouette, never this).
  limit_break: { heartbloom: true },
  // Blood Tithe: crimson HP motes ASCEND from the chest while THREE ghost cards
  // DESCEND toward the hero — the payment rising off, the tithe's draw falling in.
  offering: { tithe: true },
  // Split Seam: ONE hairline seam of heat splits open on the hero's OWN front
  // (hero-measured) — crimson-gold, seeping flecks, then it seals itself.
  rupture: { selfseam: true },
};
/** The signature knobs for a card-fly burst, or null. */
export function signatureFor(fly) {
  return fly && fly.id ? HERO_SIGNATURES[fly.id] || null : null;
}

export function heroMove(fly) {
  if (!fly) return null;
  // `hasOwn`, not a bare index: card ids come from frozen content today, but a bare
  // `HERO_MOVES[fly.id]` walks the prototype chain, so an id like "constructor" would
  // resolve to a function and emit a garbage pose class.
  const named = fly.id && Object.hasOwn(HERO_MOVES, fly.id) ? HERO_MOVES[fly.id] : null;
  if (named) return named;
  return MOVE_DEFAULTS[fly.type] || null;
}
