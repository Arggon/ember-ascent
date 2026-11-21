// Reading the kernel's PUBLIC OUTPUT into the neutral facts a policy scores.
//
// WHY A SEPARATE MODULE: a policy may only read what a player can see — the legal
// actions, the state, and the rendered dump a step returned (the determinism contract
// in policies.js). Everything that turns that observation into neutral facts lives
// here, so the scoring modules never parse text and never re-derive card behaviour:
//
//   intent labels  — what the rendered ENEMY block announces (damage per hit, hit count)
//   effectProfile() — a card definition -> what the card does, in its own printed terms
//
// No clocks, no Math.random, no I/O, no import of rules/** (the architecture gate
// forbids a surface reaching in there, so the two numbers a card needs but data does
// not carry — what a `custom` handler does, and what an announced intent will deal —
// are read from the handler NAME and from the rendered intent label, exactly as
// observe.js already does for rendering).
import { loadContent } from '../kernel/index.js';

/** Ship-time card definitions, read once. Content is the kernel's public data. */
export const CONTENT = loadContent();

/** Damage an intent label will deal, e.g. "A11" -> 11, "A5x3" -> 15, "B20" -> 0. */
export function intentDamageFromLabel(label) {
  if (typeof label !== 'string') return 0;
  const m = /A(\d+)(?:x(\d+))?/.exec(label);
  if (!m) return 0;
  return Number(m[1]) * (m[2] ? Number(m[2]) : 1);
}

/** Damage an intent label will deal per enemy turn, hits included. */
export function hitsFromLabel(label) {
  const m = /A\d+(?:x(\d+))?/.exec(typeof label === 'string' ? label : '');
  return m && m[1] ? Number(m[1]) : 1;
}

/**
 * Total incoming damage, read from the ENEMY block of a rendered dump.
 *
 * Reading the rendered text rather than state internals is deliberate: the printed
 * intent is exactly the information a player has, so the heuristic cannot quietly
 * use numbers no observation exposes. "A5x3" contributes 15; "B20"/"PWR3" contribute 0.
 *
 * NOTE: unlike intentLabelsFromDump(), this scans every row after the ENEMY header to
 * the end of the dump (a verbose dump's PILES section follows). It is the RAW label
 * sum — no Strength or Vulnerable correction — because `sim` feeds it to the policy as
 * the `incoming` override, and the override must stay the printed number a player sees.
 * @param {string} dump
 * @returns {number}
 */
export function incomingFromDump(dump) {
  const rows = dump.split('\n');
  const at = rows.indexOf('ENEMY');
  if (at === -1) return 0;
  let total = 0;
  for (let i = at + 1; i < rows.length; i += 1) {
    const m = /A(\d+)(?:x(\d+))?/.exec(rows[i]);
    if (m) total += Number(m[1]) * (m[2] ? Number(m[2]) : 1);
  }
  return total;
}

/**
 * Per-living-enemy estimate of this turn's incoming damage, in the order the
 * observation lists the enemies (which is the order `state.combat.enemies` keeps).
 *
 * WHY THE DUMP AND NOT THE STATE: what a player can see is the printed intent label.
 * Reading it keeps the policy honest about its information. Two corrections greedy
 * did not make, both from fields the player can also see, are applied on top:
 * announced damage is per hit, so enemy Strength multiplies it by the hit count, and
 * a Vulnerable player takes 50% more. Greedy ignored both, which understated the
 * incoming attack exactly when the bot was most likely to die.
 * @param {any} state
 * @param {string|null} dump rendered observation, or null when unavailable
 * @returns {number[]}
 */
export function enemyThreats(state, dump) {
  const live = (state.combat?.enemies ?? []).filter((e) => !e.dead);
  const labels = intentLabelsFromDump(dump);
  const vulnerable = (state.player.statuses?.vulnerable ?? 0) > 0;
  return live.map((e, i) => {
    const label = labels[i] ?? '';
    const base = intentDamageFromLabel(label);
    const hits = hitsFromLabel(label);
    let dmg = base + (e.statuses?.strength ?? 0) * hits;
    if (vulnerable) dmg = Math.floor((dmg * 3) / 2);
    return dmg;
  });
}

/**
 * Intent labels of the live enemies, in listing order, from a rendered dump.
 * The enemy row is ` <name>  HP x/y[ Bn]  <intent label>[ statuses]`, so the label is
 * whatever is left after the name, the HP field and an optional Block field.
 * @param {string|null|undefined} dump
 * @returns {string[]}
 */
export function intentLabelsFromDump(dump) {
  if (typeof dump !== 'string') return [];
  const rows = dump.split('\n');
  const at = rows.indexOf('ENEMY');
  if (at === -1) return [];
  const out = [];
  for (let i = at + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.trim() === '' || /^[A-Z]+\b/.test(row)) break;
    const parts = row.trim().split(/\s{2,}/);
    const rest = parts.slice(1).filter((p) => !/^HP\s+\d+\/\d+$/.test(p) && !/^B\d+$/.test(p));
    out.push(rest.join(' ').trim());
  }
  return out;
}

/**
 * What each `custom` handler does, in policy terms.
 *
 * WHY A TABLE: the `custom` verb carries only a handler NAME — the numbers live in
 * src/kernel/rules/effects/*.js, which a surface may not import (architecture gate,
 * R1a). observe.js keeps CUSTOM_SUMMARY for exactly the same reason. A card whose
 * handler is missing from this table is flagged (`handlerUnknown`) rather than
 * quietly scored at zero, so a new exotic card shows up as a hole instead of as
 * "this card is worthless".
 */
export const CUSTOM_READING = {
  vein_tap: { selfDamage: 3, energy: 2 },
  blood_hammer: { selfDamage: 2, damage: 15 },
  blood_tithe: { selfDamage: 6, energy: 2, draw: 3 },
  ash_harvest: { aoePerTarget: 4, healPerDamage: 1 },
  overtemper: { doublesStrength: true },
  brace: { doublesBlock: true },
  banked_coal: { power: 1 },
  ash_embrace: { power: 1 },
  cinder_skin: { power: 1 },
  split_seam: { power: 1 },
  climbing_heat: { damage: 8, growsBy: 5 },
};

/**
 * Read a card definition into a neutral profile of what it does, independent of any
 * board. Every field is in the card's own printed terms (damage, Block, cards drawn,
 * Energy) so the two consumers below can weight the same numbers differently.
 *
 * Only the player's CURRENT Strength and Dexterity adjust the numbers (the engine adds
 * them per hit / per Block); there is deliberately no board in here — "what does this
 * card do" and "what is it worth on this board" are separate questions with separate
 * modules.
 * @param {any} def card definition from content
 * @param {{playerStrength?: number, playerDexterity?: number}} [env]
 * @returns {any} profile
 */
export function effectProfile(def, env = {}) {
  const strength = env.playerStrength ?? 0;
  const dexterity = env.playerDexterity ?? 0;
  const p = {
    id: def.id,
    name: def.name,
    cost: def.cost,
    type: def.type,
    damage: 0,
    aoePerTarget: 0,
    block: 0,
    blockPerTurn: 0,
    doublesBlock: false,
    doublesStrength: false,
    draw: 0,
    discard: 0,
    energy: 0,
    selfDamage: 0,
    strengthGain: 0,
    vulnerable: 0,
    weak: 0,
    power: 0,
    healPerDamage: 0,
    growsBy: 0,
    exhausts: false,
    handlerUnknown: false,
  };

  for (const e of def.effects) {
    switch (e.verb) {
      case 'damage': {
        // Strength is added per hit by the engine, so it scales with the hit count.
        const total = (e.amount + strength) * (e.hits ?? 1);
        if (e.target === 'all_enemies') p.aoePerTarget += total;
        else p.damage += total;
        break;
      }
      case 'block':
        p.block += e.amount + dexterity;
        break;
      case 'draw':
        p.draw += e.amount;
        break;
      case 'discard':
        p.discard += e.amount;
        break;
      case 'energy':
        p.energy += e.amount;
        break;
      case 'exhaust':
        p.exhausts = true;
        break;
      case 'status':
        if (e.status === 'strength') p.strengthGain += e.amount;
        else if (e.status === 'vulnerable') p.vulnerable += e.amount;
        else if (e.status === 'weak') p.weak += e.amount;
        else if (e.status === 'metallicize') p.blockPerTurn += e.amount;
        else p.power += e.amount;
        break;
      case 'custom': {
        const r = CUSTOM_READING[e.handler];
        if (!r) {
          p.handlerUnknown = true;
          break;
        }
        p.damage += r.damage ?? 0;
        p.aoePerTarget += r.aoePerTarget ?? 0;
        p.block += r.block ?? 0;
        p.draw += r.draw ?? 0;
        p.energy += r.energy ?? 0;
        p.selfDamage += r.selfDamage ?? 0;
        p.healPerDamage += r.healPerDamage ?? 0;
        p.growsBy += r.growsBy ?? 0;
        p.power += r.power ?? 0;
        if (r.doublesBlock) p.doublesBlock = true;
        if (r.doublesStrength) p.doublesStrength = true;
        break;
      }
      default:
        break;
    }
  }
  return p;
}
