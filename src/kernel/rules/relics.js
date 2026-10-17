// Relics as data (B4 review). A hero definition names its relic by id
// (`startingRelic` in content/cards.json); this table says what each relic id DOES.
// The act rules read effects from here and never compare relic names, so a new hero's
// relic is one table row, and Iron Skin's `relicOff` switches off whichever relic the
// hero carries.

/** HP restored by the Kindled Heart relic (id `burning_blood`) after each combat. */
export const RELIC_HEAL = 6;
/** Extra first-turn Energy from the Cyan Lantern relic (B4, Bellows Keeper). */
export const LANTERN_ENERGY = 1;

/** A state with no `relic` field carries this one (Ashwright runs keep their old hashes). */
export const DEFAULT_RELIC = 'burning_blood';

/**
 * Relic effects by id. `healAfterFight`: HP restored after each won fight.
 * `firstTurnEnergy`: extra Energy on the first turn of each fight. `offText`: what the
 * player loses when the relic is switched off (completes "Your <relic name> ...").
 */
export const RELICS = Object.freeze({
  burning_blood: { healAfterFight: RELIC_HEAL, offText: 'no longer heals after fights' },
  cyan_lantern: { firstTurnEnergy: LANTERN_ENERGY, offText: 'no longer gives Energy on the first turn of each fight' },
});

/** The relic id a state carries. */
export const relicId = (state) => state.relic ?? DEFAULT_RELIC;

/** The working relic's effects, or null when Iron Skin switched it off. */
export const activeRelic = (state) => (state.relicOff ? null : RELICS[relicId(state)] ?? null);
