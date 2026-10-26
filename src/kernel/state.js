// State — canonical serialization, hashing, freezing, and save-file validation (R1/R3).
//
// The save file IS the entire run. State is a frozen, serializable value with no
// cycles, no functions, no Dates, no undefined holes. Every number is an integer
// (fixed-point only) so that JSON round-trips are byte-identical across platforms.
//
// input deliberately covers `stepIndex`, `rngDraws` and `contentVersion`: two
// runs that agree on the visible board but disagree on how many draws they consumed
// or which content build they ran are NOT the same run and must not share a hash.
//
// The digest is a PURE-JS sha256 (./sha256.js), not node:crypto: this file runs in
// the browser unchanged, and hash() must stay synchronous (WebCrypto is async).
// tests/kernel/sha256-parity.test.js pins the output byte-for-byte to node:crypto.

import { sha256Hex } from './sha256.js';
import { POTION_SLOTS } from './rules/potions.js';

/** Save/log format version. Bumping this makes old saves refuse to load (exit 4). */
export const FORMAT_VERSION = 1;
/** Engine version, recorded in saves for forensics; not part of hash input. */
export const ENGINE_VERSION = '0.3.0';

/**
 * Deep-freeze a value graph in place and return it.
 * Frozen state is what makes R1 structural: a surface that tries to mutate throws
 * in strict mode (all ESM is strict) instead of silently diverging from the CLI.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function freezeDeep(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
  } else {
    for (const key of Object.keys(value)) freezeDeep(value[key]);
  }
  return value;
}

/**
 * Canonical string form: recursive key sort, compact separators, NFC strings,
 * integers only, no CR. This is the single serialization used for hashing, save
 * files and golden fixtures, so "same state" has exactly one byte representation.
 * @param {any} value
 * @returns {string}
 */
export function canonical(value) {
  return encode(value, 0);
}

function encode(value, depth) {
  if (depth > 64) throw new Error('canonical: nesting too deep (possible cycle)');
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error(`canonical: non-finite number ${value}`);
    if (!Number.isInteger(value)) {
      throw new Error(
        `canonical: non-integer number ${value} — fixed-point/integers only (R3)`,
      );
    }
    return String(value);
  }
  if (t === 'string') {
    if (value.includes('\r')) throw new Error('canonical: CR in string — LF only (R3)');
    return JSON.stringify(value.normalize('NFC'));
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => encode(v, depth + 1)).join(',')}]`;
  }
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error('canonical: only plain objects are serializable');
    }
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      const v = value[k];
      if (v === undefined) throw new Error(`canonical: undefined at key "${k}"`);
      parts.push(`${JSON.stringify(k.normalize('NFC'))}:${encode(v, depth + 1)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new Error(`canonical: unsupported type ${t}`);
}

/**
 * Content-addressed run hash. `sha256:` prefixed, stable across processes.
 * @param {any} state
 * @returns {string} e.g. "sha256:ab12…"
 */
export function hash(state) {
  const body = canonical(state);
  return `sha256:${sha256Hex(body)}`;
}

/** Structural schema for a save file. Hand-rolled so runtime stays dependency-free. */
const SAVE_SHAPE = {
  formatVersion: 'integer',
  engineVersion: 'string',
  contentVersion: 'string',
  seed: 'integer',
  character: 'string',
  difficulty: 'integer',
  stepIndex: 'integer',
  rngDraws: 'integer',
  state: 'object',
};

/**
 * Validate an untrusted save/log object before any of it is used (security surface:
 * parse-safety). Returns a list of problems; empty means safe to load.
 * @param {unknown} raw
 * @returns {string[]} human-readable problems
 */
export function validateSave(raw) {
  const problems = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['save: not a JSON object'];
  }
  for (const [key, type] of Object.entries(SAVE_SHAPE)) {
    const v = /** @type {Record<string, unknown>} */ (raw)[key];
    if (v === undefined) {
      problems.push(`save: missing field "${key}"`);
      continue;
    }
    if (type === 'integer' && !Number.isInteger(v)) problems.push(`save: "${key}" must be an integer`);
    if (type === 'string' && typeof v !== 'string') problems.push(`save: "${key}" must be a string`);
    if (type === 'object' && (v === null || typeof v !== 'object' || Array.isArray(v))) {
      problems.push(`save: "${key}" must be an object`);
    }
  }
  if (typeof raw.formatVersion === 'number' && raw.formatVersion !== FORMAT_VERSION) {
    problems.push(`save: formatVersion ${raw.formatVersion} != ${FORMAT_VERSION} (version-incompatible)`);
  }
  const st = /** @type {Record<string, unknown>} */ (raw).state;
  if (st && typeof st === 'object' && !Array.isArray(st)) {
    for (const key of ['phase', 'stepIndex', 'rngDraws', 'contentVersion', 'player', 'act', 'floor']) {
      if (!(key in st)) problems.push(`save.state: missing field "${key}"`);
    }
    // S3 gold: OPTIONAL on purpose. A pre-gold save (no `player.gold`) must keep loading
    // with the purse defaulting to 0 at every read (`?? 0` in observe/rules), so the field
    // is never required here and FORMAT_VERSION stays put. When it IS present, it must be
    // an integer — the purse is whole coins like every other run number (R3) — and never
    // negative: spending (S4) makes debt a real state a tampered or corrupt save could
    // carry, and a purse below zero is refused at load, not repaired (S3 review P3).
    const player = st.player;
    if (player && typeof player === 'object' && !Array.isArray(player)) {
      const gold = /** @type {Record<string, unknown>} */ (player).gold;
      if (gold !== undefined && !Number.isInteger(gold)) {
        problems.push('save.state.player: "gold" must be an integer');
      }
      if (Number.isInteger(gold) && gold < 0) {
        problems.push('save.state.player: "gold" must not be negative');
      }
    }
    // S4 shop: OPTIONAL like every post-v1 field. Absent (a legacy save) means the run
    // predates shops; its stored map has no shop node, so the phase simply never occurs.
    // When present it must be an object or null, and every price it carries must be a
    // non-negative integer — a negative price would PAY the purse on purchase.
    const shop = /** @type {Record<string, unknown>} */ (st).shop;
    if (shop !== undefined && shop !== null) {
      if (typeof shop !== 'object' || Array.isArray(shop)) {
        problems.push('save.state: "shop" must be an object or null');
      } else {
        const offers = /** @type {Record<string, unknown>} */ (shop).offers;
        if (offers !== undefined && !Array.isArray(offers)) {
          problems.push('save.state.shop: "offers" must be an array');
        }
        if (Array.isArray(offers)) {
          offers.forEach((o, i) => {
            if (o && typeof o === 'object' && !Array.isArray(o)) {
              const price = /** @type {Record<string, unknown>} */ (o).price;
              if (!Number.isInteger(price) || price < 0) {
                problems.push(`save.state.shop.offers[${i}]: "price" must be a non-negative integer`);
              }
            }
          });
        }
        const removal = /** @type {Record<string, unknown>} */ (shop).removal;
        if (removal !== undefined && removal !== null) {
          if (typeof removal !== 'object' || Array.isArray(removal)) {
            problems.push('save.state.shop: "removal" must be an object or null');
          } else {
            const rprice = /** @type {Record<string, unknown>} */ (removal).price;
            if (!Number.isInteger(rprice) || rprice < 0) {
              problems.push('save.state.shop: "removal.price" must be a non-negative integer');
            }
          }
        }
      }
    }
    // S5 potions: OPTIONAL like every post-v1 field — a legacy save without the field
    // reads as an empty belt at every `?? []`. When present it must be an array of at
    // most POTION_SLOTS strings: a longer belt is a state the engine can never produce
    // (the drop suppresses at capacity), so it is refused at load, not repaired — the
    // same spirit as the negative-gold refusal. The ID STRINGS are NOT checked: ids the
    // potion table no longer knows degrade everywhere (raw id as the name, no quaff, a
    // discard offered) — the S2.1/S4.1 tolerance ruling, never a load-time throw.
    const potions = /** @type {Record<string, unknown>} */ (st).potions;
    if (potions !== undefined) {
      if (!Array.isArray(potions)) {
        problems.push('save.state: "potions" must be an array');
      } else {
        if (potions.length > POTION_SLOTS) {
          problems.push(`save.state: "potions" must hold at most ${POTION_SLOTS} entries`);
        }
        potions.forEach((p, i) => {
          if (typeof p !== 'string') problems.push(`save.state.potions[${i}] must be a string`);
        });
      }
    }
    // S6 events: OPTIONAL like every post-v1 field. Absent (a legacy save) means the
    // run predates events; its stored map has no event node, so the phase simply never
    // occurs. When present it must be an object or null. The INNER fields (the story
    // id, the modal offers, the resolved beat) are NOT shape-checked here, on the same
    // ruling as the potion ids: a story id the roster no longer knows degrades at the
    // surfaces (raw id as the name, no choices, the `v0` continue still enumerated so
    // the run can never softlock inside the phase) — never a load-time throw.
    const event = /** @type {Record<string, unknown>} */ (st).event;
    if (event !== undefined && event !== null && (typeof event !== 'object' || Array.isArray(event))) {
      problems.push('save.state: "event" must be an object or null');
    }
  }
  const actions = /** @type {Record<string, unknown>} */ (raw).actions;
  if (actions !== undefined && !Array.isArray(actions)) problems.push('save: "actions" must be an array');
  return problems;
}

/**
 * Build the on-disk save object for a run. The action list is the complete input
 * history, so the file alone is enough to re-derive and re-verify the run.
 * @param {any} state
 * @param {readonly string[]} actions
 * @returns {object}
 */
export function toSave(state, actions) {
  return freezeDeep({
    formatVersion: FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    contentVersion: state.contentVersion,
    seed: state.seed,
    character: state.character,
    difficulty: state.difficulty,
    stepIndex: state.stepIndex,
    rngDraws: state.rngDraws,
    state,
    actions: actions.slice(),
  });
}

/** Serialize a save object to its canonical on-disk text (LF terminated). */
export function serializeSave(save) {
  return `${canonical(save)}\n`;
}
