// tests/helpers/harness.mjs — shared fixtures and dynamic loaders. NOT a test file.
//
// Every kernel module is loaded by absolute file URL so a test never depends on the
// runner's CWD, and so the "renderer unresolvable" golden pass can import a specifier
// that must fail without taking the suite down with it.
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repository root: two levels up from tests/helpers/. */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const load = (rel) => import(pathToFileURL(resolve(REPO, rel)).href);

export const loadKernel = () => load('src/kernel/index.js');
export const loadContentMod = () => load('src/kernel/content.js');
export const loadStateMod = () => load('src/kernel/state.js');
export const loadRng = () => load('src/kernel/rng.js');
export const loadObserve = () => load('src/kernel/observe.js');
export const loadDescribe = () => load('src/kernel/describe.js');
export const loadVocabulary = () => load('src/kernel/rules/vocabulary.js');
export const loadPower = () => load('src/kernel/rules/powers.js');
export const loadEncounters = () => load('src/kernel/rules/encounters.js');
export const loadSession = () => load('src/surface/session.js');
export const loadGhost = () => load('src/surface/gui/controller.js');
export const loadCli = () => load('src/surface/cli.js');
export const loadSim = () => load('src/surface/sim.js');
export const loadTokens = () => load('scripts/measure-tokens.mjs');

let _content = null;
/** Shipped content, loaded once (read-only, so sharing is safe). */
export async function content() {
  if (_content === null) _content = (await loadContentMod()).defaultContent();
  return _content;
}

/** One enemy from the act-1 roster, with optional field overrides. */
export function makeEnemy(def, over = {}) {
  return {
    id: def.id,
    index: 0,
    name: def.name,
    hp: over.hp ?? def.maxHp[0],
    maxHp: over.maxHp ?? def.maxHp[0],
    block: over.block ?? 0,
    statuses: { ...(over.statuses ?? {}) },
    moveIndex: over.moveIndex ?? 0,
    moveHistory: [],
    intentStep: 0,
    dead: over.dead ?? false,
  };
}

/** Five dummy deck instances used as a non-empty draw pile (never drawn from here). */
export function dummyPile(c, n = 5) {
  return Array.from({ length: n }, (_, i) => ({
    uid: `d${i + 1}`,
    cardId: i % 2 === 0 ? 'strike' : 'defend',
    perPlay: 0,
  }));
}

/**
 * Build a combat state with exactly `cardId` in hand, and everything else pinned.
 *
 * Pinning stepIndex/rngDraws/energy/HP is what makes a per-card delta a fact rather
 * than an observation: the same row yields the same numbers on every machine.
 * @param {string} cardId
 * @param {any} [over]
 */
export async function combatState(cardId, over = {}) {
  const { newRun } = await loadKernel();
  const c = await content();
  const { ENEMIES } = await loadEncounters();
  const def = c.cards.get(cardId);
  const base = newRun({ seed: over.seed ?? 5 });
  const enemies = (
    over.enemies ?? [makeEnemy(ENEMIES[over.enemyId ?? 'jaw_worm'], over.enemyOver ?? {})]
  ).map((e, i) => ({ ...e, index: i }));
  return {
    ...base,
    phase: 'combat',
    stepIndex: over.stepIndex ?? 10,
    rngDraws: over.rngDraws ?? 90,
    powers: { ...(over.powers ?? {}) },
    player: {
      hp: over.hp ?? 60,
      maxHp: over.maxHp ?? 60,
      block: over.block ?? 0,
      energy: over.energy ?? 5,
      statuses: { ...(over.statuses ?? {}) },
    },
    combat: {
      active: true,
      nodeId: over.nodeId ?? 'n1',
      nodeType: over.nodeType ?? 'combat_weak',
      turn: 1,
      enemies,
      draw: (over.draw ?? dummyPile(c)).slice(),
      hand: over.hand ?? [{ uid: 'HAND', cardId, cost: def.cost, perPlay: over.perPlay ?? 0 }],
      discard: (over.discard ?? []).slice(),
      exhaust: (over.exhaust ?? []).slice(),
    },
    deck: over.deck ?? base.deck,
  };
}

/** Non-combat states (map / rest / reward) pinned the same way. */
export async function mapState(over = {}) {
  const { newRun } = await loadKernel();
  return { ...newRun({ seed: over.seed ?? 5 }), phase: 'map', ...over };
}

/** A log header for replaying a scripted action list from seed 0. */
export function header(over = {}) {
  return { format: 'dlb-log', v: 1, seed: 0, contentVersion: 'dlb-0.3.0-act1', character: 'ironclad', difficulty: 0, ...over };
}

/** Replay a scripted action list and return the step hashes. */
export async function play(h, entries) {
  const { replay } = await loadSession();
  return replay(h, entries);
}
