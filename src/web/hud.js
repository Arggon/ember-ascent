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
import { newGame } from './actions.js';
import { TEMPER_GLYPH, glyphBox } from './glyphs.js';
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
  // never disagree with the deck the modal lists.
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: `Deck (${snap.deckCount ?? (snap.deckCards || []).reduce((n, c) => n + c.count, 0)})`,
    attrs: {
      type: 'button',
      title: 'Your whole deck, duplicates counted — keyboard: d',
      'aria-label': `Deck: ${snap.deckCount} cards`,
    },
    on: { click: () => toggleDeck(true) },
  }));
  // S2 card codex: what the REWARDS can add to that deck. The pool is kernel content
  // (cardPool(), computed once — it never depends on the run), so the button announces
  // the same count the sheet will list.
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: 'Cards',
    attrs: {
      type: 'button',
      title: 'Every card the rewards can add to your deck — keyboard: k',
      'aria-label': `Card codex: ${CODEX_POOL.length} cards`,
    },
    on: { click: () => toggleCodex(true) },
  }));
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: 'Help',
    attrs: { type: 'button', title: 'How to play, and what every abbreviation means — keyboard: ?' },
    on: { click: () => toggleHelp(true) },
  }));
  hudEl.append(el('button', {
    cls: 'btn ghost',
    text: 'New Run',
    attrs: { type: 'button', title: `New run (seed ${snap.seed}) — keyboard: n` },
    on: { click: () => newGame() },
  }));
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
 * modal system: backdrop click and Escape both close, exactly like Help.
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
      el('span', { cls: 't-name', text: c.temperName || c.temperText.split(':')[0] }),
    ));
  }
  if (c.count > 1) {
    row.append(el('span', { cls: 'deck-count', text: `×${c.count}`, attrs: { title: `${c.count} copies in the deck` } }));
  }
  return row;
}

/* ---------------------------------------------------------------- CARD CODEX (S2) */

/**
 * The draft pool, computed ONCE at load: it is content-derived and phase-independent (the
 * kernel's `cardPool()`), so no repaint needs to recompute it. Rows arrive sorted by
 * rarity tier, then cost, then face name, then card id.
 */
const CODEX_POOL = cardPool();

/** The rarity groups in the order a new player should meet them; a group with no rows is skipped. */
const RARITY_GROUPS = [
  { key: 'common', label: 'Common' },
  { key: 'uncommon', label: 'Uncommon' },
  { key: 'rare', label: 'Rare' },
];

export let codexOpen = false;

export function toggleCodex(open) {
  codexOpen = open;
  repaint();
}

/**
 * The card codex sheet (S2): every card the draft pool can add to the deck, grouped by
 * rarity with group counts, read-only. Every row is a fact the kernel's `cardPool()`
 * published — names, costs, type words and descriptions all through the describe layer —
 * and the "in deck" chip is a sum of the kernel's own `deckCards` counts, so the sheet can
 * never show a card the reward deck cannot offer, or a copy the run does not hold. The
 * shell is the deck sheet's own — `.modal-back` > `.modal` > `.modal-scroll` +
 * `.modal-foot` — so the page keeps ONE modal system: backdrop click, Escape and Close
 * all dismiss it, exactly like Help and Deck.
 */
export function codexPanel() {
  const tally = inDeckCounts(snap.deckCards);
  const back = el('div', { cls: 'modal-back' });
  back.addEventListener('click', (ev) => { if (ev.target === back) toggleCodex(false); });

  const panel = el('div', { cls: 'modal codex-modal', attrs: { role: 'dialog', 'aria-label': `Card codex: ${CODEX_POOL.length} cards` } });
  const scroll = el('div', { cls: 'modal-scroll' });
  scroll.append(el('h2', { text: `Cards (${CODEX_POOL.length})` }));
  scroll.append(el('p', { cls: 'hint', text: 'Every card a combat reward can add to your deck. Pick with the fight ahead in mind.' }));

  for (const group of RARITY_GROUPS) {
    const rows = CODEX_POOL.filter((c) => c.rarity === group.key);
    if (rows.length === 0) continue;
    scroll.append(el('h3', { cls: 'codex-group-head', text: `${group.label} (${rows.length})` }));
    const list = el('div', { cls: 'codex-rows' });
    for (const c of rows) list.append(codexRow(c, tally.get(c.cardId) ?? 0));
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
