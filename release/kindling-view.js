// src/web/kindling-view.js — the act-start screen: the kindling boon choice.
//
// B1: the boon words come from the kernel snapshot. FIXED START (ruling): every run
// starts the same way — one hero (the Ashwright) on one start path (the Foundry) — so
// there is nothing to pick before the boons and the old radio-group pickers are gone.
// The other hero and the other start path stay reachable through the ?hero=/?biome=
// seeding in actions.js, now the only writer of those choices.

import { snap } from './runtime.js';
import { el, keywordText, sceneIllus } from './dom.js';
import { act } from './actions.js';
import { page } from './page-frame.js';
import { glyphBox, BOON_GLYPH } from './glyphs.js';
import { t } from './i18n.js';

/* ------------------------------------------------------------------ KINDLING */

/** #40: a boon's price must be as plain as its gift. The kernel sentence is
 *  "upside. cost." (BOONS in rules/kindling.js); the cost gets its own line,
 *  labelled and styled as a cost, so it is never mistaken for part of the upside
 *  (Iron Skin's relic-off price had no 'Lose' keyword, so nothing marked it).
 *  Falls back to one line when there is no second sentence. (Re-landed from the
 *  origin/main PR-#52 line in the 2026-11-17 merge: it shipped there on the
 *  pre-split monolith, and this module is where the kindling screen lives now.)
 * @param {string} text */
function boonParts(text) {
  const cut = text.indexOf('. ');
  if (cut < 0) return [keywordText(el('span', { cls: 'boon-text' }), text)];
  const upside = text.slice(0, cut + 1);
  const cost = text.slice(cut + 2);
  const costLine = el('span', { cls: 'boon-cost' },
    el('span', { cls: 'boon-cost-label', text: t('kindling.boonCost') }));
  costLine.append(cost);
  return [keywordText(el('span', { cls: 'boon-text' }), upside), costLine];
}

/** B1: the act-start boon choice. Every word comes from the kernel snapshot. */
export function kindlingView() {
  const wrap = el('div', { cls: 'kindling' });
  wrap.append(sceneIllus('event'));
  wrap.append(el('div', { cls: 'big-title kindling-head', text: t('kindling.head') }));
  wrap.append(el('p', { cls: 'kindling-note', text: t('kindling.note') }));
  const list = el('div', { cls: 'boon-list' });
  for (const b of snap.kindling.boons) {
    list.append(el('button', {
      cls: 'boon', attrs: { type: 'button', 'data-action': b.actionId, 'aria-label': `${b.name}: ${b.text}` },
      on: { click: () => act(b.actionId) },
    },
    // The boon's own small mark (BOON_GLYPH), decorative — the name and the kernel
    // sentence carry the meaning. An unknown id degrades to the rune, never an empty box.
    glyphBox(BOON_GLYPH[b.id] || 'rune', 'boon-glyph'),
    el('span', { cls: 'boon-name', text: b.name }),
    ...boonParts(b.text)));
  }
  wrap.append(list);
  return page('kindling', t('page.kindling'), 'flame', 'panel', [wrap]);
}
