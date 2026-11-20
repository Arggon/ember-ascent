// src/web/i18n.js — the UI chrome strings, in English and neutral Spanish (I18N-1).
//
// WHAT THIS OWNS: every player-visible DOM string the WEB SURFACE composes itself —
// buttons, sheet titles, hints, toasts, the input-gate's locked labels, the warden/vault
// copy, the map ribbons. The KERNEL's player-facing sentences (card descriptions,
// statuses, intents, relic/potion/event words) are localized kernel-side and arrive
// through `ctl.snapshot({ lang })` — this module only decides WHICH language that is and
// stores it. A game rule never lives here.
//
// THE LANGUAGE IS A SURFACE CHOICE: an explicit choice persists in localStorage
// (`dlb.lang`, written ONLY by setLang) and switches `document.documentElement.lang`
// with it. Until then the browser's own locale decides the in-memory default and
// NOTHING is written (readLang below) — the tour's language pre-step and the HUD toggle
// are the only writers. It never enters run state, the save format or the action log —
// a save loads in either language, and the kernel's compact dump stays English-only in
// both (the agent-facing contract, pinned by the goldens).
//
// FALLBACK HONESTY: `t()` resolves es -> en per key, so a missing Spanish string
// renders its English twin — never a key name, never an empty node. The `i18n` unit
// test pins that every key carries an `en` string, so a wholly missing row fails a test
// rather than shipping.
//
// Interpolation: `{name}`-shaped holes are filled from the optional params object; an
// unfilled hole stays visible, which is a louder failure than a silent empty string.


/** localStorage key. Same family as the other browser-only prefs (speed, pins, ledger). */
export const LANG_KEY = 'dlb.lang';

/** The languages the surface offers, in display order (the toggle walks this list). */
export const LANGUAGES = Object.freeze(['en', 'es']);

/** The BROWSER decides the default while no explicit choice exists: a navigator whose
 *  primary language starts with 'es' reads Spanish, anything else English. Guarded for
 *  hosts without a navigator (the unit harness — undefined reads 'en', the historic
 *  default), and case-insensitive ('es-ES', 'es-MX', 'ES' all match). */
function browserLang() {
  try {
    return String(navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en';
  } catch { /* no navigator in a narrow host */ return 'en'; }
}

function readLang() {
  let stored = null;
  try { stored = localStorage.getItem(LANG_KEY); } catch { /* private mode */ }
  // An EXPLICIT choice (either value; only setLang writes here) always wins — a Spanish
  // browser that picked English stays English on every boot.
  if (stored === 'es' || stored === 'en') return stored;
  // Nothing chosen yet: the browser's locale decides the IN-MEMORY default and nothing
  // is written — the explicit choice (the tour's language step, or the HUD toggle) is
  // the only writer, so an un-chosen browser can still be asked (ONBOARDING-TOUR).
  return browserLang();
}

let lang = readLang();

/** The current presentation language ('en' | 'es'). */
export function currentLang() {
  return lang;
}

/** Keep <html lang> truthful for screen readers; guarded for the narrow test hosts. */
export function applyDocumentLang() {
  try {
    document.documentElement.setAttribute('lang', lang);
  } catch { /* no document in a narrow harness */ }
}
applyDocumentLang();

/**
 * Set the language and persist it. Does NOT repaint — the caller repaints with a fresh
 * snapshot (switchLang below); setLang alone is for tests.
 * @param {string} next 'en' | 'es' (anything else reads English)
 */
export function setLang(next) {
  lang = next === 'es' ? 'es' : 'en';
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch { /* private mode */ }
  applyDocumentLang();
}

/**
 * Whether the player has made an EXPLICIT language choice (the key holds a value this
 * module writes). The tour's language pre-step shows only while this is false — a
 * replaying veteran or a toggle user never sees it (ONBOARDING-TOUR spec). A host whose
 * storage refuses reads reads CHOSEN, the tour.js read() convention: an un-persistable
 * choice must not re-ask on every boot.
 * @returns {boolean}
 */
export function langChosen() {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    return stored === 'es' || stored === 'en';
  } catch { /* private mode */ return true; }
}

/* ------------------------------------------------------------------ the dictionary
 *
 * One row per player-visible string the web surface composes: `{ en, es }`. The keys are
 * stable ids, grouped by view. Kernel-owned words (card names, relic names, event
 * stories) are NOT here — they come from the kernel's own bilingual tables.
 */
const STRINGS = {
  /* ---- HUD ------------------------------------------------------------ */
  'hud.deck': { en: 'Deck ({n})', es: 'Mazo ({n})' },
  'hud.deck.title': { en: 'Your whole deck, duplicates counted — keyboard: d', es: 'Tu mazo entero, duplicados contados — tecla: d' },
  'hud.deck.aria': { en: 'Deck: {n} cards', es: 'Mazo: {n} cartas' },
  'hud.cards': { en: 'Cards', es: 'Cartas' },
  'hud.cards.title': { en: 'Every card the rewards can offer this run — keyboard: k', es: 'Todas las cartas que las recompensas pueden ofrecer en esta partida — tecla: k' },
  'hud.cards.aria': { en: 'Card codex: {n} cards', es: 'Códice de cartas: {n} cartas' },
  'hud.help': { en: 'Help', es: 'Ayuda' },
  'hud.help.title': { en: 'How to play, and what every abbreviation means (Escape closes it)', es: 'Cómo jugar y qué significa cada abreviatura (Escape la cierra)' },
  'hud.newRun': { en: 'New Run', es: 'Nueva partida' },
  'hud.newRun.title': { en: 'New run (seed {n}) — keyboard: n', es: 'Nueva partida (semilla {n}) — tecla: n' },
  'hud.step': { en: 'step {n}', es: 'paso {n}' },
  'hud.hp.title': { en: 'HP {hp} of {max}', es: 'HP {hp} de {max}' },
  'hud.energy.title': { en: 'Energy {n} of {max}', es: 'Energía {n} de {max}' },
  'hud.block.title': { en: 'Block {n}', es: 'Bloqueo {n}' },
  'hud.gold.title': { en: 'Gold {n}', es: 'Oro {n}' },
  'hud.char.title': { en: '{name} — relic: {relic}', es: '{name} — reliquia: {relic}' },

  /* ---- language toggle (I18N-1) --------------------------------------- */
  'lang.toggle': { en: 'EN', es: 'ES' },
  'lang.toggle.title': { en: 'Switch the interface to Spanish', es: 'Cambiar la interfaz al inglés' },
  'lang.toggle.aria': { en: 'Language / Idioma', es: 'Language / Idioma' },

  /* ---- relics ---------------------------------------------------------- */
  // The HUD's relic chip is gone (relics act through hooks, never clicks); these two
  // survive because the reward heads still speak them for a torn save's unknown id.
  'relics.unknown': { en: 'unknown relic', es: 'reliquia desconocida' },
  'relics.unknownId': { en: ' (unknown relic id in this save)', es: ' (id de reliquia desconocido en esta partida)' },

  /* ---- potion belt ----------------------------------------------------- */
  // The belt paints in combat only (renderHud's phase guard), so every slot row is the
  // quaff/discard button shape — no inert-readout strings exist.
  'belt.aria': { en: 'Potion belt: {n} of {m}', es: 'Cinturón de pociones: {n} de {m}' },
  'belt.slot.empty': { en: 'Potion slot {n}: empty', es: 'Espacio de poción {n}: vacío' },
  'belt.unknown': { en: 'unknown potion', es: 'poción desconocida' },
  'belt.unknownId': { en: ' (unknown potion id in this save)', es: ' (id de poción desconocido en esta partida)' },
  'belt.click': { en: ' — click for quaff / discard', es: ' — haz clic para beber o descartar' },
  'belt.slot.aria': { en: 'Potion slot {n}: {name}. Open quaff or discard.', es: 'Espacio de poción {n}: {name}. Abre beber o descartar.' },
  'belt.panel.aria': { en: 'Potion', es: 'Poción' },
  'belt.panel.title': { en: '{name}: quaff or discard', es: '{name}: beber o descartar' },
  'belt.panel.unknownText': { en: 'An unknown potion — its id is not in this build’s table. Discard it to free the slot.', es: 'Una poción desconocida: su id no está en la tabla de esta versión. Descártala para liberar el espacio.' },
  'belt.quaff': { en: 'Quaff', es: 'Beber' },
  'belt.quaff.aimed': { en: 'Quaff — {enemy} ({hp}/{max})', es: 'Beber — {enemy} ({hp}/{max})' },
  'belt.quaff.aimedTitle': { en: 'Aim at living enemy {n}', es: 'Apuntar al enemigo vivo {n}' },
  'belt.quaff.aria': { en: 'Quaff {name}. {text}', es: 'Beber {name}. {text}' },
  'belt.quaff.ariaAimed': { en: 'Quaff {name}, aimed at {enemy}, {hp} of {max} HP', es: 'Beber {name}, apuntando a {enemy}, {hp} de {max} HP' },
  'belt.discard': { en: 'Discard', es: 'Descartar' },
  'belt.discard.title': { en: 'Throw it away — the slot frees, nothing else changes', es: 'Tírala: el espacio se libera y nada más cambia' },
  'belt.discard.aria': { en: 'Discard {name}. The slot frees; nothing else changes.', es: 'Descartar {name}. El espacio se libera; nada más cambia.' },
  'belt.close': { en: 'Close  (Esc)', es: 'Cerrar  (Esc)' },
  'belt.close.title': { en: 'Keep the potion (keyboard: Escape)', es: 'Conserva la poción (tecla: Escape)' },
  'belt.combatOnlyNote': { en: 'Quaff and discard work in combat only.', es: 'Beber y descartar funcionan solo en combate.' },

  /* ---- ordinal for the aim tooltip ------------------------------------- */
  'ord': { en: '{n}th', es: '{n}.º' },

  /* ---- help / glossary sheet -------------------------------------------- */
  'help.title': { en: 'How to play', es: 'Cómo jugar' },
  'help.aim.title': { en: 'Aiming at one enemy', es: 'Apuntar a un enemigo' },
  'help.aim.body': {
    en: 'When more than one enemy is alive, clicking a card that needs a target does not play it yet — the card lifts and every enemy that can be hit is highlighted and numbered. Click a highlighted enemy, or press its number, to hit that one; the enemy’s telegraphed intent is shown beside it while you decide, so you can spend the hit on the one that hurts most. Press Escape, press 0, click the card again, or click empty space to put the card back and play something else. With a single enemy alive a card still plays in one click, and cards that say ALL or SELF never ask.',
    es: 'Cuando hay más de un enemigo vivo, hacer clic en una carta que necesita objetivo no la juega todavía: la carta se levanta y cada enemigo que puede recibir el golpe se resalta y numera. Haz clic en un enemigo resaltado, o pulsa su número, para golpear a ese; la intención telegrafiada del enemigo se muestra a su lado mientras decides, así puedes gastar el golpe en el que más duela. Pulsa Escape, pulsa 0, vuelve a hacer clic en la carta o haz clic en un espacio vacío para guardarla y jugar otra cosa. Con un solo enemigo vivo una carta se juega con un clic, y las cartas que dicen TODOS o uno mismo nunca preguntan.',
  },
  'help.shorthand.title': { en: 'What the shorthand means', es: 'Qué significa la abreviatura' },
  'help.shorthand.hint': { en: 'Cards always describe themselves in words. These compact codes appear in the corner of a card, in the enemy’s intent, and in the command-line version of the game.', es: 'Las cartas siempre se describen con palabras. Estos códigos compactos aparecen en la esquina de una carta, en la intención del enemigo y en la versión de línea de comandos del juego.' },
  'help.gotIt': { en: 'Got it', es: 'Entendido' },
  'help.newRun.title': { en: 'Discard this run and start a new one (keyboard: n)', es: 'Descarta esta partida y empieza otra (tecla: n)' },

  /* ---- deck sheet -------------------------------------------------------- */
  'deck.title': { en: 'Deck: {n} cards', es: 'Mazo: {n} cartas' },
  'deck.heading': { en: 'Deck ({n})', es: 'Mazo ({n})' },
  'deck.empty': { en: 'The deck is empty.', es: 'El mazo está vacío.' },
  'deck.close.title': { en: 'Back to the run (keyboard: Escape)', es: 'Volver a la partida (tecla: Escape)' },
  'deck.copies': { en: '{n} copies in the deck', es: '{n} copias en el mazo' },
  'deck.cost': { en: 'Energy cost', es: 'Coste de Energía' },

  /* ---- codex sheet -------------------------------------------------------- */
  'codex.title': { en: 'Cards ({n})', es: 'Cartas ({n})' },
  'codex.hint': { en: 'Every card a combat reward can add to your deck this run. Pick with the fight ahead in mind.', es: 'Cada carta que una recompensa de combate puede añadir a tu mazo en esta partida. Elige pensando en el combate que viene.' },
  'codex.common': { en: 'Common', es: 'Común' },
  'codex.uncommon': { en: 'Uncommon', es: 'Infrecuente' },
  'codex.rare': { en: 'Rare', es: 'Rara' },
  'codex.other': { en: 'Other', es: 'Otra' },
  'codex.indeck': { en: 'in deck ×{n}', es: 'en el mazo ×{n}' },
  'codex.indeck.title': { en: '{n} copy in your deck', es: '{n} copia en tu mazo', },
  'codex.indeck.titlePlural': { en: '{n} copies in your deck', es: '{n} copias en tu mazo' },
  'codex.rarity': { en: 'Rarity: {r}', es: 'Rareza: {r}' },
  'codex.summary.title': { en: 'Compact form used by the agent-facing command line', es: 'Forma compacta que usa la línea de comandos para agentes' },
  'card.needsEnergy': { en: 'needs more Energy', es: 'falta Energía' },
  'card.notPlayable': { en: 'Not playable: not enough Energy.', es: 'No jugable: no hay Energía suficiente.' },
  'card.costs': { en: 'Costs {n} Energy.', es: 'Cuesta {n} de Energía.' },
  // The effect-chip row's group label (each chip's own sentence is kernel copy).
  'card.effects': { en: 'Card effects', es: 'Efectos de la carta' },

  /* ---- combat --------------------------------------------------------------- */
  'busy.play.tile': { en: 'the last card is landing', es: 'la última carta está cayendo' },
  'busy.play.aria': { en: 'the last card lands', es: 'la última carta cae' },
  'busy.enemy-turn.tile': { en: 'the enemies are acting', es: 'los enemigos están actuando' },
  'busy.enemy-turn.aria': { en: 'the enemies act', es: 'los enemigos actúan' },
  'busy.deal.tile': { en: 'the hand is arriving', es: 'la mano está llegando' },
  'busy.deal.aria': { en: 'the hand arrives', es: 'la mano llega' },
  'busy.hold.tile': { en: 'the stroke is landing', es: 'el golpe está cayendo' },
  'busy.hold.aria': { en: 'the stroke lands', es: 'el golpe cae' },
  'busy.fight.animating': { en: 'the fight animates', es: 'el combate se anima' },
  'busy.fight.animatingTile': { en: 'the fight is animating', es: 'el combate se está animando' },
  'combat.endTurn': { en: 'End Turn  (e)', es: 'Terminar turno  (e)' },
  'combat.endTurn.locked': { en: 'End Turn — locked while {why}', es: 'Terminar turno — bloqueado mientras {why}' },
  'combat.endTurn.waiting': { en: 'Waiting: {why}', es: 'Esperando: {why}' },
  'combat.targetBanner': { en: '{name} — choose an enemy target', es: '{name} — elige un enemigo objetivo' },
  'combat.cancel': { en: 'Cancel  (Esc)', es: 'Cancelar  (Esc)' },
  'combat.pile.draw': { en: 'Draw', es: 'Robo' },
  'combat.pile.discard': { en: 'Discard', es: 'Descarte' },
  'combat.pile.named': { en: '{label}: {names}', es: '{label}: {names}' },
  'combat.pile.empty': { en: '{label} pile empty', es: 'pila de {label} vacía' },
  'combat.pile.aria': { en: '{label} pile, {n} cards{extra}', es: 'pila de {label}, {n} cartas{extra}' },
  'combat.pile.exhaustExtra': { en: ', exhaust {n}', es: ', agotadas {n}' },
  'combat.pile.drawTitle': { en: 'Draw pile', es: 'Pila de robo' },
  'combat.pile.discardTitle': { en: 'Discard pile', es: 'Pila de descarte' },
  'combat.pile.emptySheet': { en: 'Empty.', es: 'Vacía.' },
  'combat.pile.exhausted': { en: 'Exhausted ({n}): {names}', es: 'Agotadas ({n}): {names}' },
  'combat.close': { en: 'Close', es: 'Cerrar' },
  'combat.energy.title': { en: 'Energy {n} of {max}', es: 'Energía {n} de {max}' },
  'combat.speed.aria': { en: 'Animation speed', es: 'Velocidad de animación' },
  'combat.speed.1': { en: 'Animation speed 1×', es: 'Velocidad de animación 1×' },
  'combat.speed.2': { en: 'Animation speed 2×', es: 'Velocidad de animación 2×' },
  'combat.speed.skip': { en: 'Skip animation', es: 'Saltar animación' },
  'combat.sfx.label': { en: 'SFX', es: 'Sonido' },
  'combat.sfx.aria': { en: 'Sound effects', es: 'Efectos de sonido' },
  'combat.sfx.mute.title': { en: 'Turn sound off', es: 'Silenciar' },
  'combat.sfx.unmute.title': { en: 'Turn sound on', es: 'Activar sonido' },
  'combat.hint': { en: 'Click a card to play it · a card that needs a target asks you to pick one', es: 'Haz clic en una carta para jugarla · una carta que necesita objetivo te pide elegir uno' },
  'combat.hint.targeting': { en: 'Click a highlighted enemy, or press 1–9 · Esc or click empty space to cancel', es: 'Haz clic en un enemigo resaltado, o pulsa 1–9 · Esc o un clic en espacio vacío cancela' },
  'combat.choosing': { en: ' Choosing a target: click a highlighted enemy, or press Escape to cancel.', es: ' Eligiendo objetivo: haz clic en un enemigo resaltado, o pulsa Escape para cancelar.' },
  'combat.waiting': { en: ' Waiting: {why}.', es: ' Esperando: {why}.' },
  'combat.pickTarget': { en: '⇱ pick a target', es: '⇱ elige un objetivo' },
  'combat.keyHint': { en: 'Keyboard shortcut: {n}', es: 'Atajo de teclado: {n}' },
  'combat.hero.aria': { en: '{name}, {hp} of {max} HP, block {block}', es: '{name}, {hp} de {max} HP, bloqueo {block}' },
  'combat.compact.title': { en: 'Compact form used by the agent-facing command line', es: 'Forma compacta que usa la línea de comandos para agentes' },

  /* ---- map ------------------------------------------------------------------- */
  'map.title': { en: 'Map — floor {a}/{b}', es: 'Mapa — piso {a}/{b}' },
  'map.youAreHere': { en: 'you are here', es: 'estás aquí' },
  'map.youWereHere': { en: 'you were here', es: 'estuviste aquí' },
  'map.next': { en: '→ next', es: '→ siguiente' },
  'map.travelFrom': { en: 'Just travelled from floor {n}', es: 'Acabas de viajar desde el piso {n}' },
  'map.hint': { en: 'Click a glowing node to travel. Fight something weak, risk an elite, or rest.', es: 'Haz clic en un nodo brillante para viajar. Pelea con algo débil, arriésgate con un élite o descansa.' },
  'map.travel': { en: 'Travel to {label}', es: 'Viajar a {label}' },
  'map.travel.pin': { en: 'Travel to {label} · right-click to pin', es: 'Viajar a {label} · clic derecho para fijar' },
  'map.pin.hint': { en: 'Right-click to pin this node', es: 'Clic derecho para fijar este nodo' },
  'map.pin.placed': { en: 'Pin placed.', es: 'Marca puesta.' },
  'map.pin.removed': { en: 'Pin removed.', es: 'Marca quitada.' },
  'map.pin.pinned': { en: 'pinned', es: 'marcado' },
  'map.quests.aria': { en: 'Ember quests', es: 'Misiones de ascua' },
  'map.quest.title': { en: '{text} Reward: {reward}.', es: '{text} Recompensa: {reward}.' },
  'map.quest.done': { en: 'done · {reward}', es: 'hecha · {reward}' },
  'map.bossSub': { en: 'final fight', es: 'combate final' },
  'map.node.weak': { en: 'Skirmish', es: 'Escaramuza' },
  'map.node.weak.sub': { en: 'card reward', es: 'recompensa de carta' },
  'map.node.strong': { en: 'Hard fight', es: 'Pelea dura' },
  'map.node.strong.sub': { en: 'card reward', es: 'recompensa de carta' },
  'map.node.elite': { en: 'Elite', es: 'Élite' },
  'map.node.elite.sub': { en: 'card reward', es: 'recompensa de carta' },
  'map.node.rest': { en: 'Campfire', es: 'Hoguera' },
  'map.node.rest.sub': { en: 'heal', es: 'recupera' },
  // I18N-2: the warden words localize like every other name — the enemies table's own
  // twins ("El Guardián de Escoria", "El Capataz de Ascuas") are the source of truth.
  'map.node.boss': { en: 'Slag Warden', es: 'El Guardián de Escoria' },
  'map.node.boss.sub': { en: 'final fight', es: 'combate final' },
  'map.bossAct2': { en: 'Cinder Foreman', es: 'El Capataz de Ascuas' },
  'map.node.shop': { en: 'Shop', es: 'Tienda' },
  'map.node.shop.sub': { en: 'buy · remove', es: 'compra · quita' },
  'map.node.event': { en: 'Wayside', es: 'El Camino' },
  'map.node.event.sub': { en: 'a choice', es: 'una elección' },
  'map.chapter.1': { en: 'I — The Path', es: 'I — El Sendero' },
  'map.chapter.2': { en: 'II — The Kiln Deeps', es: 'II — Las Hondonadas del Horno' },

  /* ---- reward / warden --------------------------------------------------------- */
  'reward.relic.head': { en: 'Victory — claim the warden\u2019s relic', es: 'Victoria — reclama la reliquia del guardián' },
  'reward.bossEmpty.head': { en: 'Victory — the warden offers nothing', es: 'Victoria — el guardián no ofrece nada' },
  'reward.card.head': { en: 'Victory — choose a card', es: 'Victoria — elige una carta' },
  'reward.gold.title': { en: 'Spoils of the fight — purse: {n} gold', es: 'Botín del combate — bolsa: {n} de oro' },
  'reward.gold': { en: '+{n} gold', es: '+{n} de oro' },
  'reward.relic.title': { en: '{name} — {text}', es: '{name} — {text}' },
  'reward.vault.sealed': { en: 'The warden\u2019s vault is sealed to you this climb.', es: 'La bóveda del guardián te está sellada en este ascenso.' },
  'reward.vault.empty': { en: 'You hold everything the warden\u2019s vault can give.', es: 'Ya tienes todo lo que la bóveda del guardián puede dar.' },
  'reward.vault.note': { en: 'New relics enter the vault as your lifetime climbs win.', es: 'Nuevas reliquias entran en la bóveda cuando tus ascensos a lo largo de tu vida ganan.' },
  'reward.vault.hint': { en: 'Win climbs to fill the warden\u2019s vault', es: 'Gana ascensos para llenar la bóveda del guardián' },
  'reward.walkAway': { en: 'Walk away', es: 'Vete' },
  'reward.walkAway.vaultTitle': { en: 'Leave the vault — the climb goes on', es: 'Deja la bóveda: el ascenso continúa' },
  'reward.take': { en: 'Take {name}', es: 'Tomar {name}' },
  'reward.cannotTake': { en: 'This relic cannot be taken', es: 'Esta reliquia no puede tomarse' },
  'reward.unknownRelic': { en: 'An unknown relic — its id is not in this build\u2019s table.', es: 'Una reliquia desconocida: su id no está en la tabla de esta versión.' },
  'reward.walkAway.title': { en: 'Leave the relic where it lies', es: 'Deja la reliquia donde yace' },
  'reward.relic.hint': { en: 'Take one relic — it stays with you for the rest of the climb', es: 'Toma una reliquia: te acompaña el resto del ascenso' },
  'reward.skip': { en: 'Skip  (HP {hp}/{max})', es: 'Pasar  (HP {hp}/{max})' },
  'reward.card.hint': { en: 'Click a card to add it to your deck', es: 'Haz clic en una carta para añadirla a tu mazo' },
  'page.reward.relic': { en: 'III — The Warden\u2019s Relic', es: 'III — La Reliquia del Guardián' },
  'page.reward.spoils': { en: 'III — The Spoils', es: 'III — El Botín' },

  /* ---- rest ----------------------------------------------------------------------- */
  'rest.title': { en: 'Rest Site', es: 'Sitio de descanso' },
  'rest.head': { en: 'A quiet moment', es: 'Un momento tranquilo' },
  'rest.note': { en: 'HP {hp}/{max} — you may heal {heal} or move on.', es: 'HP {hp}/{max} — puedes recuperarte {heal} o seguir.' },
  'rest.calm': { en: 'Nothing is hunting you here. Take the breath, or walk on.', es: 'Nada te persigue aquí. Toma el respiro, o sigue tu camino.' },
  'rest.heal': { en: 'Rest (+{n} HP)', es: 'Descansar (+{n} HP)' },
  'rest.moveOn': { en: 'Move on', es: 'Seguir' },
  'rest.temperHead': { en: 'Or temper a card at the forge (instead of resting):', es: 'O templa una carta en la forja (en vez de descansar):' },
  'rest.temper.aria': { en: 'Temper {name}. {text}', es: 'Templar {name}. {text}' },
  'page.rest': { en: 'IV — The Ember', es: 'IV — El Ascuas' },

  /* ---- event ------------------------------------------------------------------------ */
  'event.title': { en: 'The Wayside', es: 'El Camino' },
  'event.temperingNote': { en: 'The hammer is in your hand. Pick the card to temper — the choice is committed.', es: 'El martillo está en tu mano. Elige la carta a templar — la decisión queda tomada.' },
  'event.unclear': { en: 'The way is unclear, but it is open.', es: 'El camino es incierto, pero está abierto.' },
  'event.continue': { en: 'Continue', es: 'Continuar' },
  'event.continue.title': { en: 'The wayside is spent — back to the ascent.', es: 'El camino quedó atrás — de vuelta al ascenso.' },
  'event.choose': { en: 'Choose. The wayside does not offer twice.', es: 'Elige. El camino no ofrece dos veces.' },
  'event.unavailable': { en: 'Unavailable: {reason}.', es: 'No disponible: {reason}.' },
  'event.cost.gold': { en: 'Costs {n} gold', es: 'Cuesta {n} de oro' },
  'event.cost.hp': { en: 'Costs {n} HP', es: 'Cuesta {n} HP' },
  'page.event': { en: '✧ — The Wayside', es: '✧ — El Camino' },

  /* ---- shop --------------------------------------------------------------------------- */
  'shop.title': { en: 'The Ember Vendor', es: 'El Vendedor de Ascuas' },
  'shop.pickRemoval': { en: 'Choose what leaves', es: 'Elige qué se va' },
  'shop.wares': { en: 'Wares for the ascent', es: 'Géneros para el ascenso' },
  'shop.purse.title': { en: 'Your purse: {n} gold', es: 'Tu bolsa: {n} de oro' },
  'shop.gold': { en: '{n} gold', es: '{n} de oro' },
  'shop.removalNote': { en: 'The service is paid. Pick the copy that leaves your deck — duplicates are separate choices, and the removal is final.', es: 'El servicio está pagado. Elige la copia que sale de tu mazo — los duplicados son elecciones distintas, y la retirada es definitiva.' },
  'shop.copy': { en: ' · copy {a}/{b}', es: ' · copia {a}/{b}' },
  'shop.remove.aria': { en: 'Remove {name}{copy}{temper}. It leaves your deck for good.', es: 'Quitar {name}{copy}{temper}. Sale de tu mazo para siempre.' },
  'shop.tempered': { en: 'Tempered: {name}', es: 'Templada: {name}' },
  'shop.costsEnergy': { en: 'Costs {n} Energy', es: 'Cuesta {n} de Energía' },
  'shop.note': { en: 'Cards this run\u2019s rewards could still offer, priced by rarity. A grey shelf does not fit the purse \u2014 the vendor does not haggle.', es: 'Cartas que las recompensas de esta partida todavía podrían ofrecer, con precio por rareza. Un estante gris no cabe en la bolsa \u2014 el vendedor no regatea.' },
  'shop.soldNote': { en: ' Sold out.', es: ' Agotada.' },
  'shop.cannotNote': { en: ' Not affordable: {price} gold, purse {purse}.', es: ' No te alcanza: {price} de oro, bolsa {purse}.' },
  'shop.sold': { en: 'sold', es: 'vendida' },
  'shop.price.title': { en: 'Price: {n} gold', es: 'Precio: {n} de oro' },
  'shop.sold.title': { en: 'Sold', es: 'Vendida' },
  'shop.removalSpent': { en: 'The removal service is spent for this visit.', es: 'El servicio de retirada ya se usó en esta visita.' },
  'shop.removeBtn': { en: 'Remove a card \u2014 {n} gold', es: 'Quitar una carta \u2014 {n} de oro' },
  'shop.removeBtn.title': { en: 'One removal per visit: pay, then pick the exact copy to remove.', es: 'Una retirada por visita: paga y elige la copia exacta a quitar.' },
  'shop.removeBtn.poor': { en: 'The purse cannot cover {n} gold.', es: 'La bolsa no cubre {n} de oro.' },
  'shop.leave': { en: 'Leave', es: 'Salir' },
  'shop.leave.title': { en: 'Leaving is final \u2014 the shop is consumed like a fought node.', es: 'Salir es definitivo \u2014 la tienda se consume como un nodo peleado.' },
  'page.shop': { en: '✦ — The Vendor', es: '✦ — El Vendedor' },

  /* ---- kindling ----------------------------------------------------------------------- */
  'kindling.head': { en: 'The forge offers a kindling', es: 'La forja ofrece un rescoldo' },
  'kindling.note': { en: 'Take one. Each gift has a price.', es: 'Toma uno. Cada regalo tiene un precio.' },
  'kindling.boonCost': { en: 'Cost: ', es: 'Coste: ' },
  // Keyed by the HERO ID (actions.js HEROES), not the display name. KEPT BY RULING under
  // the fixed start: these rows are the two heroes' living content, but after the kindling
  // rework nothing in src consumes them at paint (the retired picker was the only one) —
  // the wiring test (i18n.test.js) is now their only net, pinning every HEROES id to a
  // non-empty en/es blurb.
  // I18N-2: the names. Ashwright is a proper noun (renders identically);
  // the Bellows Keeper's title localizes, article-less per the genderless-hero ruling.
  'hero.ironclad.name': { en: 'Ashwright', es: 'Ashwright' },
  'hero.bellows.name': { en: 'Bellows Keeper', es: 'Custodio del Fuelle' },
  'hero.ironclad.blurb': { en: '60 HP. Hammer and anvil. Kindled Heart: heal 6 after each fight.', es: '60 HP. Martillo y yunque. Corazón Encendido: recupera 6 tras cada combate.' },
  'hero.bellows.blurb': { en: '54 HP. Bellows Gust hits every enemy; Fan the Flames stokes Energy. Cyan Lantern: +1 Energy on the first turn of each fight.', es: '54 HP. Soplo del Fuelle golpea a todos los enemigos; Abanica las Llamas aviva la Energía. Farol Cian: +1 de Energía en el primer turno de cada combate.' },
  'page.kindling': { en: '0 — The Kindling', es: '0 — El Rescoldo' },

  /* ---- end screen ----------------------------------------------------------------------- */
  'end.title': { en: 'Run Over', es: 'Partida terminada' },
  'end.win': { en: 'VICTORY', es: 'VICTORIA' },
  'end.lose': { en: 'DEFEAT', es: 'DERROTA' },
  'end.stats.actLine': { en: 'Act {actN} · floor {floor} · {steps} steps · seed {seed} · {gold} gold · {relics}', es: 'Acto {actN} · piso {floor} · {steps} pasos · semilla {seed} · {gold} de oro · {relics}' },
  'end.stats.floor': { en: 'Reached floor {floor} · {steps} steps · seed {seed} · {gold} gold · {relics}', es: 'Llegaste al piso {floor} · {steps} pasos · semilla {seed} · {gold} de oro · {relics}' },
  'end.relics.one': { en: '1 relic', es: '1 reliquia' },
  'end.relics': { en: '{n} relics', es: '{n} reliquias' },
  'end.winAct1': { en: 'You cleared Act 1 and the Slag Warden fell.', es: 'Superaste el Acto 1 y el Guardián de Escoria cayó.' },
  'end.winAct2': { en: 'The Kiln Deeps are quiet. The climb is complete.', es: 'Las Hondonadas del Horno están en silencio. El ascenso está completo.' },
  // es is deliberately GENDERLESS ('Ashwright ha caído.') — the content never assigns
  // the hero a grammatical gender; flagged for the user to rule on before I18N-2.
  'end.defeatLine': { en: 'The Ashwright falls. Try a different route or a better card pick.', es: 'Ashwright ha caído. Prueba otra ruta o una mejor elección de cartas.' },
  'end.saveFailed': { en: 'This run could not be saved — your browser refused local storage.', es: 'Esta partida no pudo guardarse — tu navegador rechazó el almacenamiento local.' },
  'end.marks': { en: 'Marks', es: 'Distintivos' },
  'end.marksNote': { en: 'Marks do not add to the total.', es: 'Los distintivos no suman al total.' },
  'end.restart': { en: 'Restart  (r)', es: 'Reiniciar  (r)' },
  'end.ledger': { en: 'Open the Ledger  (h)', es: 'Abrir el Libro de cuentas  (h)' },
  'page.end': { en: 'V — The Ledger', es: 'V — El Libro de cuentas' },

  /* ---- ledger / unlock narration ------------------------------------------------------- */
  'ledger.aria': { en: 'Score ledger', es: 'Libro de puntuación' },
  'ledger.total': { en: 'Total', es: 'Total' },
  'ledger.yes': { en: 'yes', es: 'sí' },
  'ledger.no': { en: 'no', es: 'no' },
  'ledger.recognition': { en: 'This run ended on floor {floor}. You climbed {floorPlural} and killed {kills}. Killing an elite (+10) or the boss (+50) is where the larger totals come from.', es: 'Esta partida terminó en el piso {floor}. Escalaste {floorPlural} y mataste {kills}. Matar a un élite (+10) o al jefe (+50) es de donde salen los totales grandes.' },
  'end.floors.one': { en: '1 floor', es: '1 piso' },
  'end.floors': { en: '{n} floors', es: '{n} pisos' },
  'end.enemies.one': { en: '1 enemy', es: '1 enemigo' },
  'end.enemies': { en: '{n} enemies', es: '{n} enemigos' },
  'unlock.threshold.score': { en: 'Score {score} crossed the {mark}-point mark.', es: 'La puntuación {score} cruzó la marca de {mark} puntos.' },
  'unlock.threshold.runs': { en: 'Run {runs} crossed the {mark}-run mark.', es: 'La partida {runs} cruzó la marca de {mark} partidas.' },
  'unlock.threshold.condition': { en: 'Condition met: {condition}.', es: 'Condición cumplida: {condition}.' },
  'unlock.head': { en: 'UNLOCKED — {name}', es: 'DESBLOQUEADO — {name}' },
  'unlock.relics.head': { en: 'UNLOCKED — relics for the climbs ahead', es: 'DESBLOQUEADO — reliquias para los ascensos venideros' },
  'unlock.relics.line': { en: 'Your climbs unlocked: {names}.', es: 'Tus ascensos desbloquearon: {names}.' },
  'unlock.win.one': { en: 'win', es: 'victoria' },
  'unlock.win': { en: 'wins', es: 'victorias' },
  'unlock.pool.cards': { en: 'Cards in play: {n} of {m}.', es: 'Cartas en juego: {n} de {m}.' },
  'unlock.pool.relics': { en: 'Relics in play: {n} of {m}.', es: 'Reliquias en juego: {n} de {m}.' },
  'unlock.limit': { en: 'The card pool is the same {n} cards. Unlocking changes which of them you are offered — it does not add cards.', es: 'La reserva de cartas son las mismas {n} cartas. Desbloquear cambia cuáles se te ofrecen — no añade cartas.' },

  /* ---- toasts / announcements ------------------------------------------------------------ */
  'toast.illegal': { en: '✗ {err} — "{id}" is not legal right now', es: '✗ {err} — "{id}" no es legal ahora mismo' },
  'toast.rejected.aria': { en: 'That action was rejected: {err}.', es: 'Esa acción fue rechazada: {err}.' },
  'toast.playerHit': { en: 'You take {n} damage', es: 'Recibes {n} de daño' },
  'toast.dealt': { en: 'Dealt {n} damage', es: 'Infligiste {n} de daño' },
  'toast.dealtTo': { en: 'Dealt {n} damage to {name}', es: 'Infligiste {n} de daño a {name}' },
  'toast.block': { en: '+{n} block', es: '+{n} de bloqueo' },
  'toast.enemyFallback': { en: 'The enemy', es: 'El enemigo' },
  'target.aria': { en: 'Enemy {p} of {t} — {name}, {hp} of {max} HP, {intent}.', es: 'Enemigo {p} de {t} — {name}, {hp} de {max} HP, {intent}.' },
  'target.press': { en: ' Press {n} to target.', es: ' Pulsa {n} para apuntar.' },
  'target.intentUnknown': { en: 'intent unknown', es: 'intención desconocida' },
  'target.thatCard': { en: 'That card', es: 'Esa carta' },
  'target.needsTarget': { en: '{name} needs a target. {n} enemies alive. Press 1 to {m} to choose one, Escape to cancel.', es: '{name} necesita un objetivo. {n} enemigos vivos. Pulsa 1 a {m} para elegir uno, Escape para cancelar.' },
  'target.cancelled.toast': { en: 'Target cancelled — nothing was played', es: 'Objetivo cancelado — no se jugó nada' },
  'target.cancelled.aria': { en: 'Target cancelled. Nothing was played.', es: 'Objetivo cancelado. No se jugó nada.' },
  'combat.chapter': { en: 'II — The Fight', es: 'II — El Combate' },
  'fx.act.one': { en: 'Act I', es: 'Acto I' },

  /* ---- combat float words (floats.js) ---------------------------------- */
  'fx.absorbed': { en: 'absorbed', es: 'absorbido' },
  'fx.down': { en: 'down', es: 'caído' },
  'fx.bossDown': { en: 'BOSS DOWN', es: 'JEFE CAÍDO' },
  // The "golpes discretos NxM" floats: the parry proc's word (a refused strike reads as
  // its own fact, never as a 0), and the two tick words the bleed/poison floats carry in
  // small type beside the HP they took.
  'fx.parried': { en: 'parried', es: 'parada' },
  'fx.bleed': { en: 'bleed', es: 'sangrado' },
  'fx.poison': { en: 'poison', es: 'veneno' },

  /* ---- the kernel node labels, localized for the travel tooltip ----------
     The kernel's NODE_TYPES labels ('fight', 'fight+', …) are agent-facing English;
     the travel tooltip interpolates THESE instead (map-view.js), with the kernel
     label as the fallback for a type this table does not name. */
  'map.label.combat_weak': { en: 'fight', es: 'pelea' },
  'map.label.combat_strong': { en: 'fight+', es: 'pelea dura' },
  'map.label.elite': { en: 'elite', es: 'élite' },
  'map.label.rest': { en: 'rest', es: 'descanso' },
  'map.label.shop': { en: 'shop', es: 'tienda' },
  'map.label.event': { en: 'event', es: 'suceso' },
  'map.label.boss': { en: 'boss', es: 'jefe' },

  /* ---- relic unlock thresholds (run-history.js relicThresholdLine) ------- */
  'relicThreshold.crossed': { en: '{n} lifetime {plural} crossed the {marks} mark{marksPlural}.', es: '{n} {plural} de por vida {verb} {marksClause} {marks}.' },
  'relicThreshold.plain': { en: '{n} lifetime {plural} on the ledger.', es: '{n} {plural} de por vida en el libro de cuentas.' },
  'relicThreshold.marksClause': { en: 'the', es: 'la marca de' },
  'relicThreshold.verb': { en: 'crossed', es: 'cruzaron' },
  'relicThreshold.verb1': { en: 'crossed', es: 'cruzó' },
  'relicThreshold.marksClausePlural': { en: 'the', es: 'las marcas de' },

  /* ---- product tour (ONBOARDING-TOUR) ---------------------------------- */
  // While the tour is open the surface's keyboard guard swallows every game shortcut
  // (app.js's tour guard, ONBOARDING-TOUR §5.4), so the combat steps (3-5 of 5) name
  // the CLICK path and say the keys come back when the tour ends — teaching a swallowed
  // shortcut on the exact screen it is swallowed on teaches nothing.
  'tour.title': { en: 'First steps at the forge', es: 'Primeros pasos en la forja' },
  'tour.stepOf': { en: 'Step {n} of {m}', es: 'Paso {n} de {m}' },
  'tour.next': { en: 'Next', es: 'Siguiente' },
  'tour.back': { en: 'Back', es: 'Atrás' },
  'tour.done': { en: 'Done — climb', es: 'Listo — a escalar' },
  'tour.skip': { en: 'Skip the tour  (Esc)', es: 'Saltar el recorrido  (Esc)' },
  'tour.replay': { en: 'Replay the guided tour', es: 'Repetir el recorrido guiado' },
  'tour.replay.title': { en: 'Five short steps over the real screens', es: 'Cinco pasos cortos sobre las pantallas reales' },
  // Under the fixed start the kindling step IS the tour's first real step, and its way
  // forward is the boon itself — so its copy rides the hint line instead of a Next, and
  // the old heroes-step rows (and their arrow-teaching copy) are gone with the pickers.
  'tour.hint.kindling': { en: 'Take a boon to continue — the tour follows.', es: 'Toma un rescoldo para continuar — el recorrido te sigue.' },
  'tour.hint.map': { en: 'Travel to a glowing node to continue — the tour follows.', es: 'Viaja a un nodo brillante para continuar — el recorrido te sigue.' },
  'tour.step.kindling.title': { en: 'The kindling', es: 'El rescoldo' },
  'tour.step.kindling.body': { en: 'Take exactly one below: each gift has a price, and taking it starts the ascent.', es: 'Toma exactamente uno abajo: cada regalo tiene un precio, y tomarlo inicia el ascenso.' },
  'tour.step.map.title': { en: 'The ascent map', es: 'El mapa del ascenso' },
  'tour.step.map.body': { en: 'You climb floor by floor: click a glowing node to travel. Fights pay cards, the campfire heals, the Slag Warden waits at the top — you can only reach the nodes linked to your floor.', es: 'Subes piso a piso: haz clic en un nodo brillante para viajar. Las peleas pagan cartas, la hoguera cura, y el Guardián de Escoria espera arriba — solo puedes alcanzar los nodos enlazados a tu piso.' },
  'tour.step.hand.title': { en: 'Your hand and your Energy', es: 'Tu mano y tu Energía' },
  'tour.step.hand.body': { en: 'Click a card to play it. The orb counts the Energy left this turn — every card costs its gem, and the hand refills each turn. (Number keys come back when the tour ends.)', es: 'Haz clic en una carta para jugarla. El orbe cuenta la Energía que queda este turno — cada carta cuesta su gema, y la mano se rellena cada turno. (Las teclas de número vuelven cuando termina el recorrido.)' },
  'tour.step.intent.title': { en: 'What the enemy intends', es: 'Lo que el enemigo pretende' },
  'tour.step.intent.body': { en: 'The row over each enemy announces its next move — a number is damage headed your way. Read it before you spend the turn: the enemy acts the moment you end the turn.', es: 'La fila sobre cada enemigo anuncia su próximo movimiento — un número es daño que viene hacia ti. Léelo antes de gastar el turno: el enemigo actúa en cuanto termines el turno.' },
  'tour.step.endTurn.title': { en: 'End the turn', es: 'Termina el turno' },
  'tour.step.endTurn.body': { en: 'When the Energy is spent or the plan is set, click End Turn. The enemies act, then a fresh hand is dealt. That is the whole loop: play, end, climb. (The e and Space keys come back when the tour ends.)', es: 'Cuando gastes la Energía o el plan esté listo, haz clic en Terminar turno. Los enemigos actúan y llega una mano nueva. Ese es todo el bucle: jugar, terminar, escalar. (Las teclas e y Espacio vuelven cuando termina el recorrido.)' },
};

/**
 * One UI string, in the current language, with the English twin as the honest fallback:
 * a missing Spanish value renders the English string — never a key name, never empty.
 * @param {string} key a STRINGS key
 * @param {Record<string, any>} [params] values for the `{hole}`s
 * @returns {string}
 */
export function t(key, params = null) {
  const row = STRINGS[key];
  // A missing ROW is a programming error the i18n unit test pins; returning the key
  // here would violate the no-key-name rule, so the empty string stands in and the
  // test is what fails loudly.
  const base = row ? ((lang === 'es' ? (row.es ?? row.en) : row.en) ?? '') : '';
  if (!params) return base;
  return base.replace(/\{(\w+)\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m));
}

/**
 * The whole table, for tests: `{ key: {en, es} }`. Read-only by convention.
 * @returns {Record<string, {en: string, es: string}>}
 */
export function strings() {
  return STRINGS;
}

/* NOTE ON switchLang: flipping the language must also re-snapshot the CURRENT run
 * (`ctl.snapshot({ lang })`) and repaint — and both of those live in the runtime layer.
 * Keeping them out of THIS module is what makes i18n.js a dependency-free leaf a plain
 * unit test can import; the switch lives in actions.js beside newGame(), the other
 * run-lifecycle move. */
