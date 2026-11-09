// src/web/hud.js — the top status bar, the help/glossary sheet, the deck viewer and the
// card codex.
//
// Every string on the help sheet comes from the kernel (`snap.help`, `snap.glossary`),
// so the browser can never explain a rule differently from the engine that enforces it.
// `helpOpen` is written only here (by `toggleHelp`), so it needs no setter — and the same
// is true of `deckOpen` (by `toggleDeck`) and `codexOpen` (by `toggleCodex`): all three
// overlays are presentation state owned by this module and painted by render.js on the
// next repaint.

import { flash, hudEl, reducedMotion, repaint, snap } from './runtime.js';
import { capitalize, el } from './dom.js';
import { freshStatusKeys } from './floats.js';
import { act, newGame } from './actions.js';
import { cancelTargeting } from './targeting.js';
import { POTION_GLYPH, glyphBox } from './glyphs.js';
import { cardDescribe, cardTile } from './combat-view.js';
import { cardPool } from '../kernel/index.js';
import { inDeckCounts } from './deck-counts.js';
import { currentLang, t } from './i18n.js';
import { switchLang } from './actions.js';
import { startTour, HELP_SEEN_KEY } from './tour.js';

/* ------------------------------------------------------------------------- HUD */

export function renderHud() {
  hudEl.replaceChildren();
  const p = snap.player;

  hudEl.append(
    el('span', {
      cls: 'hud-char',
      text: snap.characterName || capitalize(snap.character),
      attrs: { title: snap.relicName ? t('hud.char.title', { name: snap.characterName, relic: snap.relicName }) : '' },
    }),
  );

  // DESIGN REV 3 (UX spec): the word label is NOT part of the value text. Emitting `HP 60/60`
  // as one text node inside a chip with a 44px min-width is what wrapped the HUD into
  // two-line blocks on a phone ("HP" over "60/60"). The glyph carries the label, the title
  // carries the full sentence for hover and screen readers, and the value can never wrap.
  hudEl.append(stat('hp', '♥', `${p.hp}/${p.maxHp}`, flash.hp, t('hud.hp.title', { hp: p.hp, max: p.maxHp })));
  hudEl.append(stat('energy', '⚡', `${p.energy}/${snap.energyPerTurn}`, flash.energy,
    t('hud.energy.title', { n: p.energy, max: snap.energyPerTurn })));
  hudEl.append(stat('block', '⛨', String(p.block), flash.block, t('hud.block.title', { n: p.block })));
  // S3 gold economy: the purse is a READOUT, not a control — no button, no flash, just the
  // kernel's own `snap.player.gold` (the same value the CLI dump's GOLD header shows), so
  // the browser can never disagree with the engine about how rich you are.
  const purse = p.gold ?? 0;
  hudEl.append(stat('gold', '◉', String(purse), false, t('hud.gold.title', { n: purse })));
  // The belt renders in COMBAT only (renderBelt's own why): potions are combat items,
  // and the kernel offers their actions there alone — anywhere else the row was pure
  // duplicate chrome. The relic readout is gone outright: relics act through hooks,
  // never through a click, so the chip offered nothing a click could do and the run's
  // relic list still names itself where it matters (the kindling screen, the reward
  // heads, the run summary).
  if (snap.phase === 'combat') hudEl.append(renderBelt());
  hudEl.append(el('span', { cls: 'hud-step', text: t('hud.step', { n: snap.stepIndex }) }));

  // PARITY: combat statuses (Vulnerable, Weak, …) moved DOWN to the hero's own card
  // (combat-view heroFigure) — the same place an enemy's statuses sit — because up here
  // a landing debuff read as faint legend chrome. The HUD keeps only the POWERS:
  // run-long counters (Combust, Rupture, …) that outlive the fight, which the combat
  // card never shows. The juice diff is powers-only now, against the same previous-paint
  // record render.js keeps.
  const freshSelf = freshStatusKeys(p.powers || []);
  for (const pw of p.powers) hudEl.append(el('span', {
    cls: 'pill power' + (freshSelf.has(pw.key) ? ' juice-in' : ''),
    text: pw.text || `${pw.label || pw.key} ${pw.stacks}`,
    attrs: { title: pw.explain || '' },
  }));

  hudEl.append(el('span', { cls: 'spacer' }));
  // S1 master-deck viewer: read-only, reachable wherever the HUD is (map, combat and the
  // rest phases alike). The count is the kernel's own `deckCount`, so the button can
  // never disagree with the deck the modal lists — and text and aria-label share one
  // computed total, so the visible name and the announced name cannot drift apart.
  const deckTotal = snap.deckCount ?? (snap.deckCards || []).reduce((n, c) => n + c.count, 0);
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: t('hud.deck', { n: deckTotal }),
    attrs: {
      type: 'button',
      title: t('hud.deck.title'),
      'aria-label': t('hud.deck.aria', { n: deckTotal }),
    },
    on: { click: () => toggleDeck(true) },
  }));
  // S2 card codex: what THIS run's rewards can add to that deck — the kernel's lookup
  // table filtered to the run's own draftPool (runCodexRows), so a narrowed unlock
  // profile announces the shorter truth, and the button announces the same count the
  // sheet will list.
  const codexTotal = runCodexRows().length;
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: t('hud.cards'),
    attrs: {
      type: 'button',
      title: t('hud.cards.title'),
      'aria-label': t('hud.cards.aria', { n: codexTotal }),
    },
    on: { click: () => toggleCodex(true) },
  }));
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: t('hud.help'),
    // No keyboard binding opens Help (the old "keyboard: ?" title named a key that was
    // never wired — POLISH round nit); Escape is how the OPEN sheet closes (app.js).
    attrs: { type: 'button', title: t('hud.help.title') },
    on: { click: () => toggleHelp(true) },
  }));
  // I18N-1: the language toggle. The label names the CURRENT language (EN/ES); the
  // aria-label is bilingual by design ("Language / Idioma") so a screen reader finds it
  // in either language. switchLang() re-snapshots the CURRENT run with the new lang and
  // repaints — the same run re-narrated, its state untouched.
  hudEl.append(el('button', {
    cls: 'btn ghost lang-toggle',
    text: t('lang.toggle'),
    attrs: {
      type: 'button',
      title: t('lang.toggle.title'),
      'aria-label': t('lang.toggle.aria'),
    },
    on: { click: () => switchLang() },
  }));
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: t('hud.newRun'),
    attrs: { type: 'button', title: t('hud.newRun.title', { n: snap.seed }) },
    on: { click: () => newGame() },
  }));
}

/* --------------------------------------------------------------------- BELT (S5) */

/**
 * The potion belt: exactly `snap.beltSlots` slots beside the gold readout — rendered in
 * COMBAT ONLY (the renderHud call site guards on `snap.phase === 'combat'`), so every
 * row here IS the combat shape: a FILLED slot is a named glyph chip (mark + name,
 * tooltip = the kernel's own effect sentence) that is a BUTTON opening the quaff/discard
 * popover (beltPanel below); an EMPTY slot is a dim flask. Combat is the belt's whole
 * home — the kernel offers belt actions in `phase === 'combat'` alone, and potions are
 * combat items — so there is no off-combat shape to keep: elsewhere the belt does not
 * render at all (the elite's spoils chip, the reward heads and the run summary still
 * name what the run carries where it matters). A stale belt id (a torn save) renders
 * under its raw id with the flask's rune fallback, exactly like the snapshot's
 * `known: false` row: it stays VISIBLE, never thrown away.
 * @returns {HTMLElement} the `.belt` group
 */
function renderBelt() {
  const rows = snap.belt ?? [];
  const slots = snap.beltSlots ?? 3;
  const belt = el('span', { cls: 'belt', attrs: { role: 'group', 'aria-label': t('belt.aria', { n: rows.length, m: slots }) } });
  for (let i = 0; i < slots; i += 1) {
    const row = rows[i] ?? null;
    if (!row) {
      belt.append(el('span', {
        cls: 'belt-slot empty',
        attrs: {
          title: t('belt.slot.empty', { n: i + 1 }),
          'aria-label': t('belt.slot.empty', { n: i + 1 }),
        },
      }, glyphBox('flask', 'belt-glyph')));
      continue;
    }
    // The belt only paints in combat (the call-site guard), so a filled slot is always
    // the quaff/discard button — no inert readout shape exists any more.
    const tip = `${row.name} — ${row.text || t('belt.unknown')}${row.known ? '' : t('belt.unknownId')}`;
    belt.append(el('button', {
      cls: 'belt-slot filled',
      attrs: {
        type: 'button',
        title: `${tip}${t('belt.click')}`,
        'aria-label': t('belt.slot.aria', { n: i + 1, name: row.name }),
        'aria-haspopup': 'dialog',
        'aria-expanded': String(beltOpenSlot === row.slot),
      },
      on: { click: (ev) => { ev.__dlbHandled = true; toggleBelt(row.slot); } },
    },
      glyphBox(POTION_GLYPH[row.potionId] || 'flask', 'belt-glyph'),
      el('span', { cls: 'belt-name', text: row.name }),
    ));
  }
  return belt;
}

/** The belt slot (its 1-based `slot`) whose popover is open, or null. Written only by
 *  toggleBelt, like helpOpen/deckOpen/codexOpen: presentation state this module owns. */
export let beltOpenSlot = null;

/** Open (or close, with null) the quaff/discard popover for one belt slot. Opening one
 *  slot closes another, and opening cancels a pending card aim — two choice steps open
 *  at once would let a click land somewhere the player stopped looking at. */
export function toggleBelt(slot) {
  if (slot !== null) cancelTargeting();
  beltOpenSlot = slot;
  repaint();
}

/** The paint sink's silent setter (render.js only): drops a stale slot flag WITHOUT a
 *  repaint. beltPanel runs mid-render and must never set flags itself (S5 review P3),
 *  so the stale-flag clear lives where the other one-paint flags are consumed. */
export function setBeltOpenSlot(slot) {
  beltOpenSlot = slot;
}

/**
 * The quaff/discard popover (the shop removal modal's two-choice pattern, scaled to one
 * potion): what the potion is, one Quaff button per legal form — a single one, or one
 * per living enemy when the potion must be aimed (the kernel's `quaffIds`, in
 * living-enemy order) — one Discard, and the way out. Every id comes from
 * `snap.belt[].quaffIds` / `discardId` (null outside combat: the popover only opens
 * from a combat click), so the popover can never paint a button the kernel would
 * reject. Acting closes the popover: a spent potion has nothing left to choose.
 * @returns {HTMLElement} the `.modal-back` sheet
 */
export function beltPanel() {
  const row = (snap.belt ?? []).find((r) => r.slot === beltOpenSlot);
  const back = el('div', { cls: 'modal-back', attrs: { role: 'dialog', 'aria-label': t('belt.panel.aria') } });
  back.addEventListener('click', (ev) => { if (ev.target === back) toggleBelt(null); });
  // A missing row (a stale slot index after a repaint raced the click) renders as the
  // bare backdrop and NOTHING else: this function runs mid-render, so calling
  // toggleBelt(null) here used to flip a state flag DURING the paint — a nested
  // repaint against a half-built stage, with the next action's backdrop left stale.
  // The flag is presentation state; the next repaint (the next act() or hover) clears
  // it through the normal path, and an empty backdrop covers the stage meanwhile.
  if (!row) return back;

  const panel = el('div', { cls: 'modal belt-modal', attrs: { role: 'dialog', 'aria-label': t('belt.panel.title', { name: row.name }) } });
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: row.name }));
  scroll.append(el('p', { cls: 'belt-desc', text: row.text || t('belt.panel.unknownText') }));

  const choices = el('div', { cls: 'belt-choices' });
  for (const id of row.quaffIds) {
    // An aimed potion lists one button per living enemy, named the way the targeting
    // step names them (position + face + HP), so the two flows read alike.
    const k = /_(\d+)$/.exec(id);
    const enemy = k ? snap.enemies[Number(k[1]) - 1] : null;
    choices.append(el('button', {
      cls: 'btn belt-act quaff',
      text: enemy ? t('belt.quaff.aimed', { enemy: enemy.name, hp: enemy.hp, max: enemy.maxHp }) : t('belt.quaff'),
      attrs: {
        type: 'button',
        'data-action': id,
        title: enemy ? t('belt.quaff.aimedTitle', { n: Number(k[1]) }) : row.text,
        'aria-label': enemy
          ? t('belt.quaff.ariaAimed', { name: row.name, enemy: enemy.name, hp: enemy.hp, max: enemy.maxHp })
          : t('belt.quaff.aria', { name: row.name, text: row.text }),
      },
      on: { click: (ev) => { ev.__dlbHandled = true; act(id); toggleBelt(null); } },
    }));
  }
  if (row.discardId) {
    choices.append(el('button', {
      cls: 'btn secondary belt-act discard',
      text: t('belt.discard'),
      attrs: {
        type: 'button',
        'data-action': row.discardId,
        title: t('belt.discard.title'),
        'aria-label': t('belt.discard.aria', { name: row.name }),
      },
      on: { click: (ev) => { ev.__dlbHandled = true; act(row.discardId); toggleBelt(null); } },
    }));
  }
  scroll.append(choices);
  if (snap.phase !== 'combat') {
    scroll.append(el('p', { cls: 'hint', text: t('belt.combatOnlyNote') }));
  }

  panel.append(scroll);
  panel.append(el('div', { cls: 'modal-foot' },
    el('button', {
      cls: 'btn secondary',
      text: t('belt.close'),
      attrs: { type: 'button', title: t('belt.close.title') },
      on: { click: () => toggleBelt(null) },
    }),
  ));
  back.append(panel);
  return back;
}

/** 1st/2nd/3rd… for the aim tooltip — presentation wording, localized like the rest. */
function ordinal(n) {
  return t('ord', { n });
}

/* ----------------------------------------------------------------- HELP / GLOSSARY */

export let helpOpen = false;
// The key string itself lives in tour.js beside TOUR_SEEN_KEY — the coexistence rule
// (§4 of ONBOARDING-TOUR) pairs the two flags, so one module owns both strings and this
// one consumes it (the app-bundle harness allows no re-export lists, and no reader is
// left importing it from here).

export function toggleHelp(open) {
  helpOpen = open;
  repaint();
}

/**
 * The how-to-play panel and the keyword glossary. Every string comes from the kernel
 * (`snap.help`, `snap.glossary`), so the browser can never explain a rule differently
 * from the engine that enforces it.
 */
/**
 * The how-to-play panel and the keyword glossary. Every string comes from the kernel
 * (`snap.help`, `snap.glossary`), so the browser can never explain a rule differently
 * from the engine that enforces it.
 *
 * Structure note (phone fix): the sheet has an INNER `.modal-scroll` and the `Got it`
 * control is a SIBLING of that scroller, not a child of it. Laid out this way the sheet is
 * a column, the scroller takes the leftover height with `min-height: 0`, and the footer is
 * simply the last row — so the dismiss button is on screen at every viewport height with no
 * `position: fixed`, no measured geometry and no compromise to the document scroll. Before
 * this, a 390x844 phone put `Got it` below the fold of a ~760px sheet and the only ways out
 * were Escape or tapping the backdrop.
 */
export function helpPanel() {
  const back = el('div', { cls: 'modal-back' });
  back.addEventListener('click', (ev) => { if (ev.target === back) toggleHelp(false); });

  const panel = el('div', { cls: 'modal', attrs: { role: 'dialog', 'aria-label': t('help.title') } });
  // Everything that can be long lives in the scroller: the panel scrolls INSIDE the
  // viewport instead of growing past it.
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: t('help.title') }));

  for (const topic of snap.help || []) {
    scroll.append(el('div', { cls: 'help-topic' },
      el('div', { cls: 'ht-title', text: topic.title }),
      el('div', { cls: 'ht-body', text: topic.body }),
    ));
  }

  // How targeting works is the SURFACE's behaviour, not a game rule, so this line lives
  // here rather than in the kernel's help topics: the engine has no opinion about clicks.
  scroll.append(el('div', { cls: 'help-topic' },
    el('div', { cls: 'ht-title', text: t('help.aim.title') }),
    el('div', { cls: 'ht-body', text: t('help.aim.body') }),
  ));

  scroll.append(el('h2', { cls: 'mt', text: t('help.shorthand.title') }));
  scroll.append(el('p', { cls: 'hint', text: t('help.shorthand.hint') }));

  // Grouped, so the vocabulary a player meets on every card is separated from the codes
  // that only ever appear on one card. The kernel supplies the grouping.
  const sections = snap.glossarySections || [{ key: 'A', title: t('codex.other'), blurb: '' }];
  for (const section of sections) {
    const rows = (snap.glossary || []).filter((r) => (r.group || 'A') === section.key);
    if (rows.length === 0) continue;
    scroll.append(el('h3', { cls: 'gl-section', text: section.title }));
    if (section.blurb) scroll.append(el('p', { cls: 'gl-blurb', text: section.blurb }));
    const list = el('dl', { cls: 'glossary' });
    for (const row of rows) {
      list.append(el('dt', { cls: 'gl-token', text: row.token }));
      list.append(el('dd', { cls: 'gl-cell' },
        el('span', { cls: 'gl-label', text: row.label }),
        el('span', { cls: 'gl-meaning', text: row.meaning }),
      ));
    }
    scroll.append(list);
  }

  panel.append(scroll);
  panel.append(el('div', { cls: 'modal-foot' },
    el('button', {
      cls: 'btn',
      text: t('help.gotIt'),
      attrs: { type: 'button' },
      on: { click: () => { try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch {} toggleHelp(false); } },
    }),
    // ONBOARDING-TOUR: the veteran's way back in. It reopens the tour at the step for
    // the phase the player is standing on and writes no flag (only finishing or
    // dismissing the tour does, tour.js).
    el('button', {
      cls: 'btn secondary',
      text: t('tour.replay'),
      attrs: { type: 'button', title: t('tour.replay.title') },
      on: { click: () => { toggleHelp(false); startTour(); } },
    }),
    // New Run moved here from the HUD (UX rev 3): it is destructive — it discards the run —
    // and never belonged one tap from End Turn. The `n` hotkey still starts a new run.
    el('button', {
      cls: 'btn secondary',
      text: t('hud.newRun'),
      attrs: { type: 'button', title: t('help.newRun.title') },
      on: { click: () => newGame() },
    }),
  ));

  back.append(panel);
  return back;
}

/* --------------------------------------------------------------- DECK VIEWER (S1) */

export let deckOpen = false;

export function toggleDeck(open) {
  deckOpen = open;
  repaint();
}

/**
 * The master-deck sheet (S1), UX-8: every card the run owns, read-only, rendered as the
 * GAME'S card tiles — one tile per COPY (a 4× Quench deck shows 4 Quench tiles; the count
 * is the tile count, the way Slay the Spire's deck view reads). Every row is a fact the
 * kernel's snapshot already published (`snap.deckCards`, aggregated and sorted THERE), so
 * this gallery can never show a card the run does not own, a cost the engine does not
 * charge or a temper the rules do not resolve; the tile count IS the kernel's own
 * deckCount. The rows lack the describe layer, so `cardDescribe` (combat-view's gallery
 * fact layer, kernel wording) supplies each tile's sentence and flavor line. The shell is
 * the help sheet's own — `.modal-back` > `.modal` > `.modal-scroll` + `.modal-foot` — so
 * the page keeps ONE modal system: the backdrop click and the Close button dismiss it
 * exactly like Help, and Escape closes either (app.js's sheet guards; the S1.1-era note
 * that Help had no Escape predates the keyguard round).
 */
export function deckPanel() {
  const rows = snap.deckCards || [];
  const count = snap.deckCount ?? rows.reduce((n, c) => n + c.count, 0);
  const back = el('div', { cls: 'modal-back' });
  back.addEventListener('click', (ev) => { if (ev.target === back) toggleDeck(false); });

  const panel = el('div', { cls: 'modal deck-modal', attrs: { role: 'dialog', 'aria-label': t('deck.title', { n: count }) } });
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: t('deck.heading', { n: count }) }));

  if (rows.length === 0) {
    scroll.append(el('p', { cls: 'hint', text: t('deck.empty') }));
  } else {
    const grid = el('div', { cls: 'deck-grid' });
    for (const c of rows) {
      for (let copy = 0; copy < (c.count ?? 1); copy += 1) grid.append(deckTile(c));
    }
    scroll.append(grid);
  }

  panel.append(scroll);
  panel.append(el('div', { cls: 'modal-foot' },
    el('button', {
      cls: 'btn secondary',
      text: t('belt.close'),
      attrs: { type: 'button', title: t('deck.close.title') },
      on: { click: () => toggleDeck(false) },
    }),
  ));
  back.append(panel);
  return back;
}

/**
 * One deck TILE: the full card face — art, cost gem, type head, name, flavor, effect
 * sentence — read-only (`cardTile`'s readOnly shape: a labelled div, never the hand's
 * disabled affordance). A tempered copy wears the tile's own trim and forged stamp
 * (`.ctemper`, the hand's very mark): the visible sentence is the ROW's own — the
 * kernel's tempered describe sentence from snapshotDeck — so the sheet can never
 * disagree with the hand about one card, and the stamp's tooltip carries the kernel's
 * own temper sentence on top.
 */
function deckTile(c) {
  const tile = cardTile({
    slot: `${c.cardId}|${c.temper ?? ''}|${c.copy ?? 0}`,
    cardId: c.cardId,
    name: c.name,
    flavor: c.flavor,
    cost: c.cost,
    type: c.type,
    typeLabel: c.typeLabel,
    description: c.description || c.name,
    // The row's own kernel-published chip list — already read off the TEMPERED
    // definition by snapshotDeck, so a Red-hot row's damage chip says the tempered 9.
    chips: c.chips ?? [],
    chipsComplete: c.chipsComplete === true,
    playable: false,
    showSummary: false,
    temper: c.temper,
    temperName: c.temperName,
    temperText: c.temperText,
  }, { readOnly: true });
  if (c.tempered) {
    // The full effect in one sentence on hover and for readers: the row's own (tempered)
    // rules sentence plus the kernel's temper sentence, both published verbatim.
    const full = `${c.description} ${c.temperText}`.trim();
    tile.setAttribute('title', full);
    tile.setAttribute('aria-label', `${tile.getAttribute('aria-label')} ${c.temperText}`.trim());
  }
  return tile;
}

/* ---------------------------------------------------------------- CARD CODEX (S2) */

/**
 * The kernel's full-set LOOKUP TABLE, one row per card the shipped content could ever
 * offer, describe-layer enriched. It was computed once at load; I18N-1 makes the rows
 * language-dependent (`cardPool({ lang })`), so the table is cached PER LANGUAGE and
 * re-derived the first time a paint asks in a language it has not seen — a language
 * switch repaints in the new language without paying for the other one again.
 */
const codexCache = {};
function codexPool() {
  const lang = currentLang();
  if (!codexCache[lang]) codexCache[lang] = cardPool({ lang });
  return codexCache[lang];
}

/** The rarity groups in the order a new player should meet them; a group with no rows is
 *  skipped. Labels are keys, resolved per paint — the words follow the language. */
const RARITY_GROUPS = [
  { key: 'common', labelKey: 'codex.common' },
  { key: 'uncommon', labelKey: 'codex.uncommon' },
  { key: 'rare', labelKey: 'codex.rare' },
];
const RARITY_GROUP_KEYS = new Set(RARITY_GROUPS.map((g) => g.key));

/**
 * The codex rows the CURRENT run can actually be offered: the lookup table filtered to
 * `snap.draftPool` — the exact id set `rules/act.js rollReward` picks this run's rewards
 * from, which every snapshot publishes. Recomputed per read (a Set over at most 65 cached
 * rows — no describe work), so a new run's narrowing is live from its first paint. A
 * snapshot that predates the field (null: a state loaded from a legacy save) falls back
 * to the whole table — the best a surface can do when the kernel could not say — while an
 * EMPTY array is taken at its word: "Cards (0)", nothing offerable this run.
 * @returns {Array<typeof CODEX_POOL[number]>}
 */
function runCodexRows() {
  const ids = snap.draftPool;
  if (!Array.isArray(ids)) return codexPool();
  const offerable = new Set(ids);
  return codexPool().filter((c) => offerable.has(c.cardId));
}

export let codexOpen = false;

export function toggleCodex(open) {
  codexOpen = open;
  repaint();
}

/**
 * The card codex sheet (S2), UX-8: every card THIS run's combat rewards can add to the
 * deck, grouped by rarity with group counts, read-only — rendered as the GAME'S card
 * tiles in a scrolling gallery (a card library, not a table). The rows are the kernel's
 * `cardPool()` lookup filtered to the run's own `snap.draftPool` (so a narrowed profile
 * shows only what can really be offered), every tile is a describe-layer fact, and the
 * brass "in deck ×N" chip rides the tile's corner as a sum of the kernel's own
 * `deckCards` counts — the gallery can never show a card the reward deck cannot offer,
 * or a copy the run does not hold. Tiles are `cardTile`'s readOnly shape: full art and
 * cost gem, never the hand's disabled affordance, no click. The shell is the deck
 * sheet's own — `.modal-back` > `.modal` > `.modal-scroll` + `.modal-foot` — so the page
 * keeps ONE modal system: backdrop click, Escape and Close all dismiss it, exactly like
 * Help and Deck.
 */
export function codexPanel() {
  const rows = runCodexRows();
  const tally = inDeckCounts(snap.deckCards);
  const back = el('div', { cls: 'modal-back' });
  back.addEventListener('click', (ev) => { if (ev.target === back) toggleCodex(false); });

  const panel = el('div', { cls: 'modal codex-modal', attrs: { role: 'dialog', 'aria-label': t('hud.cards.aria', { n: rows.length }) } });
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: t('codex.title', { n: rows.length }) }));
  scroll.append(el('p', { cls: 'hint', text: t('codex.hint') }));

  // The three rarity tiers, then a catch-all so the header total can never count a tile no
  // group renders: a rarity the tiers above do not name still shows, under "Other".
  for (const group of [...RARITY_GROUPS, { key: null, labelKey: 'codex.other' }]) {
    const groupRows = group.key === null
      ? rows.filter((c) => !RARITY_GROUP_KEYS.has(c.rarity))
      : rows.filter((c) => c.rarity === group.key);
    if (groupRows.length === 0) continue;
    scroll.append(el('h3', { cls: 'codex-group-head', text: `${t(group.labelKey)} (${groupRows.length})` }));
    const grid = el('div', { cls: 'codex-grid' });
    for (const c of groupRows) grid.append(codexTile(c, tally.get(c.cardId) ?? 0));
    scroll.append(grid);
  }

  panel.append(scroll);
  panel.append(el('div', { cls: 'modal-foot' },
    el('button', {
      cls: 'btn secondary',
      text: t('belt.close'),
      attrs: { type: 'button', title: t('deck.close.title') },
      on: { click: () => toggleCodex(false) },
    }),
  ));
  back.append(panel);
  return back;
}

/**
 * One codex TILE: the full card face — cost gem, type head, art, name, flavor, the
 * card's own describe-layer sentence — read-only. The rarity word rides the tile's
 * label and title (the group header is the visual cue, and the tile hue is the type's,
 * so rarity keeps a spoken home deep in a long group), and — only when the deck holds
 * at least one copy — the brass "in deck ×N" chip is pinned to the tile's corner, the
 * price badge's own slot. Zero copies render no chip: absence is the fact, and 65 zero
 * chips would bury it.
 */
function codexTile(c, inDeck) {
  const fact = cardDescribe(c.cardId);
  const rarity = t(`codex.${c.rarity}`) || c.rarity;
  // Completeness follows the chips ACTUALLY chosen (the row's when it carries one, the
  // fact's otherwise) — ORing the two flags could claim coverage the printed chips
  // don't hold and drop a sentence those chips don't restate.
  const chips = c.chips ?? fact.chips ?? [];
  const chipsComplete = (c.chips ? c.chipsComplete : fact.chipsComplete) === true;
  const tile = cardTile({
    slot: c.cardId,
    cardId: c.cardId,
    name: c.name,
    flavor: fact.flavor,
    cost: c.cost,
    type: c.type,
    typeLabel: c.typeLabel,
    description: c.description,
    // The chip row: the lookup-table row's own kernel-published list (cardPool words it
    // exactly as the hand's snapshot rows do); the describe fact is the fallback for a
    // caller whose row predates the field. Same chips everywhere, or none anywhere.
    chips,
    chipsComplete,
    playable: false,
    showSummary: false,
  }, { readOnly: true });
  const labelled = `${tile.getAttribute('aria-label')} (${t('codex.rarity', { r: rarity })})`;
  tile.setAttribute('aria-label', labelled);
  tile.setAttribute('title', `${c.description} (${rarity})`);
  if (inDeck > 0) {
    tile.append(el('span', {
      cls: 'codex-indeck',
      text: t('codex.indeck', { n: inDeck }),
      attrs: { title: t(inDeck === 1 ? 'codex.indeck.title' : 'codex.indeck.titlePlural', { n: inDeck }) },
    }));
  }
  return tile;
}

function stat(kind, glyph, text, isFlash, title) {
  // Two independent cues on the same element: the colour flash (which value changed) and
  // the jolt (which HURT). The generation suffix is what keeps the animation from restarting
  // on every repaint. Under reduced motion neither class is emitted and the number alone
  // reports the change, so no fact is lost.
  const flashCls = { hp: 'flash-hit', energy: 'flash-energy', block: 'flash-block' }[kind] || '';
  const cls = `stat ${kind}`
    + (isFlash && flashCls && !reducedMotion ? ` ${flashCls} flash-${kind}-${flash.n}` : '')
    + (kind === 'hp' && isFlash && !reducedMotion ? ` stat-jolt jolt-${flash.n}` : '');
  const node = el('span', { cls, attrs: title ? { title } : {} });
  if (glyph) node.append(el('span', { cls: 'glyph', text: glyph }));
  node.append(document.createTextNode(text));
  return node;
}
