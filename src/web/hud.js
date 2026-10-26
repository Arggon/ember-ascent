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
import { POTION_GLYPH, TEMPER_GLYPH, glyphBox } from './glyphs.js';
import { cardPool } from '../kernel/index.js';
import { inDeckCounts } from './deck-counts.js';

/* ------------------------------------------------------------------------- HUD */

export function renderHud() {
  hudEl.replaceChildren();
  const p = snap.player;

  hudEl.append(
    el('span', {
      cls: 'hud-char',
      text: snap.characterName || capitalize(snap.character),
      attrs: { title: snap.relicName ? `${snap.characterName} — relic: ${snap.relicName}` : '' },
    }),
  );

  // DESIGN REV 3 (UX spec): the word label is NOT part of the value text. Emitting `HP 60/60`
  // as one text node inside a chip with a 44px min-width is what wrapped the HUD into
  // two-line blocks on a phone ("HP" over "60/60"). The glyph carries the label, the title
  // carries the full sentence for hover and screen readers, and the value can never wrap.
  hudEl.append(stat('hp', '♥', `${p.hp}/${p.maxHp}`, flash.hp, `HP ${p.hp} of ${p.maxHp}`));
  hudEl.append(stat('energy', '⚡', `${p.energy}/${snap.energyPerTurn}`, flash.energy,
    `Energy ${p.energy} of ${snap.energyPerTurn}`));
  hudEl.append(stat('block', '⛨', String(p.block), flash.block, `Block ${p.block}`));
  // S3 gold economy: the purse is a READOUT, not a control — no button, no flash, just the
  // kernel's own `snap.player.gold` (the same value the CLI dump's GOLD header shows), so
  // the browser can never disagree with the engine about how rich you are.
  const purse = p.gold ?? 0;
  hudEl.append(stat('gold', '◉', String(purse), false, `Gold ${purse}`));
  hudEl.append(renderBelt());
  hudEl.append(el('span', { cls: 'hud-step', text: `step ${snap.stepIndex}` }));

  // A status that just landed on the PLAYER gets the same by-kind treatment as an enemy's.
  const freshSelf = freshStatusKeys([...(p.statuses || []), ...(p.powers || [])]);
  for (const s of p.statuses) hudEl.append(el('span', {
    cls: `pill ${s.key}` + (freshSelf.has(s.key) ? ' juice-in' : ''),
    text: s.text || `${s.label} ${s.stacks}`,
    attrs: { title: s.explain || '' },
  }));
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
    text: `Deck (${deckTotal})`,
    attrs: {
      type: 'button',
      title: 'Your whole deck, duplicates counted — keyboard: d',
      'aria-label': `Deck: ${deckTotal} cards`,
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
    text: 'Cards',
    attrs: {
      type: 'button',
      title: 'Every card the rewards can offer this run — keyboard: k',
      'aria-label': `Card codex: ${codexTotal} cards`,
    },
    on: { click: () => toggleCodex(true) },
  }));
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: 'Help',
    // No keyboard binding opens Help (the old "keyboard: ?" title named a key that was
    // never wired — POLISH round nit); Escape is how the OPEN sheet closes (app.js).
    attrs: { type: 'button', title: 'How to play, and what every abbreviation means (Escape closes it)' },
    on: { click: () => toggleHelp(true) },
  }));
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: 'New Run',
    attrs: { type: 'button', title: `New run (seed ${snap.seed}) — keyboard: n` },
    on: { click: () => newGame() },
  }));
}

/* --------------------------------------------------------------------- BELT (S5) */

/**
 * The potion belt: exactly `snap.beltSlots` slots beside the gold readout, in every
 * phase. A FILLED slot is a named glyph chip (mark + name, tooltip = the kernel's own
 * effect sentence); an EMPTY slot is a dim flask. In combat a filled slot is a BUTTON
 * that opens the quaff/discard popover (beltPanel below); anywhere else the belt is a
 * readout — the kernel offers belt actions in `phase === 'combat'` only, so a button
 * would promise an action the engine would reject. A stale belt id (a torn save)
 * renders under its raw id with the flask's rune fallback, exactly like the snapshot's
 * `known: false` row: it stays VISIBLE, never thrown away.
 * @returns {HTMLElement} the `.belt` group
 */
function renderBelt() {
  const rows = snap.belt ?? [];
  const slots = snap.beltSlots ?? 3;
  const belt = el('span', { cls: 'belt', attrs: { role: 'group', 'aria-label': `Potion belt: ${rows.length} of ${slots}` } });
  for (let i = 0; i < slots; i += 1) {
    const row = rows[i] ?? null;
    if (!row) {
      belt.append(el('span', {
        cls: 'belt-slot empty',
        attrs: { title: `Potion slot ${i + 1}: empty`, 'aria-label': `Potion slot ${i + 1}: empty` },
      }, glyphBox('flask', 'belt-glyph')));
      continue;
    }
    const tip = `${row.name} — ${row.text || 'unknown potion'}${row.known ? '' : ' (unknown potion id in this save)'}`;
    if (snap.phase === 'combat') {
      belt.append(el('button', {
        cls: 'belt-slot filled',
        attrs: {
          type: 'button',
          title: `${tip} — click for quaff / discard`,
          'aria-label': `Potion slot ${i + 1}: ${row.name}. Open quaff or discard.`,
          'aria-haspopup': 'dialog',
          'aria-expanded': String(beltOpenSlot === row.slot),
        },
        on: { click: (ev) => { ev.__dlbHandled = true; toggleBelt(row.slot); } },
      },
        glyphBox(POTION_GLYPH[row.potionId] || 'flask', 'belt-glyph'),
        el('span', { cls: 'belt-name', text: row.name }),
      ));
    } else {
      belt.append(el('span', {
        cls: 'belt-slot filled inert',
        attrs: { title: `${tip} — quaff and discard work in combat only`, 'aria-label': `Potion slot ${i + 1}: ${row.name}` },
      },
        glyphBox(POTION_GLYPH[row.potionId] || 'flask', 'belt-glyph'),
        el('span', { cls: 'belt-name', text: row.name }),
      ));
    }
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
  const back = el('div', { cls: 'modal-back', attrs: { role: 'dialog', 'aria-label': 'Potion' } });
  back.addEventListener('click', (ev) => { if (ev.target === back) toggleBelt(null); });
  // A missing row (a stale slot index after a repaint raced the click) renders as the
  // bare backdrop and NOTHING else: this function runs mid-render, so calling
  // toggleBelt(null) here used to flip a state flag DURING the paint — a nested
  // repaint against a half-built stage, with the next action's backdrop left stale.
  // The flag is presentation state; the next repaint (the next act() or hover) clears
  // it through the normal path, and an empty backdrop covers the stage meanwhile.
  if (!row) return back;

  const panel = el('div', { cls: 'modal belt-modal', attrs: { role: 'dialog', 'aria-label': `${row.name}: quaff or discard` } });
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: row.name }));
  scroll.append(el('p', { cls: 'belt-desc', text: row.text || 'An unknown potion — its id is not in this build\'s table. Discard it to free the slot.' }));

  const choices = el('div', { cls: 'belt-choices' });
  for (const id of row.quaffIds) {
    // An aimed potion lists one button per living enemy, named the way the targeting
    // step names them (position + face + HP), so the two flows read alike.
    const k = /_(\d+)$/.exec(id);
    const enemy = k ? snap.enemies[Number(k[1]) - 1] : null;
    choices.append(el('button', {
      cls: 'btn belt-act quaff',
      text: enemy ? `Quaff — ${enemy.name} (${enemy.hp}/${enemy.maxHp})` : 'Quaff',
      attrs: {
        type: 'button',
        'data-action': id,
        title: enemy ? `Aim at the ${ordinal(Number(k[1]))} living enemy` : row.text,
        'aria-label': enemy ? `Quaff ${row.name}, aimed at ${enemy.name}, ${enemy.hp} of ${enemy.maxHp} HP` : `Quaff ${row.name}. ${row.text}`,
      },
      on: { click: (ev) => { ev.__dlbHandled = true; act(id); toggleBelt(null); } },
    }));
  }
  if (row.discardId) {
    choices.append(el('button', {
      cls: 'btn secondary belt-act discard',
      text: 'Discard',
      attrs: {
        type: 'button',
        'data-action': row.discardId,
        title: 'Throw it away — the slot frees, nothing else changes',
        'aria-label': `Discard ${row.name}. The slot frees; nothing else changes.`,
      },
      on: { click: (ev) => { ev.__dlbHandled = true; act(row.discardId); toggleBelt(null); } },
    }));
  }
  scroll.append(choices);
  if (snap.phase !== 'combat') {
    scroll.append(el('p', { cls: 'hint', text: 'Quaff and discard work in combat only.' }));
  }

  panel.append(scroll);
  panel.append(el('div', { cls: 'modal-foot' },
    el('button', {
      cls: 'btn secondary',
      text: 'Close  (Esc)',
      attrs: { type: 'button', title: 'Keep the potion (keyboard: Escape)' },
      on: { click: () => toggleBelt(null) },
    }),
  ));
  back.append(panel);
  return back;
}

/** 1st/2nd/3rd… for the aim tooltip — presentation wording, not a rule. */
function ordinal(n) {
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n] ?? 'th'}`;
}

/* ----------------------------------------------------------------- HELP / GLOSSARY */

export let helpOpen = false;
export const HELP_SEEN_KEY = 'dlb.helpSeen.v1';

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

  const panel = el('div', { cls: 'modal', attrs: { role: 'dialog', 'aria-label': 'How to play' } });
  // Everything that can be long lives in the scroller: the panel scrolls INSIDE the
  // viewport instead of growing past it.
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: 'How to play' }));

  for (const topic of snap.help || []) {
    scroll.append(el('div', { cls: 'help-topic' },
      el('div', { cls: 'ht-title', text: topic.title }),
      el('div', { cls: 'ht-body', text: topic.body }),
    ));
  }

  // How targeting works is the SURFACE's behaviour, not a game rule, so this line lives
  // here rather than in the kernel's help topics: the engine has no opinion about clicks.
  scroll.append(el('div', { cls: 'help-topic' },
    el('div', { cls: 'ht-title', text: 'Aiming at one enemy' }),
    el('div', { cls: 'ht-body', text: 'When more than one enemy is alive, clicking a card that needs a target does not play it yet — the card lifts and every enemy that can be hit is highlighted and numbered. Click a highlighted enemy, or press its number, to hit that one; the enemy\'s telegraphed intent is shown beside it while you decide, so you can spend the hit on the one that hurts most. Press Escape, press 0, click the card again, or click empty space to put the card back and play something else. With a single enemy alive a card still plays in one click, and cards that say ALL or SELF never ask.' }),
  ));

  scroll.append(el('h2', { cls: 'mt', text: 'What the shorthand means' }));
  scroll.append(el('p', { cls: 'hint', text: 'Cards always describe themselves in words. These compact codes appear in the corner of a card, in the enemy\'s intent, and in the command-line version of the game.' }));

  // Grouped, so the vocabulary a player meets on every card is separated from the codes
  // that only ever appear on one card. The kernel supplies the grouping.
  const sections = snap.glossarySections || [{ key: 'A', title: 'Codes', blurb: '' }];
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
      text: 'Got it',
      attrs: { type: 'button' },
      on: { click: () => { try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch {} toggleHelp(false); } },
    }),
    // New Run moved here from the HUD (UX rev 3): it is destructive — it discards the run —
    // and never belonged one tap from End Turn. The `n` hotkey still starts a new run.
    el('button', {
      cls: 'btn secondary',
      text: 'New Run',
      attrs: { type: 'button', title: 'Discard this run and start a new one (keyboard: n)' },
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
 * The master-deck sheet (S1): every card the run owns, read-only. Every row is a fact the
 * kernel's snapshot already published (`snap.deckCards`, aggregated and sorted THERE), so
 * this viewer can never show a card the run does not own, a cost the engine does not
 * charge or a temper the rules do not resolve. The shell is the help sheet's own —
 * `.modal-back` > `.modal` > `.modal-scroll` + `.modal-foot` — so the page keeps ONE
 * modal system: the backdrop click and the Close button dismiss it exactly like Help,
 * and Escape closes either (app.js's sheet guards; the S1.1-era note that Help had no
 * Escape predates the keyguard round).
 */
export function deckPanel() {
  const rows = snap.deckCards || [];
  const count = snap.deckCount ?? rows.reduce((n, c) => n + c.count, 0);
  const back = el('div', { cls: 'modal-back' });
  back.addEventListener('click', (ev) => { if (ev.target === back) toggleDeck(false); });

  const panel = el('div', { cls: 'modal deck-modal', attrs: { role: 'dialog', 'aria-label': `Deck: ${count} cards` } });
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: `Deck (${count})` }));

  if (rows.length === 0) {
    scroll.append(el('p', { cls: 'hint', text: 'The deck is empty.' }));
  } else {
    const list = el('div', { cls: 'deck-rows' });
    for (const c of rows) list.append(deckRow(c));
    scroll.append(list);
  }

  panel.append(scroll);
  panel.append(el('div', { cls: 'modal-foot' },
    el('button', {
      cls: 'btn secondary',
      text: 'Close  (Esc)',
      attrs: { type: 'button', title: 'Back to the run (keyboard: Escape)' },
      on: { click: () => toggleDeck(false) },
    }),
  ));
  back.append(panel);
  return back;
}

/**
 * One deck row: cost, type word, face name, the temper stamp when the copy is tempered,
 * and ×N when the deck holds duplicates. Same stamp the hand tiles wear (`.ctemper`,
 * re-styled for rows in the deck section of style.css), so a tempered card is recognised
 * the same way everywhere.
 */
function deckRow(c) {
  const row = el('div', {
    cls: 'deck-row' + (c.tempered ? ` tempered temper-${c.temper}` : ''),
    attrs: c.tempered ? { title: c.temperText || c.temperName } : {},
  });
  row.append(el('span', { cls: 'deck-cost', attrs: { title: 'Energy cost' }, text: String(c.cost) }));
  row.append(el('span', { cls: 'deck-type', text: c.typeLabel }));
  row.append(el('span', { cls: 'deck-name', text: c.name }));
  if (c.tempered) {
    row.append(el('span', { cls: 'ctemper' },
      glyphBox(TEMPER_GLYPH[c.temper] || 'rune', 't-mark'),
      // The name alone: the kernel always publishes one for a tempered row, and any
      // fallback here would re-derive a describe-layer string on the web.
      el('span', { cls: 't-name', text: c.temperName }),
    ));
  }
  if (c.count > 1) {
    row.append(el('span', { cls: 'deck-count', text: `×${c.count}`, attrs: { title: `${c.count} copies in the deck` } }));
  }
  return row;
}

/* ---------------------------------------------------------------- CARD CODEX (S2) */

/**
 * The kernel's full-set LOOKUP TABLE, computed ONCE at load: describe-layer rows for every
 * card the shipped content could ever offer (`cardPool()`), sorted by rarity tier, then
 * cost, then face name, then card id. NOT the run's offerable pool by itself — a narrowed
 * unlock profile makes the truth shorter. The per-run filter is `runCodexRows()` below.
 */
const CODEX_POOL = cardPool();

/** The rarity groups in the order a new player should meet them; a group with no rows is skipped. */
const RARITY_GROUPS = [
  { key: 'common', label: 'Common' },
  { key: 'uncommon', label: 'Uncommon' },
  { key: 'rare', label: 'Rare' },
];
const RARITY_GROUP_KEYS = new Set(RARITY_GROUPS.map((g) => g.key));

/**
 * The codex rows the CURRENT run can actually be offered: the lookup table filtered to
 * `snap.draftPool` — the exact id set `rules/act.js rollReward` picks this run's rewards
 * from, which every snapshot publishes. Recomputed per read (a Set over at most 39 cached
 * rows — no describe work), so a new run's narrowing is live from its first paint. A
 * snapshot that predates the field (null: a state loaded from a legacy save) falls back
 * to the whole table — the best a surface can do when the kernel could not say — while an
 * EMPTY array is taken at its word: "Cards (0)", nothing offerable this run.
 * @returns {Array<typeof CODEX_POOL[number]>}
 */
function runCodexRows() {
  const ids = snap.draftPool;
  if (!Array.isArray(ids)) return CODEX_POOL;
  const offerable = new Set(ids);
  return CODEX_POOL.filter((c) => offerable.has(c.cardId));
}

export let codexOpen = false;

export function toggleCodex(open) {
  codexOpen = open;
  repaint();
}

/**
 * The card codex sheet (S2): every card THIS run's combat rewards can add to the deck,
 * grouped by rarity with group counts, read-only. The rows are the kernel's `cardPool()`
 * lookup filtered to the run's own `snap.draftPool` (so a narrowed profile shows only
 * what can really be offered), every cell is a describe-layer fact, and the "in deck"
 * chip is a sum of the kernel's own `deckCards` counts — the sheet can never show a card
 * the reward deck cannot offer, or a copy the run does not hold. The shell is the deck
 * sheet's own — `.modal-back` > `.modal` > `.modal-scroll` + `.modal-foot` — so the page
 * keeps ONE modal system: backdrop click, Escape and Close all dismiss it, exactly like
 * Help and Deck.
 */
export function codexPanel() {
  const rows = runCodexRows();
  const tally = inDeckCounts(snap.deckCards);
  const back = el('div', { cls: 'modal-back' });
  back.addEventListener('click', (ev) => { if (ev.target === back) toggleCodex(false); });

  const panel = el('div', { cls: 'modal codex-modal', attrs: { role: 'dialog', 'aria-label': `Card codex: ${rows.length} cards` } });
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: `Cards (${rows.length})` }));
  scroll.append(el('p', { cls: 'hint', text: 'Every card a combat reward can add to your deck this run. Pick with the fight ahead in mind.' }));

  // The three rarity tiers, then a catch-all so the header total can never count a row no
  // group renders: a rarity the tiers above do not name still shows, under "Other".
  for (const group of [...RARITY_GROUPS, { key: null, label: 'Other' }]) {
    const groupRows = group.key === null
      ? rows.filter((c) => !RARITY_GROUP_KEYS.has(c.rarity))
      : rows.filter((c) => c.rarity === group.key);
    if (groupRows.length === 0) continue;
    scroll.append(el('h3', { cls: 'codex-group-head', text: `${group.label} (${groupRows.length})` }));
    const list = el('div', { cls: 'codex-rows' });
    for (const c of groupRows) list.append(codexRow(c, tally.get(c.cardId) ?? 0));
    scroll.append(list);
  }

  panel.append(scroll);
  panel.append(el('div', { cls: 'modal-foot' },
    el('button', {
      cls: 'btn secondary',
      text: 'Close  (Esc)',
      attrs: { type: 'button', title: 'Back to the run (keyboard: Escape)' },
      on: { click: () => toggleCodex(false) },
    }),
  ));
  back.append(panel);
  return back;
}

/**
 * One codex row: cost, type word, face name, rarity tag, the card's own describe-layer
 * sentence, and — only when the deck holds at least one copy — the brass "in deck ×N"
 * chip. Zero copies render no chip: absence is the fact, and 39 zero chips would bury it.
 */
function codexRow(c, inDeck) {
  const row = el('div', { cls: 'codex-row', attrs: { 'data-rarity': c.rarity } });
  const line = el('div', { cls: 'codex-line' });
  line.append(el('span', { cls: 'codex-cost', attrs: { title: 'Energy cost' }, text: String(c.cost) }));
  line.append(el('span', { cls: 'codex-type', text: c.typeLabel }));
  line.append(el('span', { cls: 'codex-name', text: c.name }));
  line.append(el('span', { cls: 'codex-rarity', text: c.rarity, attrs: { title: `Rarity: ${c.rarity}` } }));
  if (inDeck > 0) {
    line.append(el('span', {
      cls: 'codex-indeck',
      text: `in deck ×${inDeck}`,
      attrs: { title: `${inDeck} ${inDeck === 1 ? 'copy' : 'copies'} in your deck` },
    }));
  }
  row.append(line);
  row.append(el('div', { cls: 'codex-desc', text: c.description }));
  return row;
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
